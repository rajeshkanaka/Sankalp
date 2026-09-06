import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type User } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  JourneyDraft,
  ReminderPreferences,
  ScheduleRevisionCandidate,
} from '../../src/domain/contracts';
import { reminderPreferencesSchema } from '../../src/domain/reminders';
import { journeyDraftSchema } from '../../src/domain/validation';
import { getPool, withUser } from '../../src/server/db/client';
import { updateJourneyMetadata } from '../../src/server/journeys/metadata';
import {
  applyScheduleRevision,
  previewScheduleRevision,
} from '../../src/server/journeys/revisions';
import {
  activateJourney,
  createJourney,
  updateJourneyDraft,
} from '../../src/server/journeys/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
  type SyntheticMarker,
} from './local-test-runtime';

const OFF: ReminderPreferences = { enabled: false, offsets: [], quietHours: null, detailed: false };
const ON: ReminderPreferences = {
  enabled: true,
  offsets: [-120, -30, -5, 0],
  quietHours: { start: '21:00', end: '23:00' },
  detailed: false,
};
const NOW = '2026-09-05T02:00:00Z';
const CLOCK_PATH = resolve(process.cwd(), '.local/integration-reminder-preferences-clock.json');
const ACCOUNTS = {
  maya: {
    email: 'integration-maya-reminder-preferences@example.test',
    marker: buildSyntheticMarker('activation', 'reminder-preferences-maya'),
  },
  arun: {
    email: 'integration-arun-reminder-preferences@example.test',
    marker: buildSyntheticMarker('activation', 'reminder-preferences-arun'),
  },
};

interface ValidationCase {
  name: string;
  input: unknown;
  valid: boolean;
}

const validationCases: ValidationCase[] = [
  { name: 'disabled empty defaults', input: OFF, valid: true },
  { name: 'enabled midnight offsets', input: ON, valid: true },
  { name: 'enabled at-time only', input: { ...ON, offsets: [0] }, valid: true },
  {
    name: 'minimum offset and eight choices',
    input: { ...ON, offsets: [-1440, -120, -60, -30, -15, -5, -1, 0] },
    valid: true,
  },
  {
    name: 'unsorted offsets remain valid',
    input: { ...ON, offsets: [0, -30, -1440] },
    valid: true,
  },
  { name: 'disabled stored suggestions', input: { ...OFF, offsets: [-30, 0] }, valid: true },
  { name: 'explicit detailed choice', input: { ...ON, detailed: true }, valid: true },
  { name: 'quiet hours disabled', input: { ...ON, quietHours: null }, valid: true },
  {
    name: 'quiet hours cross midnight',
    input: { ...ON, quietHours: { start: '23:00', end: '06:00' } },
    valid: true,
  },
  {
    name: 'quiet hour outer minute bounds',
    input: { ...ON, quietHours: { start: '00:00', end: '23:59' } },
    valid: true,
  },
  {
    name: 'quiet hours one minute wrap',
    input: { ...ON, quietHours: { start: '23:59', end: '00:00' } },
    valid: true,
  },
  ...[null, false, true, 0, 'reminders', [], {}].map((input, index) => ({
    name: `non-preference JSON shape ${index}`,
    input,
    valid: false,
  })),
  ...Object.keys(OFF).map((key) => ({
    name: `missing required ${key}`,
    input: Object.fromEntries(Object.entries(OFF).filter(([field]) => field !== key)),
    valid: false,
  })),
  { name: 'unknown preference field', input: { ...OFF, extra: false }, valid: false },
  {
    name: 'case-sensitive field names',
    input: { ...OFF, quietHours: undefined, QuietHours: null },
    valid: false,
  },
  ...(['enabled', 'detailed'] as const).flatMap((key) =>
    [null, 0, 1, 'true', 'false', [], {}].map((value, index) => ({
      name: `${key} rejects coercion ${index}`,
      input: { ...ON, [key]: value },
      valid: false,
    })),
  ),
  ...[null, 0, '0', {}].map((offsets, index) => ({
    name: `offsets must be an array ${index}`,
    input: { ...ON, offsets },
    valid: false,
  })),
  ...[
    [],
    [-1441],
    [1],
    [-1.5],
    ['-30'],
    [null],
    [false],
    [{}],
    [[0]],
    [-30, -30],
    [0, -0],
    [-9, -8, -7, -6, -5, -4, -3, -2, -1],
  ].map((offsets, index) => ({
    name: `invalid enabled offsets ${index}`,
    input: { ...ON, offsets },
    valid: false,
  })),
  {
    name: 'disabled does not permit duplicate offsets',
    input: { ...OFF, offsets: [-5, -5] },
    valid: false,
  },
  {
    name: 'disabled does not permit out-of-range offsets',
    input: { ...OFF, offsets: [1] },
    valid: false,
  },
  {
    name: 'disabled does not permit nine offsets',
    input: { ...OFF, offsets: [-9, -8, -7, -6, -5, -4, -3, -2, -1] },
    valid: false,
  },
  ...[
    false,
    '21:00',
    [],
    {},
    { start: '21:00' },
    { end: '23:00' },
    { start: '21:00', end: '23:00', extra: true },
    { start: '21:00', end: '21:00' },
    { start: null, end: '23:00' },
    { start: '21:00', end: 23 },
  ].map((quietHours, index) => ({
    name: `invalid quiet-hour shape ${index}`,
    input: { ...ON, quietHours },
    valid: false,
  })),
  ...[
    '24:00',
    '23:60',
    '9:00',
    '09:0',
    '09:00:00',
    ' 09:00',
    '09:00 ',
    '09:00\n',
    '09:00\r',
    '09:00\r\n',
    '09:00\u2028',
    '09:00\u2029',
    '０９:００',
    '09:00Z',
    '',
  ].map((value, index) => ({
    name: `strict minute start ${index}`,
    input: { ...ON, quietHours: { start: value, end: '23:00' } },
    valid: false,
  })),
  ...['24:00', '23:60', '9:00', '09:00:00', '09:00\n'].map((value, index) => ({
    name: `strict minute end ${index}`,
    input: { ...ON, quietHours: { start: '21:00', end: value } },
    valid: false,
  })),
];

function draft(title = 'Synthetic reminder preferences'): JourneyDraft {
  return {
    title,
    intention: 'Only synthetic reminder settings are used in this test.',
    practices: [
      {
        id: 'a9000000-0000-4000-8000-000000000001',
        label: 'Quiet practice',
        order: 0,
        kind: 'checkbox',
        target: null,
      },
    ],
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 3,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: structuredClone(OFF),
  };
}

describe('reminder preferences JSON boundary (no database)', () => {
  it.each(validationCases)('$name', ({ input, valid }) => {
    // Compare JSON-representable input at both public schemas, without coercion.
    const wireInput: unknown = JSON.parse(JSON.stringify(input));
    expect(reminderPreferencesSchema.safeParse(wireInput).success).toBe(valid);
    expect(journeyDraftSchema.safeParse({ ...draft(), reminders: wireInput }).success).toBe(valid);
  });
});

describe('reminder preferences PostgreSQL boundary', () => {
  let mayaId = '';
  let arunId = '';
  let adminDatabaseUrl = '';
  let clockInstalled = false;
  let previousClock: string | undefined;
  const ownedUsers = new Map<string, { email: string; marker: SyntheticMarker }>();

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

  async function deleteOwnedUser(id: string) {
    const expected = ownedUsers.get(id);
    if (!expected) throw new Error('Refusing to delete an unowned synthetic user ID.');
    const current = await authAdmin().auth.admin.getUserById(id);
    if (current.error) throw current.error;
    if (!isExpectedSyntheticUser(current.data.user, expected.email, expected.marker))
      throw new Error('Refusing to delete a user without the exact synthetic marker.');
    const deleted = await authAdmin().auth.admin.deleteUser(id);
    if (deleted.error) throw deleted.error;
    ownedUsers.delete(id);
  }

  async function createSyntheticUser(account: (typeof ACCOUNTS)[keyof typeof ACCOUNTS]) {
    const existing = (await listAllUsers()).find(({ email }) => email === account.email);
    if (existing) {
      if (!isExpectedSyntheticUser(existing, account.email, account.marker))
        throw new Error('Reserved integration email belongs to an unmarked or different account.');
      ownedUsers.set(existing.id, account);
      await deleteOwnedUser(existing.id);
    }
    const { data, error } = await authAdmin().auth.admin.createUser({
      email: account.email,
      email_confirm: true,
      app_metadata: { [SYNTHETIC_MARKER_KEY]: account.marker },
    });
    if (error) throw error;
    if (!isExpectedSyntheticUser(data.user, account.email, account.marker))
      throw new Error('Supabase returned a user without the exact synthetic marker.');
    ownedUsers.set(data.user.id, account);
    return data.user.id;
  }

  beforeAll(async () => {
    // No connection or fixture write may precede the worktree/loopback/role guard.
    const runtime = loadGuardedIntegrationRuntime();
    adminDatabaseUrl = runtime.adminDatabaseUrl;
    previousClock = process.env.DEMO_CLOCK_FILE;
    mkdirSync(resolve(process.cwd(), '.local'), { recursive: true, mode: 0o700 });
    writeFileSync(CLOCK_PATH, JSON.stringify({ now: NOW }), { mode: 0o600 });
    clockInstalled = true;
    process.env.DEMO_CLOCK_FILE = CLOCK_PATH;
    mayaId = await createSyntheticUser(ACCOUNTS.maya);
    arunId = await createSyntheticUser(ACCOUNTS.arun);
  });

  afterAll(async () => {
    try {
      const cleanup = await Promise.allSettled([...ownedUsers.keys()].map(deleteOwnedUser));
      const failures = cleanup.filter((result) => result.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Synthetic reminder fixture cleanup failed.',
        );
    } finally {
      try {
        const globalDb = globalThis as typeof globalThis & {
          sankalpaPool?: ReturnType<typeof getPool>;
        };
        if (globalDb.sankalpaPool) {
          const pool = globalDb.sankalpaPool;
          delete globalDb.sankalpaPool;
          await pool.end();
        }
      } finally {
        if (clockInstalled) {
          rmSync(CLOCK_PATH, { force: true });
          if (previousClock === undefined) delete process.env.DEMO_CLOCK_FILE;
          else process.env.DEMO_CLOCK_FILE = previousClock;
        }
      }
    }
  });

  interface Snapshot {
    id: string;
    title: string;
    intention: string;
    revision: number;
    reminderRevision: number;
    draft: JourneyDraft;
  }
  const columns = 'id,title,intention,revision,reminder_revision as "reminderRevision",draft';

  async function snapshot(id: string, ownerId = mayaId): Promise<Snapshot> {
    return withUser(ownerId, async (client) => {
      const result = await client.query<Snapshot>(
        `select ${columns} from app.journey where id=$1`,
        [id],
      );
      expect(result.rows).toHaveLength(1);
      return result.rows[0];
    });
  }

  async function savePreferences(id: string, preferences: ReminderPreferences, ownerId = mayaId) {
    return withUser(ownerId, async (client) => {
      await client.query('select id from app.journey where id=$1 for update', [id]);
      const result = await client.query<Snapshot>(
        `update app.journey set draft=jsonb_set(draft,'{reminders}',$2::jsonb),revision=revision+1 where id=$1 returning ${columns}`,
        [id, JSON.stringify(preferences)],
      );
      expect(result.rows).toHaveLength(1);
      return result.rows[0];
    });
  }

  it.each(validationCases)('SQL/Zod agree: $name', async ({ input, valid }) => {
    const result = await withUser(mayaId, (client) =>
      client.query<{ valid: boolean }>(
        'select app.valid_reminder_preferences($1::jsonb) as valid',
        [JSON.stringify(input)],
      ),
    );
    expect(result.rows[0].valid).toBe(valid);
    expect(reminderPreferencesSchema.safeParse(JSON.parse(JSON.stringify(input))).success).toBe(
      result.rows[0].valid,
    );
  });

  it('returns false rather than SQL NULL for a missing preference value', async () => {
    const result = await withUser(mayaId, (client) =>
      client.query<{ valid: boolean }>(
        'select app.valid_reminder_preferences(NULL::jsonb) as valid',
      ),
    );
    expect(result.rows[0].valid).toBe(false);
  });

  it('enforces PostgreSQL 17 and the restricted validation/revision privileges', async () => {
    const result = await withUser(mayaId, (client) =>
      client.query<{
        version: number;
        apiValidation: boolean;
        anonValidation: boolean;
        authenticatedValidation: boolean;
        apiTrigger: boolean;
        apiRevisionUpdate: boolean;
        apiDraftUpdate: boolean;
      }>(`select current_setting('server_version_num')::int as version,
      has_function_privilege('app_api','app.valid_reminder_preferences(jsonb)','EXECUTE') as "apiValidation",
      has_function_privilege('anon','app.valid_reminder_preferences(jsonb)','EXECUTE') as "anonValidation",
      has_function_privilege('authenticated','app.valid_reminder_preferences(jsonb)','EXECUTE') as "authenticatedValidation",
      has_function_privilege('app_api','app.version_reminder_preferences()','EXECUTE') as "apiTrigger",
      has_column_privilege('app_api','app.journey','reminder_revision','UPDATE') as "apiRevisionUpdate",
      has_column_privilege('app_api','app.journey','draft','UPDATE') as "apiDraftUpdate"`),
    );
    expect(result.rows[0]).toMatchObject({
      apiValidation: true,
      anonValidation: false,
      authenticatedValidation: false,
      apiTrigger: false,
      apiRevisionUpdate: false,
      apiDraftUpdate: true,
    });
    expect(result.rows[0].version).toBeGreaterThanOrEqual(170000);
    expect(result.rows[0].version).toBeLessThan(180000);
  });

  it('starts at zero, versions every actual preference change once, and preserves an equal rewrite', async () => {
    const created = await createJourney(mayaId, draft());
    expect(await snapshot(created.journey.id)).toMatchObject({
      revision: 0,
      reminderRevision: 0,
      draft: { reminders: OFF },
    });
    const first = await savePreferences(created.journey.id, ON);
    expect(first).toMatchObject({ revision: 1, reminderRevision: 1, draft: { reminders: ON } });
    const equal = await savePreferences(created.journey.id, {
      detailed: ON.detailed,
      quietHours: ON.quietHours,
      offsets: [...ON.offsets],
      enabled: ON.enabled,
    });
    expect(equal).toMatchObject({ revision: 2, reminderRevision: 1, draft: { reminders: ON } });
    const changed = await savePreferences(created.journey.id, { ...ON, detailed: true });
    expect(changed).toMatchObject({
      revision: 3,
      reminderRevision: 2,
      draft: { reminders: { ...ON, detailed: true } },
    });
    const disabled = await savePreferences(created.journey.id, OFF);
    expect(disabled).toMatchObject({ revision: 4, reminderRevision: 3, draft: { reminders: OFF } });
  });

  it('requires the containing journey revision to advance and rolls back rejected changes', async () => {
    const created = await createJourney(mayaId, draft());
    const before = await savePreferences(created.journey.id, ON);
    for (const revision of [before.revision, before.revision - 1]) {
      await expect(
        withUser(mayaId, (client) =>
          client.query(
            "update app.journey set draft=jsonb_set(draft,'{reminders}',$2::jsonb),revision=$3 where id=$1",
            [before.id, JSON.stringify(OFF), revision],
          ),
        ),
      ).rejects.toMatchObject({ code: 'P0001' });
      expect(await snapshot(before.id)).toEqual(before);
    }
  });

  it('prevents direct application revision updates even when setting the same value', async () => {
    const created = await createJourney(mayaId, draft());
    const before = await snapshot(created.journey.id);
    for (const revision of [0, 1]) {
      await expect(
        withUser(mayaId, (client) =>
          client.query('update app.journey set reminder_revision=$2 where id=$1', [
            before.id,
            revision,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      expect(await snapshot(before.id)).toEqual(before);
    }
  });

  it('rejects a nonzero initial reminder revision on an otherwise owned valid insert', async () => {
    const id = randomUUID();
    const input = draft();
    await expect(
      withUser(mayaId, (client) =>
        client.query(
          'insert into app.journey(id,owner_id,title,intention,draft,created_at,reminder_revision) values($1,$2,$3,$4,$5,$6,1)',
          [id, mayaId, input.title, input.intention, JSON.stringify(input), NOW],
        ),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    const result = await withUser(mayaId, (client) =>
      client.query('select id from app.journey where id=$1', [id]),
    );
    expect(result.rows).toEqual([]);
  });

  it('retains the trigger guard even for an administrative constraint probe', async () => {
    const created = await createJourney(mayaId, draft());
    const before = await snapshot(created.journey.id);
    // Administrative access is confined to this exact, suite-owned constraint probe.
    if (!ownedUsers.has(mayaId)) throw new Error('Expected owned synthetic fixture.');
    const client = new pg.Client({ connectionString: adminDatabaseUrl });
    await client.connect();
    try {
      await client.query('begin');
      await expect(
        client.query(
          'update app.journey set reminder_revision=reminder_revision+1 where id=$1 and owner_id=$2',
          [before.id, mayaId],
        ),
      ).rejects.toMatchObject({ code: 'P0001' });
    } finally {
      try {
        await client.query('rollback');
      } finally {
        await client.end();
      }
    }
    expect(await snapshot(before.id)).toEqual(before);
  });

  it.each([
    {
      name: 'JSON null',
      expression: "jsonb_set(draft,'{reminders}','null'::jsonb)",
      code: '23514',
    },
    { name: 'missing key', expression: "draft - 'reminders'", code: '23514' },
    { name: 'SQL null', expression: "jsonb_set(draft,'{reminders}',NULL::jsonb)", code: '23502' },
  ])(
    'rejects $name and rolls back earlier metadata and preference writes',
    async ({ expression, code }) => {
      const created = await createJourney(mayaId, draft());
      const before = await snapshot(created.journey.id);
      await expect(
        withUser(mayaId, async (client) => {
          await client.query(
            "update app.journey set title=$2,draft=jsonb_set(draft,'{reminders}',$3::jsonb),revision=revision+1 where id=$1",
            [before.id, 'Must roll back', JSON.stringify(ON)],
          );
          await client.query(
            `update app.journey set draft=${expression},revision=revision+1 where id=$1`,
            [before.id],
          );
        }),
      ).rejects.toMatchObject({ code });
      expect(await snapshot(before.id)).toEqual(before);
    },
  );

  it('keeps a retried whole-draft save idempotent without another reminder revision', async () => {
    const created = await createJourney(mayaId, draft());
    const preferences = { ...OFF, offsets: [-30, 0] };
    const request = {
      operationId: randomUUID(),
      baseRevision: 0,
      payload: { ...draft(), reminders: preferences },
    };
    const saved = await updateJourneyDraft(mayaId, created.journey.id, request);
    expect(await updateJourneyDraft(mayaId, created.journey.id, request)).toEqual(saved);
    expect(await snapshot(created.journey.id)).toMatchObject({
      revision: 1,
      reminderRevision: 1,
      draft: { reminders: preferences },
    });
  });

  it('preserves current preferences through real metadata and future-schedule services while retaining historical snapshots', async () => {
    const created = await createJourney(mayaId, draft());
    const activated = await activateJourney(mayaId, created.journey.id, {
      operationId: randomUUID(),
      baseRevision: created.journey.revision,
      payload: { fingerprint: created.fingerprint },
    });
    const preferences = { ...OFF, offsets: [-30, 0] };
    const changed = await savePreferences(created.journey.id, preferences);
    const metadata = await updateJourneyMetadata(mayaId, created.journey.id, {
      operationId: randomUUID(),
      baseRevision: changed.revision,
      payload: { title: 'Updated synthetic title', intention: 'Updated synthetic intention' },
    });
    expect(await snapshot(created.journey.id)).toMatchObject({
      revision: changed.revision + 1,
      reminderRevision: 1,
      draft: { reminders: preferences },
    });
    const candidate: ScheduleRevisionCandidate = {
      effectivePracticeDate: '2026-09-06',
      practices: draft().practices,
      schedule: {
        durationMode: 'occurrences',
        durationValue: 3,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        localTime: '07:00',
        timeZone: 'Asia/Kolkata',
        attribution: 'civil',
        windowMinutes: 60,
      },
    };
    const preview = await previewScheduleRevision(mayaId, created.journey.id, {
      mode: 'preview',
      baseRevision: metadata.journey.revision,
      payload: candidate,
    });
    await applyScheduleRevision(mayaId, created.journey.id, {
      mode: 'apply',
      operationId: randomUUID(),
      baseRevision: metadata.journey.revision,
      payload: { candidate, fingerprint: preview.fingerprint },
    });
    const after = await snapshot(created.journey.id);
    expect(after).toMatchObject({
      revision: metadata.journey.revision + 1,
      reminderRevision: 1,
      draft: { reminders: preferences, schedule: { localTime: '07:00' } },
    });
    const versions = await withUser(mayaId, (client) =>
      client.query<{ id: string; preferences: ReminderPreferences }>(
        "select id,definition->'reminders' as preferences from app.schedule_version where journey_id=$1 order by version",
        [created.journey.id],
      ),
    );
    expect(versions.rows).toEqual([
      { id: activated.journey.activeScheduleVersionId, preferences: OFF },
      { id: expect.any(String), preferences },
    ]);
  });

  it('permits only one concurrent CAS winner and exactly one reminder revision', async () => {
    const created = await createJourney(mayaId, draft());
    const choices = [ON, { ...ON, detailed: true }];
    const results = await Promise.all(
      choices.map((preferences) =>
        withUser(mayaId, (client) =>
          client.query<Snapshot>(
            `update app.journey set draft=jsonb_set(draft,'{reminders}',$2::jsonb),revision=revision+1 where id=$1 and revision=0 returning ${columns}`,
            [created.journey.id, JSON.stringify(preferences)],
          ),
        ),
      ),
    );
    expect(results.map(({ rowCount }) => rowCount).sort()).toEqual([0, 1]);
    const winner = results.flatMap(({ rows }) => rows)[0];
    expect(winner).toMatchObject({ revision: 1, reminderRevision: 1 });
    expect(await snapshot(created.journey.id)).toEqual(winner);
  });

  it('hides another owner’s preferences and rejects a forged owned insert', async () => {
    const maya = await createJourney(mayaId, draft('Maya synthetic preferences'));
    const arun = await createJourney(arunId, draft('Arun synthetic preferences'));
    const before = await savePreferences(maya.journey.id, ON);
    const hidden = await withUser(arunId, (client) =>
      client.query(`select ${columns} from app.journey where id=$1`, [before.id]),
    );
    expect(hidden.rows).toEqual([]);
    const update = await withUser(arunId, (client) =>
      client.query(
        "update app.journey set draft=jsonb_set(draft,'{reminders}',$2::jsonb),revision=revision+1 where id=$1 returning id",
        [before.id, JSON.stringify(OFF)],
      ),
    );
    expect(update.rows).toEqual([]);
    const input = draft();
    await expect(
      withUser(arunId, (client) =>
        client.query(
          'insert into app.journey(id,owner_id,title,intention,draft,created_at) values($1,$2,$3,$4,$5,$6)',
          [randomUUID(), mayaId, input.title, input.intention, JSON.stringify(input), NOW],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await snapshot(before.id)).toEqual(before);
    expect(await savePreferences(arun.journey.id, ON, arunId)).toMatchObject({
      reminderRevision: 1,
      draft: { reminders: ON },
    });
  });
});
