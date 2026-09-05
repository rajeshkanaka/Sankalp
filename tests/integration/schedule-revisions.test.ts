import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JourneyDraft, ScheduleRevisionCandidate } from '../../src/domain/contracts';
import { getPool, withUser } from '../../src/server/db/client';
import { activateJourney, createJourney, getJourneyView } from '../../src/server/journeys/service';
import { updateJourneyMetadata } from '../../src/server/journeys/metadata';
import {
  applyScheduleRevision,
  previewScheduleRevision,
} from '../../src/server/journeys/revisions';
import { confirmSession } from '../../src/server/sessions/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
  type SyntheticMarker,
} from './local-test-runtime';

const TEST_EMAIL = 'integration-maya-revisions@example.test';
const TEST_MARKER = buildSyntheticMarker('activation', 'revision-maya');
const SECOND_EMAIL = 'integration-arun-revisions@example.test';
const SECOND_MARKER = buildSyntheticMarker('activation', 'revision-arun');
const CLOCK_PATH = resolve(process.cwd(), '.local/integration-revisions-clock.json');
const FIRST_PRACTICE_ID = 'a4000000-0000-4000-8000-000000000001';
const SECOND_PRACTICE_ID = 'a4000000-0000-4000-8000-000000000002';
const BEFORE_SECOND_OPEN = '2026-09-06T00:29:00Z';
const AT_SECOND_OPEN = '2026-09-06T00:30:00Z';

let userId = '';
let secondUserId = '';
const ownedUserIds = new Set<string>();

function setClock(now: string) {
  mkdirSync(resolve(process.cwd(), '.local'), { recursive: true, mode: 0o700 });
  writeFileSync(CLOCK_PATH, JSON.stringify({ now }), { mode: 0o600 });
  process.env.DEMO_CLOCK_FILE = CLOCK_PATH;
}

function authAdmin() {
  return createClient(process.env.SUPABASE_URL!, process.env.LOCAL_SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function listAllUsers(): Promise<User[]> {
  const admin = authAdmin();
  const users: User[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1_000) return users;
  }
  throw new Error('Local Supabase contains too many auth users for guarded test lookup.');
}

async function deleteOwnedSyntheticUser(id: string, email: string, marker: SyntheticMarker) {
  if (!ownedUserIds.has(id)) throw new Error('Refusing to delete an unowned synthetic user ID.');
  const current = await authAdmin().auth.admin.getUserById(id);
  if (current.error) throw current.error;
  if (!isExpectedSyntheticUser(current.data.user, email, marker)) {
    throw new Error('Refusing to delete a user without the exact synthetic marker.');
  }
  const deleted = await authAdmin().auth.admin.deleteUser(id);
  if (deleted.error) throw deleted.error;
  ownedUserIds.delete(id);
}

async function createSyntheticUser(email: string, marker: SyntheticMarker): Promise<string> {
  const existing = (await listAllUsers()).find((user) => user.email === email);
  if (existing) {
    if (!isExpectedSyntheticUser(existing, email, marker)) {
      throw new Error('Reserved integration email belongs to an unmarked or different account.');
    }
    ownedUserIds.add(existing.id);
    await deleteOwnedSyntheticUser(existing.id, email, marker);
  }
  const { data, error } = await authAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { [SYNTHETIC_MARKER_KEY]: marker },
  });
  if (error) throw error;
  if (!isExpectedSyntheticUser(data.user, email, marker)) {
    throw new Error('Supabase returned a user without the exact synthetic marker.');
  }
  ownedUserIds.add(data.user.id);
  return data.user.id;
}

function draft(title: string, durationMode: 'occurrences' | 'calendar_days' = 'occurrences') {
  return {
    title,
    intention: 'Keep history stable during a synthetic revision.',
    practices: [
      {
        id: FIRST_PRACTICE_ID,
        label: 'Morning japa',
        order: 0,
        kind: 'repetitions',
        target: 108,
      },
    ],
    schedule: {
      startDate: '2026-09-05',
      durationMode,
      durationValue: 6,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  } satisfies JourneyDraft;
}

function candidate(
  effectivePracticeDate = '2026-09-06',
  durationMode: 'occurrences' | 'calendar_days' = 'occurrences',
): ScheduleRevisionCandidate {
  return {
    effectivePracticeDate,
    practices: [
      {
        id: SECOND_PRACTICE_ID,
        label: 'Evening japa',
        order: 0,
        kind: 'repetitions',
        target: 54,
      },
    ],
    schedule: {
      durationMode,
      durationValue: 4,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '07:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
  };
}

async function activate(input: JourneyDraft = draft(`Revision ${randomUUID()}`)) {
  const created = await createJourney(userId, input);
  return activateJourney(userId, created.journey.id, {
    operationId: randomUUID(),
    baseRevision: created.journey.revision,
    payload: { fingerprint: created.fingerprint },
  });
}

async function preview(journeyId: string, input = candidate()) {
  const current = await getJourneyView(userId, journeyId);
  return previewScheduleRevision(userId, journeyId, {
    mode: 'preview',
    baseRevision: current.journey.revision,
    payload: input,
  });
}

beforeAll(async () => {
  loadGuardedIntegrationRuntime();
  setClock(BEFORE_SECOND_OPEN);
  userId = await createSyntheticUser(TEST_EMAIL, TEST_MARKER);
  secondUserId = await createSyntheticUser(SECOND_EMAIL, SECOND_MARKER);
});

afterAll(async () => {
  if (userId && ownedUserIds.has(userId)) {
    await deleteOwnedSyntheticUser(userId, TEST_EMAIL, TEST_MARKER);
  }
  if (secondUserId && ownedUserIds.has(secondUserId)) {
    await deleteOwnedSyntheticUser(secondUserId, SECOND_EMAIL, SECOND_MARKER);
  }
  const globalDb = globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> };
  if (globalDb.sankalpaPool) {
    const pool = globalDb.sankalpaPool;
    delete globalDb.sankalpaPool;
    await pool.end();
  }
  rmSync(CLOCK_PATH, { force: true });
  delete process.env.DEMO_CLOCK_FILE;
});

describe('future schedule revisions', () => {
  it('retains opened identity and labels while tombstoning only replaceable sessions', async () => {
    setClock(BEFORE_SECOND_OPEN);
    const original = await activate();
    const opened = original.sessions.find(({ practiceDate }) => practiceDate === '2026-09-05')!;
    const revision = candidate();
    const proposed = await preview(original.journey.id, revision);

    expect(proposed).toMatchObject({
      currentRevision: original.journey.revision,
      currentScheduleVersionId: original.journey.activeScheduleVersionId,
      originalStartDate: '2026-09-05',
      effectivePracticeDate: '2026-09-06',
      remainingAllowance: 3,
      totalActive: 4,
      retained: [{ id: opened.id, ordinal: opened.ordinal, reason: 'opened' }],
    });
    expect(proposed.supersededSessionIds).toHaveLength(5);
    expect(
      proposed.proposed.map(({ ordinal, practiceDate }) => ({ ordinal, practiceDate })),
    ).toEqual([
      { ordinal: 2, practiceDate: '2026-09-06' },
      { ordinal: 3, practiceDate: '2026-09-07' },
      { ordinal: 4, practiceDate: '2026-09-08' },
    ]);

    const operationId = randomUUID();
    const request = {
      mode: 'apply' as const,
      operationId,
      baseRevision: original.journey.revision,
      payload: { candidate: revision, fingerprint: proposed.fingerprint },
    };
    const applied = await applyScheduleRevision(userId, original.journey.id, request);
    const retained = applied.view.sessions.find(({ id }) => id === opened.id)!;
    const active = applied.view.sessions.filter(({ supersededAt }) => supersededAt === null);

    expect(retained).toMatchObject({
      id: opened.id,
      ordinal: opened.ordinal,
      scheduleVersionId: opened.scheduleVersionId,
      opensAt: opened.opensAt,
      practices: opened.practices,
      supersededAt: null,
    });
    expect(active).toHaveLength(4);
    expect(
      active
        .filter(({ id }) => id !== opened.id)
        .every(({ practices }) => practices[0]?.label === 'Evening japa'),
    ).toBe(true);
    expect([...applied.supersededSessionIds].sort()).toEqual(
      [...proposed.supersededSessionIds].sort(),
    );
    expect(applied.createdSessionIds).toHaveLength(3);
    expect(applied.view.journey).toMatchObject({
      revision: original.journey.revision + 1,
      activeScheduleVersionId: expect.not.stringMatching(opened.scheduleVersionId),
      schedule: { startDate: '2026-09-05', localTime: '07:00' },
    });

    await expect(applyScheduleRevision(userId, original.journey.id, request)).resolves.toEqual(
      applied,
    );
    await expect(
      applyScheduleRevision(userId, original.journey.id, {
        ...request,
        payload: {
          ...request.payload,
          candidate: { ...revision, effectivePracticeDate: '2026-09-07' },
        },
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
  });

  it('invalidates a preview when a session reaches its opening boundary before apply', async () => {
    setClock(BEFORE_SECOND_OPEN);
    const original = await activate();
    const revision = candidate();
    const proposed = await preview(original.journey.id, revision);
    const before = await getJourneyView(userId, original.journey.id);

    setClock(AT_SECOND_OPEN);
    await expect(
      applyScheduleRevision(userId, original.journey.id, {
        mode: 'apply',
        operationId: randomUUID(),
        baseRevision: original.journey.revision,
        payload: { candidate: revision, fingerprint: proposed.fingerprint },
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED', status: 409 });

    const after = await getJourneyView(userId, original.journey.id);
    expect(after.journey).toMatchObject({
      revision: before.journey.revision,
      activeScheduleVersionId: before.journey.activeScheduleVersionId,
    });
    expect(after.sessions).toEqual(before.sessions);
  });

  it('serializes completion at the opening boundary and preserves the completed session', async () => {
    setClock(BEFORE_SECOND_OPEN);
    const original = await activate();
    const second = original.sessions.find(({ practiceDate }) => practiceDate === '2026-09-06')!;
    await withUser(userId, (client) =>
      client.query(
        'update app.session_practice set numeric_value=108 where session_id=$1 and practice_id=$2',
        [second.id, FIRST_PRACTICE_ID],
      ),
    );
    const revision = candidate();
    const proposed = await preview(original.journey.id, revision);

    setClock(AT_SECOND_OPEN);
    const [completion, application] = await Promise.allSettled([
      confirmSession(userId, second.id, {
        operationId: randomUUID(),
        baseRevision: second.revision,
        payload: { performedAt: second.opensAt },
      }),
      applyScheduleRevision(userId, original.journey.id, {
        mode: 'apply',
        operationId: randomUUID(),
        baseRevision: original.journey.revision,
        payload: { candidate: revision, fingerprint: proposed.fingerprint },
      }),
    ]);

    expect(completion.status).toBe('fulfilled');
    expect(application).toMatchObject({
      status: 'rejected',
      reason: { code: 'PREVIEW_CHANGED', status: 409 },
    });
    const after = await getJourneyView(userId, original.journey.id);
    expect(after.journey.activeScheduleVersionId).toBe(original.journey.activeScheduleVersionId);
    expect(after.sessions.find(({ id }) => id === second.id)).toMatchObject({
      id: second.id,
      ordinal: second.ordinal,
      scheduleVersionId: second.scheduleVersionId,
      confirmed: true,
      supersededAt: null,
      practices: [expect.objectContaining({ id: FIRST_PRACTICE_ID, value: 108 })],
    });
  });

  it('rejects duration reductions that would remove retained occurrence or calendar history', async () => {
    setClock(AT_SECOND_OPEN);
    const occurrenceJourney = await activate();
    const beforeOccurrence = await getJourneyView(userId, occurrenceJourney.journey.id);
    const occurrenceReduction = candidate();
    occurrenceReduction.schedule.durationValue = 1;
    await expect(preview(occurrenceJourney.journey.id, occurrenceReduction)).rejects.toMatchObject({
      code: 'INVALID_SCHEDULE_REVISION',
      status: 422,
    });
    expect(await getJourneyView(userId, occurrenceJourney.journey.id)).toEqual(beforeOccurrence);

    const calendarJourney = await activate(draft(`Calendar ${randomUUID()}`, 'calendar_days'));
    const calendarReduction = candidate('2026-09-10', 'calendar_days');
    calendarReduction.schedule.durationValue = 3;
    await expect(preview(calendarJourney.journey.id, calendarReduction)).rejects.toMatchObject({
      code: 'INVALID_SCHEDULE_REVISION',
      status: 422,
    });
  });

  it('updates metadata without changing schedule versions or historical definitions', async () => {
    setClock(BEFORE_SECOND_OPEN);
    const original = await activate();
    const operationId = randomUUID();
    const input = {
      operationId,
      baseRevision: original.journey.revision,
      payload: { title: 'Renamed journey', intention: 'Updated intention only.' },
    };
    const updated = await updateJourneyMetadata(userId, original.journey.id, input);

    expect(updated.journey).toMatchObject({
      title: input.payload.title,
      intention: input.payload.intention,
      revision: original.journey.revision + 1,
      activeScheduleVersionId: original.journey.activeScheduleVersionId,
      schedule: original.journey.schedule,
      practices: original.journey.practices,
    });
    expect(updated.sessions).toEqual(original.sessions);
    await expect(updateJourneyMetadata(userId, original.journey.id, input)).resolves.toEqual(
      updated,
    );
    await expect(
      previewScheduleRevision(userId, original.journey.id, {
        mode: 'preview',
        baseRevision: original.journey.revision,
        payload: candidate(),
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 409 });
  });

  it('uses owner-private 404 responses for revision and metadata access', async () => {
    setClock(BEFORE_SECOND_OPEN);
    const original = await activate();
    await expect(
      previewScheduleRevision(secondUserId, original.journey.id, {
        mode: 'preview',
        baseRevision: original.journey.revision,
        payload: candidate(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(
      updateJourneyMetadata(secondUserId, original.journey.id, {
        operationId: randomUUID(),
        baseRevision: original.journey.revision,
        payload: { title: 'Forbidden', intention: '' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
