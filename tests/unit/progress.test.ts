import { describe, expect, it } from 'vitest';
import type { JourneyRecord, JourneyView, SessionRecord } from '../../src/domain/contracts';
import { deriveCompletionTiming, deriveStatus } from '../../src/domain/status';
import { computeMetrics } from '../../src/domain/metrics';
import { journeyProgressItem, sessionListItem } from '../../src/domain/progress';
import { validateCalendarRange } from '../../src/server/progress/service';

function session(day: number, changes: Partial<SessionRecord> = {}): SessionRecord {
  const date = `2026-09-${String(day).padStart(2, '0')}`;
  return {
    id: `00000000-0000-4000-8000-${String(day).padStart(12, '0')}`,
    journeyId: '10000000-0000-4000-8000-000000000001',
    scheduleVersionId: '20000000-0000-4000-8000-000000000001',
    ordinal: day,
    practiceDate: date,
    opensAt: `${date}T00:00:00Z`,
    closesAt: `${date}T04:00:00Z`,
    adjustment: null,
    timeZone: 'UTC',
    attribution: 'civil',
    practices: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        label: 'Meditation',
        order: 0,
        kind: 'minutes',
        target: 20,
        value: 0,
      },
    ],
    confirmed: false,
    performedAt: null,
    recordedAt: null,
    revision: 0,
    supersededAt: null,
    ...changes,
  };
}

function complete(day: number, changes: Partial<SessionRecord> = {}) {
  const base = session(day);
  return session(day, {
    practices: base.practices.map((practice) => ({ ...practice, value: 20 })),
    confirmed: true,
    performedAt: base.opensAt,
    recordedAt: base.opensAt,
    ...changes,
  });
}

const journey: JourneyRecord = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'My practice',
  intention: '',
  practices: [],
  schedule: {
    startDate: '2026-09-01',
    durationMode: 'occurrences',
    durationValue: 21,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    localTime: '00:00',
    timeZone: 'UTC',
    attribution: 'civil',
    windowMinutes: 240,
  },
  reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  state: 'active',
  revision: 0,
  activeScheduleVersionId: '20000000-0000-4000-8000-000000000001',
  createdAt: '2026-09-01T00:00:00Z',
};

describe('progress timing and projection', () => {
  it('keeps practiced-late and recorded-later independent at the closing boundary', () => {
    expect(deriveCompletionTiming(complete(1, { recordedAt: '2026-09-01T04:00:00Z' }))).toEqual({
      practiceTiming: 'on_schedule',
      recordedLater: true,
    });
    expect(
      deriveCompletionTiming(
        complete(1, { performedAt: '2026-09-01T04:00:00Z', recordedAt: '2026-09-01T05:00:00Z' }),
      ),
    ).toEqual({ practiceTiming: 'practiced_late', recordedLater: true });
    expect(deriveCompletionTiming(complete(1, { recordedAt: '2026-09-01T03:59:59Z' }))).toEqual({
      practiceTiming: 'on_schedule',
      recordedLater: false,
    });
    expect(deriveCompletionTiming(session(1))).toEqual({
      practiceTiming: null,
      recordedLater: false,
    });
  });

  it('projects an overnight session onto its stored practice date regardless of civil time', () => {
    const overnight = complete(5, {
      practiceDate: '2026-09-05',
      opensAt: '2026-09-05T18:30:00Z',
      closesAt: '2026-09-05T22:30:00Z',
      performedAt: '2026-09-05T18:45:00Z',
      recordedAt: '2026-09-05T18:45:00Z',
      timeZone: 'Asia/Kolkata',
      attribution: 'previous_evening',
    });
    expect(sessionListItem(overnight, 'Evening practice', '2026-09-05T18:45:00Z')).toMatchObject({
      practiceDate: '2026-09-05',
      status: 'complete',
      journeyTitle: 'Evening practice',
      attribution: 'previous_evening',
      practiceTiming: 'on_schedule',
      windowClosed: false,
    });
  });

  it('partitions zero and numeric partial values at the exact deadline', () => {
    const empty = session(1);
    const partial = session(2, {
      practices: session(2).practices.map((practice) => ({ ...practice, value: 5 })),
    });
    expect(sessionListItem(partial, 'Practice', partial.closesAt)).toMatchObject({
      status: 'partial',
      windowClosed: true,
    });
    expect(deriveStatus(empty, empty.closesAt)).toBe('missed');
    expect(
      computeMetrics([empty, partial, complete(3), session(4)], '2026-09-03T01:00:00Z'),
    ).toMatchObject({
      total: 4,
      missed: 1,
      partial: 1,
      complete: 1,
      upcoming: 1,
      open: 0,
      percent: 25,
    });
  });

  it('keeps unscheduled weekdays out of streaks and recomputes after historical correction', () => {
    const monday = complete(7);
    const thursday = complete(10, { ordinal: 2 });
    const lateMonday = complete(14, {
      ordinal: 3,
      performedAt: '2026-09-14T05:00:00Z',
      recordedAt: '2026-09-14T05:00:00Z',
    });
    expect(computeMetrics([monday, thursday, lateMonday], '2026-09-15T00:00:00Z')).toMatchObject({
      currentStreak: 0,
      longestStreak: 2,
      onScheduleRatio: 2 / 3,
    });
    expect(
      computeMetrics(
        [monday, thursday, { ...lateMonday, performedAt: '2026-09-14T01:00:00Z' }],
        '2026-09-15T00:00:00Z',
      ),
    ).toMatchObject({ currentStreak: 3, longestStreak: 3, onScheduleRatio: 1 });
  });

  it('shows ended 20/21 without extending the schedule, and fully completed 21/21', () => {
    const sessions = Array.from({ length: 21 }, (_, index) =>
      index === 20 ? session(21) : complete(index + 1),
    );
    expect(computeMetrics(sessions, '2026-09-21T04:00:00Z')).toMatchObject({
      total: 21,
      complete: 20,
      percent: 95,
      ended: true,
      fullyCompleted: false,
      missed: 1,
    });
    expect(
      computeMetrics([...sessions.slice(0, 20), complete(21)], '2026-09-21T04:00:00Z'),
    ).toMatchObject({ total: 21, complete: 21, percent: 100, ended: true, fullyCompleted: true });
  });

  it('keeps the completed open occurrence current then advances at closing, excluding superseded rows', () => {
    const sessions = [
      complete(1),
      session(2),
      session(3, { supersededAt: '2026-09-01T00:00:00Z' }),
    ];
    const view = (now: string): JourneyView => ({
      journey,
      sessions,
      now,
      metrics: computeMetrics(sessions, now),
    });
    expect(journeyProgressItem(view('2026-09-01T03:59:59Z'))).toMatchObject({
      current: { id: sessions[0].id },
      next: { id: sessions[1].id },
      metrics: { total: 2 },
    });
    const closed = journeyProgressItem(view('2026-09-01T04:00:00Z'));
    expect(closed.current?.id).toBe(sessions[1].id);
    expect(closed.timeline).toHaveLength(2);
  });
});

describe('calendar range boundaries', () => {
  it('accepts one through forty-two inclusive days including a year boundary', () => {
    expect(validateCalendarRange({ from: '2026-12-15', to: '2027-01-25' })).toEqual({
      from: '2026-12-15',
      to: '2027-01-25',
    });
    expect(validateCalendarRange({ from: '2026-09-05', to: '2026-09-05' })).toBeTruthy();
  });
  it.each([
    { from: '2026-09-05', to: '2026-09-04' },
    { from: '2026-09-01', to: '2026-10-13' },
    { from: '2026-02-30', to: '2026-03-02' },
    { from: '2026-09-01', to: '2026-09-30', journeyId: 'not-a-uuid' },
  ])('rejects an invalid or oversized range before accessing the database: %j', (input) => {
    expect(() => validateCalendarRange(input)).toThrow();
  });
});
