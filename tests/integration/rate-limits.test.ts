import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPool } from '../../src/server/db/client';
import { AppError } from '../../src/server/errors';
import { consumeLimit, type RateScope } from '../../src/server/rate-limit';
import { loadGuardedIntegrationRuntime } from './local-test-runtime';

const ownedKeys = new Set<string>();

function uniqueKey(): string {
  const key = randomBytes(32).toString('hex');
  ownedKeys.add(key);
  return key;
}

async function consumeBucket(scope: RateScope, key: string): Promise<number> {
  const result = await getPool().query<{ retry: number }>(
    'select app.consume_rate_limit($1,$2) as retry',
    [scope, key],
  );
  return result.rows[0]!.retry;
}

async function withAdmin<T>(operation: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
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

beforeAll(() => {
  loadGuardedIntegrationRuntime();
});

afterAll(async () => {
  await closeApplicationPool();
  if (ownedKeys.size)
    await withAdmin(async (client) => {
      await client.query('delete from app.rate_bucket where key_hash=any($1::text[])', [
        [...ownedKeys],
      ]);
    });
});

describe('database rate-limit boundaries', () => {
  it('enforces the fixed minute and hour caps with integer retry seconds', async () => {
    const minuteKey = uniqueKey();
    expect(await consumeBucket('sign-in-minute', minuteKey)).toBe(0);
    const minuteRetry = await consumeBucket('sign-in-minute', minuteKey);
    expect(Number.isInteger(minuteRetry)).toBe(true);
    expect(minuteRetry).toBeGreaterThanOrEqual(1);
    expect(minuteRetry).toBeLessThanOrEqual(60);

    const hourKey = uniqueKey();
    const allowed = await Promise.all(
      Array.from({ length: 5 }, () => consumeBucket('sign-in-hour', hourKey)),
    );
    expect(allowed).toEqual([0, 0, 0, 0, 0]);
    const hourRetry = await consumeBucket('sign-in-hour', hourKey);
    expect(Number.isInteger(hourRetry)).toBe(true);
    expect(hourRetry).toBeGreaterThanOrEqual(1);
    expect(hourRetry).toBeLessThanOrEqual(3_600);
  });

  it('starts a fresh allowance when an owned bucket crosses its database-time window', async () => {
    const key = uniqueKey();
    expect(await consumeBucket('sign-in-minute', key)).toBe(0);

    await withAdmin(async (client) => {
      const shifted = await client.query(
        `update app.rate_bucket
         set window_start=date_trunc('minute',clock_timestamp())-interval '1 minute'
         where scope='sign-in-minute' and key_hash=$1`,
        [key],
      );
      expect(shifted.rowCount).toBe(1);
    });

    expect(await consumeBucket('sign-in-minute', key)).toBe(0);
    const reset = await withAdmin((client) =>
      client.query<{ attempts: number; current_window: boolean }>(
        `select attempts, window_start=date_trunc('minute',clock_timestamp()) as current_window
         from app.rate_bucket where scope='sign-in-minute' and key_hash=$1`,
        [key],
      ),
    );
    expect(reset.rows[0]).toEqual({ attempts: 1, current_window: true });
  });

  it('isolates counters by both scope and key', async () => {
    const sharedKey = uniqueKey();
    const otherKey = uniqueKey();

    expect(await consumeBucket('sign-in-minute', sharedKey)).toBe(0);
    expect(await consumeBucket('sign-in-minute', sharedKey)).toBeGreaterThan(0);
    expect(await consumeBucket('sign-in-ip-minute', sharedKey)).toBe(0);
    expect(await consumeBucket('sign-in-ip-minute', sharedKey)).toBeGreaterThan(0);
    expect(await consumeBucket('sign-in-minute', otherKey)).toBe(0);
  });

  it('atomically allows exactly 120 of 121 concurrent write attempts', async () => {
    const key = uniqueKey();
    const results = await Promise.all(
      Array.from({ length: 121 }, () => consumeBucket('write-minute', key)),
    );
    expect(results.filter((retry) => retry === 0)).toHaveLength(120);
    const blocked = results.filter((retry) => retry > 0);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toBeGreaterThanOrEqual(1);
    expect(blocked[0]).toBeLessThanOrEqual(60);
  });

  it('keeps table access denied and rejects function calls outside app_api', async () => {
    await expect(getPool().query('select * from app.rate_bucket limit 1')).rejects.toMatchObject({
      code: '42501',
    });

    await withAdmin(async (client) => {
      const privileges = await client.query(
        `select
          has_table_privilege('app_api','app.rate_bucket','SELECT') as table_select,
          has_function_privilege('app_api','app.consume_rate_limit(text,text)','EXECUTE') as function_execute`,
      );
      expect(privileges.rows[0]).toEqual({ table_select: false, function_execute: true });
      await expect(
        client.query('select app.consume_rate_limit($1,$2)', [
          'sign-in-minute',
          randomBytes(32).toString('hex'),
        ]),
      ).rejects.toMatchObject({ message: 'Restricted application role required' });
    });
  });

  it('deletes at most 1,000 buckets older than two hours and preserves newer records', async () => {
    const oldKeys = Array.from({ length: 1_001 }, () => uniqueKey());
    const recentKey = uniqueKey();
    const triggerKey = uniqueKey();
    await withAdmin(async (client) => {
      await client.query(
        `insert into app.rate_bucket(scope,key_hash,window_start,attempts)
         select 'write-minute',key_hash,clock_timestamp()-interval '3 hours',1
         from unnest($1::text[]) as keys(key_hash)`,
        [oldKeys],
      );
      await client.query(
        `insert into app.rate_bucket(scope,key_hash,window_start,attempts)
         values('write-minute',$1,clock_timestamp()-interval '90 minutes',1)`,
        [recentKey],
      );
    });

    expect(await consumeBucket('write-minute', triggerKey)).toBe(0);
    const remaining = await withAdmin((client) =>
      client.query<{ old_total: number; recent_total: number }>(
        `select
          count(*) filter(where key_hash=any($1::text[]))::int as old_total,
          count(*) filter(where key_hash=$2)::int as recent_total
         from app.rate_bucket`,
        [oldKeys, recentKey],
      ),
    );
    expect(remaining.rows[0]).toEqual({ old_total: 1, recent_total: 1 });
  });
});

describe('application rate-limit wrapper', () => {
  it('uses the origin-bound HMAC key and reports a safe 429 response', async () => {
    const identity = `integration-rate-${randomUUID()}`;
    const secret = process.env.RATE_LIMIT_SECRET;
    const origin = process.env.APP_ORIGIN;
    if (!secret || !origin)
      throw new Error('Integration environment is missing rate-limit settings.');
    const key = createHmac('sha256', secret)
      .update(`${new URL(origin).origin}:${identity}`)
      .digest('hex');
    ownedKeys.add(key);

    await expect(consumeLimit('sign-in-minute', identity)).resolves.toBeUndefined();
    await expect(consumeLimit('sign-in-minute', identity)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfter: expect.any(Number),
    } satisfies Partial<AppError>);

    const persisted = await withAdmin((client) =>
      client.query<{ attempts: number }>(
        `select attempts from app.rate_bucket
         where scope='sign-in-minute' and key_hash=$1`,
        [key],
      ),
    );
    expect(persisted.rows[0]?.attempts).toBe(2);
  });
});
