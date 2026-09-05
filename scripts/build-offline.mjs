import { build } from 'vite';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const shellRoot = resolve(root, 'src/service-worker/shell');
const output = resolve(root, 'public/offline');
const common = {
  configFile: false,
  envFile: false,
  envPrefix: 'SANKALPA_PUBLIC_',
  publicDir: false,
  resolve: { alias: { '@': resolve(root, 'src') } },
  plugins: [
    {
      name: 'public-shell-boundary',
      resolveId(source) {
        if (source === 'next' || source.startsWith('next/') || source.includes('/server/'))
          throw new Error('The public offline bundle must not import Next or server modules.');
      },
    },
  ],
};

await mkdir(output, { recursive: true });
await build({
  ...common,
  root: shellRoot,
  base: '/offline/',
  build: { outDir: output, emptyOutDir: true, sourcemap: false, target: 'es2022' },
});

const paths = await readdir(output, { recursive: true });
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
const assets = [];
const hash = createHash('sha256');
for (const path of paths.sort()) {
  if (!path.includes('.')) continue;
  const contentType = types[path.split('.').at(-1)];
  if (!contentType) throw new Error('Unexpected asset in the public offline bundle.');
  const body = await readFile(resolve(output, path));
  hash.update(path).update(body);
  assets.push({ path: '/offline/' + path, contentType });
}
for (const source of ['worker.ts', 'policy.ts'])
  hash.update(await readFile(resolve(root, 'src/service-worker', source)));
const version = hash.digest('hex').slice(0, 20);
await build({
  ...common,
  root,
  define: {
    __PUBLIC_ASSETS__: JSON.stringify(assets),
    __PUBLIC_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: resolve(root, 'public'),
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2022',
    lib: {
      entry: resolve(root, 'src/service-worker/worker.ts'),
      formats: ['iife'],
      name: 'SankalpaPublicWorker',
      fileName: () => 'sw.js',
    },
  },
});
await writeFile(
  resolve(output, 'asset-manifest.json'),
  JSON.stringify({ version, assets }, null, 2) + '\n',
);
console.log(`Public offline shell built: ${assets.length} assets, version ${version}.`);
