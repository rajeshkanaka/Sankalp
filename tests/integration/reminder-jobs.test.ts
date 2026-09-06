import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JourneyDraft, ReminderPreferences } from '../../src/domain/contracts';
import { getPool, withUser } from '../../src/server/db/client';
import { createJourney, activateJourney } from '../../src/server/journeys/service';
import {
  getReminderPreferences,
  updateReminderPreferences,
} from '../../src/server/reminders/preferences';
import { refreshReminderJobs } from '../../src/server/reminders/jobs';
import { quietHoursContain } from '../../src/domain/reminders';
import {
  getSessionHistory,
  savePractices,
  confirmSession,
} from '../../src/server/sessions/service';
import {
  loadGuardedIntegrationRuntime,
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  SYNTHETIC_MARKER_KEY,
} from './local-test-runtime';

const NOW = '2026-09-05T00:00:00Z';
const DUE = '2026-09-05T00:30:00Z';
const CLOCK = resolve('.local/integration-reminder-jobs-clock.json');
const ON: ReminderPreferences = { enabled: true, offsets: [0], quietHours: null, detailed: false };
const OFF: ReminderPreferences = { ...ON, enabled: false, offsets: [] };

describe('durable reminder lifecycle on actual restricted PostgreSQL logins', () => {
  let admin: pg.Pool;
  let worker: pg.Pool;
  let owner = '';
  let other = '';
  let previousClock: string | undefined;
  let previousMode: string | undefined;
  const accounts = new Map<
    string,
    { email: string; marker: ReturnType<typeof buildSyntheticMarker> }
  >();
  const auth = () =>
    createClient(process.env.SUPABASE_URL!, process.env.LOCAL_SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  function setClock(now: string) {
    writeFileSync(CLOCK, JSON.stringify({ now }), { mode: 0o600 });
  }
  async function user(label: string) {
    const email = `integration-reminder-jobs-${label}-${randomUUID().slice(0, 8)}@example.test`;
    const marker = buildSyntheticMarker('activation', `reminder-jobs-${label}`);
    const result = await auth().auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { [SYNTHETIC_MARKER_KEY]: marker },
    });
    if (
      result.error ||
      !result.data.user ||
      !isExpectedSyntheticUser(result.data.user, email, marker)
    )
      throw new Error('Synthetic reminder user creation failed.');
    accounts.set(result.data.user.id, { email, marker });
    return result.data.user.id;
  }
  beforeAll(async () => {
    const runtime = loadGuardedIntegrationRuntime();
    const workerUrl = new URL(process.env.WORKER_DATABASE_URL ?? '');
    if (
      workerUrl.username !== 'app_worker' ||
      !['localhost', '127.0.0.1'].includes(workerUrl.hostname) ||
      Number(workerUrl.port) !== runtime.dbPort ||
      workerUrl.pathname !== '/postgres' ||
      workerUrl.search ||
      workerUrl.hash
    )
      throw new Error('Invalid isolated worker database target.');
    admin = new pg.Pool({ connectionString: runtime.adminDatabaseUrl, max: 2 });
    worker = new pg.Pool({ connectionString: workerUrl.href, max: 4 });
    const role = await worker.query('select current_user,session_user');
    expect(role.rows[0]).toEqual({ current_user: 'app_worker', session_user: 'app_worker' });
    previousClock = process.env.DEMO_CLOCK_FILE;
    previousMode = process.env.PUSH_TRANSPORT;
    mkdirSync(resolve('.local'), { recursive: true });
    setClock(NOW);
    process.env.DEMO_CLOCK_FILE = CLOCK;
    process.env.PUSH_TRANSPORT = 'simulated';
    owner = await user('maya');
    other = await user('arun');
    await withUser(owner, async () => {});
    await withUser(other, async () => {});
  });
  afterAll(async () => {
    try {
      for (const [id, expected] of accounts) {
        const current = await auth().auth.admin.getUserById(id);
        if (
          current.error ||
          !isExpectedSyntheticUser(current.data.user, expected.email, expected.marker)
        )
          throw new Error('Refusing to remove unowned reminder fixture.');
        const deleted = await auth().auth.admin.deleteUser(id);
        if (deleted.error) throw new Error('Synthetic reminder cleanup failed.');
      }
    } finally {
      await Promise.allSettled([admin?.end(), worker?.end()]);
      const globalDb = globalThis as typeof globalThis & {
        sankalpaPool?: ReturnType<typeof getPool>;
      };
      if (globalDb.sankalpaPool) {
        const pool = globalDb.sankalpaPool;
        delete globalDb.sankalpaPool;
        await pool.end();
      }
      if (previousClock === undefined) delete process.env.DEMO_CLOCK_FILE;
      else process.env.DEMO_CLOCK_FILE = previousClock;
      if (previousMode === undefined) delete process.env.PUSH_TRANSPORT;
      else process.env.PUSH_TRANSPORT = previousMode;
      rmSync(CLOCK, { force: true });
    }
  });
  beforeEach(async () => {
    setClock(NOW);
    // Both IDs were created and verified by this suite after the isolated-runtime guard.
    await admin.query('delete from app.journey where owner_id=any($1::uuid[])', [[owner, other]]);
    await admin.query('delete from app.push_subscription where owner_id=any($1::uuid[])', [
      [owner, other],
    ]);
  });
  async function journey() {
    const draft: JourneyDraft = {
      title: 'Synthetic quiet practice',
      intention: 'Private intention must stay out of push',
      practices: [
        { id: randomUUID(), label: 'Practice', order: 0, kind: 'checkbox', target: null },
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
      reminders: OFF,
    };
    const created = await createJourney(owner, draft);
    return activateJourney(owner, created.journey.id, {
      operationId: randomUUID(),
      baseRevision: created.journey.revision,
      payload: { fingerprint: created.fingerprint },
    });
  }
  async function subscription() {
    const id = randomUUID();
    const endpoint = `https://fcm.googleapis.com/synthetic-${id}`;
    await admin.query(
      'insert into app.push_subscription(id,owner_id,endpoint,endpoint_hash,p256dh,auth_key,device_label,created_at,updated_at,simulated) values($1,$2,$3,$4,$5,$6,$7,$8,$8,true)',
      [
        id,
        owner,
        endpoint,
        createHash('sha256').update(endpoint).digest('hex'),
        'x'.repeat(87),
        'y'.repeat(22),
        'Synthetic local device',
        NOW,
      ],
    );
    return id;
  }
  async function ready(prefs = ON) {
    const view = await journey();
    const sub = await subscription();
    await updateReminderPreferences(owner, view.journey.id, {
      operationId: randomUUID(),
      baseRevision: 0,
      payload: prefs,
    });
    return { view, sub };
  }
  async function claim(now = DUE, limit = 4) {
    return (await worker.query('select * from app.claim_reminder_jobs($1,$2,true)', [now, limit]))
      .rows as { job_id: string; lease_token: string; lease_until: Date }[];
  }
  async function prepare(lease: Awaited<ReturnType<typeof claim>>[number], now = DUE) {
    return (
      await worker.query('select app.prepare_reminder_job($1,$2,$3,true) as result', [
        lease.job_id,
        lease.lease_token,
        now,
      ])
    ).rows[0].result;
  }
  async function settle(
    job: { jobId: string; leaseToken: string; attempt: number },
    result: unknown,
    now = DUE,
  ) {
    return (
      await worker.query('select app.settle_reminder_job($1,$2,$3,$4,$5) as result', [
        job.jobId,
        job.leaseToken,
        job.attempt,
        JSON.stringify(result),
        now,
      ])
    ).rows[0].result;
  }
  it('refuses application impersonation, direct worker data access and private reflections', async () => {
    await expect(worker.query('select * from app.reflection')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(worker.query('select * from app.reminder_job')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      withUser(owner, (c) => c.query('select * from app.claim_reminder_jobs($1,1,true)', [DUE])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      worker.query('select app.refresh_reminder_jobs($1,$2,true)', [randomUUID(), DUE]),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('persists one reminder revision and only one job per identity across retries', async () => {
    const { view } = await ready();
    await withUser(owner, (c) => refreshReminderJobs(c, view.journey.id, NOW));
    const jobs = await admin.query('select * from app.reminder_job where journey_id=$1', [
      view.journey.id,
    ]);
    expect(jobs.rowCount).toBe(3);
    expect(jobs.rows.every((row) => row.state === 'pending' && row.simulated)).toBe(true);
    const current = await getReminderPreferences(owner, view.journey.id);
    expect(current.revision).toBe(1);
    expect(current.activeDeviceCount).toBe(1);
    await expect(getReminderPreferences(other, view.journey.id)).rejects.toMatchObject({
      status: 404,
    });
    const request = {
      operationId: randomUUID(),
      baseRevision: 1,
      payload: { ...ON, offsets: [-5, 0] },
    };
    const saved = await updateReminderPreferences(owner, view.journey.id, request);
    expect(saved.revision).toBe(2);
    expect(await updateReminderPreferences(owner, view.journey.id, request)).toEqual(saved);
    expect(
      (
        await admin.query(
          "select count(*)::int as n from app.reminder_job where journey_id=$1 and state='canceled'",
          [view.journey.id],
        )
      ).rows[0].n,
    ).toBe(3);
    await expect(
      updateReminderPreferences(owner, view.journey.id, { ...request, operationId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
  });
  it('claims disjoint jobs, prepares once and records exact simulated acceptance without an opened event', async () => {
    const { view } = await ready();
    const [a, b] = await Promise.all([claim(), claim()]);
    expect(a.length + b.length).toBe(1);
    const lease = [...a, ...b][0];
    const job = await prepare(lease);
    expect(job).toMatchObject({ ready: true, attempt: 1, simulated: true, journeyTitle: null });
    expect(JSON.stringify(job)).not.toContain(view.journey.intention);
    expect(await prepare(lease)).toEqual({ ready: false });
    const result = { kind: 'accepted', mode: 'simulated', httpStatus: null };
    expect(await settle(job, result)).toBe(true);
    expect(await settle(job, result)).toBe(true);
    expect(
      await settle(job, {
        kind: 'uncertain',
        reason: 'network',
        mode: 'simulated',
        httpStatus: null,
      }),
    ).toBe(false);
    const facts = await admin.query(
      'select kind,simulated from app.notification_event where job_id=$1 order by kind',
      [job.jobId],
    );
    expect(facts.rows.map((row) => row.kind)).toEqual([
      'dispatch_started',
      'reminder_scheduled',
      'service_accepted',
    ]);
    expect(facts.rows.every((row) => row.simulated)).toBe(true);
  });
  it('expires outage backlog and fences a crash lease before bounded recovery', async () => {
    await ready();
    const lease = (await claim())[0];
    const job = await prepare(lease);
    const recovery = (await claim('2026-09-05T00:31:01Z'))[0];
    expect(recovery.lease_token).not.toBe(lease.lease_token);
    expect(
      await settle(
        job,
        { kind: 'accepted', mode: 'simulated', httpStatus: null },
        '2026-09-05T00:31:01Z',
      ),
    ).toBe(false);
    const retried = await prepare(recovery, '2026-09-05T00:31:01Z');
    expect(retried.attempt).toBe(2);
    expect(
      (
        await admin.query(
          "select count(*)::int as n from app.notification_event where job_id=$1 and kind='dispatch_uncertain'",
          [job.jobId],
        )
      ).rows[0].n,
    ).toBe(1);
    const cleanup=await claim('2026-09-05T00:36:00Z');
    expect(cleanup).toHaveLength(1);
    expect(await prepare(cleanup[0],'2026-09-05T00:36:00Z')).toEqual({ready:false});
    const row = (await admin.query('select state from app.reminder_job where id=$1', [job.jobId]))
      .rows[0];
    expect(row.state).toBe('uncertain');
  });
  it('cancels a leased job when preferences are disabled before preparation', async () => {
    const { view } = await ready();
    const lease = (await claim())[0];
    setClock(DUE);
    await updateReminderPreferences(owner, view.journey.id, {
      operationId: randomUUID(),
      baseRevision: 1,
      payload: OFF,
    });
    expect(await prepare(lease)).toEqual({ ready: false });
    expect(
      (
        await admin.query(
          "select count(*)::int as n from app.notification_event where job_id=$1 and kind='dispatch_started'",
          [lease.job_id],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('suppresses quiet hours instead of shifting and skips already-past offsets', async () => {
    const { view } = await ready({
      ...ON,
      offsets: [-30, 0],
      quietHours: { start: '05:55', end: '06:05' },
    });
    const jobs = await admin.query(
      'select state,offset_minutes from app.reminder_job where journey_id=$1 order by scheduled_at',
      [view.journey.id],
    );
    expect(jobs.rowCount).toBe(5);
    expect(jobs.rows.filter((row) => row.state === 'suppressed')).toHaveLength(3);
    expect(await claim()).toHaveLength(0);
  });
  it('matches pure quiet-hour boundaries including both DST folds', async () => {
    for (const zone of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland'])
      for (const at of [
        '2026-11-01T05:29:59Z',
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
        '2026-11-01T07:00:00Z',
      ]) {
        const preferences = { ...ON, quietHours: { start: '01:30', end: '02:00' } };
        // Admin observes a private pure helper; API/worker callers cannot execute helpers directly.
        const result = await admin.query('select app.reminder_quiet($1,$2,$3) as quiet', [
          JSON.stringify(preferences),
          at,
          zone,
        ]);
        expect(result.rows[0].quiet).toBe(quietHoursContain(at, zone, preferences.quietHours));
      }
  });
  it('uses the same closure key for worker sweeping and later app reads/corrections', async () => {
    const { view } = await ready();
    const session = view.sessions[0];
    const closed = '2026-09-05T01:30:00Z';
    setClock(closed);
    const due = await worker.query('select session_id from app.due_session_closures($1,50)', [
      closed,
    ]);
    expect(due.rows).toContainEqual({ session_id: session.id });
    expect(
      (
        await worker.query('select app.record_session_closure($1,$2) as result', [
          session.id,
          closed,
        ])
      ).rows[0].result,
    ).toBe(true);
    const initial = await getSessionHistory(owner, session.id);
    expect(initial.events.filter((event) => event.kind === 'session_closed')).toHaveLength(1);
    const values = await savePractices(owner, session.id, {
      operationId: randomUUID(),
      baseRevision: 0,
      payload: { values: { [session.practices[0].id]: true } },
    });
    await confirmSession(owner, session.id, {
      operationId: randomUUID(),
      baseRevision: values.session.revision,
      payload: { performedAt: DUE },
    });
    const final = await getSessionHistory(owner, session.id);
    expect(final.events.filter((event) => event.kind === 'session_closed')).toEqual(initial.events);
    expect(
      (
        await worker.query('select app.record_session_closure($1,$2) as result', [
          session.id,
          closed,
        ])
      ).rows[0].result,
    ).toBe(false);
    await expect(
      withUser(other, (c) =>
        c.query('select app.record_session_closure($1,$2) as result', [session.id, closed]),
      ),
    ).resolves.toMatchObject({ rows: [{ result: false }] });
  });
});
