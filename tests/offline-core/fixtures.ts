import type { QueueOperation, Snapshot } from '../../src/offline/core/types';
export const ACCOUNT = '12000000-0000-4000-8000-000000000001';
export const OTHER = '12000000-0000-4000-8000-000000000002';
export const snapshot: Snapshot = {
  session: {
    id: '12000000-0000-4000-8000-000000000003',
    journeyId: '12000000-0000-4000-8000-000000000004',
    scheduleVersionId: '12000000-0000-4000-8000-000000000005',
    ordinal: 1,
    practiceDate: '2026-09-05',
    opensAt: '2026-09-05T00:00:00.000Z',
    closesAt: '2026-09-06T00:00:00.000Z',
    adjustment: null,
    timeZone: 'Asia/Kolkata',
    attribution: 'civil',
    confirmed: false,
    performedAt: null,
    recordedAt: null,
    revision: 1,
    supersededAt: null,
    practices: [
      {
        id: '12000000-0000-4000-8000-000000000006',
        label: 'Synthetic checklist',
        order: 0,
        kind: 'checkbox',
        target: null,
        value: false,
      },
      {
        id: '12000000-0000-4000-8000-000000000007',
        label: 'Synthetic minutes',
        order: 1,
        kind: 'minutes',
        target: 20,
        value: 0,
      },
    ],
  },
  journeyTitle: 'Synthetic offline harness',
  reflection: null,
  preferences: { prompts: [] },
  lastSyncedAt: '2026-09-05T01:00:00.000Z',
  clock: {
    serverNow: '2026-09-05T01:00:00.000Z',
    capturedAt: '2026-09-06T01:00:00.000Z',
    simulated: true,
  },
};
export function operation(overrides: Partial<QueueOperation> = {}): QueueOperation {
  return {
    accountId: ACCOUNT,
    operationId: '12000000-0000-4000-8000-000000000008',
    sessionId: snapshot.session.id,
    scheduleVersionId: snapshot.session.scheduleVersionId,
    baseRevision: 1,
    expectedLocalHead: null,
    intent: {
      kind: 'practices',
      payload: { values: { [snapshot.session.practices[0].id]: true } },
    },
    stream: 'session',
    sequence: 1,
    createdAt: snapshot.lastSyncedAt,
    state: 'queued',
    predecessorId: null,
    request: null,
    attempts: 0,
    attemptedAt: null,
    retryAfter: null,
    conflict: null,
    ...overrides,
  };
}
