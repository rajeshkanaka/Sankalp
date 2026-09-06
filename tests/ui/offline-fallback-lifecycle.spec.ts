import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

import type {
  JourneyDraftPreview,
  JourneyView,
  SessionMutationResult,
} from '../../src/domain/contracts';
import { test, expect } from './test';
import { setUiClock } from './helpers/clock';
import { capturedSignIn } from './helpers/sign-in';

const M1_NOW = '2026-09-05T00:45:00Z';
const PERFORMED_AT = '2026-09-05T00:40:00Z';

function requestGate() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function createOnlinePractice(page: Page) {
  setUiClock(M1_NOW);
  // Registration denial is the only simulated integration. All API writes,
  // authentication and reads below use the actual app and local services.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'register', {
      value: () =>
        Promise.reject(new DOMException('Synthetic registration denial', 'SecurityError')),
    });
  });
  await capturedSignIn(page, 'ui-maya@example.test');
  const headers = { Origin: process.env.UI_ORIGIN!, 'Content-Type': 'application/json' };
  const practiceId = randomUUID();
  const createdResponse = await page.request.post('/api/journeys', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {
      title: 'Online-only account checkpoints',
      intention: 'Synthetic lifecycle regression.',
      practices: [
        { id: practiceId, label: 'Quiet breaths', order: 0, kind: 'repetitions', target: 3 },
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
  const initialSession = activated.sessions[0]!;
  const valuesResponse = await page.request.put(`/api/sessions/${initialSession.id}/practices`, {
    headers,
    data: {
      operationId: randomUUID(),
      baseRevision: initialSession.revision,
      payload: { values: { [practiceId]: 3 } },
    },
  });
  expect(valuesResponse.status()).toBe(200);
  const { session } = (await valuesResponse.json()) as SessionMutationResult;
  expect(session.practices.find(({ id }) => id === practiceId)?.value).toBe(3);
  return {
    session,
    headers,
    path: `/journeys/${activated.journey.id}/sessions/${session.id}`,
  };
}

async function expectOnlineControls(page: Page) {
  await expect(
    page.getByText('Offline saving is unavailable. You can continue using the online controls.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Quiet breaths', { exact: true })).toHaveValue('3');
}

test('@M3 @M3-offline online-only sign-out waits for a real reflection write acknowledgment', async ({
  page,
}, info) => {
  const { session, path } = await createOnlinePractice(page);
  await page.goto(path);
  await expectOnlineControls(page);
  const reflection = page.getByRole('region', { name: 'Private reflection', exact: true });
  const note = reflection.getByLabel('Your reflection', { exact: true });
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  const raw = '\n  Synthetic pending note: शांत practice.  \n';
  const reflectionPath = `/api/sessions/${session.id}/reflection`;
  const writeGate = requestGate();
  const signOutGate = requestGate();
  let writeRequests = 0;
  let signOutRequests = 0;
  let submittedReflection: unknown;
  await page.route(`**${reflectionPath}`, async (route) => {
    if (route.request().method() === 'PUT') {
      writeRequests += 1;
      submittedReflection = route.request().postDataJSON();
      await writeGate.ready;
    }
    await route.continue();
  });
  await page.route('**/api/auth/sign-out', async (route) => {
    if (route.request().method() === 'POST') {
      signOutRequests += 1;
      await signOutGate.ready;
    }
    await route.continue();
  });
  try {
    await note.fill(raw);
    await expect.poll(() => writeRequests).toBe(1);
    expect(submittedReflection).toMatchObject({ payload: { text: raw, moods: [] } });
    await signOut.click();
    await expect(signOut).toBeDisabled();
    await expect(note).toBeDisabled();
    await expect(reflection.getByRole('status')).toHaveText('Saving…');
    expect((await page.request.get('/api/auth/session')).status()).toBe(200);
    const beforeSave = await page.request.get(reflectionPath);
    expect(beforeSave.status()).toBe(200);
    expect(await beforeSave.json()).toBeNull();
    expect(signOutRequests).toBe(0);
    await expect(page).toHaveURL(path);

    const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({
      path: resolve(evidence, 'online-only-pending-signout.png'),
      fullPage: true,
    });
    const savedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === reflectionPath &&
        response.request().method() === 'PUT',
    );
    writeGate.release();
    expect((await savedResponse).status()).toBe(200);
    await expect.poll(() => signOutRequests).toBe(1);
    expect(writeRequests).toBe(1);
    await expect(reflection.getByRole('status')).toHaveText('Saved.');
    // Hold only transmission of the real logout request long enough to verify
    // the acknowledged write through the authenticated canonical read API.
    const saved = await page.request.get(reflectionPath);
    expect(saved.status()).toBe(200);
    const savedNote = await saved.json();
    expect(savedNote.text).toBe(raw);
    expect(savedNote.moods).toEqual([]);
    expect(savedNote.revision).toBe(1);
    signOutGate.release();
    await expect(page).toHaveURL('/welcome');
    expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  } finally {
    writeGate.release();
    signOutGate.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('@M3 @M3-offline online-only account cancellation preserves mood and correction-time drafts', async ({
  page,
}, info) => {
  const { session, headers, path } = await createOnlinePractice(page);
  const confirmedResponse = await page.request.post(`/api/sessions/${session.id}/completion`, {
    headers,
    data: {
      operationId: randomUUID(),
      baseRevision: session.revision,
      payload: { performedAt: PERFORMED_AT },
    },
  });
  expect(confirmedResponse.status()).toBe(200);
  const confirmed = (await confirmedResponse.json()) as SessionMutationResult;
  expect(confirmed.session.confirmed).toBe(true);
  expect(Date.parse(confirmed.session.performedAt!)).toBe(Date.parse(PERFORMED_AT));
  await page.goto(path);
  await expectOnlineControls(page);
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  const keepSignedIn = page.getByRole('button', { name: 'Keep signed in', exact: true });
  const unsavedChoice = page.getByRole('heading', {
    name: 'Local changes need attention',
    exact: true,
  });
  const reflection = page.getByRole('region', { name: 'Private reflection', exact: true });
  const moodInput = reflection.getByLabel('Mood tag (optional)', { exact: true });
  const rawMood = '  still choosing शांत  ';
  await moodInput.fill(rawMood);
  await signOut.click();
  await expect(unsavedChoice).toBeVisible();
  await expect(moodInput).toBeDisabled();
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  await keepSignedIn.click();
  await expect(moodInput).toBeEnabled();
  await expect(moodInput).toHaveValue(rawMood);
  const absentReflection = await page.request.get(`/api/sessions/${session.id}/reflection`);
  expect(absentReflection.status()).toBe(200);
  expect(await absentReflection.json()).toBeNull();
  await moodInput.fill('');

  await page.getByRole('button', { name: 'Correct practice time', exact: true }).click();
  const practiceTime = page.getByLabel('Actual practice time in Asia/Kolkata', { exact: true });
  const rawTime = '2026-09-05T06:12';
  await practiceTime.fill(rawTime);
  await signOut.click();
  await expect(unsavedChoice).toBeVisible();
  await expect(practiceTime).toBeDisabled();
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({
    path: resolve(evidence, 'online-only-correction-draft-signout.png'),
    fullPage: true,
  });
  await keepSignedIn.click();
  await expect(practiceTime).toBeEnabled();
  await expect(practiceTime).toHaveValue(rawTime);
  const canonicalResponse = await page.request.get(`/api/sessions/${session.id}`);
  expect(canonicalResponse.status()).toBe(200);
  const canonical = (await canonicalResponse.json()) as {
    session: SessionMutationResult['session'];
  };
  expect(Date.parse(canonical.session.performedAt!)).toBe(Date.parse(PERFORMED_AT));
  expect(canonical.session.revision).toBe(confirmed.session.revision);
  await page.getByRole('button', { name: 'Cancel time correction', exact: true }).click();
  await signOut.click();
  await expect(page).toHaveURL('/welcome');
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
});
