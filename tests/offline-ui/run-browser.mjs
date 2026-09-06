/* global window, document */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { log as consoleLog } from 'node:console';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { chromium, webkit, firefox, expect } from '@playwright/test';
import { runAccountRaces } from './account-races.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const development = process.argv.includes('--development');
const out = path.join(root, '.local/offline-ui-browser');
const scenarioNames = [
  'failed-draft-preservation',
  'storage-read-withholding',
  'canonical-change-notification',
  'canonical-save-feedback-after-prop-refresh',
  'immediate-checkbox',
  'shared-device-roundtrip',
  'dirty-online-input-guards-private-mode',
  'post-privacy-read-failure-recovery',
  'invalid-numeric-reload',
  'account-quarantine',
  'concurrent-draft-cleanup-CAS',
  'full-ordered-conflict-and-explicit-discard',
  'compact-privacy-320px',
  'unverified-storage-blocks-signout',
  'verified-response-binding-CAS-race',
  'stale-account-verification-denial',
  'readiness-account-change-race',
  'readiness-clear-does-not-resurrect',
  'storage-failure-still-requires-identity',
  'scope-less-online-mode-rechecks-identity',
  'logout-failure-retains-retry-after-local-purge',
  'initial-private-bind-requires-live-verification',
  'verified-local-offline-focus-preserves-input',
  'unavailable-identity-preserves-only-in-memory-input',
  'authoritative-signed-out-retry-needs-no-post',
];
const summary = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  ),
  integration: 'SIMULATED_BACKEND_AND_PUBLIC_SHELL_READINESS',
  renderMode: development ? 'DEVELOPMENT_STRICT_MODE' : 'PRODUCTION',
  browsers: [],
};
let activeResult;
function log(serialized) {
  const result = JSON.parse(serialized);
  if (result.status === 'PASS' && activeResult) {
    for (const name of result.scenarios ?? [result.scenario]) {
      const scenario = activeResult.scenarios.find((item) => item.name === name);
      if (scenario) scenario.status = 'PASS';
    }
  }
  consoleLog(serialized);
}
await build({
  configFile: false,
  root,
  envFile: false,
  envPrefix: 'SANKALPA_SYNTHETIC_',
  define: { 'process.env.NODE_ENV': JSON.stringify(development ? 'development' : 'production') },
  logLevel: 'error',
  plugins: [
    {
      name: 'synthetic-enqueue-race',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === '../core' && importer?.includes('/src/offline/ui/'))
          return path.join(root, 'tests/offline-ui/core-adapter.ts');
      },
    },
  ],
  resolve: { alias: { '@': path.join(root, 'src') } },
  build: {
    outDir: out,
    emptyOutDir: true,
    lib: {
      entry: path.join(root, 'tests/offline-ui/harness.tsx'),
      formats: ['iife'],
      name: 'OfflineUiHarness',
      fileName: () => 'harness.js',
      cssFileName: 'harness',
    },
  },
});
let accountId = '12000000-0000-4000-8000-000000000001';
let session;
let reflection = null;
const server = createServer(async (request, response) => {
  if (request.url === '/harness.js' || request.url === '/harness.css') {
    response.setHeader(
      'Content-Type',
      request.url.endsWith('.js') ? 'text/javascript' : 'text/css',
    );
    response.end(await readFile(path.join(out, request.url.slice(1))));
    return;
  }
  if (request.url.startsWith('/api/') || request.url.startsWith('/synthetic/')) {
    response.setHeader('Content-Type', 'application/json');
    const chunks = [];
    for await (const part of request) chunks.push(part);
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const reply = (data, status = 200) => {
      response.statusCode = status;
      response.end(JSON.stringify(data));
    };
    if (request.url === '/synthetic/reset') {
      accountId = '12000000-0000-4000-8000-000000000001';
      session = input;
      reflection = null;
      reply({ ok: true });
      return;
    }
    if (request.url === '/synthetic/advance') {
      session.revision++;
      session.practices[0].value = true;
      session.practices[1].value = 12;
      reply({ ok: true });
      return;
    }
    if (request.url === '/synthetic/account') {
      accountId = input.accountId;
      reply({ ok: true });
      return;
    }
    if (request.url === '/api/auth/session') {
      reply({ accountId, now: '2026-09-05T01:00:00.000Z' });
      return;
    }
    if (request.headers['x-sankalpa-account'] !== accountId) {
      reply({ error: { code: 'ACCOUNT_CHANGED' } }, 409);
      return;
    }
    if (request.url.endsWith('/reflection')) {
      if (request.method === 'GET') {
        reply(reflection);
        return;
      }
      if (input.baseRevision !== (reflection?.revision ?? 0)) {
        reply({ error: { code: 'REVISION_CONFLICT' } }, 409);
        return;
      }
      reflection = {
        ...input.payload,
        sessionId: session.id,
        journeyId: session.journeyId,
        scheduleVersionId: session.scheduleVersionId,
        revision: (reflection?.revision ?? 0) + 1,
        createdAt: '2026-09-05T01:00:00.000Z',
        updatedAt: '2026-09-05T01:00:00.000Z',
      };
      reply({
        sessionId: session.id,
        revision: reflection.revision,
        updatedAt: reflection.updatedAt,
      });
      return;
    }
    if (request.method === 'GET') {
      reply({ session, now: '2026-09-05T01:00:00.000Z' });
      return;
    }
    if (input.baseRevision !== session.revision) {
      reply({ error: { code: 'REVISION_CONFLICT' } }, 409);
      return;
    }
    if (request.url.endsWith('/practices'))
      session.practices = session.practices.map((item) => ({
        ...item,
        value: input.payload.values[item.id] ?? item.value,
      }));
    if (request.url.endsWith('/completion')) {
      session.confirmed = request.method !== 'DELETE';
      session.performedAt = session.confirmed ? input.payload.performedAt : null;
      session.recordedAt = session.confirmed ? '2026-09-05T01:00:00.000Z' : null;
    }
    session.revision++;
    reply({ session });
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(
    '<!doctype html><html lang="en"><title>Synthetic offline UI verification</title><link rel="stylesheet" href="/harness.css"><body><div id="root"></div><script src="/harness.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const firefoxData = path.join(root, '.local/offline-ui-firefox');
await mkdir(firefoxData, { recursive: true, mode: 0o700 });
try {
  for (const [name, engine] of Object.entries(
    process.env.SANKALPA_FULL_BROWSER_SUITE === '1' ? { chromium, webkit, firefox } : { chromium },
  )) {
    const browser = await engine.launch(
      name === 'firefox' ? { env: { ...process.env, MOZ_APP_DATA: firefoxData } } : {},
    );
    const result = {
      browser: name,
      version: browser.version(),
      status: 'NOT_RUN',
      pageErrors: null,
      scenarios: scenarioNames.map((name) => ({ name, status: 'NOT_RUN' })),
    };
    summary.browsers.push(result);
    activeResult = result;
    const errors = [];
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('pageerror', (error) => {
        errors.push(error.message);
        log(JSON.stringify({ browser: name, error: error.message, stack: error.stack }));
      });
      await page.goto(url);
      await expect(page.getByText('Offline state: ready', { exact: true }))
        .toBeVisible()
        .catch(async (error) => {
          log(JSON.stringify({ errors, syntheticBody: await page.locator('body').innerText() }));
          throw error;
        });
      await page.evaluate(async () => {
        const h = window.offlineUiHarness;
        await window.fetch('/synthetic/reset', {
          method: 'POST',
          body: JSON.stringify(h.snapshot.session),
        });
      });
      const note = page.getByLabel('Your reflection', { exact: true });
      await expect(note).toBeVisible();
      await page.evaluate(() => window.offlineUiHarness.denyDrafts(true));
      await note.fill('Synthetic note preserved through storage failure.');
      await expect(
        page.getByRole('heading', { name: 'Your draft has not been saved' }),
      ).toBeVisible();
      await page.evaluate(async () => {
        const h = window.offlineUiHarness;
        const d = await h.core.getDeviceState();
        await h.core.saveSnapshot(d.scope, h.snapshot);
      });
      await expect(note).toHaveValue('Synthetic note preserved through storage failure.');
      await page.evaluate(() => window.offlineUiHarness.refreshCanonicalProps(['noticed']));
      await expect(page.getByText('What did you notice?', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Private reflection' }).getByRole('status'),
      ).toHaveText('Not saved on this device. Keep this page open.');
      await page.evaluate(() => {
        window.offlineUiHarness.denyReads(true);
        window.dispatchEvent(new window.Event('pageshow'));
      });
      await expect(
        page.getByRole('heading', { name: 'Verify local storage to continue' }),
      ).toBeVisible();
      await expect(note).toBeHidden();
      await expect(note).toHaveValue('Synthetic note preserved through storage failure.');
      await page.evaluate(() => window.offlineUiHarness.denyReads(false));
      await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
      await expect(note).toBeVisible();
      await expect(note).toHaveValue('Synthetic note preserved through storage failure.');
      await page.evaluate(() => window.offlineUiHarness.denyDrafts(false));
      await page.getByRole('button', { name: 'Try saving draft again', exact: true }).click();
      await expect(note).toBeEnabled();
      await expect(
        page.getByRole('region', { name: 'Private reflection' }).getByRole('status'),
      ).toHaveText('Saved.');
      assert.equal(await page.evaluate(() => window.offlineUiHarness.canonicalChanges()), 1);
      const checkbox = page.getByRole('checkbox', { name: 'Synthetic checklist', exact: true });
      await checkbox.check();
      await expect(checkbox).toBeChecked();
      await expect(
        page.getByRole('region', { name: 'Practice checklist' }).locator('p[role=status]'),
      ).toHaveText('Saved.');
      assert.equal(await page.evaluate(() => window.offlineUiHarness.canonicalChanges()), 2);
      await page.evaluate(() => window.offlineUiHarness.refreshCanonicalProps([]));
      await expect(page.getByText('What did you notice?', { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Practice checklist' }).locator('p[role=status]'),
      ).toHaveText('Saved.');
      assert.equal(await page.evaluate(() => window.offlineUiHarness.canonicalChanges()), 2);
      await page.getByRole('button', { name: 'Mark this as a shared device', exact: true }).click();
      await expect(page.getByText('Offline state: online_only', { exact: true })).toBeVisible();
      await page
        .getByLabel('Synthetic online input', { exact: true })
        .fill('Preserve this unsubmitted input');
      await page
        .getByRole('button', { name: 'Use private local storage on this device', exact: true })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Save or cancel your current input' }),
      ).toBeVisible();
      await expect(page.getByLabel('Synthetic online input', { exact: true })).toHaveValue(
        'Preserve this unsubmitted input',
      );
      await page.getByLabel('Synthetic online input', { exact: true }).fill('');
      await page.evaluate(() => window.offlineUiHarness.denyAfterPrivacyMutation());
      await page
        .getByRole('button', { name: 'Use private local storage on this device', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Verify local storage to continue' }),
      ).toBeVisible();
      await page.evaluate(() => window.offlineUiHarness.denyReads(false));
      await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
      await expect(page.getByText('Offline state: ready', { exact: true })).toBeVisible();
      const numeric = page.getByLabel('Synthetic minutes', { exact: true });
      await numeric.fill('');
      await numeric.pressSequentially('1e-');
      await expect(numeric).toHaveValue('1e-');
      await expect(
        page.getByRole('region', { name: 'Practice checklist' }).locator('p[role=status]'),
      ).toHaveText('Draft saved on this device.');
      await page.reload();
      await expect(numeric).toHaveValue('1e-');
      await page.evaluate(() => window.offlineUiHarness.refreshCanonicalProps(['noticed']));
      await expect(page.getByText('What did you notice?', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Practice checklist' }).locator('p[role=status]'),
      ).toHaveText('Draft saved on this device.');
      await page.route('**/api/**', (route) => route.abort());
      await page
        .getByLabel('Your reflection', { exact: true })
        .fill('Synthetic note belongs only to the original account.');
      await expect(
        page.getByRole('region', { name: 'Private reflection' }).getByRole('status'),
      ).toContainText('Saved on this device');
      await page.evaluate(() => window.offlineUiHarness.refreshCanonicalProps([]));
      await expect(page.getByText('What did you notice?', { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Private reflection' }).getByRole('status'),
      ).toContainText('Saved on this device');
      await page.evaluate(() => window.offlineUiHarness.switchAccount());
      await expect(
        page.getByRole('heading', { name: 'Local changes belong to another account' }),
      ).toBeVisible();
      await expect(
        page.getByText('Synthetic note belongs only to the original account.', { exact: true }),
      ).toHaveCount(0);
      assert.deepEqual(errors, []);
      await mkdir(path.join(root, '.local/offline-ui-evidence'), { recursive: true });
      if (process.env.SANKALPA_MILESTONE_EVIDENCE === '1')
        await page.screenshot({
          path: path.join(root, '.local/offline-ui-evidence', `${name}-quarantine.png`),
          fullPage: true,
        });
      log(
        JSON.stringify({
          browser: name,
          status: 'PASS',
          scenarios: [
            'failed-draft-preservation',
            'storage-read-withholding',
            'canonical-change-notification',
            'canonical-save-feedback-after-prop-refresh',
            'immediate-checkbox',
            'shared-device-roundtrip',
            'dirty-online-input-guards-private-mode',
            'post-privacy-read-failure-recovery',
            'invalid-numeric-reload',
            'account-quarantine',
          ],
          pageErrors: errors.length,
        }),
      );
      const raceContext = await browser.newContext();
      const race = await raceContext.newPage();
      race.on('pageerror', (error) => errors.push(error.message));
      await race.goto(url);
      await expect(race.getByLabel('Synthetic minutes', { exact: true })).toBeEnabled();
      await race.route('**/api/**', (route) => route.abort());
      await race.getByLabel('Synthetic minutes', { exact: true }).fill('25');
      await expect(
        race.getByRole('region', { name: 'Practice checklist' }).locator('p[role=status]'),
      ).toHaveText('Draft saved on this device.');
      await race.evaluate(() => {
        const h = window.offlineUiHarness;
        h.replaceDraftAfterEnqueue({
          numericValues: { [h.snapshot.session.practices[1].id]: '42' },
        });
      });
      await race
        .getByRole('button', { name: 'Save value for Synthetic minutes', exact: true })
        .click();
      await expect(
        race.getByRole('heading', { name: 'Your draft has not been saved', exact: true }),
      ).toBeVisible();
      assert.equal(
        await race.evaluate(async () => {
          const h = window.offlineUiHarness;
          const d = await h.core.getDeviceState();
          const saved = await h.core.read(d.scope, h.snapshot.session.id);
          return saved.draft.numericValues[h.snapshot.session.practices[1].id];
        }),
        '42',
      );
      await raceContext.close();
      log(
        JSON.stringify({ browser: name, status: 'PASS', scenario: 'concurrent-draft-cleanup-CAS' }),
      );
      const conflictContext = await browser.newContext();
      const conflict = await conflictContext.newPage();
      conflict.on('pageerror', (error) => errors.push(error.message));
      await conflict.goto(url);
      await expect(conflict.getByLabel('Synthetic minutes', { exact: true })).toBeEnabled();
      await conflict.evaluate(async () => {
        await window.fetch('/synthetic/reset', {
          method: 'POST',
          body: JSON.stringify(window.offlineUiHarness.snapshot.session),
        });
      });
      await conflict.route('**/api/**', (route) => route.abort());
      const conflictCheckbox = conflict.getByRole('checkbox', {
        name: 'Synthetic checklist',
        exact: true,
      });
      await conflictCheckbox.check();
      await expect(conflictCheckbox).toBeEnabled();
      await conflictCheckbox.uncheck();
      await expect(conflictCheckbox).toBeEnabled();
      await conflict.getByLabel('Synthetic minutes', { exact: true }).fill('later');
      await expect(
        conflict.getByRole('region', { name: 'Practice checklist' }).locator('p[role=status]'),
      ).toHaveText('Draft saved on this device.');
      await conflict.evaluate(() => window.fetch('/synthetic/advance', { method: 'POST' }));
      await conflict.unroute('**/api/**');
      await conflict.getByRole('button', { name: 'Retry sync', exact: true }).click();
      await expect(
        conflict.getByRole('heading', { name: 'This saved practice changed elsewhere' }),
      ).toBeVisible();
      await expect(
        conflict.getByRole('list', { name: 'Changes in order' }).locator(':scope > li'),
      ).toHaveCount(2);
      await expect(conflict.getByRole('region', { name: 'Current saved version' })).toContainText(
        'Synthetic minutes: 12',
      );
      await expect(conflict.getByRole('region', { name: 'Your unsynced version' })).toContainText(
        'Synthetic minutes: later',
      );
      await conflict.evaluate(() => window.offlineUiHarness.refreshCanonicalProps(['noticed']));
      await expect(conflict.getByText('What did you notice?', { exact: true })).toBeVisible();
      await expect(
        conflict.getByRole('region', { name: 'Practice checklist' }).locator('p[role=status]'),
      ).toHaveText('Saved on this device. Review the conflict below.');
      await conflict.getByRole('button', { name: 'Keep my reviewed version', exact: true }).click();
      await expect(
        conflict.getByRole('heading', { name: 'This saved practice changed elsewhere' }),
      ).toHaveCount(0);
      await expect
        .poll(() =>
          conflict.evaluate(async () => {
            const h = window.offlineUiHarness;
            const d = await h.core.getDeviceState();
            const v = await h.core.read(d.scope, h.snapshot.session.id);
            return [
              v.operations.length,
              v.snapshot.session.revision,
              v.snapshot.session.practices[0].value,
              v.draft?.numericValues?.[h.snapshot.session.practices[1].id],
            ];
          }),
        )
        .toEqual([0, 4, false, 'later']);
      await conflict.route('**/api/**', (route) => route.abort());
      await conflictCheckbox.check();
      await expect(conflictCheckbox).toBeEnabled();
      await conflict.evaluate(() => window.fetch('/synthetic/advance', { method: 'POST' }));
      await conflict.unroute('**/api/**');
      await conflict.getByRole('button', { name: 'Retry sync', exact: true }).click();
      await expect(
        conflict.getByRole('heading', { name: 'This saved practice changed elsewhere' }),
      ).toBeVisible();
      const notificationsBeforeDiscard = await conflict.evaluate(() =>
        window.offlineUiHarness.canonicalChanges(),
      );
      await conflict
        .getByRole('button', {
          name: 'Use saved version and discard these local changes',
          exact: true,
        })
        .click();
      await expect(
        conflict.getByRole('heading', { name: 'This saved practice changed elsewhere' }),
      ).toHaveCount(0);
      assert.ok(
        (await conflict.evaluate(() => window.offlineUiHarness.canonicalChanges())) >
          notificationsBeforeDiscard,
      );
      assert.deepEqual(
        await conflict.evaluate(async () => {
          const h = window.offlineUiHarness;
          const d = await h.core.getDeviceState();
          const v = await h.core.read(d.scope, h.snapshot.session.id);
          return [v.operations.length, v.snapshot.session.revision, v.draft];
        }),
        [0, 5, null],
      );
      await conflictContext.close();
      log(
        JSON.stringify({
          browser: name,
          status: 'PASS',
          scenario: 'full-ordered-conflict-and-explicit-discard',
        }),
      );
      const compactContext = await browser.newContext({ viewport: { width: 320, height: 800 } });
      const compact = await compactContext.newPage();
      compact.on('pageerror', (error) => errors.push(error.message));
      await compact.goto(`${url}/?compact`);
      await expect(compact.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      await expect(
        compact.getByRole('button', { name: 'Mark this as a shared device', exact: true }),
      ).toBeHidden();
      await compact.getByRole('button', { name: 'Device privacy', exact: true }).click();
      await expect(
        compact.getByRole('button', { name: 'Mark this as a shared device', exact: true }),
      ).toBeVisible();
      await compact.getByRole('button', { name: 'Device privacy', exact: true }).click();
      await compact.route('**/api/**', (route) => route.abort());
      await compact.getByRole('checkbox', { name: 'Synthetic checklist', exact: true }).check();
      await expect(
        compact.getByRole('checkbox', { name: 'Synthetic checklist', exact: true }),
      ).toBeEnabled();
      await compact.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(
        compact.getByRole('heading', { name: 'Local changes need attention', exact: true }),
      ).toBeVisible();
      assert.equal(
        await compact.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      if (process.env.SANKALPA_MILESTONE_EVIDENCE === '1')
        await compact.screenshot({
          path: path.join(root, '.local/offline-ui-evidence', `${name}-compact-320.png`),
          fullPage: true,
        });
      await compact.getByRole('button', { name: 'Keep signed in', exact: true }).click();
      await expect(
        compact.getByRole('heading', { name: 'Local changes need attention', exact: true }),
      ).toBeHidden();
      await expect(
        compact.getByRole('checkbox', { name: 'Synthetic checklist', exact: true }),
      ).toBeEnabled();
      await compactContext.close();
      const denied = await context.newPage();
      denied.on('pageerror', (error) => errors.push(error.message));
      await denied.goto(`${url}/?denyReads`);
      await expect(denied.getByText('Offline state: online_only', { exact: true })).toBeVisible();
      await denied.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(
        denied.getByRole('region', { name: 'Device privacy' }).getByRole('status'),
      ).toBeVisible();
      await expect(denied).not.toHaveTitle('Synthetic signed out');
      await denied.close();
      assert.deepEqual(errors, []);
      log(
        JSON.stringify({
          browser: name,
          status: 'PASS',
          scenarios: ['compact-privacy-320px', 'unverified-storage-blocks-signout'],
          pageErrors: errors.length,
        }),
      );
      await context.close();
      await runAccountRaces(browser, url, errors, (scenario) =>
        log(JSON.stringify({ browser: name, status: 'PASS', scenario })),
      );
      assert.deepEqual(errors, []);
      result.status = 'PASS';
      result.pageErrors = errors.length;
    } catch (error) {
      result.status = 'FAIL';
      result.pageErrors = errors.length;
      throw error;
    } finally {
      await browser.close();
    }
  }
} finally {
  await mkdir(path.join(root, 'artifacts/offline-ui'), { recursive: true });
  await writeFile(
    path.join(
      root,
      development
        ? 'artifacts/offline-ui/strict-summary.json'
        : 'artifacts/offline-ui/summary.json',
    ),
    JSON.stringify(summary, null, 2) + '\n',
  );
  await new Promise((resolve) => server.close(resolve));
}
