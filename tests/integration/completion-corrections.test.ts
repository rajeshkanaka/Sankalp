import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JourneyDraft, SessionRecord } from '../../src/domain/contracts';
import { deriveCompletionTiming } from '../../src/domain/status';
import { getPool, withUser } from '../../src/server/db/client';
import { activateJourney, createJourney, getJourneyView } from '../../src/server/journeys/service';
import {
  confirmSession,
  getSessionHistory,
  removeCompletion,
  savePractices,
} from '../../src/server/sessions/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
  type SyntheticMarker,
} from './local-test-runtime';
import { bounded, observedTransactions, settled, signal } from './revision-test-helpers';

const TEST_EMAIL = 'integration-maya-corrections@example.test';
const TEST_MARKER = buildSyntheticMarker('activation', 'correction-maya');
const CLOCK_PATH = resolve(process.cwd(), '.local/integration-corrections-clock.json');
const FIRST_PRACTICE_ID = 'a6000000-0000-4000-8000-000000000001';
const SECOND_PRACTICE_ID = 'a6000000-0000-4000-8000-000000000002';
const BEFORE_OPEN = '2026-09-05T00:00:00Z';
const DURING_WINDOW = '2026-09-05T00:45:00Z';
const BEFORE_CLOSE = '2026-09-05T01:29:59Z';
const AT_CLOSE = '2026-09-05T01:30:00Z';
const AFTER_CLOSE = '2026-09-05T02:00:00Z';

let userId = '';
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
  const users: User[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await authAdmin().auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1_000) return users;
  }
  throw new Error('Local Supabase contains too many auth users for guarded test lookup.');
}

async function deleteOwnedUser(id: string, email: string, marker: SyntheticMarker) {
  if (!ownedUserIds.has(id)) throw new Error('Refusing to delete an unowned synthetic user ID.');
  const current = await authAdmin().auth.admin.getUserById(id);
  if (current.error) throw current.error;
  if (!isExpectedSyntheticUser(current.data.user, email, marker))
    throw new Error('Refusing to delete a user without the exact synthetic marker.');
  const deleted = await authAdmin().auth.admin.deleteUser(id);
  if (deleted.error) throw deleted.error;
  ownedUserIds.delete(id);
}

async function createSyntheticUser(email: string, marker: SyntheticMarker) {
  const existing = (await listAllUsers()).find((user) => user.email === email);
  if (existing) {
    if (!isExpectedSyntheticUser(existing, email, marker))
      throw new Error('Reserved integration email belongs to an unmarked or different account.');
    ownedUserIds.add(existing.id);
    await deleteOwnedUser(existing.id, email, marker);
  }
  const { data, error } = await authAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { [SYNTHETIC_MARKER_KEY]: marker },
  });
  if (error) throw error;
  if (!isExpectedSyntheticUser(data.user, email, marker))
    throw new Error('Supabase returned a user without the exact synthetic marker.');
  ownedUserIds.add(data.user.id);
  return data.user.id;
}

function draft(title: string): JourneyDraft {
  return {
    title,
    intention: 'Synthetic history must remain factual after correction.',
    practices: [
      { id: FIRST_PRACTICE_ID, label: 'First practice', order: 0, kind: 'checkbox', target: null },
      {
        id: SECOND_PRACTICE_ID,
        label: 'Second practice',
        order: 1,
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

async function activate(title: string) {
  setClock(BEFORE_OPEN);
  const created = await createJourney(userId, draft(title));
  return activateJourney(userId, created.journey.id, {
    operationId: randomUUID(),
    baseRevision: created.journey.revision,
    payload: { fingerprint: created.fingerprint },
  });
}

async function saveAll(session: SessionRecord, now = DURING_WINDOW) {
  setClock(now);
  return savePractices(userId, session.id, {
    operationId: randomUUID(),
    baseRevision: session.revision,
    payload: { values: { [FIRST_PRACTICE_ID]: true, [SECOND_PRACTICE_ID]: true } },
  });
}

beforeAll(async () => {
  loadGuardedIntegrationRuntime();
  setClock(BEFORE_OPEN);
  userId = await createSyntheticUser(TEST_EMAIL, TEST_MARKER);
});

afterAll(async () => {
  if (userId && ownedUserIds.has(userId)) await deleteOwnedUser(userId, TEST_EMAIL, TEST_MARKER);
  const globalDb = globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> };
  if (globalDb.sankalpaPool) {
    const pool = globalDb.sankalpaPool;
    delete globalDb.sankalpaPool;
    await pool.end();
  }
  rmSync(CLOCK_PATH, { force: true });
  delete process.env.DEMO_CLOCK_FILE;
});

describe('completion corrections and immutable history', () => {
  it('captures partial closure once and distinguishes recorded-later from practiced-late', async () => {
    const activated = await activate(`Timing ${randomUUID()}`);
    const original = activated.sessions[0];
    setClock(DURING_WINDOW);
    const partial = await savePractices(userId, original.id, {
      operationId: randomUUID(),
      baseRevision: original.revision,
      payload: { values: { [FIRST_PRACTICE_ID]: true } },
    });

    setClock(AT_CLOSE);
    const atClose = await getSessionHistory(userId, original.id);
    expect(atClose.events).toEqual([
      expect.objectContaining({
        kind: 'session_closed',
        occurredAt: new Date(AT_CLOSE).toISOString(),
        sessionRevision: 1,
        detail: { status: 'partial' },
      }),
    ]);
    expect((await getSessionHistory(userId, original.id)).events).toEqual(atClose.events);

    setClock(AFTER_CLOSE);
    const ready = await savePractices(userId, original.id, {
      operationId: randomUUID(),
      baseRevision: partial.session.revision,
      payload: { values: { [SECOND_PRACTICE_ID]: true } },
    });
    const recordedLater = await confirmSession(userId, original.id, {
      operationId: randomUUID(),
      baseRevision: ready.session.revision,
      payload: { performedAt: '2026-09-05T00:40:00Z' },
    });
    expect(deriveCompletionTiming(recordedLater.session)).toEqual({
      practiceTiming: 'on_schedule',
      recordedLater: true,
    });

    const correctionId = randomUUID();
    const correction = {
      operationId: correctionId,
      baseRevision: recordedLater.session.revision,
      payload: { performedAt: '2026-09-05T01:45:00Z' },
    };
    const practicedLate = await confirmSession(userId, original.id, correction);
    expect(deriveCompletionTiming(practicedLate.session)).toEqual({
      practiceTiming: 'practiced_late',
      recordedLater: false,
    });
    await expect(confirmSession(userId, original.id, correction)).resolves.toEqual(practicedLate);
    await expect(
      confirmSession(userId, original.id, {
        ...correction,
        operationId: randomUUID(),
        baseRevision: practicedLate.session.revision,
      }),
    ).rejects.toMatchObject({ code: 'NO_CHANGE', status: 409 });

    const history = await getSessionHistory(userId, original.id);
    expect(history.amendments.map(({ kind, sessionRevision }) => [kind, sessionRevision])).toEqual([
      ['values_saved', 1],
      ['values_saved', 2],
      ['confirmed', 3],
      ['completion_corrected', 4],
    ]);
    expect(history.events.filter(({ kind }) => kind === 'session_closed')).toHaveLength(1);
    expect(
      history.events
        .filter((event) => event.kind === 'session_corrected')
        .map((event) => event.detail),
    ).toEqual([
      expect.objectContaining({ beforeStatus: 'partial', afterStatus: 'partial' }),
      expect.objectContaining({
        action: 'confirmed',
        beforeStatus: 'partial',
        afterStatus: 'complete',
        afterTiming: { practiceTiming: 'on_schedule', recordedLater: true },
      }),
      expect.objectContaining({
        action: 'completion_corrected',
        beforeStatus: 'complete',
        afterStatus: 'complete',
        afterTiming: { practiceTiming: 'practiced_late', recordedLater: false },
      }),
    ]);
  });

  it('keeps a complete closure marker after undo and makes exact retries idempotent', async () => {
    const activated = await activate(`Undo ${randomUUID()}`);
    const ready = await saveAll(activated.sessions[0]);
    const confirmInput = {
      operationId: randomUUID(),
      baseRevision: ready.session.revision,
      payload: { performedAt: '2026-09-05T00:40:00Z' },
    };
    const completed = await confirmSession(userId, ready.session.id, confirmInput);
    await expect(confirmSession(userId, ready.session.id, confirmInput)).resolves.toEqual(
      completed,
    );

    setClock(AT_CLOSE);
    expect((await getSessionHistory(userId, ready.session.id)).events[0]).toMatchObject({
      kind: 'session_closed',
      detail: { status: 'complete' },
    });
    const undoInput = {
      operationId: randomUUID(),
      baseRevision: completed.session.revision,
      payload: {},
    };
    const undone = await removeCompletion(userId, ready.session.id, undoInput);
    expect(undone.session).toMatchObject({ confirmed: false, performedAt: null, recordedAt: null });
    expect(undone.session.practices.every(({ value }) => value === true)).toBe(true);
    await expect(removeCompletion(userId, ready.session.id, undoInput)).resolves.toEqual(undone);

    const history = await getSessionHistory(userId, ready.session.id);
    expect(history.events.filter(({ kind }) => kind === 'session_closed')).toEqual([
      expect.objectContaining({ detail: { status: 'complete' } }),
    ]);
    expect(history.events.at(-1)).toMatchObject({
      kind: 'session_corrected',
      detail: { action: 'completion_removed', beforeStatus: 'complete', afterStatus: 'partial' },
    });
    await expect(
      removeCompletion(userId, ready.session.id, {
        ...undoInput,
        operationId: randomUUID(),
        baseRevision: undone.session.revision,
      }),
    ).rejects.toMatchObject({ code: 'NO_CHANGE', status: 409 });
  });

  it('serializes concurrent correction and undo so one revision wins', async () => {
    const activated = await activate(`Race ${randomUUID()}`);
    const ready = await saveAll(activated.sessions[0]);
    const completed = await confirmSession(userId, ready.session.id, {
      operationId: randomUUID(),
      baseRevision: ready.session.revision,
      payload: { performedAt: '2026-09-05T01:00:00Z' },
    });
    setClock(AFTER_CLOSE);
    await getSessionHistory(userId, ready.session.id);

    const [correction, undo] = await Promise.all([
      settled(
        confirmSession(userId, ready.session.id, {
          operationId: randomUUID(),
          baseRevision: completed.session.revision,
          payload: { performedAt: '2026-09-05T01:45:00Z' },
        }),
      ),
      settled(
        removeCompletion(userId, ready.session.id, {
          operationId: randomUUID(),
          baseRevision: completed.session.revision,
          payload: {},
        }),
      ),
    ]);
    expect([correction, undo].filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect([correction, undo].filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'REVISION_CONFLICT' }) }),
    ]);
    const current = (await getJourneyView(userId, activated.journey.id)).sessions.find(
      ({ id }) => id === ready.session.id,
    )!;
    expect(current.revision).toBe(completed.session.revision + 1);
    const history = await getSessionHistory(userId, ready.session.id);
    expect(history.amendments).toHaveLength(3);
    expect(history.events.filter(({ kind }) => kind === 'session_corrected')).toHaveLength(1);
  });

  it('samples time after locks and rolls back closure, values and amendment on SQL failure', async () => {
    const activated = await activate(`Locks ${randomUUID()}`);
    const original = activated.sessions[0];
    setClock(BEFORE_CLOSE);
    const operationId = randomUUID();
    const locked = signal<void>();
    const release = signal<void>();

    const result = await observedTransactions(
      {
        after: async (query) => {
          if (
            query.operationId === operationId &&
            query.text === 'select id from app.session where id=$1 for update'
          ) {
            locked.resolve();
            await release.promise;
          }
        },
      },
      async () => {
        const save = savePractices(userId, original.id, {
          operationId,
          baseRevision: original.revision,
          payload: { values: { [FIRST_PRACTICE_ID]: true } },
        });
        try {
          await bounded(locked.promise, 'locked session before clock sample');
          setClock(AT_CLOSE);
          release.resolve();
          return await save;
        } finally {
          release.resolve();
          await Promise.allSettled([save]);
        }
      },
    );
    expect(result.historyEvents[0]).toMatchObject({
      kind: 'session_closed',
      recordedAt: new Date(AT_CLOSE).toISOString(),
      detail: { status: 'missed' },
    });

    await withUser(userId, (client) =>
      client.query('update app.session set revision=2147483647 where id=$1', [original.id]),
    );
    const before = await withUser(userId, async (client) => ({
      value: (
        await client.query<{ checkbox_value: boolean }>(
          'select checkbox_value from app.session_practice where session_id=$1 and practice_id=$2',
          [original.id, SECOND_PRACTICE_ID],
        )
      ).rows[0].checkbox_value,
      amendments: (
        await client.query<{ total: number }>(
          'select count(*)::int as total from app.amendment where session_id=$1',
          [original.id],
        )
      ).rows[0].total,
      events: (
        await client.query<{ total: number }>(
          'select count(*)::int as total from app.notification_event where session_id=$1',
          [original.id],
        )
      ).rows[0].total,
    }));
    setClock(AFTER_CLOSE);
    await expect(
      savePractices(userId, original.id, {
        operationId: randomUUID(),
        baseRevision: 2_147_483_647,
        payload: { values: { [SECOND_PRACTICE_ID]: true } },
      }),
    ).rejects.toThrow(/out of range/i);
    const after = await withUser(userId, async (client) => ({
      value: (
        await client.query<{ checkbox_value: boolean }>(
          'select checkbox_value from app.session_practice where session_id=$1 and practice_id=$2',
          [original.id, SECOND_PRACTICE_ID],
        )
      ).rows[0].checkbox_value,
      amendments: (
        await client.query<{ total: number }>(
          'select count(*)::int as total from app.amendment where session_id=$1',
          [original.id],
        )
      ).rows[0].total,
      events: (
        await client.query<{ total: number }>(
          'select count(*)::int as total from app.notification_event where session_id=$1',
          [original.id],
        )
      ).rows[0].total,
    }));
    expect(after).toEqual(before);
  });
});
