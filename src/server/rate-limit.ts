import { createHmac } from 'node:crypto';
import { getPool } from './db/client';
import { getOrigin, getRuntimeInfo, requiredEnv } from './config';
import { AppError } from './errors';

export type RateScope =
  'sign-in-minute' | 'sign-in-hour' | 'sign-in-ip-minute' | 'sign-in-ip-hour' | 'write-minute';
export async function consumeLimit(scope: RateScope, identity: string) {
  const key = createHmac('sha256', requiredEnv('RATE_LIMIT_SECRET'))
    .update(`${getOrigin()}:${identity}`)
    .digest('hex');
  const result = await getPool().query<{ retry: number }>(
    'select app.consume_rate_limit($1,$2) as retry',
    [scope, key],
  );
  const retry = result.rows[0].retry;
  if (retry > 0)
    throw new AppError(
      429,
      'RATE_LIMITED',
      'Please wait a little before trying again.',
      undefined,
      retry,
    );
}
export async function limitSignIn(email: string) {
  const { appEnv } = getRuntimeInfo();
  // The local server binds to loopback. Hosted ingress identity is a release gate.
  if (!['local', 'ci'].includes(appEnv))
    throw new AppError(
      503,
      'INGRESS_NOT_CONFIGURED',
      'Sign-in is awaiting secure hosting configuration.',
    );
  await consumeLimit('sign-in-ip-minute', '127.0.0.1');
  await consumeLimit('sign-in-ip-hour', '127.0.0.1');
  await consumeLimit('sign-in-minute', email.toLowerCase());
  await consumeLimit('sign-in-hour', email.toLowerCase());
}
