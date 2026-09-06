import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type User } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JourneyDraft, SessionRecord } from '../../src/domain/contracts';
import { getPool, withUser } from '../../src/server/db/client';
import { activateJourney, createJourney } from '../../src/server/journeys/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
  type SyntheticMarker,
} from './local-test-runtime';

const CREATED_AT = '2026-09-05T00:00:00Z';
const AFTER_CLOSE = '2026-09-05T02:00:00Z';
const CLOCK_PATH = resolve(process.cwd(), '.local/integration-reminder-schema-clock.json');
const ACCOUNTS = {
  maya: {
    email: 'integration-maya-reminder-schema@example.test',
    marker: buildSyntheticMarker('activation', 'reminder-schema-maya'),
  },
  arun: {
    email: 'integration-arun-reminder-schema@example.test',
    marker: buildSyntheticMarker('activation', 'reminder-schema-arun'),
  },
};
type Table =
  | 'push_subscription'
  | 'reminder_job'
  | 'notification_event'
  | 'notification_read'
  | 'worker_heartbeat';
type Row = Record<string, unknown>;

function subscription(ownerId: string, changes: Row = {}) {
  const endpoint = `https://push.sankalpa.invalid/schema/${randomUUID()}`;
  return {
    id: randomUUID(),
    owner_id: ownerId,
    generation: 1,
    endpoint,
    endpoint_hash: createHash('sha256').update(endpoint).digest('hex'),
    // Deliberately synthetic, unusable transport material: these tests never send push.
    p256dh: 's'.repeat(87),
    auth_key: 's'.repeat(22),
    device_label: 'Synthetic schema device',
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    revoked_at: null,
    last_result: null,
    ...changes,
  };
}

function job(ownerId: string, session: SessionRecord, subscriptionId: string, changes: Row = {}) {
  return {
    id: randomUUID(),
    owner_id: ownerId,
    journey_id: session.journeyId,
    session_id: session.id,
    schedule_version_id: session.scheduleVersionId,
    subscription_id: subscriptionId,
    reminder_revision: 0,
    subscription_generation: 1,
    kind: 'offset',
    offset_minutes: 0,
    operation_id: null,
    scheduled_at: session.opensAt,
    expires_at: new Date(Date.parse(session.opensAt) + 300_000).toISOString(),
    next_attempt_at: session.opensAt,
    state: 'pending',
    attempts: 0,
    lease_token: null,
    lease_until: null,
    dispatch_started_at: null,
    cancel_requested_at: null,
    safe_reason: null,
    created_at: CREATED_AT,
    ...changes,
  };
}

function explicitTestJob(
  ownerId: string,
  session: SessionRecord,
  subscriptionId: string,
  changes: Row = {},
) {
  return job(ownerId, session, subscriptionId, {
    kind: 'test',
    offset_minutes: null,
    operation_id: randomUUID(),
    journey_id: null,
    session_id: null,
    schedule_version_id: null,
    reminder_revision: null,
    ...changes,
  });
}

function event(source: ReturnType<typeof job>, changes: Row = {}) {
  return {
    id: randomUUID(),
    owner_id: source.owner_id,
    journey_id: source.journey_id,
    session_id: source.session_id,
    schedule_version_id: source.schedule_version_id,
    amendment_id: null,
    kind: 'reminder_scheduled',
    occurred_at: source.created_at,
    recorded_at: source.created_at,
    session_revision: 0,
    detail: {},
    job_id: source.id,
    subscription_id: source.subscription_id,
    attempt_number: 0,
    simulated: true,
    ...changes,
  };
}

async function insert(client: pg.PoolClient, table: Table, row: Row) {
  // Table and column identifiers are test-owned constants, never request inputs.
  const columns = Object.keys(row);
  const values = Object.values(row);
  await client.query(
    `insert into app.${table}(${columns.join(',')}) values(${columns.map((_, index) => `$${index + 1}`).join(',')})`,
    values,
  );
}

async function rejectStatement(
  client: pg.PoolClient,
  action: () => Promise<unknown>,
  code: string,
) {
  await client.query('savepoint rejected_probe');
  try {
    await expect(action()).rejects.toMatchObject({ code });
  } finally {
    await client.query('rollback to savepoint rejected_probe');
    await client.query('release savepoint rejected_probe');
  }
}

describe('reminder schema PostgreSQL integrity and privilege boundaries', () => {
  let mayaId = '';
  let arunId = '';
  let mayaSession: SessionRecord;
  let otherMayaSession: SessionRecord;
  let arunSession: SessionRecord;
  let mayaDevice: ReturnType<typeof subscription>;
  let secondMayaDevice: ReturnType<typeof subscription>;
  let arunDevice: ReturnType<typeof subscription>;
  let mayaJob: ReturnType<typeof job>;
  let arunJob: ReturnType<typeof job>;
  let mayaEvent: ReturnType<typeof event>;
  let arunEvent: ReturnType<typeof event>;
  let adminPool: pg.Pool | undefined;
  let previousClock: string | undefined;
  let clockInstalled = false;
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

  async function transaction<T>(
    operation: (client: pg.PoolClient) => Promise<T>,
    options: { persistFixture?: boolean; ownerRoleProbe?: boolean } = {},
  ): Promise<T> {
    if (!adminPool) throw new Error('Guarded schema fixture runtime has not been initialized.');
    const client = await adminPool.connect();
    try {
      await client.query('begin');
      if (options.ownerRoleProbe) {
        // This is the actual NOLOGIN function-owner privilege context, not a worker login.
        await client.query('set local role app_reminder_owner');
        const identity = await client.query('select current_user,session_user');
        expect(identity.rows).toEqual([
          { current_user: 'app_reminder_owner', session_user: 'postgres' },
        ]);
      }
      const result = await operation(client);
      await client.query(options.persistFixture ? 'commit' : 'rollback');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async function createSession(ownerId: string, title: string) {
    const input: JourneyDraft = {
      title,
      intention: 'Synthetic reminder schema fixture.',
      practices: [
        { id: randomUUID(), label: 'Quiet practice', order: 0, kind: 'checkbox', target: null },
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
    const created = await createJourney(ownerId, input);
    const activated = await activateJourney(ownerId, created.journey.id, {
      operationId: randomUUID(),
      baseRevision: created.journey.revision,
      payload: { fingerprint: created.fingerprint },
    });
    return activated.sessions[0];
  }

  beforeAll(async () => {
    // The guard must precede every connection, clock write and synthetic mutation.
    const runtime = loadGuardedIntegrationRuntime();
    adminPool = new pg.Pool({
      connectionString: runtime.adminDatabaseUrl,
      max: 2,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
    previousClock = process.env.DEMO_CLOCK_FILE;
    mkdirSync(resolve(process.cwd(), '.local'), { recursive: true, mode: 0o700 });
    writeFileSync(CLOCK_PATH, JSON.stringify({ now: AFTER_CLOSE }), { mode: 0o600 });
    clockInstalled = true;
    process.env.DEMO_CLOCK_FILE = CLOCK_PATH;
    mayaId = await createSyntheticUser(ACCOUNTS.maya);
    arunId = await createSyntheticUser(ACCOUNTS.arun);
    mayaSession = await createSession(mayaId, 'Maya schema journey');
    otherMayaSession = await createSession(mayaId, 'Other Maya schema journey');
    arunSession = await createSession(arunId, 'Arun schema journey');
    mayaDevice = subscription(mayaId);
    secondMayaDevice = subscription(mayaId);
    arunDevice = subscription(arunId);
    mayaJob = job(mayaId, mayaSession, mayaDevice.id);
    arunJob = explicitTestJob(arunId, arunSession, arunDevice.id);
    mayaEvent = event(mayaJob);
    arunEvent = event(arunJob);
    // No registration/job functions exist in migration010: direct fixture writes
    // exercise schema only and are not evidence of a functioning reminder runtime.
    await transaction(
      async (client) => {
        for (const row of [mayaDevice, secondMayaDevice, arunDevice])
          await insert(client, 'push_subscription', row);
        for (const row of [mayaJob, arunJob]) await insert(client, 'reminder_job', row);
        for (const row of [mayaEvent, arunEvent]) {
          await insert(client, 'notification_event', row);
          await insert(client, 'notification_read', {
            owner_id: row.owner_id,
            event_id: row.id,
            read_at: AFTER_CLOSE,
          });
        }
      },
      { persistFixture: true },
    );
  });

  afterAll(async () => {
    try {
      const cleanup = await Promise.allSettled([...ownedUsers.keys()].map(deleteOwnedUser));
      const failures = cleanup.filter((result) => result.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Synthetic reminder schema cleanup failed.',
        );
    } finally {
      try {
        const globalDb = globalThis as typeof globalThis & {
          sankalpaPool?: ReturnType<typeof getPool>;
        };
        const applicationPool = globalDb.sankalpaPool;
        delete globalDb.sankalpaPool;
        await Promise.all([adminPool?.end(), applicationPool?.end()]);
      } finally {
        if (clockInstalled) {
          rmSync(CLOCK_PATH, { force: true });
          if (previousClock === undefined) delete process.env.DEMO_CLOCK_FILE;
          else process.env.DEMO_CLOCK_FILE = previousClock;
        }
      }
    }
  });

  it('permits an explicit test job and event without inventing a journey or session', async () => {
    await transaction(async (client) => {
      const row = explicitTestJob(mayaId, mayaSession, mayaDevice.id);
      await insert(client, 'reminder_job', row);
      await insert(client, 'notification_event', event(row));
      const result = await client.query(
        'select journey_id,session_id,schedule_version_id,reminder_revision from app.reminder_job where id=$1',
        [row.id],
      );
      expect(result.rows).toEqual([
        { journey_id: null, session_id: null, schedule_version_id: null, reminder_revision: null },
      ]);
    });
  });

  it.each(['journey_id', 'session_id', 'schedule_version_id', 'reminder_revision'])(
    'requires non-test %s even when a composite foreign key would skip NULL',
    async (field) => {
      await transaction(async (client) => {
        for (const kind of ['offset', 'snooze']) {
          const row = job(mayaId, mayaSession, secondMayaDevice.id, {
            kind,
            ...(kind === 'snooze' ? { offset_minutes: null, operation_id: randomUUID() } : {}),
            [field]: null,
          });
          await rejectStatement(client, () => insert(client, 'reminder_job', row), '23514');
        }
      });
    },
  );

  it.each(['journey_id', 'session_id', 'schedule_version_id', 'reminder_revision'])(
    'rejects a test job carrying %s',
    async (field) => {
      await transaction(async (client) => {
        const value = field === 'reminder_revision' ? 0 : randomUUID();
        await rejectStatement(
          client,
          () =>
            insert(
              client,
              'reminder_job',
              explicitTestJob(mayaId, mayaSession, mayaDevice.id, { [field]: value }),
            ),
          '23514',
        );
      });
    },
  );

  it('rejects cross-owner parents and mismatched same-owner session versions', async () => {
    await transaction(async (client) => {
      const invalid = [
        job(mayaId, arunSession, mayaDevice.id),
        job(mayaId, mayaSession, arunDevice.id),
        job(mayaId, mayaSession, secondMayaDevice.id, {
          schedule_version_id: otherMayaSession.scheduleVersionId,
        }),
      ];
      for (const row of invalid)
        await rejectStatement(client, () => insert(client, 'reminder_job', row), '23503');
    });
  });

  it.each([
    { name: 'offset without offset', patch: { offset_minutes: null } },
    { name: 'offset with request ID', patch: { operation_id: randomUUID() } },
    { name: 'snooze without request ID', patch: { kind: 'snooze', offset_minutes: null } },
    { name: 'snooze carrying an offset', patch: { kind: 'snooze', operation_id: randomUUID() } },
    { name: 'positive offset', patch: { offset_minutes: 1 } },
    { name: 'offset before supported horizon', patch: { offset_minutes: -1441 } },
    { name: 'negative preference revision', patch: { reminder_revision: -1 } },
    { name: 'invalid subscription generation', patch: { subscription_generation: 0 } },
    { name: 'fourth attempt', patch: { attempts: 4 } },
    { name: 'negative attempts', patch: { attempts: -1 } },
    {
      name: 'unbounded provider message',
      patch: { safe_reason: 'Synthetic raw provider response must not enter safe_reason' },
    },
  ])('rejects $name', async ({ patch }) => {
    await transaction(async (client) => {
      await rejectStatement(
        client,
        () => insert(client, 'reminder_job', job(mayaId, mayaSession, secondMayaDevice.id, patch)),
        '23514',
      );
    });
  });

  it.each([
    {
      name: 'expiry at intended time',
      patch: (time: number) => ({ expires_at: new Date(time).toISOString() }),
    },
    {
      name: 'expiry beyond five minutes',
      patch: (time: number) => ({ expires_at: new Date(time + 300_001).toISOString() }),
    },
    {
      name: 'retry before intended time',
      patch: (time: number) => ({ next_attempt_at: new Date(time - 1).toISOString() }),
    },
  ])('rejects $name', async ({ patch }) => {
    await transaction(async (client) => {
      await rejectStatement(
        client,
        () =>
          insert(
            client,
            'reminder_job',
            job(mayaId, mayaSession, secondMayaDevice.id, patch(Date.parse(mayaSession.opensAt))),
          ),
        '23514',
      );
    });
  });

  it.each([
    { name: 'lease without token or deadline', patch: { state: 'leased' } },
    { name: 'token without deadline', patch: { lease_token: randomUUID() } },
    { name: 'deadline without token', patch: { lease_until: AFTER_CLOSE } },
    {
      name: 'dispatch without attempt',
      patch: {
        state: 'dispatching',
        lease_token: randomUUID(),
        lease_until: AFTER_CLOSE,
        dispatch_started_at: CREATED_AT,
      },
    },
    {
      name: 'dispatch without start',
      patch: {
        state: 'dispatching',
        attempts: 1,
        lease_token: randomUUID(),
        lease_until: AFTER_CLOSE,
      },
    },
    {
      name: 'acceptance without attempt',
      patch: { state: 'accepted', dispatch_started_at: CREATED_AT },
    },
    { name: 'acceptance without dispatch start', patch: { state: 'accepted', attempts: 1 } },
  ])('rejects $name', async ({ patch }) => {
    await transaction(async (client) => {
      await rejectStatement(
        client,
        () => insert(client, 'reminder_job', job(mayaId, mayaSession, secondMayaDevice.id, patch)),
        '23514',
      );
    });
  });

  it('deduplicates offset work while allowing a separately versioned subscription generation', async () => {
    await transaction(async (client) => {
      await rejectStatement(
        client,
        () => insert(client, 'reminder_job', { ...mayaJob, id: randomUUID() }),
        '23505',
      );
      await client.query('update app.push_subscription set generation=2 where id=$1', [
        mayaDevice.id,
      ]);
      const replacement = { ...mayaJob, id: randomUUID(), subscription_generation: 2 };
      await insert(client, 'reminder_job', replacement);
      const result = await client.query(
        'select subscription_generation from app.reminder_job where id=any($1::uuid[]) order by subscription_generation',
        [[mayaJob.id, replacement.id]],
      );
      expect(result.rows).toEqual([{ subscription_generation: 1 }, { subscription_generation: 2 }]);
    });
  });

  it('deduplicates snooze/test request identity per device without blocking a second device', async () => {
    await transaction(async (client) => {
      const operationId = randomUUID();
      const snooze = job(mayaId, mayaSession, mayaDevice.id, {
        kind: 'snooze',
        offset_minutes: null,
        operation_id: operationId,
      });
      await insert(client, 'reminder_job', snooze);
      await rejectStatement(
        client,
        () => insert(client, 'reminder_job', { ...snooze, id: randomUUID() }),
        '23505',
      );
      await rejectStatement(
        client,
        () =>
          insert(
            client,
            'reminder_job',
            explicitTestJob(mayaId, mayaSession, mayaDevice.id, { operation_id: operationId }),
          ),
        '23505',
      );
      await insert(client, 'reminder_job', {
        ...snooze,
        id: randomUUID(),
        subscription_id: secondMayaDevice.id,
      });
    });
  });

  it('allows only one active owner binding for an endpoint and retains the revoked binding', async () => {
    await transaction(async (client) => {
      const replacement = subscription(arunId, {
        endpoint: mayaDevice.endpoint,
        endpoint_hash: mayaDevice.endpoint_hash,
      });
      await rejectStatement(
        client,
        () => insert(client, 'push_subscription', replacement),
        '23505',
      );
      await client.query(
        'update app.push_subscription set revoked_at=$2,updated_at=$2 where id=$1',
        [mayaDevice.id, AFTER_CLOSE],
      );
      await insert(client, 'push_subscription', replacement);
      const result = await client.query(
        'select owner_id,revoked_at is null as active from app.push_subscription where endpoint_hash=$1 order by active',
        [mayaDevice.endpoint_hash],
      );
      expect(result.rows).toEqual([
        { owner_id: mayaId, active: false },
        { owner_id: arunId, active: true },
      ]);
    });
  });

  it.each([
    { name: 'zero subscription generation', patch: { generation: 0 } },
    { name: 'updated before creation', patch: { updated_at: '2026-09-04T23:59:59Z' } },
    { name: 'revoked before creation', patch: { revoked_at: '2026-09-04T23:59:59Z' } },
  ])('rejects $name', async ({ patch }) => {
    await transaction(async (client) => {
      await rejectStatement(
        client,
        () => insert(client, 'push_subscription', subscription(mayaId, patch)),
        '23514',
      );
    });
  });

  it('rejects event context belonging to a different same-owner device or session', async () => {
    await transaction(async (client) => {
      const wrongContexts = [
        { subscription_id: secondMayaDevice.id },
        {
          journey_id: otherMayaSession.journeyId,
          session_id: otherMayaSession.id,
          schedule_version_id: otherMayaSession.scheduleVersionId,
        },
        { journey_id: null },
        { session_id: null },
        { schedule_version_id: null },
        { journey_id: null, session_id: null, schedule_version_id: null },
        { owner_id: arunId },
      ];
      for (const patch of wrongContexts)
        await rejectStatement(
          client,
          () => insert(client, 'notification_event', event(mayaJob, patch)),
          '23514',
        );
    });
  });

  it('rejects manufactured session context on a test-job event', async () => {
    await transaction(async (client) => {
      await rejectStatement(
        client,
        () =>
          insert(
            client,
            'notification_event',
            event(arunJob, {
              journey_id: arunSession.journeyId,
              session_id: arunSession.id,
              schedule_version_id: arunSession.scheduleVersionId,
            }),
          ),
        '23514',
      );
    });
  });

  it('rejects an event recorded before it occurred while allowing the exact boundary', async () => {
    await transaction(async (client) => {
      const occurredAt = mayaSession.opensAt;
      const row = event(mayaJob, {
        kind: 'reminder_canceled',
        occurred_at: occurredAt,
        recorded_at: new Date(new Date(occurredAt).getTime() - 1).toISOString(),
      });
      await rejectStatement(client, () => insert(client, 'notification_event', row), '23514');
      await insert(client, 'notification_event', { ...row, recorded_at: occurredAt });
      const saved = await client.query(
        'select recorded_at=occurred_at as exact_boundary from app.notification_event where id=$1',
        [row.id],
      );
      expect(saved.rows).toEqual([{ exact_boundary: true }]);
    });
  });

  it.each(['service_accepted', 'dispatch_failed', 'dispatch_uncertain'])(
    'allows one terminal outcome for an attempt first recorded as %s',
    async (kind) => {
      await transaction(async (client) => {
        await insert(
          client,
          'notification_event',
          event(mayaJob, { kind: 'dispatch_started', attempt_number: 1 }),
        );
        await insert(client, 'notification_event', event(mayaJob, { kind, attempt_number: 1 }));
        for (const other of ['service_accepted', 'dispatch_failed', 'dispatch_uncertain']) {
          await rejectStatement(
            client,
            () =>
              insert(
                client,
                'notification_event',
                event(mayaJob, { kind: other, attempt_number: 1 }),
              ),
            '23505',
          );
        }
        await insert(
          client,
          'notification_event',
          event(mayaJob, { kind: 'dispatch_started', attempt_number: 2 }),
        );
        await insert(
          client,
          'notification_event',
          event(mayaJob, { kind: 'dispatch_uncertain', attempt_number: 2 }),
        );
      });
    },
  );

  it.each(['dispatch_started', 'service_accepted', 'dispatch_failed', 'dispatch_uncertain'])(
    'rejects attempt zero for %s',
    async (kind) => {
      await transaction(async (client) => {
        await rejectStatement(
          client,
          () => insert(client, 'notification_event', event(mayaJob, { kind, attempt_number: 0 })),
          '23514',
        );
      });
    },
  );

  it('preserves one closure identity and rejects worker metadata attached to a closure', async () => {
    await transaction(async (client) => {
      const closure = event(mayaJob, {
        kind: 'session_closed',
        job_id: null,
        subscription_id: null,
        attempt_number: null,
        simulated: null,
        occurred_at: mayaSession.closesAt,
        recorded_at: AFTER_CLOSE,
        detail: { status: 'missed' },
      });
      for (const patch of [{ attempt_number: 1 }, { simulated: false }]) {
        await rejectStatement(
          client,
          () => insert(client, 'notification_event', { ...closure, ...patch }),
          '23514',
        );
      }
      await insert(client, 'notification_event', closure);
      await rejectStatement(
        client,
        () => insert(client, 'notification_event', { ...closure, id: randomUUID() }),
        '23505',
      );
    });
  });

  it('deduplicates read receipts and rejects another owner for the same event', async () => {
    await transaction(async (client) => {
      const unread = event(mayaJob, { kind: 'reminder_canceled' });
      await insert(client, 'notification_event', unread);
      await rejectStatement(
        client,
        () =>
          insert(client, 'notification_read', {
            owner_id: arunId,
            event_id: unread.id,
            read_at: AFTER_CLOSE,
          }),
        '23503',
      );
      await insert(client, 'notification_read', {
        owner_id: mayaId,
        event_id: unread.id,
        read_at: AFTER_CLOSE,
      });
      await rejectStatement(
        client,
        () =>
          insert(client, 'notification_read', {
            owner_id: mayaId,
            event_id: unread.id,
            read_at: AFTER_CLOSE,
          }),
        '23505',
      );
    });
  });

  it('enforces app_api ownership on devices, jobs, events and read receipts with positive own-record controls', async () => {
    await withUser(arunId, async (client) => {
      const pairs = [
        { table: 'push_subscription', key: 'id', hidden: mayaDevice.id, own: arunDevice.id },
        { table: 'reminder_job', key: 'id', hidden: mayaJob.id, own: arunJob.id },
        { table: 'notification_event', key: 'id', hidden: mayaEvent.id, own: arunEvent.id },
        { table: 'notification_read', key: 'event_id', hidden: mayaEvent.id, own: arunEvent.id },
      ];
      for (const pair of pairs) {
        const hidden = await client.query(
          `select ${pair.key} from app.${pair.table} where ${pair.key}=$1`,
          [pair.hidden],
        );
        expect(hidden.rows).toEqual([]);
        const own = await client.query(
          `select ${pair.key} from app.${pair.table} where ${pair.key}=$1`,
          [pair.own],
        );
        expect(own.rows).toEqual([{ [pair.key]: pair.own }]);
      }
    });
  });

  it.each(['endpoint', 'endpoint_hash', 'p256dh', 'auth_key', '*'])(
    'denies app_api sensitive subscription projection %s even for its owner',
    async (column) => {
      await expect(
        withUser(mayaId, (client) =>
          client.query(`select ${column} from app.push_subscription where id=$1`, [mayaDevice.id]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );

  it.each([
    'service_accepted',
    'dispatch_started',
    'dispatch_failed',
    'dispatch_uncertain',
    'notification_opened',
    'reminder_scheduled',
  ])('prevents app_api from forging %s on an otherwise valid owned job', async (kind) => {
    await expect(
      withUser(mayaId, (client) =>
        insert(client, 'notification_event', event(mayaJob, { kind, attempt_number: 1 })),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('preserves app_api insertion of ordinary closure history', async () => {
    await withUser(mayaId, async (client) => {
      const closure = event(mayaJob, {
        kind: 'session_closed',
        job_id: null,
        subscription_id: null,
        attempt_number: null,
        simulated: null,
        occurred_at: mayaSession.closesAt,
        recorded_at: AFTER_CLOSE,
        detail: { status: 'missed' },
      });
      // A savepoint rolls back the positive probe so the shared fixture remains unchanged.
      await client.query('savepoint history_probe');
      await insert(client, 'notification_event', closure);
      const own = await client.query('select kind from app.notification_event where id=$1', [
        closure.id,
      ]);
      expect(own.rows).toEqual([{ kind: 'session_closed' }]);
      await client.query('rollback to savepoint history_probe');
    });
  });

  it('denies app_api direct job/subscription/heartbeat writes and read-receipt forgery', async () => {
    await withUser(mayaId, async (client) => {
      for (const action of [
        () => insert(client, 'push_subscription', subscription(mayaId)),
        () => insert(client, 'reminder_job', explicitTestJob(mayaId, mayaSession, mayaDevice.id)),
        () =>
          client.query("update app.reminder_job set state='canceled' where id=$1", [mayaJob.id]),
        () => client.query('delete from app.reminder_job where id=$1', [mayaJob.id]),
        () => insert(client, 'worker_heartbeat', { singleton: true, observed_at: AFTER_CLOSE }),
        () =>
          insert(client, 'notification_read', {
            owner_id: mayaId,
            event_id: mayaEvent.id,
            read_at: AFTER_CLOSE,
          }),
      ])
        await rejectStatement(client, action, '42501');
    });
  });

  it('keeps the runtime/owner roles restricted and denies runtime membership in the owner role', async () => {
    await withUser(mayaId, async (client) => {
      const roles =
        await client.query(`select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls
        from pg_roles where rolname in ('app_worker','app_reminder_owner') order by rolname`);
      expect(roles.rows).toEqual([
        {
          rolname: 'app_reminder_owner',
          rolcanlogin: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
        },
        {
          rolname: 'app_worker',
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
        },
      ]);
      const members = await client.query(
        "select rolname from pg_roles where rolname in ('app_api','app_worker','anon','authenticated','service_role','authenticator') and pg_has_role(oid,'app_reminder_owner'::regrole,'MEMBER')",
      );
      expect(members.rows).toEqual([]);
      const inherited = await client.query(
        "select member from pg_auth_members where member in ('app_worker'::regrole,'app_reminder_owner'::regrole)",
      );
      expect(inherited.rows).toEqual([]);
      const owned =
        await client.query(`select c.relname from pg_class c where c.relnamespace='app'::regnamespace and c.relowner in ('app_worker'::regrole,'app_reminder_owner'::regrole)
        union all select nspname from pg_namespace where oid='app'::regnamespace and nspowner in ('app_worker'::regrole,'app_reminder_owner'::regrole)`);
      expect(owned.rows).toEqual([]);
      const rls = await client.query(
        "select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='app'::regnamespace and relname=any($1::text[]) order by relname",
        [
          [
            'push_subscription',
            'reminder_job',
            'notification_event',
            'notification_read',
            'worker_heartbeat',
          ],
        ],
      );
      expect(rls.rows).toHaveLength(5);
      expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    });
    await expect(
      withUser(mayaId, (client) => client.query('set local role app_reminder_owner')),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('proves via catalog privileges that app_worker has no direct table or column access', async () => {
    // No SET ROLE app_worker or invented worker credential: this is a catalog probe.
    // A real worker-login/function gate remains separate and NOT RUN at migration010.
    const result = await withUser(mayaId, (client) =>
      client.query<{ table_name: string; table_access: boolean; column_access: boolean }>(`
      select c.relname as table_name,
        has_table_privilege('app_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as table_access,
        has_any_column_privilege('app_worker',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') as column_access
      from pg_class c where c.relnamespace='app'::regnamespace and c.relkind in ('r','p') order by c.relname`),
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'reflection',
        'reflection_mood',
        'push_subscription',
        'reminder_job',
        'notification_event',
        'notification_read',
        'worker_heartbeat',
      ]),
    );
    expect(result.rows.filter((row) => row.table_access || row.column_access)).toEqual([]);
  });

  it('allows the NOLOGIN owner to lock canonical rows but rejects even same-value canonical updates', async () => {
    await transaction(
      async (client) => {
        const journey = await client.query('select id from app.journey where id=$1 for update', [
          mayaSession.journeyId,
        ]);
        const session = await client.query('select id from app.session where id=$1 for update', [
          mayaSession.id,
        ]);
        expect(journey.rows).toEqual([{ id: mayaSession.journeyId }]);
        expect(session.rows).toEqual([{ id: mayaSession.id }]);
        await rejectStatement(
          client,
          () => client.query('update app.journey set id=id where id=$1', [mayaSession.journeyId]),
          '42501',
        );
        await rejectStatement(
          client,
          () => client.query('update app.session set id=id where id=$1', [mayaSession.id]),
          '42501',
        );
        await rejectStatement(
          client,
          () =>
            client.query('update app.session set confirmed=false where id=$1', [mayaSession.id]),
          '42501',
        );
        await rejectStatement(
          client,
          () =>
            client.query('select text from app.reflection where session_id=$1', [mayaSession.id]),
          '42501',
        );
        await rejectStatement(
          client,
          () =>
            client.query('select label from app.reflection_mood where session_id=$1', [
              mayaSession.id,
            ]),
          '42501',
        );
      },
      { ownerRoleProbe: true },
    );
  });

  it('keeps event and read records append-only for the NOLOGIN owner', async () => {
    await transaction(
      async (client) => {
        const added = event(mayaJob, { kind: 'reminder_canceled' });
        await insert(client, 'notification_event', added);
        await insert(client, 'notification_read', {
          owner_id: mayaId,
          event_id: added.id,
          read_at: AFTER_CLOSE,
        });
        for (const action of [
          () =>
            client.query("update app.notification_event set detail='{}'::jsonb where id=$1", [
              added.id,
            ]),
          () => client.query('delete from app.notification_event where id=$1', [added.id]),
          () =>
            client.query('update app.notification_read set read_at=read_at where event_id=$1', [
              added.id,
            ]),
          () => client.query('delete from app.notification_read where event_id=$1', [added.id]),
        ])
          await rejectStatement(client, action, '42501');
        const result = await client.query(
          'select event_id from app.notification_read where event_id=$1',
          [added.id],
        );
        expect(result.rows).toEqual([{ event_id: added.id }]);
      },
      { ownerRoleProbe: true },
    );
  });
});
