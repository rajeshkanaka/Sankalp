import { describe, expect, it } from 'vitest';
import {
  dueForReview,
  makeView,
  retryAt,
  stableJson,
  validateDraft,
  validateIntent,
  validateSnapshot,
} from '../../src/offline/core/model';
import { snapshot, operation } from '../offline-core/fixtures';

describe('offline intent and projection policy', () => {
  it('preserves raw invalid inputs without accepting them as wire mutations', () => {
    const raw = {
      numericValues: { [snapshot.session.practices[1].id]: '1e-' },
      reflection: { text: '  \n unfinished \n ', moods: ['', ' untrimmed '] },
    };
    expect(validateDraft(raw)).toEqual(raw);
    expect(() =>
      validateIntent({
        kind: 'practices',
        payload: { values: { [snapshot.session.practices[1].id]: '1e-' as never } },
      }),
    ).toThrow();
  });
  it('separates pending completion from canonical progress and independent reflection heads', () => {
    const check = operation({
      intent: {
        kind: 'practices',
        payload: {
          values: {
            [snapshot.session.practices[0].id]: true,
            [snapshot.session.practices[1].id]: 20,
          },
        },
      },
    });
    const confirm = operation({
      operationId: crypto.randomUUID(),
      sequence: 2,
      intent: { kind: 'completion', payload: { performedAt: snapshot.clock.serverNow } },
    });
    const reflection = operation({
      operationId: crypto.randomUUID(),
      stream: 'reflection',
      sequence: 3,
      intent: { kind: 'reflection', payload: { text: 'local only', moods: [] } },
    });
    const view = makeView(snapshot, [check, confirm, reflection], null, 0);
    expect(view.snapshot.session.confirmed).toBe(false);
    expect(view.snapshot.session.revision).toBe(1);
    expect(view.projectedSession.confirmed).toBe(true);
    expect(view.projectedSession.revision).toBe(1);
    expect(view.projectedReflection.text).toBe('local only');
    expect(view.heads).toEqual({
      session: confirm.operationId,
      reflection: reflection.operationId,
    });
  });
  it('projects undo without deleting canonical completion', () => {
    const completed = structuredClone(snapshot);
    completed.session.confirmed = true;
    completed.session.performedAt = snapshot.clock.serverNow;
    const view = makeView(
      completed,
      [operation({ intent: { kind: 'completion_undo', payload: {} } })],
      null,
      0,
    );
    expect(view.projectedSession.confirmed).toBe(false);
    expect(view.snapshot.session.confirmed).toBe(true);
  });
  it('requires review only after thirty days and bounds retry delay', () => {
    const row = operation({ createdAt: '2026-09-01T00:00:00.000Z' });
    expect(dueForReview(row, '2026-10-01T00:00:00.000Z')).toBe(false);
    expect(dueForReview(row, '2026-10-01T00:00:00.001Z')).toBe(true);
    expect(retryAt(row.createdAt, 1)).toBe('2026-09-01T00:00:01.000Z');
    expect(retryAt(row.createdAt, 99)).toBe('2026-09-01T00:00:30.000Z');
    expect(retryAt(row.createdAt, 1, 9999)).toBe('2026-09-01T00:05:00.000Z');
  });
  it('compares intent objects independent of object key insertion order', () => {
    expect(stableJson({ b: 2, a: { z: 1, y: 'x' } })).toBe(
      stableJson({ a: { y: 'x', z: 1 }, b: 2 }),
    );
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });
  it('rejects cross-session reflection snapshots and requires captured clock identity', () => {
    expect(validateSnapshot(snapshot)).toEqual(snapshot);
    expect(() => validateSnapshot({ ...snapshot, clock: undefined as never })).toThrow();
    expect(() =>
      validateSnapshot({
        ...snapshot,
        reflection: {
          sessionId: crypto.randomUUID(),
          journeyId: snapshot.session.journeyId,
          scheduleVersionId: snapshot.session.scheduleVersionId,
          text: '',
          moods: [],
          revision: 1,
          createdAt: snapshot.clock.serverNow,
          updatedAt: snapshot.clock.serverNow,
        },
      }),
    ).toThrow();
  });
});
