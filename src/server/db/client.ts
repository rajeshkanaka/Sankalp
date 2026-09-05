import pg from 'pg';
import { z } from 'zod';
import { requiredEnv } from '../config';
import { AppError } from '../errors';

const globalDb = globalThis as typeof globalThis & { sankalpaPool?: pg.Pool };
export function getPool() {
  if (!globalDb.sankalpaPool) {
    globalDb.sankalpaPool = new pg.Pool({
      connectionString: requiredEnv('DATABASE_URL'),
      max: 8,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      application_name: 'sankalpa-app',
    });
    globalDb.sankalpaPool.on('error', () => console.error('database_pool_error'));
  }
  return globalDb.sankalpaPool;
}
export async function withUser<T>(
  userId: string,
  operation: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  z.uuid().parse(userId);
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const role = await client.query(
      'select current_user, session_user, rolsuper, rolbypassrls, exists(select from pg_auth_members where member = r.oid) as memberships from pg_roles r where rolname = current_user',
    );
    const identity = role.rows[0];
    if (
      identity?.current_user !== 'app_api' ||
      identity?.session_user !== 'app_api' ||
      identity.rolsuper ||
      identity.rolbypassrls ||
      identity.memberships
    )
      throw new Error('Application database role is not restricted.');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query('select pg_advisory_xact_lock_shared(hashtextextended($1, 2))', [userId]);
    // Privacy disabling takes the exclusive form of this account lock.
    // The verified auth identity can initialize only its own otherwise empty profile.
    await client.query('insert into app.profile(owner_id) values($1) on conflict do nothing', [
      userId,
    ]);
    const active = await client.query('select disabled_at from app.profile where owner_id = $1', [
      userId,
    ]);
    if (!active.rows[0] || active.rows[0].disabled_at)
      throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable.');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
