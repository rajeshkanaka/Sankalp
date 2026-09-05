import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JourneyDraft } from '../../src/domain/contracts';
import { deriveStatus } from '../../src/domain/status';
import { getPool, withUser } from '../../src/server/db/client';
import { AppError } from '../../src/server/errors';
import { activateJourney, createJourney, getJourneyView } from '../../src/server/journeys/service';
import { confirmSession, savePractices } from '../../src/server/sessions/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
  type SyntheticMarker,
} from './local-test-runtime';

const TEST_EMAIL = 'integration-maya-activation@example.test';
const TEST_MARKER = buildSyntheticMarker('activation', 'maya');
const SECOND_EMAIL = 'integration-arun-activation@example.test';
const SECOND_MARKER = buildSyntheticMarker('activation', 'arun');
const CLOCK_PATH = resolve(process.cwd(), '.local/integration-activation-clock.json');
const NOW = '2026-09-05T06:15:00+05:30';
const PERFORMED_AT = '2026-09-05T06:10:00+05:30';
const FIRST_PRACTICE_ID = 'a1000000-0000-4000-8000-000000000001';
const SECOND_PRACTICE_ID = 'a1000000-0000-4000-8000-000000000002';

let userId = '';
let secondUserId = '';
const ownedUserIds = new Set<string>();

function loadIntegrationEnvironment() {
  loadGuardedIntegrationRuntime();
  mkdirSync(resolve(process.cwd(), '.local'), { recursive: true, mode: 0o700 });
  writeFileSync(CLOCK_PATH, JSON.stringify({ now: NOW }), { mode: 0o600 });
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
  const admin = authAdmin();
  const current = await admin.auth.admin.getUserById(id);
  if (current.error) throw current.error;
  if (!isExpectedSyntheticUser(current.data.user, email, marker))
    throw new Error('Refusing to delete a user without the exact synthetic marker.');
  const deleted = await admin.auth.admin.deleteUser(id);
  if (deleted.error) throw deleted.error;
  ownedUserIds.delete(id);
}

async function createSyntheticUser(email: string, marker: SyntheticMarker): Promise<string> {
  const existing = (await listAllUsers()).find((user) => user.email === email);
  if (existing) {
    if (!isExpectedSyntheticUser(existing, email, marker))
      throw new Error('Reserved integration email belongs to an unmarked or different account.');
    ownedUserIds.add(existing.id);
    await deleteOwnedSyntheticUser(existing.id, email, marker);
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

async function closeApplicationPool() {
  const globalDb = globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> };
  if (globalDb.sankalpaPool) {
    const pool = globalDb.sankalpaPool;
    delete globalDb.sankalpaPool;
    await pool.end();
  }
}

function draft(title: string): JourneyDraft {
  return {
    title,
    intention: 'A synthetic integration journey.',
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
      durationValue: 21,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  };
}

async function createActivatedJourney(title: string) {
  const created = await createJourney(userId, draft(title));
  const operationId = randomUUID();
  const envelope = {
    operationId,
    baseRevision: 0,
    payload: { fingerprint: created.fingerprint },
  };
  const activated = await activateJourney(userId, created.journey.id, envelope);
  return { created, activated, envelope };
}

function personalizedDraft(title: string): JourneyDraft {
  const input = draft(title);
  input.practices = [
    { id: randomUUID(), label: 'Meditation', order: 0, kind: 'minutes', target: 20 },
    { id: randomUUID(), label: 'Japa', order: 1, kind: 'repetitions', target: 108 },
    { id: randomUUID(), label: 'Puja', order: 2, kind: 'checkbox', target: null },
  ];
  return input;
}

async function activatePersonalized(input: JourneyDraft, ownerId = userId) {
  const created = await createJourney(ownerId, input);
  const activated = await activateJourney(ownerId, created.journey.id, {
    operationId: randomUUID(),
    baseRevision: created.journey.revision,
    payload: { fingerprint: created.fingerprint },
  });
  return { created, activated };
}

beforeAll(async () => {
  loadIntegrationEnvironment();
  userId = await createSyntheticUser(TEST_EMAIL, TEST_MARKER);
  secondUserId = await createSyntheticUser(SECOND_EMAIL, SECOND_MARKER);
});

afterAll(async () => {
  if (userId && ownedUserIds.has(userId))
    await deleteOwnedSyntheticUser(userId, TEST_EMAIL, TEST_MARKER);
  if (secondUserId && ownedUserIds.has(secondUserId))
    await deleteOwnedSyntheticUser(secondUserId, SECOND_EMAIL, SECOND_MARKER);
  await closeApplicationPool();
  rmSync(CLOCK_PATH, { force: true });
  delete process.env.DEMO_CLOCK_FILE;
});

describe('personalized target persistence', () => {
  it('keeps five minutes partial with zero completion credit, then requires every target and explicit confirmation', async () => {
    const input = personalizedDraft('Mixed targets');
    const [minutes, repetitions, checkbox] = input.practices;
    const { activated } = await activatePersonalized(input);
    const first = activated.sessions[0]!;

    expect(first.practices).toEqual([
      { ...minutes, value: 0 },
      { ...repetitions, value: 0 },
      { ...checkbox, value: false },
    ]);
    const partial = await savePractices(userId, first.id, {
      operationId: randomUUID(),
      baseRevision: first.revision,
      payload: { values: { [minutes!.id]: 5 } },
    });
    expect(deriveStatus(partial.session, NOW)).toBe('partial');
    const partialView = await getJourneyView(userId, activated.journey.id);
    expect(partialView.metrics).toMatchObject({ complete: 0, percent: 0, partial: 1 });
    await expect(
      confirmSession(userId, first.id, {
        operationId: randomUUID(),
        baseRevision: partial.session.revision,
        payload: { performedAt: PERFORMED_AT },
      }),
    ).rejects.toMatchObject({ code: 'TARGETS_INCOMPLETE' });

    const ready = await savePractices(userId, first.id, {
      operationId: randomUUID(),
      baseRevision: partial.session.revision,
      payload: {
        values: { [minutes!.id]: 20, [repetitions!.id]: 108, [checkbox!.id]: true },
      },
    });
    expect(ready.session.confirmed).toBe(false);
    expect((await getJourneyView(userId, activated.journey.id)).metrics).toMatchObject({
      complete: 0,
      percent: 0,
    });
    await confirmSession(userId, first.id, {
      operationId: randomUUID(),
      baseRevision: ready.session.revision,
      payload: { performedAt: PERFORMED_AT },
    });
    const reloaded = await getJourneyView(userId, activated.journey.id);
    expect(reloaded.metrics).toMatchObject({ total: 21, complete: 1, percent: 5, partial: 0 });
    expect(reloaded.sessions[0]).toMatchObject({
      confirmed: true,
      practices: [
        expect.objectContaining({ id: minutes!.id, target: 20, value: 20 }),
        expect.objectContaining({ id: repetitions!.id, target: 108, value: 108 }),
        expect.objectContaining({ id: checkbox!.id, target: null, value: true }),
      ],
    });
  });

  it('persists an explicit zero-only save as open rather than partial or complete', async () => {
    const input = personalizedDraft('Zero values');
    const { activated } = await activatePersonalized(input);
    const first = activated.sessions[0]!;
    await savePractices(userId, first.id, {
      operationId: randomUUID(),
      baseRevision: first.revision,
      payload: {
        values: Object.fromEntries(
          input.practices.map((practice) => [
            practice.id,
            practice.kind === 'checkbox' ? false : 0,
          ]),
        ),
      },
    });
    const reloaded = await getJourneyView(userId, activated.journey.id);
    expect(deriveStatus(reloaded.sessions[0]!, NOW)).toBe('open');
    expect(reloaded.metrics).toMatchObject({ complete: 0, percent: 0, partial: 0, open: 1 });
  });

  it('rejects invalid and null targets at both service validation and the database constraint', async () => {
    const input = personalizedDraft('Target constraints');
    const { activated } = await activatePersonalized(input);
    const first = activated.sessions[0]!;
    const invalidTargets = [
      { kind: 'minutes', target: 1_440 },
      { kind: 'minutes', target: null },
      { kind: 'repetitions', target: 0 },
      { kind: 'repetitions', target: 1_000_001 },
      { kind: 'repetitions', target: null },
      { kind: 'checkbox', target: 1 },
    ];
    for (const { kind, target } of invalidTargets) {
      const practice = { id: randomUUID(), label: 'Invalid target', order: 0, kind, target };
      const invalid = { ...input, practices: [practice] } as JourneyDraft;
      await expect(createJourney(userId, invalid)).rejects.toMatchObject({ name: 'ZodError' });
      await expect(
        withUser(userId, (client) =>
          client.query(
            `insert into app.practice_version
             (id,schedule_version_id,journey_id,owner_id,label,position,kind,target)
             values($1,$2,$3,$4,$5,3,$6,$7)`,
            [
              practice.id,
              first.scheduleVersionId,
              activated.journey.id,
              userId,
              practice.label,
              kind,
              target,
            ],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    expect(
      (await getJourneyView(userId, activated.journey.id)).sessions[0]!.practices,
    ).toHaveLength(3);
  });

  it('rolls back a valid numeric value when another value has the wrong type and rejects SQL null numeric values', async () => {
    const input = personalizedDraft('Numeric value constraints');
    const [minutes, repetitions] = input.practices;
    const { activated } = await activatePersonalized(input);
    const first = activated.sessions[0]!;
    await expect(
      savePractices(userId, first.id, {
        operationId: randomUUID(),
        baseRevision: first.revision,
        payload: { values: { [minutes!.id]: 5, [repetitions!.id]: true } },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    for (const practice of [minutes!, repetitions!]) {
      await expect(
        withUser(userId, (client) =>
          client.query(
            'update app.session_practice set numeric_value=null where session_id=$1 and practice_id=$2',
            [first.id, practice.id],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    const reloaded = await getJourneyView(userId, activated.journey.id);
    expect(reloaded.sessions[0]).toMatchObject({
      revision: 0,
      practices: [
        expect.objectContaining({ id: minutes!.id, value: 0 }),
        expect.objectContaining({ id: repetitions!.id, value: 0 }),
        expect.objectContaining({ value: false }),
      ],
    });
  });
});

describe('personalized schedules through activation and reload', () => {
  it('persists twelve Monday and Thursday occurrences from September 7 through October 15', async () => {
    const input = personalizedDraft('Monday and Thursday');
    input.schedule = {
      ...input.schedule,
      startDate: '2026-09-07',
      weekdays: [1, 4],
      durationValue: 12,
    };
    const { activated } = await activatePersonalized(input);
    const reloaded = await getJourneyView(userId, activated.journey.id);
    expect(reloaded.sessions.map((session) => session.practiceDate)).toEqual([
      '2026-09-07',
      '2026-09-10',
      '2026-09-14',
      '2026-09-17',
      '2026-09-21',
      '2026-09-24',
      '2026-09-28',
      '2026-10-01',
      '2026-10-05',
      '2026-10-08',
      '2026-10-12',
      '2026-10-15',
    ]);
    expect(reloaded.sessions[0]!.opensAt).toBe('2026-09-07T00:30:00.000Z');
    expect(reloaded.sessions.at(-1)!.opensAt).toBe('2026-10-15T00:30:00.000Z');
    expect(reloaded.metrics).toMatchObject({ total: 12, upcoming: 12, complete: 0 });
    expect(reloaded.journey.schedule).toEqual(input.schedule);
  });

  it('persists four Tuesday sessions in a thirty-calendar-day span without extending the end date', async () => {
    const input = personalizedDraft('Tuesday calendar span');
    input.schedule = {
      ...input.schedule,
      weekdays: [2],
      durationMode: 'calendar_days',
      durationValue: 30,
    };
    const { activated } = await activatePersonalized(input);
    const reloaded = await getJourneyView(userId, activated.journey.id);
    expect(reloaded.sessions.map((session) => session.practiceDate)).toEqual([
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
    ]);
    expect(reloaded.metrics).toMatchObject({ total: 4, upcoming: 4 });
    expect(reloaded.journey.schedule.durationMode).toBe('calendar_days');
    expect(reloaded.journey.schedule.durationValue).toBe(30);
  });

  it('preserves twenty-one evening practice dates while scheduling midnight on the following civil date', async () => {
    const input = personalizedDraft('Overnight attribution');
    input.schedule = { ...input.schedule, localTime: '00:00', attribution: 'previous_evening' };
    const { activated } = await activatePersonalized(input);
    const reloaded = await getJourneyView(userId, activated.journey.id);
    expect(reloaded.sessions).toHaveLength(21);
    expect(reloaded.sessions[0]).toMatchObject({
      practiceDate: '2026-09-05',
      opensAt: '2026-09-05T18:30:00.000Z',
      closesAt: '2026-09-05T19:30:00.000Z',
      attribution: 'previous_evening',
    });
    expect(reloaded.sessions.at(-1)).toMatchObject({
      practiceDate: '2026-09-25',
      opensAt: '2026-09-25T18:30:00.000Z',
      attribution: 'previous_evening',
    });
    expect(reloaded.sessions.map((session) => session.ordinal)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1),
    );
    expect(reloaded.metrics).toMatchObject({ total: 21, upcoming: 21 });
  });
});

describe('personalized preview boundaries', () => {
  it('previews disabled reminder offsets with exact dates and past flags, without enabling delivery', async () => {
    const input = personalizedDraft('Reminder time preview only');
    input.schedule.durationValue = 2;
    input.reminders.offsets = [-30, -5, 0];
    const created = await createJourney(userId, input);
    expect(created).toHaveProperty('reminderTimes', [
      {
        practiceDate: '2026-09-05',
        offsetMinutes: -30,
        scheduledFor: '2026-09-05T00:00:00.000Z',
        isPast: true,
      },
      {
        practiceDate: '2026-09-05',
        offsetMinutes: -5,
        scheduledFor: '2026-09-05T00:25:00.000Z',
        isPast: true,
      },
      {
        practiceDate: '2026-09-05',
        offsetMinutes: 0,
        scheduledFor: '2026-09-05T00:30:00.000Z',
        isPast: true,
      },
      {
        practiceDate: '2026-09-06',
        offsetMinutes: -30,
        scheduledFor: '2026-09-06T00:00:00.000Z',
        isPast: false,
      },
      {
        practiceDate: '2026-09-06',
        offsetMinutes: -5,
        scheduledFor: '2026-09-06T00:25:00.000Z',
        isPast: false,
      },
      {
        practiceDate: '2026-09-06',
        offsetMinutes: 0,
        scheduledFor: '2026-09-06T00:30:00.000Z',
        isPast: false,
      },
    ]);
    const reloaded = await getJourneyView(userId, created.journey.id);
    expect(reloaded.journey.reminders).toEqual(input.reminders);
    expect(reloaded.journey.reminders.enabled).toBe(false);
    expect(reloaded.sessions).toEqual([]);
  });

  it('rejects enabling reminder delivery before the integration exists', async () => {
    const input = personalizedDraft('Unavailable delivery');
    input.reminders = { ...input.reminders, enabled: true, offsets: [-5, 0] };
    await expect(createJourney(userId, input)).rejects.toMatchObject({
      status: 422,
      code: 'REMINDERS_UNAVAILABLE',
    });
  });

  it('warns about an overlapping owned active journey while permitting both schedules', async () => {
    const existing = personalizedDraft('Existing owned afternoon practice');
    existing.schedule = {
      ...existing.schedule,
      startDate: '2026-11-01',
      durationValue: 2,
      localTime: '14:00',
    };
    const { activated: original } = await activatePersonalized(existing);
    const proposed = personalizedDraft('Overlapping afternoon practice');
    proposed.schedule = { ...existing.schedule, localTime: '14:30' };
    const created = await createJourney(userId, proposed);
    expect(created.preview.warnings).toEqual([expect.stringMatching(/overlap/i)]);
    const activated = await activateJourney(userId, created.journey.id, {
      operationId: randomUUID(),
      baseRevision: 0,
      payload: { fingerprint: created.fingerprint },
    });
    expect(activated.sessions).toHaveLength(2);
    expect((await getJourneyView(userId, original.journey.id)).sessions).toEqual(original.sessions);
  });

  it('does not reveal an overlapping journey owned by another account', async () => {
    const foreign = personalizedDraft('Private Arun overlap sentinel');
    foreign.schedule = {
      ...foreign.schedule,
      startDate: '2026-12-01',
      durationValue: 2,
      localTime: '16:00',
    };
    const { activated: foreignJourney } = await activatePersonalized(foreign, secondUserId);
    const proposed = personalizedDraft('Maya same-time practice');
    proposed.schedule = { ...foreign.schedule };
    const created = await createJourney(userId, proposed);
    expect(created.preview.warnings).toEqual([]);
    expect(JSON.stringify(created)).not.toContain(foreignJourney.journey.id);
    expect(JSON.stringify(created)).not.toContain(foreign.title);
    const activated = await activateJourney(userId, created.journey.id, {
      operationId: randomUUID(),
      baseRevision: 0,
      payload: { fingerprint: created.fingerprint },
    });
    expect(activated.sessions).toHaveLength(2);
    await expect(getJourneyView(userId, foreignJourney.journey.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('journey draft creation', () => {
  it('returns one persisted journey for an exact operation retry and rejects changed input', async () => {
    const operationId = randomUUID();
    const input = draft('Draft idempotence');
    const created = await createJourney(userId, input, operationId);
    const retried = await createJourney(userId, input, operationId);

    expect(retried).toEqual(created);
    const persisted = await withUser(userId, async (client) => {
      const journeys = await client.query(
        'select count(*)::int as total from app.journey where id=$1',
        [created.journey.id],
      );
      const receipts = await client.query(
        'select count(*)::int as total from app.operation_receipt where operation_id=$1',
        [operationId],
      );
      return { journeys: journeys.rows[0]?.total, receipts: receipts.rows[0]?.total };
    });
    expect(persisted).toEqual({ journeys: 1, receipts: 1 });

    await expect(
      createJourney(userId, { ...input, title: 'Changed draft input' }, operationId),
    ).rejects.toMatchObject({ status: 409, code: 'OPERATION_REUSED' } satisfies Partial<AppError>);
  });

  it.each([
    {
      name: 'all occurrence windows have already opened',
      schedule: {
        startDate: '2026-09-04',
        durationMode: 'occurrences' as const,
        durationValue: 1,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      },
    },
    {
      name: 'the calendar range contains no selected weekday',
      schedule: {
        startDate: '2026-09-06',
        durationMode: 'calendar_days' as const,
        durationValue: 1,
        weekdays: [1],
      },
    },
  ])('maps an invalid schedule to AppError 422 when $name', async ({ schedule }) => {
    const input = draft('Invalid schedule');
    input.schedule = { ...input.schedule, ...schedule };
    await expect(createJourney(userId, input, randomUUID())).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_SCHEDULE',
    } satisfies Partial<AppError>);
  });
});

describe('journey activation', () => {
  it('activates exactly 21 persisted sessions and returns the same records on an idempotent retry', async () => {
    const { created, activated, envelope } = await createActivatedJourney('Activation idempotence');
    const retried = await activateJourney(userId, created.journey.id, envelope);
    const reloaded = await getJourneyView(userId, created.journey.id);

    expect(activated.sessions).toHaveLength(21);
    expect(activated.sessions[0]).toMatchObject({
      ordinal: 1,
      practiceDate: '2026-09-05',
      confirmed: false,
    });
    expect(retried.sessions.map(({ id }) => id)).toEqual(activated.sessions.map(({ id }) => id));
    expect(reloaded.sessions.map(({ id }) => id)).toEqual(activated.sessions.map(({ id }) => id));
    expect(reloaded.journey).toMatchObject({ state: 'active', revision: 1 });

    const receipts = await withUser(userId, (client) =>
      client.query(
        'select count(*)::int as total from app.operation_receipt where operation_id=$1',
        [envelope.operationId],
      ),
    );
    expect(receipts.rows[0]?.total).toBe(1);
  });

  it('rolls activation back completely when the reviewed fingerprint is stale', async () => {
    const created = await createJourney(userId, draft('Activation rollback'));
    const operationId = randomUUID();

    await expect(
      activateJourney(userId, created.journey.id, {
        operationId,
        baseRevision: 0,
        payload: { fingerprint: '0'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' } satisfies Partial<AppError>);

    const persisted = await withUser(userId, async (client) => {
      const journey = await client.query(
        'select state, revision, active_schedule_version_id from app.journey where id=$1',
        [created.journey.id],
      );
      const versions = await client.query(
        'select count(*)::int as total from app.schedule_version where journey_id=$1',
        [created.journey.id],
      );
      const sessions = await client.query(
        'select count(*)::int as total from app.session where journey_id=$1',
        [created.journey.id],
      );
      const receipts = await client.query(
        'select count(*)::int as total from app.operation_receipt where operation_id=$1',
        [operationId],
      );
      return {
        journey: journey.rows[0],
        versions: versions.rows[0],
        sessions: sessions.rows[0],
        receipts: receipts.rows[0],
      };
    });

    expect(persisted).toEqual({
      journey: { state: 'draft', revision: 0, active_schedule_version_id: null },
      versions: { total: 0 },
      sessions: { total: 0 },
      receipts: { total: 0 },
    });
  });
});

describe('practice persistence', () => {
  it('rolls back an earlier valid value when the same payload contains an unknown nested ID', async () => {
    const { activated } = await createActivatedJourney('Unknown nested practice rollback');
    const first = activated.sessions[0]!;
    const operationId = randomUUID();

    await expect(
      savePractices(userId, first.id, {
        operationId,
        baseRevision: 0,
        payload: { values: { [FIRST_PRACTICE_ID]: true, [randomUUID()]: true } },
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_PRACTICE' } satisfies Partial<AppError>);

    const reloaded = await getJourneyView(userId, activated.journey.id);
    expect(reloaded.sessions[0]).toMatchObject({
      revision: 0,
      confirmed: false,
      practices: [
        expect.objectContaining({ id: FIRST_PRACTICE_ID, value: false }),
        expect.objectContaining({ id: SECOND_PRACTICE_ID, value: false }),
      ],
    });
    const writes = await withUser(userId, async (client) => {
      const amendments = await client.query(
        'select count(*)::int as total from app.amendment where session_id=$1',
        [first.id],
      );
      const receipts = await client.query(
        'select count(*)::int as total from app.operation_receipt where operation_id=$1',
        [operationId],
      );
      return { amendments: amendments.rows[0]?.total, receipts: receipts.rows[0]?.total };
    });
    expect(writes).toEqual({ amendments: 0, receipts: 0 });
  });

  it('rejects incomplete and stale confirmation paths, then persists one of 21 exactly once', async () => {
    const { activated } = await createActivatedJourney('One of twenty-one persistence');
    const first = activated.sessions[0]!;
    const firstSaveId = randomUUID();
    const incompleteConfirmId = randomUUID();
    const staleSaveId = randomUUID();
    const secondSaveId = randomUUID();
    const confirmId = randomUUID();

    const partial = await savePractices(userId, first.id, {
      operationId: firstSaveId,
      baseRevision: 0,
      payload: { values: { [FIRST_PRACTICE_ID]: true } },
    });
    expect(partial.session).toMatchObject({ revision: 1, confirmed: false });

    await expect(
      confirmSession(userId, first.id, {
        operationId: incompleteConfirmId,
        baseRevision: 1,
        payload: { performedAt: PERFORMED_AT },
      }),
    ).rejects.toMatchObject({ code: 'TARGETS_INCOMPLETE' } satisfies Partial<AppError>);

    await expect(
      savePractices(userId, first.id, {
        operationId: staleSaveId,
        baseRevision: 0,
        payload: { values: { [SECOND_PRACTICE_ID]: true } },
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' } satisfies Partial<AppError>);

    const ready = await savePractices(userId, first.id, {
      operationId: secondSaveId,
      baseRevision: 1,
      payload: { values: { [SECOND_PRACTICE_ID]: true } },
    });
    expect(ready.session).toMatchObject({ revision: 2, confirmed: false });

    const confirmation = {
      operationId: confirmId,
      baseRevision: 2,
      payload: { performedAt: PERFORMED_AT },
    };
    const completed = await confirmSession(userId, first.id, confirmation);
    const retried = await confirmSession(userId, first.id, confirmation);
    const reloaded = await getJourneyView(userId, activated.journey.id);

    expect(retried.session).toEqual(completed.session);
    expect(reloaded.metrics).toMatchObject({ total: 21, complete: 1, percent: 5 });
    expect(reloaded.sessions[0]).toMatchObject({
      id: first.id,
      revision: 3,
      confirmed: true,
      performedAt: '2026-09-05T00:40:00.000Z',
      practices: [
        expect.objectContaining({ id: FIRST_PRACTICE_ID, value: true }),
        expect.objectContaining({ id: SECOND_PRACTICE_ID, value: true }),
      ],
    });

    const evidence = await withUser(userId, async (client) => {
      const amendments = await client.query(
        'select kind, count(*)::int as total from app.amendment where session_id=$1 group by kind order by kind',
        [first.id],
      );
      const receipts = await client.query(
        'select operation_id from app.operation_receipt where operation_id = any($1::uuid[]) order by operation_id',
        [[firstSaveId, incompleteConfirmId, staleSaveId, secondSaveId, confirmId]],
      );
      return {
        amendments: amendments.rows,
        receiptIds: receipts.rows.map(({ operation_id }) => operation_id),
      };
    });
    expect(evidence.amendments).toEqual([
      { kind: 'confirmed', total: 1 },
      { kind: 'values_saved', total: 2 },
    ]);
    expect(evidence.receiptIds.sort()).toEqual([firstSaveId, secondSaveId, confirmId].sort());
  });
});
