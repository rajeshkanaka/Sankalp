import { createHash, randomUUID } from 'node:crypto';

import type { APIRequestContext, APIResponse, Browser } from '@playwright/test';

import type {
  JourneyDraft,
  JourneyDraftPreview,
  JourneyView,
  ReflectionMutationResult,
  ReflectionRecord,
  ScheduleRevisionPreview,
  ScheduleRevisionResult,
  SessionMutationResult,
  SessionRecord,
} from '../../src/domain/contracts';
import { expect, test } from './test';
import { setUiClock } from './helpers/clock';
import { capturedSignIn } from './helpers/sign-in';

const NOW = '2026-09-05T00:45:00Z';
const OWNER_EMAIL = 'ui-http-maya@example.test';
const OTHER_EMAIL = 'ui-http-arun@example.test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_FIELDS = [
  'adjustment',
  'attribution',
  'closesAt',
  'confirmed',
  'id',
  'journeyId',
  'opensAt',
  'ordinal',
  'performedAt',
  'practiceDate',
  'practices',
  'recordedAt',
  'revision',
  'scheduleVersionId',
  'supersededAt',
  'timeZone',
].sort();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function objectBody(response: APIResponse): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`Expected JSON object response with status ${response.status()}.`);
  }
  if (!isRecord(value))
    throw new Error(`Expected JSON object response with status ${response.status()}.`);
  return value;
}

function expectPrivate(response: APIResponse) {
  const headers = response.headers();
  expect(headers['cache-control']).toContain('private');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['cache-control']).toContain('no-cache');
  expect(headers['cache-control']).toContain('must-revalidate');
  expect(headers.pragma).toBe('no-cache');
  expect(headers.expires).toBe('0');
}

async function expectError(
  response: APIResponse,
  status: number,
  code: string,
  options: { current?: boolean } = {},
) {
  expect(response.status()).toBe(status);
  expectPrivate(response);
  const body = await objectBody(response);
  expect(Object.keys(body)).toEqual(['error']);
  if (!isRecord(body.error)) throw new Error('Expected a structured API error.');
  expect(Object.keys(body.error).sort()).toEqual(
    ['code', 'correlationId', 'message', ...(options.current ? ['current'] : [])].sort(),
  );
  expect(body.error.code).toBe(code);
  expect(body.error.correlationId).toEqual(expect.stringMatching(UUID));
  return body.error;
}

function headers(accountId?: string) {
  return {
    Origin: process.env.UI_ORIGIN!,
    'Content-Type': 'application/json',
    ...(accountId ? { 'X-Sankalpa-Account': accountId } : {}),
  };
}

async function identity(request: APIRequestContext) {
  const response = await request.get('/api/auth/session');
  expect(response.status()).toBe(200);
  expectPrivate(response);
  const body = await objectBody(response);
  expect(Object.keys(body).sort()).toEqual(['accountId', 'now']);
  expect(body.accountId).toEqual(expect.stringMatching(UUID));
  expect(body.now).toBe(new Date(NOW).toISOString());
  return body.accountId as string;
}

async function readSession(request: APIRequestContext, sessionId: string, accountId: string) {
  const response = await request.get(`/api/sessions/${sessionId}`, {
    headers: { 'X-Sankalpa-Account': accountId },
  });
  expect(response.status()).toBe(200);
  expectPrivate(response);
  const body = await objectBody(response);
  expect(Object.keys(body).sort()).toEqual(['now', 'session']);
  expect(body.now).toBe(new Date(NOW).toISOString());
  if (!isRecord(body.session)) throw new Error('Session read omitted its canonical session.');
  expect(Object.keys(body.session).sort()).toEqual(SESSION_FIELDS);
  expect(body.session).not.toHaveProperty('reflection');
  expect(body.session).not.toHaveProperty('journeyTitle');
  expect(body.session).not.toHaveProperty('ownerId');
  return body.session as unknown as SessionRecord;
}

async function write(
  request: APIRequestContext,
  path: string,
  method: 'POST' | 'PUT',
  body: unknown,
  accountId?: string,
) {
  return request.fetch(path, { method, headers: headers(accountId), data: body });
}

function responseDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function draft(): JourneyDraft {
  return {
    title: 'Offline HTTP boundary',
    intention: 'Synthetic account and replay isolation verification.',
    practices: [
      {
        id: randomUUID(),
        label: 'Grounding breath',
        order: 0,
        kind: 'checkbox',
        target: null,
      },
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
}

async function createJourney(request: APIRequestContext) {
  const journeyDraft = draft();
  const createdResponse = await request.post('/api/journeys', {
    headers: { ...headers(), 'Idempotency-Key': randomUUID() },
    data: journeyDraft,
  });
  expect(createdResponse.status()).toBe(200);
  expectPrivate(createdResponse);
  const created = (await createdResponse.json()) as JourneyDraftPreview;
  const activationResponse = await write(
    request,
    `/api/journeys/${created.journey.id}/activate`,
    'POST',
    {
      operationId: randomUUID(),
      baseRevision: created.journey.revision,
      payload: { fingerprint: created.fingerprint },
    },
  );
  expect(activationResponse.status()).toBe(200);
  expectPrivate(activationResponse);
  return { draft: journeyDraft, view: (await activationResponse.json()) as JourneyView };
}

async function signInOther(browser: Browser) {
  const context = await browser.newContext({ baseURL: process.env.UI_ORIGIN });
  const page = await context.newPage();
  await capturedSignIn(page, OTHER_EMAIL);
  return { context, page, accountId: await identity(page.request) };
}

test.describe('@M3 @M3-offline offline replay HTTP boundaries', () => {
  test('keeps identity, owner reads and replay mutations account scoped', async ({
    browser,
    page,
    request,
  }) => {
    test.setTimeout(120000);
    setUiClock(NOW);
    const unauthenticatedIdentity = await request.get('/api/auth/session');
    await expectError(unauthenticatedIdentity, 401, 'SIGN_IN_REQUIRED');

    await capturedSignIn(page, OWNER_EMAIL);
    const ownerId = await identity(page.request);
    const other = await signInOther(browser);
    try {
      expect(other.accountId).not.toBe(ownerId);
      const created = await createJourney(page.request);
      const original = created.view.sessions[0]!;
      const future = created.view.sessions[1]!;

      const ownerRead = await readSession(page.request, original.id, ownerId);
      expect(ownerRead.id).toBe(original.id);
      expect(ownerRead.revision).toBe(0);
      expect(ownerRead.confirmed).toBe(false);
      expect(ownerRead.practices[0]?.value).toBe(false);

      const crossOwnerRead = await other.page.request.get(`/api/sessions/${original.id}`, {
        headers: { 'X-Sankalpa-Account': other.accountId },
      });
      await expectError(crossOwnerRead, 404, 'NOT_FOUND');

      const staleAccountSessionRead = await other.page.request.get(`/api/sessions/${original.id}`, {
        headers: { 'X-Sankalpa-Account': ownerId },
      });
      await expectError(staleAccountSessionRead, 409, 'ACCOUNT_CHANGED');
      const staleAccountReflectionRead = await other.page.request.get(
        `/api/sessions/${original.id}/reflection`,
        { headers: { 'X-Sankalpa-Account': ownerId } },
      );
      await expectError(staleAccountReflectionRead, 409, 'ACCOUNT_CHANGED');

      const staleAccountHeaders = ownerId;
      const practiceEnvelope = {
        operationId: randomUUID(),
        baseRevision: original.revision,
        payload: { values: { [original.practices[0]!.id]: true } },
      };
      const rejectedPractice = await write(
        other.page.request,
        `/api/sessions/${original.id}/practices`,
        'PUT',
        practiceEnvelope,
        staleAccountHeaders,
      );
      await expectError(rejectedPractice, 409, 'ACCOUNT_CHANGED');

      const rejectedReflection = await write(
        other.page.request,
        `/api/sessions/${original.id}/reflection`,
        'PUT',
        {
          operationId: randomUUID(),
          baseRevision: 0,
          payload: { text: 'Private synthetic offline note.', moods: ['Calm'] },
        },
        staleAccountHeaders,
      );
      await expectError(rejectedReflection, 409, 'ACCOUNT_CHANGED');

      const unchanged = await readSession(page.request, original.id, ownerId);
      expect(unchanged.revision).toBe(0);
      expect(unchanged.confirmed).toBe(false);
      expect(unchanged.practices[0]?.value).toBe(false);
      const absentReflection = await page.request.get(`/api/sessions/${original.id}/reflection`);
      expect(absentReflection.status()).toBe(200);
      expectPrivate(absentReflection);
      expect(await absentReflection.json()).toBeNull();

      const savedResponse = await write(
        page.request,
        `/api/sessions/${original.id}/practices`,
        'PUT',
        practiceEnvelope,
        ownerId,
      );
      expect(savedResponse.status()).toBe(200);
      expectPrivate(savedResponse);
      const saved = (await savedResponse.json()) as SessionMutationResult;
      expect(saved.session.revision).toBe(1);
      expect(saved.session.practices[0]?.value).toBe(true);
      const savedRetryResponse = await write(
        page.request,
        `/api/sessions/${original.id}/practices`,
        'PUT',
        practiceEnvelope,
        ownerId,
      );
      expect(savedRetryResponse.status()).toBe(200);
      expectPrivate(savedRetryResponse);
      const savedRetry = (await savedRetryResponse.json()) as SessionMutationResult;
      expect(responseDigest(savedRetry)).toBe(responseDigest(saved));

      const completionEnvelope = {
        operationId: randomUUID(),
        baseRevision: saved.session.revision,
        payload: { performedAt: NOW },
      };
      const rejectedCompletion = await write(
        other.page.request,
        `/api/sessions/${original.id}/completion`,
        'POST',
        completionEnvelope,
        staleAccountHeaders,
      );
      await expectError(rejectedCompletion, 409, 'ACCOUNT_CHANGED');
      const beforeCompletion = await readSession(page.request, original.id, ownerId);
      expect(beforeCompletion.revision).toBe(1);
      expect(beforeCompletion.confirmed).toBe(false);

      const completedResponse = await write(
        page.request,
        `/api/sessions/${original.id}/completion`,
        'POST',
        completionEnvelope,
        ownerId,
      );
      expect(completedResponse.status()).toBe(200);
      expectPrivate(completedResponse);
      const completed = (await completedResponse.json()) as SessionMutationResult;
      expect(completed.session).toMatchObject({
        revision: 2,
        confirmed: true,
        performedAt: new Date(NOW).toISOString(),
      });
      const completedRetryResponse = await write(
        page.request,
        `/api/sessions/${original.id}/completion`,
        'POST',
        completionEnvelope,
        ownerId,
      );
      expect(completedRetryResponse.status()).toBe(200);
      expectPrivate(completedRetryResponse);
      const completedRetry = (await completedRetryResponse.json()) as SessionMutationResult;
      expect(responseDigest(completedRetry)).toBe(responseDigest(completed));

      const reflectionEnvelope = {
        operationId: randomUUID(),
        baseRevision: 0,
        payload: { text: 'Private synthetic offline note.', moods: ['Calm'] },
      };
      const reflectedResponse = await write(
        page.request,
        `/api/sessions/${original.id}/reflection`,
        'PUT',
        reflectionEnvelope,
        ownerId,
      );
      expect(reflectedResponse.status()).toBe(200);
      expectPrivate(reflectedResponse);
      const reflected = (await reflectedResponse.json()) as ReflectionMutationResult;
      expect(reflected).toMatchObject({ sessionId: original.id, revision: 1 });
      const reflectedRetryResponse = await write(
        page.request,
        `/api/sessions/${original.id}/reflection`,
        'PUT',
        reflectionEnvelope,
        ownerId,
      );
      expect(reflectedRetryResponse.status()).toBe(200);
      expectPrivate(reflectedRetryResponse);
      const reflectedRetry = (await reflectedRetryResponse.json()) as ReflectionMutationResult;
      expect(responseDigest(reflectedRetry)).toBe(responseDigest(reflected));

      const canonicalReflectionResponse = await page.request.get(
        `/api/sessions/${original.id}/reflection`,
      );
      expect(canonicalReflectionResponse.status()).toBe(200);
      expectPrivate(canonicalReflectionResponse);
      const canonicalReflection = (await canonicalReflectionResponse.json()) as ReflectionRecord;
      expect(Object.keys(canonicalReflection).sort()).toEqual([
        'createdAt',
        'journeyId',
        'moods',
        'revision',
        'scheduleVersionId',
        'sessionId',
        'text',
        'updatedAt',
      ]);
      expect(canonicalReflection).toMatchObject({
        sessionId: original.id,
        text: reflectionEnvelope.payload.text,
        moods: reflectionEnvelope.payload.moods,
        revision: 1,
      });

      const candidate = {
        effectivePracticeDate: future.practiceDate,
        practices: created.draft.practices,
        schedule: {
          durationMode: created.draft.schedule.durationMode,
          durationValue: created.draft.schedule.durationValue,
          weekdays: created.draft.schedule.weekdays,
          localTime: '06:15',
          timeZone: created.draft.schedule.timeZone,
          attribution: created.draft.schedule.attribution,
          windowMinutes: created.draft.schedule.windowMinutes,
        },
      };
      const previewResponse = await write(
        page.request,
        `/api/journeys/${created.view.journey.id}/schedule-revisions`,
        'POST',
        { mode: 'preview', baseRevision: created.view.journey.revision, payload: candidate },
        ownerId,
      );
      expect(previewResponse.status()).toBe(200);
      expectPrivate(previewResponse);
      const preview = (await previewResponse.json()) as ScheduleRevisionPreview;
      expect(preview.supersededSessionIds).toContain(future.id);
      const revisionResponse = await write(
        page.request,
        `/api/journeys/${created.view.journey.id}/schedule-revisions`,
        'POST',
        {
          mode: 'apply',
          operationId: randomUUID(),
          baseRevision: created.view.journey.revision,
          payload: { candidate, fingerprint: preview.fingerprint },
        },
        ownerId,
      );
      expect(revisionResponse.status()).toBe(200);
      expectPrivate(revisionResponse);
      const revision = (await revisionResponse.json()) as ScheduleRevisionResult;
      expect(revision.supersededSessionIds).toContain(future.id);

      const tombstone = await readSession(page.request, future.id, ownerId);
      expect(tombstone.id).toBe(future.id);
      expect(tombstone.supersededAt).toEqual(expect.any(String));
      const rejectedTombstoneMutation = await write(
        page.request,
        `/api/sessions/${future.id}/practices`,
        'PUT',
        {
          operationId: randomUUID(),
          baseRevision: future.revision,
          payload: { values: { [future.practices[0]!.id]: true } },
        },
        ownerId,
      );
      const replaced = await expectError(rejectedTombstoneMutation, 409, 'SESSION_REPLACED', {
        current: true,
      });
      if (!isRecord(replaced.current))
        throw new Error('Replaced session response omitted current.');
      expect(Object.keys(replaced.current).sort()).toEqual(SESSION_FIELDS);
      expect(replaced.current.id).toBe(future.id);
      expect(replaced.current.supersededAt).toEqual(expect.any(String));
      const tombstoneAfter = await readSession(page.request, future.id, ownerId);
      expect(tombstoneAfter.revision).toBe(tombstone.revision);
      expect(tombstoneAfter.practices[0]?.value).toBe(false);
    } finally {
      await other.context.close();
      setUiClock(NOW);
    }
  });
});
