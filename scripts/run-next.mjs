import { spawn, spawnSync } from 'node:child_process';

const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) throw new Error('Expected dev or start.');
if (mode === 'dev') {
  const built = spawnSync(process.execPath, ['scripts/build-offline.mjs'], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    mode,
    '--hostname',
    '127.0.0.1',
    '--port',
    process.env.PORT || '3000',
  ],
  { stdio: 'inherit', env: process.env },
);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
