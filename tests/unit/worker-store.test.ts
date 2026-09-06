import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { PreparedReminder } from '../../src/server/reminders/worker-contracts';
import {
  createPostgresWorkerStore,
  type WorkerClient,
  type WorkerPool,
} from '../../src/worker/store';

const now = '2026-09-05T16:30:00.000Z';
const id = (number: number) => `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`;
const lease = { jobId: id(1), leaseToken: id(2), leaseUntil: '2026-09-05T16:31:00.000Z' };
const ready: Extract<PreparedReminder, { ready: true }> = {
  jobId: lease.jobId,
  leaseToken: lease.leaseToken,
  ready: true,
  attempt: 1,
  eventId: id(3),
  journeyId: id(4),
  sessionId: id(5),
  subscriptionId: id(6),
  subscriptionGeneration: 1,
  expiresAt: '2026-09-05T16:35:00.000Z',
  simulated: true,
  journeyTitle: null,
  subscription: {
    endpoint: 'https://fcm.googleapis.com/synthetic',
    keys: { p256dh: 'synthetic', auth: 'synthetic' },
  },
};

function fixture() {
  const role = {
    current_user: 'app_worker',
    session_user: 'app_worker',
    rolsuper: false,
    rolbypassrls: false,
    memberships: false,
  };
  const operation = vi.fn<(sql: string, values?: unknown[]) => Promise<pg.QueryResultRow[]>>(
    async () => [],
  );
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (['begin', 'commit', 'rollback'].includes(sql)) return { rows: [] };
    if (sql.includes('from pg_roles')) return { rows: [role] };
    return { rows: await operation(sql, values) };
  });
  const client = { query, release: vi.fn() } as unknown as WorkerClient;
  const pool: WorkerPool = {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => {}),
    on: vi.fn(),
  };
  const factory = vi.fn<(config: pg.PoolConfig) => WorkerPool>(() => pool);
  const store = createPostgresWorkerStore('postgresql://synthetic-configuration', factory);
  return { role, query, operation, client, pool, factory, store };
}

describe('worker database adapter with an injected pool (no database connection)', () => {
  it('constructs the exact bounded pool and does not read app credentials or set an auth subject', async () => {
    const test = fixture();
    await test.store.heartbeat();
    expect(test.factory).toHaveBeenCalledWith({
      connectionString: 'postgresql://synthetic-configuration',
      max: 5,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      idleTimeoutMillis: 30000,
      application_name: 'sankalpa-worker',
    });
    expect(test.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
      /set_config|request.jwt|set role/i,
    );
    expect(test.pool.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('checks role within each short transaction, parameterizes claim, maps dates, commits and releases', async () => {
    const test = fixture();
    test.operation.mockResolvedValue([
      {
        job_id: lease.jobId,
        lease_token: lease.leaseToken,
        lease_until: new Date(lease.leaseUntil),
      },
    ]);
    expect(await test.store.claim(now, 4, true)).toEqual([lease]);
    expect(test.query.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      expect.stringContaining('from pg_roles'),
      'select * from app.claim_reminder_jobs($1::timestamptz,$2::int,$3::boolean)',
      'commit',
    ]);
    expect(test.operation).toHaveBeenCalledWith(expect.stringContaining('claim_reminder_jobs'), [
      now,
      4,
      true,
    ]);
    expect(test.client.release).toHaveBeenCalledWith(false);
    await test.store.claim(now, 1, false);
    expect(test.pool.connect).toHaveBeenCalledTimes(2);
    expect(test.query.mock.calls.filter(([sql]) => sql.includes('from pg_roles'))).toHaveLength(2);
  });

  it.each([
    ['current_user', 'app_api'],
    ['session_user', 'postgres'],
    ['rolsuper', true],
    ['rolbypassrls', true],
    ['memberships', true],
    ['rolsuper', null],
  ])(
    'rejects forbidden/missing role property %s before any function call',
    async (field, value) => {
      const test = fixture();
      Object.assign(test.role, { [field as string]: value });
      await expect(test.store.claim(now, 4, true)).rejects.toThrow(
        'Worker database operation failed.',
      );
      expect(test.operation).not.toHaveBeenCalled();
      expect(test.query).toHaveBeenLastCalledWith('rollback');
      expect(test.client.release).toHaveBeenCalledWith(false);
    },
  );

  it('rechecks a later checkout instead of trusting the first successful role check', async () => {
    const test = fixture();
    await test.store.heartbeat();
    test.role.memberships = true;
    await expect(test.store.heartbeat()).rejects.toThrow('Worker database operation failed.');
    expect(test.operation).toHaveBeenCalledTimes(1);
  });

  it('prepare returns only a validated matching fenced DTO and releases before the caller sends', async () => {
    const test = fixture();
    test.operation.mockResolvedValue([{ result: ready }]);
    expect(await test.store.prepare(lease, now, true)).toEqual(ready);
    expect(test.operation).toHaveBeenCalledWith(
      'select app.prepare_reminder_job($1::uuid,$2::uuid,$3::timestamptz,$4::boolean) as result',
      [lease.jobId, lease.leaseToken, now, true],
    );
    expect(test.query).toHaveBeenLastCalledWith('commit');
    expect(test.client.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...ready, jobId: id(99) },
    { ...ready, leaseToken: id(99) },
    { ...ready, simulated: false },
    { ...ready, attempt: 4 },
    { ...ready, sessionId: null },
    { ...ready, raw: 'synthetic-private-value' },
  ])('rolls back an invalid or mismatched prepared DTO', async (result) => {
    const test = fixture();
    test.operation.mockResolvedValue([{ result }]);
    await expect(test.store.prepare(lease, now, true)).rejects.toThrow(
      'Worker database operation failed.',
    );
    expect(test.query).toHaveBeenLastCalledWith('rollback');
  });

  it('passes through no-ready without inventing a dispatch', async () => {
    const test = fixture();
    test.operation.mockResolvedValue([{ result: { ready: false } }]);
    expect(await test.store.prepare(lease, now, true)).toEqual({ ready: false });
  });

  it('settles only exact sanitized JSON and returns false for a lost fence', async () => {
    const test = fixture();
    const result = {
      mode: 'simulated',
      httpStatus: null,
      kind: 'uncertain',
      reason: 'timeout',
    } as const;
    test.operation.mockResolvedValue([{ result: false }]);
    expect(await test.store.settle(ready, result, now)).toBe(false);
    expect(test.operation).toHaveBeenCalledWith(
      'select app.settle_reminder_job($1::uuid,$2::uuid,$3::int,$4::jsonb,$5::timestamptz) as result',
      [ready.jobId, ready.leaseToken, ready.attempt, JSON.stringify(result), now],
    );
  });

  it('mode mismatch is rejected before checking out a connection', async () => {
    const test = fixture();
    await expect(async () =>
      test.store.settle(ready, { mode: 'real', httpStatus: 201, kind: 'accepted' }, now),
    ).rejects.toThrow('Worker result mode does not match.');
    expect(test.pool.connect).not.toHaveBeenCalled();
  });

  it('invalid settlement outputs are not accepted as success', async () => {
    const test = fixture();
    test.operation.mockResolvedValue([{ result: 'true' }]);
    await expect(
      test.store.settle(ready, { mode: 'simulated', httpStatus: null, kind: 'accepted' }, now),
    ).rejects.toThrow('Worker database operation failed.');
  });

  it('parameterizes closure listing, insertion and heartbeat with no session access outside functions', async () => {
    const test = fixture();
    test.operation
      .mockResolvedValueOnce([{ session_id: id(5) }])
      .mockResolvedValueOnce([{ result: true }])
      .mockResolvedValueOnce([]);
    expect(await test.store.dueClosures(now, 50)).toEqual([id(5)]);
    expect(await test.store.closeSession(id(5), now)).toBe(true);
    await test.store.heartbeat();
    expect(test.operation.mock.calls).toEqual([
      ['select session_id from app.due_session_closures($1::timestamptz,$2::int)', [now, 50]],
      ['select app.record_session_closure($1::uuid,$2::timestamptz) as result', [id(5), now]],
      ['select app.record_worker_heartbeat()', undefined],
    ]);
  });

  it.each([0, 5, 50, 1.5])(
    'rejects claim limit %s before acquiring a connection',
    async (limit) => {
      const test = fixture();
      expect(() => test.store.claim(now, limit, true)).toThrow('Worker batch limit is invalid.');
      expect(test.pool.connect).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed identifiers and clock input without interpolating them into SQL', () => {
    const test = fixture();
    expect(() => test.store.closeSession("'; drop table app.session; --", now)).toThrow(
      'Worker boundary validation failed.',
    );
    expect(() => test.store.claim('invalid-clock', 4, true)).toThrow(
      'Worker boundary validation failed.',
    );
    expect(test.pool.connect).not.toHaveBeenCalled();
  });

  it('rolls back malformed/duplicate claim rows without leaking returned subscription-like data', async () => {
    const test = fixture();
    const row = {
      job_id: lease.jobId,
      lease_token: lease.leaseToken,
      lease_until: new Date(lease.leaseUntil),
    };
    test.operation.mockResolvedValue([row, row]);
    await expect(test.store.claim(now, 4, true)).rejects.toThrow(
      'Worker database operation failed.',
    );
    test.operation.mockResolvedValue([{ ...row, job_id: 'synthetic-private-value' }]);
    await expect(test.store.claim(now, 4, true)).rejects.not.toThrow('synthetic-private-value');
  });

  it('sanitizes connection failures and query errors and releases resources after rollback', async () => {
    const test = fixture();
    vi.mocked(test.pool.connect).mockRejectedValueOnce(new Error('postgres://synthetic-password'));
    await expect(test.store.heartbeat()).rejects.toThrow('Worker database operation failed.');
    test.operation.mockRejectedValue(new Error('synthetic-endpoint-in-database-error'));
    await expect(test.store.heartbeat()).rejects.toThrow('Worker database operation failed.');
    expect(test.query).toHaveBeenLastCalledWith('rollback');
    expect(test.client.release).toHaveBeenCalledWith(false);
  });

  it('destroys a client whose rollback fails and does not mask the sanitized error', async () => {
    const test = fixture();
    test.query.mockImplementation(async (sql) => {
      if (sql === 'begin') return { rows: [] };
      throw new Error('synthetic-sensitive-error');
    });
    await expect(test.store.heartbeat()).rejects.toThrow('Worker database operation failed.');
    expect(test.client.release).toHaveBeenCalledWith(true);
  });

  it('sanitizes the asynchronous pool error and closes the pool explicitly', async () => {
    const test = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const listener = vi.mocked(test.pool.on).mock.calls[0][1];
      listener();
      expect(log).toHaveBeenCalledWith('worker_database_pool_error');
    } finally {
      log.mockRestore();
    }
    await test.store.close();
    expect(test.pool.end).toHaveBeenCalledTimes(1);
  });
});
