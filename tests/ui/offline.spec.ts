import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type {
  JourneyDraft,
  JourneyDraftPreview,
  JourneyView,
  ReflectionRecord,
  SessionRecord,
} from '../../src/domain/contracts';
import { test, expect } from './test';
import { capturedSignIn } from './helpers/sign-in';
import { setUiClock } from './helpers/clock';
import { setUiNetworkDisconnected } from './helpers/network';

const NOW = '2026-09-05T00:45:00Z';
const NOTE = '\n  Synthetic offline reflection. आज मन शांत है।\n';
async function openPractice(page: Page, email: string, includeNumeric = false) {
  setUiClock(NOW);
  await capturedSignIn(page, email);
  const draft: JourneyDraft = {
    title: 'Offline recovery practice',
    intention: 'Synthetic browser recovery verification.',
    practices: [
      { id: randomUUID(), label: 'Quiet attention', order: 0, kind: 'checkbox', target: null },
      ...(includeNumeric
        ? [
            {
              id: randomUUID(),
              label: 'Quiet minutes',
              order: 1,
              kind: 'minutes' as const,
              target: 10,
            },
          ]
        : []),
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
  };
  const headers = { Origin: process.env.UI_ORIGIN!, 'Content-Type': 'application/json' };
  const createdResponse = await page.request.post('/api/journeys', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: draft,
  });
  expect(createdResponse.ok()).toBe(true);
  const created = (await createdResponse.json()) as JourneyDraftPreview;
  const response = await page.request.post(`/api/journeys/${created.journey.id}/activate`, {
    headers,
    data: {
      operationId: randomUUID(),
      baseRevision: created.journey.revision,
      payload: { fingerprint: created.fingerprint },
    },
  });
  expect(response.ok()).toBe(true);
  const view = (await response.json()) as JourneyView;
  const session = view.sessions[0];
  const path = `/journeys/${view.journey.id}/sessions/${session.id}`;
  await page.goto(path);
  await expect(page.getByRole('region', { name: 'Practice checklist', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const controller = navigator.serviceWorker?.controller;
        if (!controller) return false;
        return new Promise<boolean>((done) => {
          const channel = new MessageChannel();
          const timeout = setTimeout(() => {
            channel.port1.close();
            done(false);
          }, 2000);
          channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            channel.port1.close();
            done(event.data?.type === 'PUBLIC_CACHE_READY' && event.data.ready === true);
          };
          controller.postMessage({ type: 'PUBLIC_CACHE_READY' }, [channel.port2]);
        });
      }),
    )
    .toBe(true);
  await expect(
    page
      .getByRole('region', { name: 'Private reflection', exact: true })
      .getByLabel('Your reflection', { exact: true }),
  ).toBeEnabled();
  return { session, path };
}

test('@M3 @M3-offline disconnected edits survive reload and sync once with real auth and persistence', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { session, path } = await openPractice(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
  );
  const checklist = page.getByRole('region', { name: 'Practice checklist', exact: true });
  const reflection = page.getByRole('region', { name: 'Private reflection', exact: true });
  try {
    await setUiNetworkDisconnected(true);
    // Chromium also models browser offline. WebKit/Firefox exercise the actual server outage.
    if (info.project.name === 'chromium') await page.context().setOffline(true);
    await checklist.getByRole('checkbox', { name: 'Quiet attention', exact: true }).check();
    await expect(
      checklist.locator('p[role=status]').filter({ hasText: 'Saved on this device' }),
    ).toBeVisible();
    await checklist.getByRole('button', { name: 'Complete this session', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Completion saved on this device.', exact: true }),
    ).toBeVisible();
    await reflection.getByLabel('Your reflection', { exact: true }).fill(NOTE);
    await expect(reflection.getByRole('status')).toContainText('Saved on this device');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Completion saved on this device.', exact: true }),
    ).toBeVisible();
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);
    await expect(
      page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
    ).toHaveCount(0);
    const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, 'offline-pending.png'), fullPage: true });
    await page.context().setOffline(false);
    await setUiNetworkDisconnected(false);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(reflection.getByRole('status')).toHaveText('Saved.');
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);
    const savedSession = await page.request.get(`/api/sessions/${session.id}`);
    expect(savedSession.ok()).toBe(true);
    expect(((await savedSession.json()) as { session: SessionRecord }).session).toMatchObject({
      confirmed: true,
      revision: 2,
    });
    const savedReflection = await page.request.get(`/api/sessions/${session.id}/reflection`);
    expect(savedReflection.ok()).toBe(true);
    expect((await savedReflection.json()) as ReflectionRecord).toMatchObject({
      text: NOTE,
      revision: 1,
    });
    await page.getByRole('link', { name: 'Your journey', exact: true }).click();
    await expect(page).toHaveURL(`/journeys/${session.journeyId}`);
    const progress = page.getByRole('region', { name: 'Journey progress', exact: true });
    await expect(progress.getByText('1 of 2 sessions completed', { exact: true })).toBeVisible();
    await expect(progress.getByText('1 upcoming', { exact: true })).toBeVisible();
    await page.reload();
    await expect(progress.getByText('1 of 2 sessions completed', { exact: true })).toBeVisible();
    await expect(progress.getByText('1 upcoming', { exact: true })).toBeVisible();
    await page
      .getByRole('list', { name: 'Chronological sessions', exact: true })
      .locator(`a[href="${path}"]`)
      .click();
    await expect(page).toHaveURL(path);
    await expect(
      page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
    ).toBeVisible();
    await expect(
      checklist.getByRole('checkbox', { name: 'Quiet attention', exact: true }),
    ).toBeChecked();
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);
    const history = page.getByRole('list', { name: 'Session history', exact: true });
    await expect(history.getByText('Practice values saved.', { exact: true })).toHaveCount(1);
    await expect(history.getByText('Completion confirmed.', { exact: true })).toHaveCount(1);
    await page.screenshot({ path: resolve(evidence, 'offline-replayed.png'), fullPage: true });
  } finally {
    await page.context().setOffline(false);
    await setUiNetworkDisconnected(false);
    setUiClock(NOW);
  }
});

test('@M3 @M3-offline simulated quota failure preserves actual editor input through focus and retry', async ({
  page,
}, info) => {
  await openPractice(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
  );
  const reflection = page.getByRole('region', { name: 'Private reflection', exact: true });
  await page.evaluate(() => {
    const state = window as Window & { restoreSyntheticDraftWrites?: () => void };
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'drafts')
        throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
    state.restoreSyntheticDraftWrites = () => {
      IDBObjectStore.prototype.put = original;
    };
  });
  try {
    await reflection.getByLabel('Your reflection', { exact: true }).fill(NOTE);
    await expect(
      page.getByRole('heading', { name: 'Your draft has not been saved', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);
    await page.evaluate(() =>
      (
        window as Window & { restoreSyntheticDraftWrites?: () => void }
      ).restoreSyntheticDraftWrites?.(),
    );
    await page.getByRole('button', { name: 'Try saving draft again', exact: true }).click();
    await expect(reflection.getByRole('status')).toHaveText('Saved.', { timeout: 15000 });
    await page.reload();
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);
  } finally {
    await page
      .evaluate(() =>
        (
          window as Window & { restoreSyntheticDraftWrites?: () => void }
        ).restoreSyntheticDraftWrites?.(),
      )
      .catch(() => undefined);
    setUiClock(NOW);
  }
});

test('@M3 @M3-offline switching real authenticated accounts hides the original pending reflection', async ({
  page,
}, info) => {
  const { session } = await openPractice(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
  );
  const reflection = page.getByRole('region', { name: 'Private reflection', exact: true });
  let other: Page | undefined;
  try {
    await setUiNetworkDisconnected(true);
    await reflection.getByLabel('Your reflection', { exact: true }).fill(NOTE);
    await expect(reflection.getByRole('status')).toContainText('Saved on this device');
    // Freeze the original editor through its real account-action guard before reconnecting.
    // No sign-out/discard is confirmed: the pending private note remains on this device.
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Local changes need attention', exact: true }),
    ).toBeVisible();
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toBeDisabled();
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);
    await setUiNetworkDisconnected(false);
    const canonical = await page.request.get(`/api/sessions/${session.id}/reflection`);
    expect(canonical.ok()).toBe(true);
    expect(await canonical.json()).toBeNull();
    other = await page.context().newPage();
    await capturedSignIn(
      other,
      info.project.name === 'chromium' ? 'ui-arun@example.test' : 'ui-maya@example.test',
    );
    for (const tab of [page, other]) {
      await expect(
        tab.getByRole('heading', { name: 'Local changes belong to another account', exact: true }),
      ).toBeVisible();
      await expect(tab.getByLabel('Your reflection', { exact: true })).toHaveCount(0);
      await expect(tab.locator('body')).not.toContainText(NOTE.trim());
    }
  } finally {
    await setUiNetworkDisconnected(false);
    await other?.close();
    setUiClock(NOW);
  }
});

test('@M3 @M3-offline two device contexts review every queued change against real server values', async ({
  browser,
  page,
}, info) => {
  test.setTimeout(120000);
  const { session, path } = await openPractice(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    true,
  );
  const otherDevice = await browser.newContext({
    baseURL: process.env.UI_ORIGIN,
    storageState: await page.context().storageState(),
  });
  try {
    const other = await otherDevice.newPage();
    await other.goto(path);
    await other.getByLabel('Quiet minutes', { exact: true }).fill('10');
    await other.getByRole('button', { name: 'Save value for Quiet minutes', exact: true }).click();
    await expect(
      other
        .getByRole('region', { name: 'Practice checklist', exact: true })
        .locator('p[role=status]'),
    ).toHaveText('Saved.');

    // The original device still has revision0. Its independent IndexedDB has not read this update.
    await setUiNetworkDisconnected(true);
    if (info.project.name === 'chromium') await page.context().setOffline(true);
    const numeric = page.getByLabel('Quiet minutes', { exact: true });
    const save = page.getByRole('button', { name: 'Save value for Quiet minutes', exact: true });
    await numeric.fill('10');
    await save.click();
    await expect(numeric).toBeEnabled();
    await numeric.fill('30');
    await save.click();
    await expect(numeric).toBeEnabled();
    await numeric.fill('later');
    await expect(
      page
        .getByRole('region', { name: 'Practice checklist', exact: true })
        .locator('p[role=status]'),
    ).toHaveText('Draft saved on this device.');
    const reflection = page.getByRole('region', { name: 'Private reflection', exact: true });
    await reflection.getByLabel('Your reflection', { exact: true }).fill(NOTE);
    await expect(reflection.getByRole('status')).toContainText('Saved on this device');

    await page.context().setOffline(false);
    await setUiNetworkDisconnected(false);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'This saved practice changed elsewhere', exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const reviewedChanges = page.getByRole('list', { name: 'Changes in order', exact: true });
    await expect(reviewedChanges.locator(':scope > li')).toHaveCount(2);
    await expect(reviewedChanges.locator(':scope > li').nth(0)).toContainText('Quiet minutes: 10');
    await expect(reviewedChanges.locator(':scope > li').nth(1)).toContainText('Quiet minutes: 30');
    await expect(
      page.getByRole('region', { name: 'Current saved version', exact: true }),
    ).toContainText('Quiet minutes: 10');
    await expect(
      page.getByRole('region', { name: 'Your unsynced version', exact: true }),
    ).toContainText('Quiet minutes: later');
    const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({
      path: resolve(evidence, 'offline-two-device-conflict.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Keep my reviewed version', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'This saved practice changed elsewhere', exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/sessions/${session.id}`);
        expect(response.ok()).toBe(true);
        const value = ((await response.json()) as { session: SessionRecord }).session;
        return {
          revision: value.revision,
          minutes: value.practices.find((item) => item.label === 'Quiet minutes')?.value,
        };
      })
      .toEqual({ revision: 2, minutes: 30 });
    await expect(numeric).toHaveValue('later');
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);
    await page.reload();
    await expect(numeric).toHaveValue('later');
    await expect(reflection.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);
    await page.screenshot({
      path: resolve(evidence, 'offline-two-device-resolved.png'),
      fullPage: true,
    });
  } finally {
    await page.context().setOffline(false);
    await setUiNetworkDisconnected(false);
    await otherDevice.close();
    setUiClock(NOW);
  }
});
