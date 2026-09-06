import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page, Route, TestInfo } from '@playwright/test';

import type { JourneyDraftPreview, JourneyView } from '../../src/domain/contracts';
import { test, expect } from './test';
import { capturedSignIn } from './helpers/sign-in';
import { setUiClock } from './helpers/clock';

const NOW = '2026-09-05T00:45:00Z';
const NEXT_SCRIPTS = /\/_next\/static\/.*\.js(?:\?.*)?$/;

// These account-boundary scenarios exercise the real online app. Blocking workers
// makes the explicit script/logout transport gates observable in every engine;
// separate offline tests exercise the actual installed worker and public cache.
test.use({ serviceWorkers: 'block' });

function gate() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function identity(page: Page) {
  const response = await page.request.get('/api/auth/session');
  expect(response.status()).toBe(200);
  const result = (await response.json()) as { accountId: string };
  expect(result.accountId).toMatch(/^[a-f0-9-]{36}$/);
  return result.accountId;
}

async function createPractice(page: Page, label: string) {
  const title = `Synthetic ${label} private practice`;
  const note = `\n  Synthetic ${label} reflection: शांत मन.  \n`;
  const headers = { Origin: process.env.UI_ORIGIN!, 'Content-Type': 'application/json' };
  const createdResponse = await page.request.post('/api/journeys', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {
      title,
      intention: `Synthetic ${label} account-boundary verification.`,
      practices: [
        { id: randomUUID(), label: 'Quiet attention', order: 0, kind: 'checkbox', target: null },
      ],
      schedule: {
        startDate: '2026-09-05',
        durationMode: 'occurrences',
        durationValue: 2,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        localTime: '06:00',
        timeZone: 'Asia/Kolkata',
        attribution: 'civil',
        windowMinutes: 60,
      },
      reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
    },
  });
  expect(createdResponse.status()).toBe(200);
  const created = (await createdResponse.json()) as JourneyDraftPreview;
  const activatedResponse = await page.request.post(
    `/api/journeys/${created.journey.id}/activate`,
    {
      headers,
      data: {
        operationId: randomUUID(),
        baseRevision: created.journey.revision,
        payload: { fingerprint: created.fingerprint },
      },
    },
  );
  expect(activatedResponse.status()).toBe(200);
  const activated = (await activatedResponse.json()) as JourneyView;
  const session = activated.sessions[0]!;
  const reflectionPath = `/api/sessions/${session.id}/reflection`;
  const saved = await page.request.put(reflectionPath, {
    headers,
    data: {
      operationId: randomUUID(),
      baseRevision: 0,
      payload: { text: note, moods: [] },
    },
  });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toMatchObject({ sessionId: session.id, revision: 1 });
  const path = `/journeys/${activated.journey.id}/sessions/${session.id}`;
  await page.goto(path);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(note);
  await expect(page.getByLabel('Your reflection', { exact: true })).toBeEnabled();
  return { title, note, path, reflectionPath };
}

async function deviceBinding(page: Page) {
  // Read only the real browser account/generation metadata, never private records.
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('sankalpa-offline');
      opening.onupgradeneeded = () => {
        opening.transaction?.abort();
        reject(new Error('Expected the application to initialize local account storage.'));
      };
      opening.onerror = () => reject(new Error('Local account metadata could not be opened.'));
      opening.onsuccess = () => resolve(opening.result);
    });
    try {
      return await new Promise<{
        activeAccountId: string | null;
        quarantinedAccountId: string | null;
        generation: string;
      }>((resolve, reject) => {
        const read = db.transaction('meta', 'readonly').objectStore('meta').get('device');
        read.onerror = () => reject(new Error('Local account metadata could not be read.'));
        read.onsuccess = () => {
          const value = read.result;
          if (!value || typeof value.generation !== 'string') {
            reject(new Error('Local account metadata is missing.'));
            return;
          }
          resolve({
            activeAccountId: value.activeAccountId,
            quarantinedAccountId: value.quarantinedAccountId,
            generation: value.generation,
          });
        };
      });
    } finally {
      db.close();
    }
  });
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const directory = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, name), fullPage: true });
}

test('@M3 @M3-offline stale private hydration cannot rebind an account after real sign-in changes', async ({
  page,
  context,
}, info) => {
  setUiClock(NOW);
  const scripts = gate();
  let heldScripts = 0;
  let other: Page | undefined;
  const holdScripts = async (route: Route) => {
    heldScripts += 1;
    await scripts.ready;
    await route.continue();
  };
  try {
    await capturedSignIn(page, 'ui-maya@example.test');
    const originalAccount = await identity(page);
    const original = await createPractice(page, 'original');
    await page.route(NEXT_SCRIPTS, holdScripts);
    const staleDocument = await page.reload({ waitUntil: 'commit' });
    expect(staleDocument?.status()).toBe(200);
    await expect.poll(() => heldScripts).toBeGreaterThan(0);
    await expect(
      page.getByText('Opening your private practice space…', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: original.title, exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Your reflection', { exact: true })).toHaveCount(0);

    other = await context.newPage();
    await capturedSignIn(other, 'ui-arun@example.test');
    const currentAccount = await identity(other);
    expect(currentAccount).not.toBe(originalAccount);
    const current = await createPractice(other, 'current');
    const beforeRelease = await deviceBinding(other);
    expect(beforeRelease.activeAccountId).toBe(currentAccount);
    expect(beforeRelease.quarantinedAccountId).toBeNull();

    scripts.release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(
      page.getByRole('heading', { name: 'Verify your account to continue', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: original.title, exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Your reflection', { exact: true })).toHaveCount(0);
    expect(await identity(page)).toBe(currentAccount);
    expect(await deviceBinding(other)).toEqual(beforeRelease);
    await expect(other.getByRole('heading', { name: current.title, exact: true })).toBeVisible();
    await expect(other.getByLabel('Your reflection', { exact: true })).toHaveValue(current.note);
    await expect(other.getByLabel('Your reflection', { exact: true })).toBeEnabled();
    const currentSaved = await other.request.get(current.reflectionPath);
    expect(currentSaved.status()).toBe(200);
    expect(await currentSaved.json()).toMatchObject({ text: current.note, moods: [], revision: 1 });
    expect((await page.request.get(original.reflectionPath)).status()).toBe(404);
    await screenshot(page, info, 'stale-account-hydration-withheld.png');
  } finally {
    scripts.release();
    await page.unrouteAll({ behavior: 'wait' });
    await other?.close();
    setUiClock(NOW);
  }
});

test('@M3 @M3-offline failed remote sign-out remains explicit and retryable after private cleanup', async ({
  page,
}, info) => {
  setUiClock(NOW);
  const firstLogout = gate();
  let logoutRequests = 0;
  try {
    await capturedSignIn(page, 'ui-maya@example.test');
    const accountId = await identity(page);
    const practice = await createPractice(page, 'logout recovery');
    await page.route('**/api/auth/sign-out', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      logoutRequests += 1;
      if (logoutRequests !== 1) return route.continue();
      await firstLogout.ready;
      // Only the first logout outage is simulated. Retry reaches real auth.
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'UNAVAILABLE',
            message: 'Synthetic temporary sign-out outage.',
            correlationId: 'synthetic-logout-retry',
          },
        }),
      });
    });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => logoutRequests).toBe(1);
    await expect(
      page.getByRole('heading', { name: 'Finishing sign out…', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Private reflection', exact: true }),
    ).not.toBeVisible();
    expect((await deviceBinding(page)).activeAccountId).toBeNull();
    expect(await identity(page)).toBe(accountId);
    firstLogout.release();
    await expect(
      page.getByRole('heading', { name: 'Sign-out did not finish', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Local private data has been cleared. The server has not confirmed sign-out. Retry to finish signing out.',
        { exact: true },
      ),
    ).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry sign out', exact: true });
    await expect(retry).toBeEnabled();
    await expect(
      page.getByRole('region', { name: 'Private reflection', exact: true }),
    ).not.toBeVisible();
    expect(await identity(page)).toBe(accountId);
    const saved = await page.request.get(practice.reflectionPath);
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({ text: practice.note, moods: [], revision: 1 });
    await screenshot(page, info, 'failed-signout-private-content-withheld.png');
    await retry.click();
    await expect(page).toHaveURL('/welcome');
    expect(logoutRequests).toBe(2);
    expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  } finally {
    firstLogout.release();
    await page.unrouteAll({ behavior: 'wait' });
    setUiClock(NOW);
  }
});
