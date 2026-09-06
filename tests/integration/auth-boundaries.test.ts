import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JourneyDraft } from '../../src/domain/contracts';
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

const MAYA_EMAIL = 'integration-maya-boundaries@example.test';
const ARUN_EMAIL = 'integration-arun-boundaries@example.test';
const DELETE_CASCADE_EMAIL = 'integration-delete-cascade@example.test';
const MAYA_MARKER = buildSyntheticMarker('auth-boundaries', 'maya');
const ARUN_MARKER = buildSyntheticMarker('auth-boundaries', 'arun');
const DELETE_CASCADE_MARKER = buildSyntheticMarker('auth-boundaries', 'delete-cascade');
const CLOCK_PATH = resolve(process.cwd(), '.local/integration-boundaries-clock.json');
const NOW = '2026-09-05T06:15:00+05:30';
const PRACTICE_ID = 'b1000000-0000-4000-8000-000000000001';

let mayaId = '';
let arunId = '';
let journeyId = '';
let sessionId = '';
let scheduleVersionId = '';
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

async function forceCleanupSyntheticUser(id: string, email: string, marker: SyntheticMarker) {
  if (!ownedUserIds.has(id)) throw new Error('Refusing to force-delete an unowned user ID.');
  const admin = new pg.Client({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    const identity = await admin.query<{
      email: string;
      app_metadata: Record<string, unknown>;
    }>('select email, raw_app_meta_data as app_metadata from auth.users where id=$1', [id]);
    if (identity.rowCount === 0) {
      ownedUserIds.delete(id);
      return;
    }
    if (!isExpectedSyntheticUser(identity.rows[0]!, email, marker))
      throw new Error('Refusing force cleanup without the exact synthetic marker.');
    await admin.query('begin');
    await admin.query('delete from app.session_practice where owner_id=$1', [id]);
    await admin.query('delete from auth.users where id=$1', [id]);
    await admin.query('commit');
    ownedUserIds.delete(id);
  } catch (error) {
    await admin.query('rollback');
    throw error;
  } finally {
    await admin.end();
  }
}

async function closeApplicationPool() {
  const globalDb = globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> };
  if (globalDb.sankalpaPool) {
    const pool = globalDb.sankalpaPool;
    delete globalDb.sankalpaPool;
    await pool.end();
  }
}

function draft(): JourneyDraft {
  return {
    title: 'Boundary fixture',
    intention: 'Synthetic isolation evidence.',
    practices: [
      { id: PRACTICE_ID, label: 'Boundary practice', order: 0, kind: 'checkbox', target: null },
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

beforeAll(async () => {
  loadIntegrationEnvironment();
  mayaId = await createSyntheticUser(MAYA_EMAIL, MAYA_MARKER);
  arunId = await createSyntheticUser(ARUN_EMAIL, ARUN_MARKER);
  const created = await createJourney(mayaId, draft());
  const activated = await activateJourney(mayaId, created.journey.id, {
    operationId: randomUUID(),
    baseRevision: 0,
    payload: { fingerprint: created.fingerprint },
  });
  journeyId = activated.journey.id;
  sessionId = activated.sessions[0]!.id;
  scheduleVersionId = activated.sessions[0]!.scheduleVersionId;
});

afterAll(async () => {
  if (mayaId && ownedUserIds.has(mayaId))
    await deleteOwnedSyntheticUser(mayaId, MAYA_EMAIL, MAYA_MARKER);
  if (arunId && ownedUserIds.has(arunId))
    await deleteOwnedSyntheticUser(arunId, ARUN_EMAIL, ARUN_MARKER);
  await closeApplicationPool();
  rmSync(CLOCK_PATH, { force: true });
  delete process.env.DEMO_CLOCK_FILE;
});

describe('authenticated ownership boundaries', () => {
  it('hides another owner journey and rejects mutations without leaking its current state', async () => {
    await expect(getJourneyView(arunId, journeyId)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    } satisfies Partial<AppError>);
    await expect(
      savePractices(arunId, sessionId, {
        operationId: randomUUID(),
        baseRevision: 0,
        payload: { values: { [PRACTICE_ID]: true } },
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' } satisfies Partial<AppError>);
    await expect(
      confirmSession(arunId, sessionId, {
        operationId: randomUUID(),
        baseRevision: 0,
        payload: { performedAt: '2026-09-05T06:10:00+05:30' },
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' } satisfies Partial<AppError>);

    const visible = await withUser(arunId, (client) =>
      client.query('select id from app.journey where id=$1', [journeyId]),
    );
    expect(visible.rowCount).toBe(0);
  });

  it('rejects a forged owner tuple through the composite journey parent key', async () => {
    await expect(
      withUser(arunId, (client) =>
        client.query(
          'insert into app.schedule_version(id,journey_id,owner_id,definition,created_at,version,effective_practice_date) values($1,$2,$3,$4,$5,2,$6)',
          [
            randomUUID(),
            journeyId,
            arunId,
            JSON.stringify(draft()),
            NOW,
            draft().schedule.startDate,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('clears the transaction-local owner claim before returning a pooled connection', async () => {
    const inside = await withUser(mayaId, async (client) => {
      const result = await client.query(
        "select pg_backend_pid() as pid, current_setting('request.jwt.claim.sub', true) as subject",
      );
      return result.rows[0] as { pid: number; subject: string };
    });
    expect(inside.subject).toBe(mayaId);

    const client = await getPool().connect();
    try {
      const result = await client.query(
        "select pg_backend_pid() as pid, current_setting('request.jwt.claim.sub', true) as subject",
      );
      expect(result.rows[0]?.pid).toBe(inside.pid);
      expect([null, '']).toContain(result.rows[0]?.subject);
    } finally {
      client.release();
    }
  });

  it('holds the shared account lock against the privacy operation exclusive lock', async () => {
    const admin = new pg.Client({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL });
    await admin.connect();
    let releaseShared!: () => void;
    let markShared!: () => void;
    const release = new Promise<void>((resolveRelease) => {
      releaseShared = resolveRelease;
    });
    const shared = new Promise<void>((resolveShared) => {
      markShared = resolveShared;
    });
    const request = withUser(mayaId, async () => {
      markShared();
      await release;
    });

    try {
      await shared;
      await admin.query('begin');
      await admin.query("set local lock_timeout='200ms'");
      await expect(
        admin.query('select pg_advisory_xact_lock(hashtextextended($1, 2))', [mayaId]),
      ).rejects.toMatchObject({ code: '55P03' });
      await admin.query('rollback');
      releaseShared();
      await request;

      await admin.query('begin');
      await expect(
        admin.query('select pg_advisory_xact_lock(hashtextextended($1, 2))', [mayaId]),
      ).resolves.toBeDefined();
      await admin.query('rollback');
    } finally {
      releaseShared();
      await request;
      await admin.query('rollback').catch(() => undefined);
      await admin.end();
    }
  });
});

describe('database role and integrity hardening', () => {
  it('keeps app_api restricted, membership-free and separate from application ownership', async () => {
    const admin = new pg.Client({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL });
    await admin.connect();
    try {
      const role = await admin.query(
        `select rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls,
          exists(select from pg_auth_members where member=r.oid) as memberships,
          exists(select from pg_class where relnamespace='app'::regnamespace and relowner=r.oid) as owns_relations,
          exists(select from pg_namespace where oid='app'::regnamespace and nspowner=r.oid) as owns_schema
        from pg_roles r where rolname='app_api'`,
      );
      expect(role.rows).toEqual([
        {
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
          memberships: false,
          owns_relations: false,
          owns_schema: false,
        },
      ]);
    } finally {
      await admin.end();
    }
  });

  it('grants only the intended mutable-table operations', async () => {
    const admin = new pg.Client({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL });
    await admin.connect();
    try {
      const privileges = await admin.query(
        `select
          has_table_privilege('app_api','app.journey','UPDATE') as journey_table_update,
          has_column_privilege('app_api','app.journey','title','UPDATE') as journey_title_update,
          has_column_privilege('app_api','app.journey','owner_id','UPDATE') as journey_owner_update,
          has_table_privilege('app_api','app.journey','DELETE') as journey_delete,
          has_table_privilege('app_api','app.session','UPDATE') as session_table_update,
          has_column_privilege('app_api','app.session','confirmed','UPDATE') as session_confirmed_update,
          has_column_privilege('app_api','app.session','owner_id','UPDATE') as session_owner_update,
          has_table_privilege('app_api','app.session','DELETE') as session_delete,
          has_table_privilege('app_api','app.session_practice','UPDATE') as value_table_update,
          has_column_privilege('app_api','app.session_practice','checkbox_value','UPDATE') as checkbox_update,
          has_column_privilege('app_api','app.session_practice','kind','UPDATE') as value_kind_update,
          has_table_privilege('app_api','app.practice_version','UPDATE') as practice_update,
          has_table_privilege('app_api','app.schedule_version','DELETE') as version_delete,
          has_table_privilege('app_api','app.amendment','UPDATE') as amendment_update,
          has_table_privilege('app_api','app.amendment','DELETE') as amendment_delete,
          has_table_privilege('app_api','app.operation_receipt','UPDATE') as receipt_update,
          has_table_privilege('app_api','app.operation_receipt','DELETE') as receipt_delete`,
      );
      expect(privileges.rows[0]).toEqual({
        journey_table_update: false,
        journey_title_update: true,
        journey_owner_update: false,
        journey_delete: true,
        session_table_update: false,
        session_confirmed_update: true,
        session_owner_update: false,
        session_delete: false,
        value_table_update: false,
        checkbox_update: true,
        value_kind_update: false,
        practice_update: false,
        version_delete: false,
        amendment_update: false,
        amendment_delete: false,
        receipt_update: false,
        receipt_delete: false,
      });
    } finally {
      await admin.end();
    }
  });

  it('rejects a session value kind that disagrees with its practice version', async () => {
    const admin = new pg.Client({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query('begin');
      await expect(
        admin.query(
          `update app.session_practice set kind='minutes', checkbox_value=null, numeric_value=1
           where session_id=$1 and practice_id=$2 and schedule_version_id=$3`,
          [sessionId, PRACTICE_ID, scheduleVersionId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await admin.query('rollback');
    } finally {
      await admin.query('rollback').catch(() => undefined);
      await admin.end();
    }
  });

  it('lets Auth delete an account with an activated journey through the complete cascade', async () => {
    const deleteUserId = await createSyntheticUser(DELETE_CASCADE_EMAIL, DELETE_CASCADE_MARKER);
    let deleted = false;
    try {
      const created = await createJourney(deleteUserId, draft());
      await activateJourney(deleteUserId, created.journey.id, {
        operationId: randomUUID(),
        baseRevision: 0,
        payload: { fingerprint: created.fingerprint },
      });

      const result = await authAdmin().auth.admin.deleteUser(deleteUserId);
      if (result.error) throw result.error;
      deleted = true;
      ownedUserIds.delete(deleteUserId);

      const admin = new pg.Client({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL });
      await admin.connect();
      try {
        const remaining = await admin.query(
          `select
            (select count(*)::int from auth.users where id=$1) as auth_users,
            (select count(*)::int from app.profile where owner_id=$1) as profiles,
            (select count(*)::int from app.journey where owner_id=$1) as journeys`,
          [deleteUserId],
        );
        expect(remaining.rows[0]).toEqual({ auth_users: 0, profiles: 0, journeys: 0 });
      } finally {
        await admin.end();
      }
    } finally {
      if (!deleted)
        await forceCleanupSyntheticUser(deleteUserId, DELETE_CASCADE_EMAIL, DELETE_CASCADE_MARKER);
    }
  });

  it('fails closed when DATABASE_URL points at the administrative role', async () => {
    const applicationUrl = process.env.DATABASE_URL!;
    await closeApplicationPool();
    process.env.DATABASE_URL = process.env.LOCAL_ADMIN_DATABASE_URL;
    try {
      await expect(withUser(mayaId, async () => undefined)).rejects.toThrow(
        'Application database role is not restricted.',
      );
    } finally {
      await closeApplicationPool();
      process.env.DATABASE_URL = applicationUrl;
    }
  });
});
