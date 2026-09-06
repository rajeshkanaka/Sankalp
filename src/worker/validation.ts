import { z } from 'zod';

import type { PushResult } from '../server/reminders/transport-contracts.js';
import type { PreparedReminder, ReminderLease } from '../server/reminders/worker-contracts.js';

const instant = z.iso.datetime({ offset: true });
const uuid = z.uuid();
const leaseSchema = z.strictObject({ jobId: uuid, leaseToken: uuid, leaseUntil: instant });
const preparedSchema = z.discriminatedUnion('ready', [
  z.strictObject({ ready: z.literal(false) }),
  z.strictObject({
    ready: z.literal(true),
    jobId: uuid,
    leaseToken: uuid,
    attempt: z.number().int().min(1).max(3),
    eventId: uuid,
    journeyId: uuid.nullable(),
    sessionId: uuid.nullable(),
    subscriptionId: uuid,
    subscriptionGeneration: z.number().int().positive(),
    expiresAt: instant,
    simulated: z.boolean(),
    journeyTitle: z.string().nullable(),
    subscription: z.strictObject({
      endpoint: z.string().min(1).max(4096),
      keys: z.strictObject({ p256dh: z.string().min(1).max(100), auth: z.string().min(1).max(30) }),
    }),
  }),
]);
const mode = {
  mode: z.enum(['real', 'simulated']),
  httpStatus: z.number().int().min(100).max(599).nullable(),
};
const resultSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ ...mode, kind: z.literal('accepted') }),
    z.strictObject({
      ...mode,
      kind: z.literal('terminal_failure'),
      reason: z.enum([
        'invalid_input',
        'endpoint_blocked',
        'subscription_gone',
        'provider_rejected',
        'tls_rejected',
        'expired',
        'canceled',
      ]),
      invalidateSubscription: z.boolean(),
    }),
    z.strictObject({
      ...mode,
      kind: z.literal('transient_failure'),
      reason: z.enum(['dns_failure', 'network_before_send', 'provider_retry']),
      retryAfterMs: z.number().nonnegative().max(300_000).nullable(),
    }),
    z.strictObject({
      ...mode,
      kind: z.literal('uncertain'),
      reason: z.enum(['timeout', 'aborted', 'network', 'invalid_response']),
    }),
  ])
  .refine((value) => value.mode !== 'simulated' || value.httpStatus === null);

// Do not expose schema issues: they may contain a subscription or private title.
export function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('Worker boundary validation failed.');
  return parsed.data;
}

export function checkInstant(value: unknown): string {
  return checked(instant, value);
}

export function checkId(value: unknown): string {
  return checked(uuid, value);
}

export function checkLease(value: unknown): ReminderLease {
  return checked(leaseSchema, value);
}

export function checkPrepared(value: unknown): PreparedReminder {
  const result = checked(preparedSchema, value);
  if (result.ready && (result.journeyId === null) !== (result.sessionId === null))
    throw new Error('Worker boundary validation failed.');
  return result;
}

export function checkResult(value: unknown): PushResult {
  return checked(resultSchema, value) as PushResult;
}
