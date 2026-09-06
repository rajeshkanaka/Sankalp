import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JourneyDraftPreview, JourneyView } from '../../src/domain/contracts';
import { test, expect } from './test';
import { capturedSignIn } from './helpers/sign-in';

test('@M3 @M3-offline online-only editors preserve unsaved input during account actions', async ({
  page,
}, info) => {
  // Only shell readiness is simulated as unavailable; authentication, storage,
  // practice creation and saves below use the actual app and local services.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'register', {
      value: () =>
        Promise.reject(new DOMException('Synthetic registration denial', 'SecurityError')),
    });
  });
  await capturedSignIn(page, 'ui-maya@example.test');
  const headers = { Origin: process.env.UI_ORIGIN!, 'Content-Type': 'application/json' };
  const createdResponse = await page.request.post('/api/journeys', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {
      title: 'Online-only draft protection',
      intention: 'Synthetic fallback regression.',
      practices: [
        { id: randomUUID(), label: 'Quiet breaths', order: 0, kind: 'repetitions', target: 3 },
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
  await page.goto(`/journeys/${activated.journey.id}/sessions/${session.id}`);
  await expect(
    page.getByText('Offline saving is unavailable. You can continue using the online controls.', {
      exact: true,
    }),
  ).toBeVisible();
  const numeric = page.getByLabel('Quiet breaths', { exact: true });
  await numeric.fill('2');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Local changes need attention', exact: true }),
  ).toBeVisible();
  await expect(numeric).toBeDisabled();
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  await page.getByRole('button', { name: 'Keep signed in', exact: true }).click();
  await expect(numeric).toHaveValue('2');
  await numeric.fill('0');
  await page.getByRole('button', { name: 'Save value for Quiet breaths', exact: true }).click();
  await expect(page.getByText('This value is already saved.', { exact: true })).toBeVisible();

  const reflection = page.getByRole('region', { name: 'Private reflection', exact: true });
  const note = reflection.getByLabel('Your reflection', { exact: true });
  const raw = '\n  Synthetic fallback note remains exactly here.\n';
  await page.route(`**/api/sessions/${session.id}/reflection`, (route) => {
    if (route.request().method() === 'PUT') return route.abort('failed');
    return route.continue();
  });
  await note.fill(raw);
  await expect(reflection.getByText('Not saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Local changes need attention', exact: true }),
  ).toBeVisible();
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({
    path: resolve(evidence, 'online-only-unsaved-signout.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Keep signed in', exact: true }).click();
  await expect(note).toHaveValue(raw);
  await page.unroute(`**/api/sessions/${session.id}/reflection`);
  await reflection.getByRole('button', { name: 'Try saving again', exact: true }).click();
  await expect(reflection.getByRole('status').filter({ hasText: /^Saved\.$/ })).toBeVisible();
  const saved = await page.request.get(`/api/sessions/${session.id}/reflection`);
  expect(saved.status()).toBe(200);
  expect((await saved.json()).text).toBe(raw);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/welcome');
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
});
