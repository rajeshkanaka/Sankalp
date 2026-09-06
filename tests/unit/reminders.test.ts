import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';

import type { ReminderPreferences } from '../../src/domain/contracts';
import {
  planSessionReminders,
  planSnooze,
  quietHoursContain,
  reminderPreferencesSchema,
  type ReminderSession,
} from '../../src/domain/reminders';

function preferences(overrides: Partial<ReminderPreferences> = {}): ReminderPreferences {
  return { enabled: true, offsets: [-15, 0], quietHours: null, detailed: false, ...overrides };
}

function session(overrides: Partial<ReminderSession> = {}): ReminderSession {
  return {
    opensAt: '2026-09-06T10:00:00Z',
    closesAt: '2026-09-06T11:00:00Z',
    timeZone: 'UTC',
    confirmed: false,
    supersededAt: null,
    ...overrides,
  };
}

describe('reminderPreferencesSchema', () => {
  it.each([
    { enabled: false, offsets: [] },
    { enabled: false, offsets: [-120, -30, -5, 0] },
    { enabled: true, offsets: [-1440, -120, -60, -30, -15, -10, -5, 0] },
    { enabled: true, offsets: [0], quietHours: { start: '22:00', end: '06:00' }, detailed: true },
  ])('preserves explicitly chosen valid preferences: %j', (overrides) => {
    const value = preferences(overrides);
    expect(reminderPreferencesSchema.parse(value)).toEqual(value);
  });

  it.each([
    ['enabled without offsets', { offsets: [] }],
    ['duplicate offsets', { offsets: [-15, -15] }],
    ['more than eight offsets', { offsets: [-8, -7, -6, -5, -4, -3, -2, -1, 0] }],
    ['more than one day before', { offsets: [-1441] }],
    ['after opening', { offsets: [1] }],
    ['fractional minute', { offsets: [-0.5] }],
    ['string offset', { offsets: ['-15'] }],
    ['null offset', { offsets: [null] }],
    ['infinite offset', { offsets: [-Infinity] }],
    ['not a number', { offsets: [NaN] }],
    ['boolean offset', { offsets: [false] }],
    ['offset list missing', { offsets: undefined }],
    ['enabled string', { enabled: 'true' }],
    ['enabled missing', { enabled: undefined }],
    ['detailed number', { detailed: 0 }],
    ['detailed missing', { detailed: undefined }],
    ['unknown preference', { unexpected: true }],
    ['equal quiet bounds', { quietHours: { start: '09:00', end: '09:00' } }],
    ['unknown quiet field', { quietHours: { start: '21:00', end: '06:00', shift: true } }],
    ['quiet hour 24', { quietHours: { start: '24:00', end: '06:00' } }],
    ['quiet minute 60', { quietHours: { start: '21:60', end: '06:00' } }],
    ['quiet seconds', { quietHours: { start: '21:00:00', end: '06:00' } }],
    ['quiet hour not padded', { quietHours: { start: '9:00', end: '06:00' } }],
    ['quiet whitespace', { quietHours: { start: ' 21:00', end: '06:00' } }],
    ['quiet end missing', { quietHours: { start: '21:00' } }],
  ])('rejects %s without coercion', (_label, overrides) => {
    expect(reminderPreferencesSchema.safeParse({ ...preferences(), ...overrides }).success).toBe(
      false,
    );
  });

  it('also validates disabled suggestions instead of hiding invalid future settings', () => {
    expect(
      reminderPreferencesSchema.safeParse(preferences({ enabled: false, offsets: [0, 0] })).success,
    ).toBe(false);
  });
});

describe('quietHoursContain', () => {
  it('treats null quiet hours as off', () => {
    expect(quietHoursContain('2026-09-05T18:30:00Z', 'Asia/Kolkata', null)).toBe(false);
  });

  it.each([
    ['2026-09-06T03:29:59.999999999Z', false],
    ['2026-09-06T03:30:00Z', true],
    ['2026-09-06T11:29:59.999999999Z', true],
    ['2026-09-06T11:30:00Z', false],
  ])('uses inclusive start/exclusive end at %s', (instant, expected) => {
    expect(quietHoursContain(instant, 'Asia/Kolkata', { start: '09:00', end: '17:00' })).toBe(
      expected,
    );
  });

  it.each([
    ['2026-09-05T15:29:59Z', false],
    ['2026-09-05T15:30:00Z', true],
    ['2026-09-05T18:30:00Z', true],
    ['2026-09-06T00:29:59Z', true],
    ['2026-09-06T00:30:00Z', false],
  ])('wraps midnight without changing the intended date at %s', (instant, expected) => {
    expect(quietHoursContain(instant, 'Asia/Kolkata', { start: '21:00', end: '06:00' })).toBe(
      expected,
    );
  });

  it.each([
    ['2026-03-08T06:59:59Z', false], // 01:59:59 before the spring gap.
    ['2026-03-08T07:00:00Z', true], // 03:00 after the spring gap.
    ['2026-03-08T07:30:00Z', false],
  ])('checks the actual spring-transition clock at %s', (instant, expected) => {
    expect(quietHoursContain(instant, 'America/New_York', { start: '02:30', end: '03:30' })).toBe(
      expected,
    );
  });

  it.each([
    ['2026-11-01T05:30:00Z', true], // First 01:30, EDT.
    ['2026-11-01T06:30:00Z', true], // Second 01:30, EST.
    ['2026-11-01T07:00:00Z', false],
  ])('checks either occurrence of a repeated wall time at %s', (instant, expected) => {
    expect(quietHoursContain(instant, 'America/New_York', { start: '01:00', end: '02:00' })).toBe(
      expected,
    );
  });

  it('rejects equal bounds when called directly', () => {
    expect(() =>
      quietHoursContain('2026-09-06T10:00:00Z', 'UTC', { start: '00:00', end: '00:00' }),
    ).toThrow();
  });
});

describe('planSessionReminders', () => {
  it('preserves A02 midnight dates and sorts without mutating configured offsets', () => {
    const prefs = preferences({ offsets: [0, -5, -120, -30] });
    const original = structuredClone(prefs);
    const planned = planSessionReminders(
      session({
        opensAt: '2026-09-05T18:30:00Z',
        closesAt: '2026-09-05T22:30:00Z',
        timeZone: 'Asia/Kolkata',
      }),
      prefs,
      '2026-09-05T16:29:50Z',
    );
    expect(planned).toEqual([
      {
        offsetMinutes: -120,
        scheduledAt: '2026-09-05T16:30:00Z',
        expiresAt: '2026-09-05T16:35:00Z',
        suppressionReason: null,
      },
      {
        offsetMinutes: -30,
        scheduledAt: '2026-09-05T18:00:00Z',
        expiresAt: '2026-09-05T18:05:00Z',
        suppressionReason: null,
      },
      {
        offsetMinutes: -5,
        scheduledAt: '2026-09-05T18:25:00Z',
        expiresAt: '2026-09-05T18:30:00Z',
        suppressionReason: null,
      },
      {
        offsetMinutes: 0,
        scheduledAt: '2026-09-05T18:30:00Z',
        expiresAt: '2026-09-05T18:35:00Z',
        suppressionReason: null,
      },
    ]);
    expect(
      planned.map(({ scheduledAt }) =>
        Temporal.Instant.from(scheduledAt)
          .toZonedDateTimeISO('Asia/Kolkata')
          .toPlainDateTime()
          .toString({ smallestUnit: 'minute' }),
      ),
    ).toEqual(['2026-09-05T22:00', '2026-09-05T23:30', '2026-09-05T23:55', '2026-09-06T00:00']);
    expect(prefs).toEqual(original);
  });

  it('retains disabled suggestions with an explicit reason, or returns no items for no offsets', () => {
    const planned = planSessionReminders(
      session(),
      preferences({ enabled: false }),
      '2026-09-06T09:00:00Z',
    );
    expect(planned.map(({ suppressionReason }) => suppressionReason)).toEqual([
      'disabled',
      'disabled',
    ]);
    expect(planned[0]?.scheduledAt).toBe('2026-09-06T09:45:00Z');
    expect(
      planSessionReminders(
        session(),
        preferences({ enabled: false, offsets: [] }),
        '2026-09-06T09:00:00Z',
      ),
    ).toEqual([]);
  });

  it.each([
    ['2026-09-06T09:44:59.999999999Z', [null, null]],
    ['2026-09-06T09:45:00Z', ['past', null]],
    ['2026-09-06T10:00:00Z', ['past', 'past']],
  ])('never schedules an exact-now or past offset at %s', (now, reasons) => {
    expect(
      planSessionReminders(session(), preferences(), now).map((item) => item.suppressionReason),
    ).toEqual(reasons);
  });

  it.each([
    [{ confirmed: true }, 'completed'],
    [{ supersededAt: '2026-09-06T08:00:00Z' }, 'superseded'],
  ] as const)('suppresses an ineligible session %j', (overrides, reason) => {
    expect(
      planSessionReminders(session(overrides), preferences(), '2026-09-06T09:00:00Z').map(
        (item) => item.suppressionReason,
      ),
    ).toEqual([reason, reason]);
  });

  it('suppresses quiet reminders without moving their times or the others', () => {
    const planned = planSessionReminders(
      session(),
      preferences({ quietHours: { start: '09:30', end: '10:00' } }),
      '2026-09-06T09:00:00Z',
    );
    expect(
      planned.map(({ scheduledAt, suppressionReason }) => ({ scheduledAt, suppressionReason })),
    ).toEqual([
      { scheduledAt: '2026-09-06T09:45:00Z', suppressionReason: 'quiet_hours' },
      { scheduledAt: '2026-09-06T10:00:00Z', suppressionReason: null },
    ]);
  });

  it('caps the five-minute expiry at the actual session close', () => {
    expect(
      planSessionReminders(
        session({ closesAt: '2026-09-06T10:02:00Z' }),
        preferences({ offsets: [0] }),
        '2026-09-06T09:00:00Z',
      )[0]?.expiresAt,
    ).toBe('2026-09-06T10:02:00Z');
  });

  it('subtracts elapsed minutes across the spring DST gap', () => {
    const planned = planSessionReminders(
      session({
        opensAt: '2026-03-08T07:00:00Z',
        closesAt: '2026-03-08T08:00:00Z',
        timeZone: 'America/New_York',
      }),
      preferences({ offsets: [-30, 0], quietHours: { start: '01:00', end: '02:00' } }),
      '2026-03-08T06:00:00Z',
    );
    expect(
      planned.map(({ scheduledAt, suppressionReason }) => ({ scheduledAt, suppressionReason })),
    ).toEqual([
      { scheduledAt: '2026-03-08T06:30:00Z', suppressionReason: 'quiet_hours' },
      { scheduledAt: '2026-03-08T07:00:00Z', suppressionReason: null },
    ]);
  });

  it('rejects invalid preferences and nonpositive session windows instead of returning eligible jobs', () => {
    expect(() =>
      planSessionReminders(session(), preferences({ offsets: [1] }), '2026-09-06T09:00:00Z'),
    ).toThrow();
    expect(() =>
      planSessionReminders(
        session({ closesAt: '2026-09-06T10:00:00Z' }),
        preferences(),
        '2026-09-06T09:00:00Z',
      ),
    ).toThrow('The session must close after it opens');
  });
});

describe('planSnooze', () => {
  it.each([
    ['2026-09-06T09:59:59.999999999Z', 'not_open'],
    ['2026-09-06T10:50:00Z', 'deadline'],
    ['2026-09-06T10:59:59Z', 'deadline'],
    ['2026-09-06T11:00:00Z', 'window_closed'],
    ['2026-09-06T11:00:01Z', 'window_closed'],
  ])('rejects an unavailable snooze at %s', (now, reason) => {
    expect(planSnooze(session(), preferences(), now)).toEqual({ eligible: false, reason });
  });

  it('allows snooze exactly at opening with a five-minute expiry', () => {
    expect(planSnooze(session(), preferences(), '2026-09-06T10:00:00Z')).toEqual({
      eligible: true,
      scheduledAt: '2026-09-06T10:10:00Z',
      expiresAt: '2026-09-06T10:15:00Z',
    });
  });

  it('allows a target just before closing but caps expiry at closing', () => {
    expect(planSnooze(session(), preferences(), '2026-09-06T10:49:59.999999999Z')).toEqual({
      eligible: true,
      scheduledAt: '2026-09-06T10:59:59.999999999Z',
      expiresAt: '2026-09-06T11:00:00Z',
    });
  });

  it.each([
    [session(), preferences({ enabled: false }), 'disabled'],
    [session({ confirmed: true }), preferences(), 'completed'],
    [session({ supersededAt: '2026-09-06T09:00:00Z' }), preferences(), 'superseded'],
  ] as const)('rejects inactive reminder state %#', (current, prefs, reason) => {
    expect(planSnooze(current, prefs, '2026-09-06T10:00:00Z')).toEqual({ eligible: false, reason });
  });

  it.each([
    ['2026-09-05T18:20:00Z', { eligible: false, reason: 'quiet_hours' }],
    ['2026-09-05T18:25:00Z', { eligible: false, reason: 'quiet_hours' }],
    [
      '2026-09-05T18:30:00Z',
      { eligible: true, scheduledAt: '2026-09-05T18:40:00Z', expiresAt: '2026-09-05T18:45:00Z' },
    ],
  ])('checks the target civil date and exclusive quiet-hours end at %s', (now, expected) => {
    expect(
      planSnooze(
        session({
          opensAt: '2026-09-05T18:20:00Z',
          closesAt: '2026-09-05T19:30:00Z',
          timeZone: 'Asia/Kolkata',
        }),
        preferences({ quietHours: { start: '00:00', end: '00:10' } }),
        now,
      ),
    ).toEqual(expected);
  });

  it.each([
    ['2026-03-08T06:55:00Z', '2026-03-08T07:05:00Z'],
    ['2026-11-01T05:55:00Z', '2026-11-01T06:05:00Z'],
  ])('adds ten elapsed minutes through DST at %s', (now, scheduledAt) => {
    const current = session({
      opensAt: now,
      closesAt: Temporal.Instant.from(now).add({ hours: 1 }).toString(),
      timeZone: 'America/New_York',
    });
    expect(planSnooze(current, preferences(), now)).toEqual({
      eligible: true,
      scheduledAt,
      expiresAt: Temporal.Instant.from(scheduledAt).add({ minutes: 5 }).toString(),
    });
  });

  it('evaluates fall-back quiet hours at the target, not at the request wall time', () => {
    expect(
      planSnooze(
        session({
          opensAt: '2026-11-01T05:00:00Z',
          closesAt: '2026-11-01T07:00:00Z',
          timeZone: 'America/New_York',
        }),
        preferences({ quietHours: { start: '01:00', end: '01:30' } }),
        '2026-11-01T05:55:00Z',
      ),
    ).toEqual({ eligible: false, reason: 'quiet_hours' });
  });
});
