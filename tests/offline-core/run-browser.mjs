// Real IndexedDB/Web Locks against an isolated synthetic adapter; no app/auth/DB service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, firefox, webkit } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, '.local/offline-core-browser');
await build({
  configFile: false,
  root,
  logLevel: 'error',
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: path.join(root, 'tests/offline-core/harness.ts'),
      formats: ['iife'],
      name: 'OfflineHarness',
      fileName: () => 'harness.js',
    },
  },
});
const server = createServer(async (request, response) => {
  if (request.url === '/harness.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(path.join(outDir, 'harness.js')));
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><html lang="en"><title>Synthetic offline core verification</title><body><p>Isolated real browser storage test; synthetic transport.</p><script src="/harness.js"></script></body></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [name, engine] of Object.entries({ chromium, webkit, firefox })) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => !!window.offlineHarness, { timeout: 10_000 });
      const results = {};
      for (const scenario of ['basic', 'uncertain', 'isolation', 'ageAndCapacity']) {
        results[scenario] = await page.evaluate(
          ({ scenario, db }) => window.offlineHarness[scenario](db),
          { scenario, db: `sankalpa-test-${name}-${scenario}-${crypto.randomUUID()}` },
        );
      }
      const reloadDb = `sankalpa-test-reload-${crypto.randomUUID()}`;
      await page.evaluate((db) => window.offlineHarness.seedReload(db), reloadDb);
      await page.reload();
      await page.waitForFunction(() => !!window.offlineHarness, { timeout: 10_000 });
      results.reload = await page.evaluate(
        (db) => window.offlineHarness.verifyReload(db),
        reloadDb,
      );
      const lockDb = `sankalpa-test-lock-${crypto.randomUUID()}`;
      await page.evaluate((db) => window.offlineHarness.startHeld(db), lockDb);
      const other = await context.newPage();
      await other.goto(url);
      await other.waitForFunction(() => !!window.offlineHarness, { timeout: 10_000 });
      results.multitab = await other.evaluate((db) => window.offlineHarness.otherTab(db), lockDb);
      assert.equal(
        (await page.evaluate(() => window.offlineHarness.releaseHeld())).acknowledged,
        1,
      );
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({ browser: name, status: 'PASS', results, pageErrors: errors.length }),
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
