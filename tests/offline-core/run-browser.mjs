// Real IndexedDB/Web Locks against an isolated synthetic adapter; no app/auth/DB service.
/* global window */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { log } from 'node:console';
import process from 'node:process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, firefox, webkit } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const summary = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty:
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length >
    0,
  startedAt: new Date().toISOString(),
  scope: process.env.OFFLINE_SCENARIOS ? 'focused' : 'full',
  integration: 'Synthetic transport; real browser IndexedDB, Web Locks and document reload.',
  browsers: [],
};
let complete = false;
const outDir = path.join(root, '.local/offline-core-browser');
await build({
  configFile: false,
  root,
  envFile: false,
  envPrefix: 'SANKALPA_SYNTHETIC_',
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
const firefoxAppData = path.join(root, '.local/offline-core-firefox-app-data');
await mkdir(firefoxAppData, { recursive: true, mode: 0o700 });
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
    const browser = await engine.launch(
      name === 'firefox' ? { env: { ...process.env, MOZ_APP_DATA: firefoxAppData } } : {},
    );
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => !!window.offlineHarness, { timeout: 10_000 });
      const results = {};
      for (const scenario of process.env.OFFLINE_SCENARIOS?.split(',') ?? [
        'basic',
        'uncertain',
        'isolation',
        'ageAndCapacity',
        'staleResolution',
        'independentResolution',
        'comparisonVersion',
        'orderedReplacement',
        'accountChanged',
        'switchDuringReplay',
        'storageFailures',
        'queueCeiling',
        'resolutionBoundaries',
        'transportFailures',
        'comparisonAccountChange',
      ]) {
        results[scenario] = await page.evaluate(
          ({ scenario, db }) => window.offlineHarness[scenario](db),
          { scenario, db: `sankalpa-test-${name}-${scenario}-${randomUUID()}` },
        );
      }
      const reloadDb = `sankalpa-test-reload-${randomUUID()}`;
      await page.evaluate((db) => window.offlineHarness.seedReload(db), reloadDb);
      await page.reload();
      await page.waitForFunction(() => !!window.offlineHarness, { timeout: 10_000 });
      results.reload = await page.evaluate(
        (db) => window.offlineHarness.verifyReload(db),
        reloadDb,
      );
      const lockDb = `sankalpa-test-lock-${randomUUID()}`;
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
      const result = {
        browser: name,
        version: browser.version(),
        status: 'PASS',
        results,
        pageErrors: errors.length,
      };
      summary.browsers.push(result);
      log(JSON.stringify(result));
      await context.close();
    } finally {
      await browser.close();
    }
  }
  complete = true;
} finally {
  await new Promise((resolve) => server.close(resolve));
  const directory = path.join(root, 'artifacts/offline-core');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'summary.json'),
    JSON.stringify(
      {
        ...summary,
        finishedAt: new Date().toISOString(),
        status: complete ? 'PASS' : 'INCOMPLETE',
      },
      null,
      2,
    ) + '\n',
  );
}
