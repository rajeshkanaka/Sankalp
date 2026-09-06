import pg from 'pg';
import { getPool, withUser } from '../../src/server/db/client';
import { loadGuardedIntegrationRuntime } from './local-test-runtime';

interface QueryObservation {
  text: string;
  values: unknown[];
  operationId: string | null;
  run: (text: string, values?: unknown[]) => Promise<pg.QueryResult>;
}

export interface TransactionObserver {
  before?: (query: QueryObservation) => Promise<void>;
  after?: (query: QueryObservation, result: pg.QueryResult) => Promise<void>;
}

export function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 5000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

// Only the application connection pool is substituted; every SQL statement still runs on real
// PostgreSQL with the guarded app_api connection and the production withUser transaction wrapper.
export async function observedTransactions<T>(
  observer: TransactionObserver,
  run: (pool: pg.Pool) => Promise<T>,
): Promise<T> {
  loadGuardedIntegrationRuntime();
  const globalDb = globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> };
  const previousPool = globalDb.sankalpaPool;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    application_name: 'sankalpa-revision-transaction-test',
  });
  pool.on('connect', (client) => {
    const query = client.query.bind(client) as (
      text: string,
      values?: unknown[],
    ) => Promise<pg.QueryResult>;
    let operationId: string | null = null;
    client.query = (async (text: string, values: unknown[] = []) => {
      if (typeof text !== 'string' || !Array.isArray(values))
        throw new Error('Observed revision transactions require promise-based text queries.');
      const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized === 'begin') operationId = null;
      if (
        normalized.startsWith(
          'select operation_type, request_hash, response from app.operation_receipt',
        )
      )
        operationId = String(values[1]);
      const observation: QueryObservation = { text: normalized, values, operationId, run: query };
      await observer.before?.(observation);
      const result = await query(text, values);
      await observer.after?.(observation, result);
      if (normalized === 'commit' || normalized === 'rollback') operationId = null;
      return result;
    }) as typeof client.query;
  });
  globalDb.sankalpaPool = pool;
  try {
    return await run(pool);
  } finally {
    if (previousPool) globalDb.sankalpaPool = previousPool;
    else delete globalDb.sankalpaPool;
    await pool.end();
  }
}

export function settled<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
}

export async function blockingPids(pool: pg.Pool, pid: number): Promise<number[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ blockers: number[] }>(
      'select pg_blocking_pids($1) as blockers',
      [pid],
    );
    return result.rows[0].blockers;
  } finally {
    client.release();
  }
}

export function revisionSnapshot(userId: string, journeyId: string) {
  return withUser(userId, async (client) => {
    const journey = await client.query('select to_jsonb(j) as row from app.journey j where id=$1', [
      journeyId,
    ]);
    const versions = await client.query(
      'select to_jsonb(v) as row from app.schedule_version v where journey_id=$1 order by id',
      [journeyId],
    );
    const practices = await client.query(
      'select to_jsonb(p) as row from app.practice_version p where journey_id=$1 order by schedule_version_id,id',
      [journeyId],
    );
    const sessions = await client.query(
      'select to_jsonb(s) as row from app.session s where journey_id=$1 order by id',
      [journeyId],
    );
    const values = await client.query(
      'select to_jsonb(v) as row from app.session_practice v where journey_id=$1 order by session_id,practice_id',
      [journeyId],
    );
    const amendments = await client.query(
      'select to_jsonb(a) as row from app.amendment a where journey_id=$1 order by id',
      [journeyId],
    );
    const receipts = await client.query(
      'select to_jsonb(r) as row from app.operation_receipt r where owner_id=$1 order by operation_id',
      [userId],
    );
    return {
      journey: journey.rows,
      versions: versions.rows,
      practices: practices.rows,
      sessions: sessions.rows,
      values: values.rows,
      amendments: amendments.rows,
      receipts: receipts.rows,
    };
  });
}

export function operationReceipts(userId: string, operationIds: string[]) {
  return withUser(userId, async (client) => {
    const result = await client.query<{ operation_id: string; operation_type: string }>(
      'select operation_id,operation_type from app.operation_receipt where operation_id=any($1::uuid[]) order by operation_id',
      [operationIds],
    );
    return result.rows;
  });
}
