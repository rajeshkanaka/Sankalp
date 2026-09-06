import { z } from 'zod';
import {
  completionSchema,
  completionUndoSchema,
  practiceValuesSchema,
  reflectionPayloadSchema,
  reflectionPreferencesSchema,
} from '../../domain/validation';
import type { ReflectionRecord, SessionRecord } from '../../domain/contracts';
import { targetsMet } from '../../domain/status';
import type { Intent, LocalView, QueueOperation, RawDraft, Snapshot, Stream } from './types';

export const MAX_OPERATIONS = 500;
export const MAX_UNPINNED_SESSIONS = 50;
export const REVIEW_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export class OfflineError extends Error {
  constructor(
    public readonly code: string,
    message = 'Local storage could not complete this action.',
  ) {
    super(message);
    this.name = 'OfflineError';
  }
}
export function storageError(error: unknown): OfflineError {
  return error instanceof OfflineError
    ? error
    : new OfflineError(
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? 'STORAGE_FULL'
          : 'STORAGE_UNAVAILABLE',
        'This change was not saved on this device. Keep this page open and try again.',
      );
}
export const uuid = (value: unknown): string => z.uuid().parse(value);
export const instant = (value: unknown): string => z.iso.datetime({ offset: true }).parse(value);
export const revision = (value: unknown): number => z.int().nonnegative().parse(value);
export function streamFor(intent: Intent): Stream {
  return intent.kind === 'reflection' ? 'reflection' : 'session';
}
export function validateIntent(intent: Intent): Intent {
  switch (intent.kind) {
    case 'practices':
      return { kind: intent.kind, payload: practiceValuesSchema.parse(intent.payload) };
    case 'completion':
      return { kind: intent.kind, payload: completionSchema.parse(intent.payload) };
    case 'completion_undo':
      return { kind: intent.kind, payload: completionUndoSchema.parse(intent.payload) };
    case 'reflection':
      return { kind: intent.kind, payload: reflectionPayloadSchema.parse(intent.payload) };
    default:
      throw new OfflineError('INVALID_INTENT', 'This action cannot be saved offline.');
  }
}
/** Validate every step against the state it will actually follow, including reviewed sequences. */
export function applyIntent(session: SessionRecord, intent: Intent): SessionRecord {
  const projected = structuredClone(session);
  if (intent.kind === 'practices') {
    for (const [id, value] of Object.entries(intent.payload.values)) {
      const practice = projected.practices.find((item) => item.id === id);
      if (
        !practice ||
        (practice.kind === 'checkbox' ? typeof value !== 'boolean' : typeof value !== 'number')
      )
        throw new OfflineError('INVALID_PRACTICE');
      practice.value = value;
    }
  } else if (intent.kind === 'completion') {
    if (!targetsMet(projected))
      throw new OfflineError('TARGETS_INCOMPLETE', 'Meet every practice target before confirming.');
    projected.confirmed = true;
    projected.performedAt = intent.payload.performedAt;
  } else if (intent.kind === 'completion_undo') {
    projected.confirmed = false;
    projected.performedAt = null;
  }
  return projected;
}
const sessionSchema = z.object({
  id: z.uuid(),
  journeyId: z.uuid(),
  scheduleVersionId: z.uuid(),
  ordinal: z.int().positive(),
  practiceDate: z.iso.date(),
  opensAt: z.iso.datetime({ offset: true }),
  closesAt: z.iso.datetime({ offset: true }),
  adjustment: z.string().nullable(),
  timeZone: z.string(),
  attribution: z.enum(['civil', 'previous_evening']),
  practices: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      order: z.int().nonnegative(),
      kind: z.enum(['checkbox', 'minutes', 'repetitions']),
      target: z.number().nullable(),
      value: z.union([z.boolean(), z.number()]),
    }),
  ),
  confirmed: z.boolean(),
  performedAt: z.iso.datetime({ offset: true }).nullable(),
  recordedAt: z.iso.datetime({ offset: true }).nullable(),
  revision: z.int().nonnegative(),
  supersededAt: z.iso.datetime({ offset: true }).nullable(),
});
const reflectionSchema = z.object({
  sessionId: z.uuid(),
  journeyId: z.uuid(),
  scheduleVersionId: z.uuid(),
  text: z.string(),
  moods: z.array(z.string()),
  revision: z.int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const parseSession = (value: unknown): SessionRecord => sessionSchema.parse(value);
export const parseReflection = (value: unknown): ReflectionRecord | null =>
  reflectionSchema.nullable().parse(value);
export function validateSnapshot(value: Snapshot): Snapshot {
  const snapshot = {
    session: parseSession(value.session),
    journeyTitle: z.string().max(200).parse(value.journeyTitle),
    reflection: parseReflection(value.reflection),
    preferences: reflectionPreferencesSchema.parse(value.preferences),
    lastSyncedAt: instant(value.lastSyncedAt),
    clock: z
      .strictObject({
        serverNow: z.iso.datetime({ offset: true }),
        capturedAt: z.iso.datetime({ offset: true }),
        simulated: z.boolean(),
      })
      .parse(value.clock),
  };
  if (
    snapshot.reflection &&
    (snapshot.reflection.sessionId !== snapshot.session.id ||
      snapshot.reflection.scheduleVersionId !== snapshot.session.scheduleVersionId ||
      snapshot.reflection.journeyId !== snapshot.session.journeyId)
  )
    throw new OfflineError('IDENTITY_MISMATCH');
  return snapshot;
}
export function validateDraft(value: RawDraft | null): RawDraft | null {
  // A generous explicit input bound avoids unbounded storage while preserving invalid domain input.
  return z
    .strictObject({
      numericValues: z.record(z.uuid(), z.string().max(1_000)).optional(),
      reflection: z
        .strictObject({
          text: z.string().max(200_000),
          moods: z.array(z.string().max(1_000)).max(100),
        })
        .optional(),
    })
    .nullable()
    .parse(value);
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function dueForReview(operation: QueueOperation, now: string): boolean {
  return Date.parse(now) - Date.parse(operation.createdAt) > REVIEW_AGE_MS;
}
export function retryAt(now: string, attempts: number, requestedSeconds = 0): string {
  const seconds = Math.max(
    Math.min(30, 2 ** Math.min(5, Math.max(0, attempts - 1))),
    Math.min(300, Math.max(0, requestedSeconds)),
  );
  return new Date(Date.parse(now) + seconds * 1_000).toISOString();
}
export function makeView(
  snapshot: Snapshot,
  operations: QueueOperation[],
  draft: RawDraft | null,
  draftRevision: number,
): LocalView {
  const projectedSession = structuredClone(snapshot.session);
  let projectedReflection = {
    text: snapshot.reflection?.text ?? '',
    moods: [...(snapshot.reflection?.moods ?? [])],
  };
  const heads: Record<Stream, string | null> = { session: null, reflection: null };
  for (const operation of [...operations].sort((a, b) => a.sequence - b.sequence)) {
    heads[operation.stream] = operation.operationId;
    if (operation.intent.kind === 'practices') {
      const values = operation.intent.payload.values;
      for (const practice of projectedSession.practices)
        if (Object.hasOwn(values, practice.id)) practice.value = values[practice.id];
    } else if (operation.intent.kind === 'completion') {
      projectedSession.confirmed = true;
      projectedSession.performedAt = operation.intent.payload.performedAt;
    } else if (operation.intent.kind === 'completion_undo') {
      projectedSession.confirmed = false;
      projectedSession.performedAt = null;
    } else projectedReflection = structuredClone(operation.intent.payload);
  }
  return {
    snapshot,
    projectedSession,
    projectedReflection,
    operations,
    heads,
    draft,
    draftRevision,
  };
}
