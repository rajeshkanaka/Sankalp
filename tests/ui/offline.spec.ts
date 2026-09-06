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
async function openPractice(page: Page, email: string) {
  setUiClock(NOW);
  await capturedSignIn(page, email);
  const draft: JourneyDraft = {
    title: 'Offline recovery practice',
    intention: 'Synthetic browser recovery verification.',
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
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
    ).toBeVisible();
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
  await openPractice(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
  );
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  const reflection = page.getByRole('region', { name: 'Private reflection', exact: true });
  await reflection.getByLabel('Your reflection', { exact: true }).fill(NOTE);
  await expect(reflection.getByRole('status')).toContainText('Saved on this device');
  const other = await page.context().newPage();
  try {
    await capturedSignIn(
      other,
      info.project.name === 'chromium' ? 'ui-arun@example.test' : 'ui-maya@example.test',
    );
    await expect(
      other.getByRole('heading', { name: 'Local changes belong to another account', exact: true }),
    ).toBeVisible();
    await expect(other.getByText(NOTE, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Your reflection', { exact: true })).toHaveCount(0);
  } finally {
    await other.close();
    await page.unroute('**/api/**');
    setUiClock(NOW);
  }
});
