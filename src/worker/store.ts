import pg from 'pg';

import type { PushResult } from '../server/reminders/transport-contracts.js';
import type {
  PreparedReminder,
  ReminderLease,
  ReminderWorkerStore,
} from '../server/reminders/worker-contracts.js';
import { checkId, checkInstant, checkLease, checkPrepared, checkResult } from './validation.js';

export interface WorkerClient {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(destroy?: boolean): void;
}

export interface WorkerPool {
  connect(): Promise<WorkerClient>;
  end(): Promise<void>;
  on(event: 'error', listener: () => void): unknown;
}

const roleQuery = `select current_user,session_user,rolsuper,rolbypassrls,
  exists(select from pg_auth_members where member=r.oid) as memberships
  from pg_roles r where rolname=current_user`;

function boundedLimit(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error('Worker batch limit is invalid.');
  return value;
}

function booleanResult(rows: pg.QueryResultRow[]): boolean {
  if (rows.length !== 1 || typeof rows[0].result !== 'boolean')
    throw new Error('Worker database response is invalid.');
  return rows[0].result;
}

export function createPostgresWorkerStore(
  connectionString: string,
  createPool: (config: pg.PoolConfig) => WorkerPool = (config) => new pg.Pool(config),
): ReminderWorkerStore {
  if (!connectionString.trim()) throw new Error('Worker database configuration is missing.');
  const pool = createPool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    idleTimeoutMillis: 30000,
    application_name: 'sankalpa-worker',
  });
  pool.on('error', () => console.error('worker_database_pool_error'));

  async function transaction<T>(operation: (client: WorkerClient) => Promise<T>): Promise<T> {
    let client: WorkerClient | undefined;
    let began = false;
    let destroy = false;
    try {
      client = await pool.connect();
      await client.query('begin');
      began = true;
      const result = await client.query(roleQuery);
      const role = result.rows[0];
      if (
        result.rows.length !== 1 ||
        role?.current_user !== 'app_worker' ||
        role.session_user !== 'app_worker' ||
        role.rolsuper !== false ||
        role.rolbypassrls !== false ||
        role.memberships !== false
      )
        throw new Error('Worker database role is not restricted.');
      const value = await operation(client);
      await client.query('commit');
      began = false;
      return value;
    } catch {
      if (client && began) {
        try {
          await client.query('rollback');
        } catch {
          destroy = true;
        }
      } else if (client) destroy = true;
      throw new Error('Worker database operation failed.');
    } finally {
      client?.release(destroy);
    }
  }

  return {
    claim(now, limit, simulated) {
      checkInstant(now);
      boundedLimit(limit, 4);
      return transaction(async (client) => {
        const { rows } = await client.query(
          'select * from app.claim_reminder_jobs($1::timestamptz,$2::int,$3::boolean)',
          [now, limit, simulated],
        );
        if (rows.length > limit) throw new Error('Worker database response is invalid.');
        const leases = rows.map((row) =>
          checkLease({
            jobId: row.job_id,
            leaseToken: row.lease_token,
            leaseUntil:
              row.lease_until instanceof Date ? row.lease_until.toISOString() : row.lease_until,
          }),
        );
        if (new Set(leases.map((lease) => lease.jobId)).size !== leases.length)
          throw new Error('Worker database response is invalid.');
        return leases;
      });
    },
    prepare(lease: ReminderLease, now, simulated) {
      checkLease(lease);
      checkInstant(now);
      return transaction(async (client) => {
        const { rows } = await client.query(
          'select app.prepare_reminder_job($1::uuid,$2::uuid,$3::timestamptz,$4::boolean) as result',
          [lease.jobId, lease.leaseToken, now, simulated],
        );
        if (rows.length !== 1) throw new Error('Worker database response is invalid.');
        const result = checkPrepared(rows[0].result);
        if (
          result.ready &&
          (result.jobId !== lease.jobId ||
            result.leaseToken !== lease.leaseToken ||
            result.simulated !== simulated)
        )
          throw new Error('Worker database response is invalid.');
        return result;
      });
    },
    settle(job: Extract<PreparedReminder, { ready: true }>, result: PushResult, now) {
      checkPrepared(job);
      checkResult(result);
      checkInstant(now);
      if (job.simulated !== (result.mode === 'simulated'))
        throw new Error('Worker result mode does not match.');
      return transaction(async (client) =>
        booleanResult(
          (
            await client.query(
              'select app.settle_reminder_job($1::uuid,$2::uuid,$3::int,$4::jsonb,$5::timestamptz) as result',
              [job.jobId, job.leaseToken, job.attempt, JSON.stringify(result), now],
            )
          ).rows,
        ),
      );
    },
    dueClosures(now, limit) {
      checkInstant(now);
      boundedLimit(limit, 50);
      return transaction(async (client) => {
        const { rows } = await client.query(
          'select session_id from app.due_session_closures($1::timestamptz,$2::int)',
          [now, limit],
        );
        if (rows.length > limit) throw new Error('Worker database response is invalid.');
        return [...new Set(rows.map((row) => checkId(row.session_id)))];
      });
    },
    closeSession(sessionId, now) {
      checkId(sessionId);
      checkInstant(now);
      return transaction(async (client) =>
        booleanResult(
          (
            await client.query(
              'select app.record_session_closure($1::uuid,$2::timestamptz) as result',
              [sessionId, now],
            )
          ).rows,
        ),
      );
    },
    heartbeat() {
      return transaction(async (client) => {
        await client.query('select app.record_worker_heartbeat()');
      });
    },
    close: () => pool.end(),
  };
}
