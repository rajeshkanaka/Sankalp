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
import {
  blockingPids,
  bounded,
  observedTransactions,
  operationReceipts,
  revisionSnapshot,
  settled,
  signal,
} from './revision-test-helpers';

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

  it(
    'makes revision wait for the completion lock winner at the opening boundary',
    { timeout: 20000 },
    async () => {
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

      const completionId = randomUUID();
      const revisionId = randomUUID();
      const locked = signal<number>();
      const contender = signal<number>();
      const release = signal<void>();
      setClock(AT_SECOND_OPEN);
      const [completion, application] = await observedTransactions(
        {
          before: async (query) => {
            if (
              query.operationId === revisionId &&
              query.text.includes('from app.journey where id=$1 for update')
            ) {
              const pid = await query.run('select pg_backend_pid() as pid');
              contender.resolve(pid.rows[0].pid);
            }
          },
          after: async (query) => {
            if (
              query.operationId === completionId &&
              query.text === 'select state from app.journey where id=$1 for update'
            ) {
              const pid = await query.run('select pg_backend_pid() as pid');
              locked.resolve(pid.rows[0].pid);
              await release.promise;
            }
          },
        },
        async (pool) => {
          const completion = settled(
            confirmSession(userId, second.id, {
              operationId: completionId,
              baseRevision: second.revision,
              payload: { performedAt: second.opensAt },
            }),
          );
          let application:
            | ReturnType<typeof settled<Awaited<ReturnType<typeof applyScheduleRevision>>>>
            | undefined;
          try {
            const winnerPid = await bounded(locked.promise, 'completion journey lock');
            application = settled(
              applyScheduleRevision(userId, original.journey.id, {
                mode: 'apply',
                operationId: revisionId,
                baseRevision: original.journey.revision,
                payload: { candidate: revision, fingerprint: proposed.fingerprint },
              }),
            );
            const waitingPid = await bounded(contender.promise, 'revision lock attempt');
            await expect
              .poll(() => blockingPids(pool, waitingPid), { timeout: 3000, interval: 20 })
              .toContain(winnerPid);
            release.resolve();
            return await Promise.all([completion, application]);
          } finally {
            release.resolve();
            await Promise.allSettled([completion, ...(application ? [application] : [])]);
          }
        },
      );

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
      expect(await operationReceipts(userId, [completionId, revisionId])).toEqual([
        { operation_id: completionId, operation_type: `complete:${second.id}` },
      ]);
    },
  );

  it(
    'makes completion wait for a revision that tombstones its old session first',
    { timeout: 20000 },
    async () => {
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
      const completionId = randomUUID();
      const revisionId = randomUUID();
      const superseded = signal<number>();
      const contender = signal<number>();
      const release = signal<void>();

      const [application, completion] = await observedTransactions(
        {
          before: async (query) => {
            if (
              query.operationId === completionId &&
              query.text === 'select state from app.journey where id=$1 for update'
            ) {
              const pid = await query.run('select pg_backend_pid() as pid');
              contender.resolve(pid.rows[0].pid);
            }
          },
          after: async (query, result) => {
            if (
              query.operationId === revisionId &&
              query.text.startsWith('update app.session set superseded_at=')
            ) {
              expect(result.rows.map((row) => row.id)).toContain(second.id);
              const pid = await query.run('select pg_backend_pid() as pid');
              superseded.resolve(pid.rows[0].pid);
              await release.promise;
            }
          },
        },
        async (pool) => {
          const application = settled(
            applyScheduleRevision(userId, original.journey.id, {
              mode: 'apply',
              operationId: revisionId,
              baseRevision: original.journey.revision,
              payload: { candidate: revision, fingerprint: proposed.fingerprint },
            }),
          );
          let completion:
            ReturnType<typeof settled<Awaited<ReturnType<typeof confirmSession>>>> | undefined;
          try {
            const winnerPid = await bounded(superseded.promise, 'revision supersede write');
            // Revision has already applied its pre-opening snapshot while holding the actual row lock.
            // The old session opens before completion arrives, but completion must see the tombstone.
            setClock(AT_SECOND_OPEN);
            completion = settled(
              confirmSession(userId, second.id, {
                operationId: completionId,
                baseRevision: second.revision,
                payload: { performedAt: second.opensAt },
              }),
            );
            const waitingPid = await bounded(contender.promise, 'completion lock attempt');
            await expect
              .poll(() => blockingPids(pool, waitingPid), { timeout: 3000, interval: 20 })
              .toContain(winnerPid);
            release.resolve();
            return await Promise.all([application, completion]);
          } finally {
            release.resolve();
            await Promise.allSettled([application, ...(completion ? [completion] : [])]);
          }
        },
      );

      expect(application.status).toBe('fulfilled');
      expect(completion).toMatchObject({
        status: 'rejected',
        reason: { code: 'SESSION_REPLACED', status: 409 },
      });
      const after = await getJourneyView(userId, original.journey.id);
      expect(after.journey.revision).toBe(original.journey.revision + 1);
      expect(after.journey.activeScheduleVersionId).not.toBe(
        original.journey.activeScheduleVersionId,
      );
      expect(after.sessions.find(({ id }) => id === second.id)).toMatchObject({
        confirmed: false,
        supersededAt: new Date(BEFORE_SECOND_OPEN).toISOString(),
        scheduleVersionId: second.scheduleVersionId,
        practices: [expect.objectContaining({ id: FIRST_PRACTICE_ID, value: 108 })],
      });
      const replacement = after.sessions.find(
        (session) => session.practiceDate === second.practiceDate && session.supersededAt === null,
      )!;
      expect(replacement.id).not.toBe(second.id);
      expect(replacement).toMatchObject({
        confirmed: false,
        practices: [expect.objectContaining({ id: SECOND_PRACTICE_ID, target: 54, value: 0 })],
      });
      expect(await operationReceipts(userId, [completionId, revisionId])).toEqual([
        { operation_id: revisionId, operation_type: `schedule-revision:${original.journey.id}` },
      ]);
      const amendments = await withUser(userId, (client) =>
        client.query('select id from app.amendment where session_id=$1 and kind=$2', [
          second.id,
          'confirmed',
        ]),
      );
      expect(amendments.rows).toEqual([]);
    },
  );

  it.each(['supersede update', 'replacement insert'] as const)(
    'rolls back all state after a real %s fails, then safely retries the same operation',
    { timeout: 20000 },
    async (stage) => {
      setClock(BEFORE_SECOND_OPEN);
      const original = await activate();
      const revision = candidate();
      const proposed = await preview(original.journey.id, revision);
      const operationId = randomUUID();
      const request = {
        mode: 'apply' as const,
        operationId,
        baseRevision: original.journey.revision,
        payload: { candidate: revision, fingerprint: proposed.fingerprint },
      };
      const before = await revisionSnapshot(userId, original.journey.id);
      const injected = new Error(`Injected failure after ${stage}.`);
      let observedWrite = false;
      await observedTransactions(
        {
          after: async (query, result) => {
            const target =
              stage === 'supersede update'
                ? query.text.startsWith('update app.session set superseded_at=')
                : query.text.startsWith('insert into app.session (');
            if (query.operationId !== operationId || !target || observedWrite) return;
            expect(result.rowCount).toBe(
              stage === 'supersede update' ? proposed.supersededSessionIds.length : 1,
            );
            const changed = await query.run(
              stage === 'supersede update'
                ? 'select count(*)::int as count from app.session where journey_id=$1 and superseded_at is not null'
                : 'select count(*)::int as count from app.session where journey_id=$1 and schedule_version_id<>$2',
              stage === 'supersede update'
                ? [original.journey.id]
                : [original.journey.id, original.journey.activeScheduleVersionId],
            );
            expect(changed.rows[0].count).toBe(
              stage === 'supersede update' ? proposed.supersededSessionIds.length : 1,
            );
            observedWrite = true;
            throw injected;
          },
        },
        async () => {
          await expect(applyScheduleRevision(userId, original.journey.id, request)).rejects.toBe(
            injected,
          );
        },
      );
      expect(observedWrite).toBe(true);
      expect(await revisionSnapshot(userId, original.journey.id)).toEqual(before);
      expect(await operationReceipts(userId, [operationId])).toEqual([]);
      expect((await getJourneyView(userId, original.journey.id)).sessions).toEqual(
        original.sessions,
      );

      const retry = await applyScheduleRevision(userId, original.journey.id, request);
      expect(retry.view.journey.activeScheduleVersionId).not.toBe(
        original.journey.activeScheduleVersionId,
      );
      expect(retry.view.sessions.filter((session) => session.supersededAt === null)).toHaveLength(
        proposed.totalActive,
      );
      expect(retry.createdSessionIds).toHaveLength(proposed.proposed.length);
      expect((await revisionSnapshot(userId, original.journey.id)).versions).toHaveLength(
        before.versions.length + 1,
      );
      expect(await operationReceipts(userId, [operationId])).toEqual([
        { operation_id: operationId, operation_type: `schedule-revision:${original.journey.id}` },
      ]);
      await expect(applyScheduleRevision(userId, original.journey.id, request)).resolves.toEqual(
        retry,
      );
    },
  );

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
