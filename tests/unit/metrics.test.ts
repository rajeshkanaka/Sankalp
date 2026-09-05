import { describe, expect, it } from 'vitest';

import type { SessionPractice, SessionRecord } from '../../src/domain/contracts';
import { computeMetrics } from '../../src/domain/metrics';
import { deriveStatus, targetsMet } from '../../src/domain/status';

const CHECKBOX_ID = '11111111-1111-4111-8111-111111111111';

function practice(value: boolean | number = false): SessionPractice {
  return { id: CHECKBOX_ID, label: 'Practice', order: 0, kind: 'checkbox', target: null, value };
}

function session(ordinal: number, changes: Partial<SessionRecord> = {}): SessionRecord {
  const day = String(ordinal).padStart(2, '0');
  return {
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
    journeyId: '11111111-1111-4111-8111-111111111111',
    scheduleVersionId: '22222222-2222-4222-8222-222222222222',
    ordinal,
    practiceDate: `2026-09-${day}`,
    opensAt: `2026-09-${day}T00:00:00Z`,
    closesAt: `2026-09-${day}T04:00:00Z`,
    adjustment: null,
    timeZone: 'UTC',
    attribution: 'civil',
    practices: [practice()],
    confirmed: false,
    performedAt: null,
    recordedAt: null,
    revision: 0,
    supersededAt: null,
    ...changes,
  };
}

function complete(ordinal: number, changes: Partial<SessionRecord> = {}): SessionRecord {
  const day = String(ordinal).padStart(2, '0');
  return session(ordinal, {
    practices: [practice(true)],
    confirmed: true,
    performedAt: `2026-09-${day}T01:00:00Z`,
    recordedAt: `2026-09-${day}T01:01:00Z`,
    ...changes,
  });
}

describe('status', () => {
  it('uses an opening-inclusive and closing-exclusive interval', () => {
    const empty = session(5);

    expect(deriveStatus(empty, '2026-09-04T23:59:59Z')).toBe('upcoming');
    expect(deriveStatus(empty, '2026-09-05T00:00:00Z')).toBe('open');
    expect(deriveStatus(empty, '2026-09-05T03:59:59Z')).toBe('open');
    expect(deriveStatus(empty, '2026-09-05T04:00:00Z')).toBe('missed');
  });

  it('keeps numeric progress partial with zero completion credit', () => {
    const partial = session(5, {
      practices: [
        {
          id: CHECKBOX_ID,
          label: 'Meditation',
          order: 0,
          kind: 'minutes',
          target: 20,
          value: 5,
        },
      ],
    });

    expect(targetsMet(partial)).toBe(false);
    expect(deriveStatus(partial, '2026-09-05T04:00:00Z')).toBe('partial');
    expect(computeMetrics([partial], '2026-09-05T04:00:00Z').complete).toBe(0);
  });

  it('requires deliberate confirmation even after every target is met', () => {
    const unconfirmed = session(5, { practices: [practice(true)] });

    expect(targetsMet(unconfirmed)).toBe(true);
    expect(deriveStatus(unconfirmed, '2026-09-05T01:00:00Z')).toBe('partial');
    expect(deriveStatus(complete(5), '2026-09-05T01:00:00Z')).toBe('complete');
  });
});

describe('computeMetrics', () => {
  it('reports 7/21 as 33 percent without partial credit', () => {
    const sessions = Array.from({ length: 21 }, (_, index) =>
      index < 7 ? complete(index + 1) : session(index + 1),
    );
    const metrics = computeMetrics(sessions, '2026-09-07T04:01:00Z');

    expect(metrics).toMatchObject({
      total: 21,
      complete: 7,
      partial: 0,
      missed: 0,
      upcoming: 14,
      open: 0,
      percent: 33,
      onScheduleRatio: 1,
      currentStreak: 7,
      longestStreak: 7,
      ended: false,
      fullyCompleted: false,
    });
  });

  it('distinguishes recorded-later from practiced-late streak credit and excludes canceled rows', () => {
    const recordedLater = complete(1, { recordedAt: '2026-09-02T09:00:00Z' });
    const practicedLate = complete(2, { performedAt: '2026-09-02T04:00:00Z' });
    const third = complete(3);
    const open = session(4);
    const canceled = session(5, { supersededAt: '2026-09-01T00:00:00Z' });

    const beforeOpenCompletion = computeMetrics(
      [recordedLater, practicedLate, third, open, canceled],
      '2026-09-04T01:00:00Z',
    );
    expect(beforeOpenCompletion).toMatchObject({
      total: 4,
      complete: 3,
      open: 1,
      onScheduleRatio: 2 / 3,
      currentStreak: 1,
      longestStreak: 1,
    });

    const completedOpen = complete(4);
    const afterOpenCompletion = computeMetrics(
      [recordedLater, practicedLate, third, completedOpen, canceled],
      '2026-09-04T01:00:00Z',
    );
    expect(afterOpenCompletion).toMatchObject({
      total: 4,
      complete: 4,
      onScheduleRatio: 2 / 3,
      currentStreak: 2,
      longestStreak: 2,
    });
  });

  it('excludes future and open windows from consistency and ends only at the final close', () => {
    const sessions = [complete(1), session(2)];

    expect(computeMetrics(sessions, '2026-09-01T02:00:00Z')).toMatchObject({
      onScheduleRatio: null,
      ended: false,
    });
    expect(computeMetrics(sessions, '2026-09-02T04:00:00Z')).toMatchObject({
      onScheduleRatio: 0.5,
      ended: true,
      fullyCompleted: false,
    });
    expect(computeMetrics([complete(1), complete(2)], '2026-09-02T04:00:00Z')).toMatchObject({
      ended: true,
      fullyCompleted: true,
    });
  });
});
