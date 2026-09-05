import { describe, expect, it } from 'vitest';

import type { ScheduleInput } from '../../src/domain/contracts';
import { generateSchedule, previewSchedule } from '../../src/domain/schedule';

function schedule(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    startDate: '2026-09-05',
    durationMode: 'occurrences',
    durationValue: 21,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    localTime: '00:00',
    timeZone: 'Asia/Kolkata',
    attribution: 'previous_evening',
    windowMinutes: 240,
    ...overrides,
  };
}

describe('generateSchedule', () => {
  it('generates the 21-night reference with stable previous-evening practice dates', () => {
    const occurrences = generateSchedule(schedule());

    expect(occurrences).toHaveLength(21);
    expect(occurrences[0]).toEqual({
      ordinal: 1,
      practiceDate: '2026-09-05',
      opensAt: '2026-09-05T18:30:00Z',
      closesAt: '2026-09-05T22:30:00Z',
      adjustment: null,
    });
    expect(occurrences[20]).toMatchObject({
      ordinal: 21,
      practiceDate: '2026-09-25',
      opensAt: '2026-09-25T18:30:00Z',
    });
  });

  it('generates exactly 12 Monday/Thursday occurrences ending 15 October', () => {
    const occurrences = generateSchedule(
      schedule({
        startDate: '2026-09-07',
        durationValue: 12,
        weekdays: [1, 4],
        localTime: '18:30',
        attribution: 'civil',
        windowMinutes: 60,
      }),
    );

    expect(occurrences.map((occurrence) => occurrence.practiceDate)).toEqual([
      '2026-09-07',
      '2026-09-10',
      '2026-09-14',
      '2026-09-17',
      '2026-09-21',
      '2026-09-24',
      '2026-09-28',
      '2026-10-01',
      '2026-10-05',
      '2026-10-08',
      '2026-10-12',
      '2026-10-15',
    ]);
  });

  it('counts only Tuesdays in a 30-calendar-day span', () => {
    const occurrences = generateSchedule(
      schedule({ durationMode: 'calendar_days', durationValue: 30, weekdays: [2] }),
    );

    expect(occurrences.map((occurrence) => occurrence.practiceDate)).toEqual([
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
    ]);
  });

  it('keeps a 06:00 civil practice on its own date', () => {
    const [occurrence] = generateSchedule(
      schedule({
        durationValue: 1,
        localTime: '06:00',
        attribution: 'civil',
        windowMinutes: 60,
      }),
    );

    expect(occurrence).toMatchObject({
      practiceDate: '2026-09-05',
      opensAt: '2026-09-05T00:30:00Z',
    });
  });

  it('moves a nonexistent New York time to the first valid instant after the gap', () => {
    const preview = previewSchedule(
      schedule({
        startDate: '2026-03-08',
        durationValue: 1,
        localTime: '02:30',
        timeZone: 'America/New_York',
        attribution: 'civil',
        windowMinutes: 60,
      }),
      '2026-03-01T00:00:00Z',
    );

    expect(preview.occurrences[0]).toMatchObject({
      opensAt: '2026-03-08T07:00:00Z',
      closesAt: '2026-03-08T07:30:00Z',
    });
    expect(preview.occurrences[0]?.adjustment).toContain('03:00');
    expect(preview.warnings).toHaveLength(1);
  });

  it('chooses the earlier instant when New York repeats 01:30', () => {
    const [occurrence] = generateSchedule(
      schedule({
        startDate: '2026-11-01',
        durationValue: 1,
        localTime: '01:30',
        timeZone: 'America/New_York',
        attribution: 'civil',
        windowMinutes: 60,
      }),
    );

    expect(occurrence?.opensAt).toBe('2026-11-01T05:30:00Z');
    expect(occurrence?.adjustment).toContain('earlier occurrence');
  });

  it('rejects a calendar span with no scheduled weekday', () => {
    expect(() =>
      generateSchedule(
        schedule({ durationMode: 'calendar_days', durationValue: 1, weekdays: [1] }),
      ),
    ).toThrow(/no occurrences/i);
  });

  it('rejects a resolved window that lasts 24 elapsed hours or longer', () => {
    expect(() =>
      generateSchedule(
        schedule({
          startDate: '2026-11-01',
          durationValue: 1,
          localTime: '01:30',
          timeZone: 'America/New_York',
          attribution: 'civil',
          windowMinutes: 1_439,
        }),
      ),
    ).toThrow(/shorter than 24/i);
  });

  it('preserves retained ordinals and counts them toward occurrence duration', () => {
    const retained = [
      {
        ordinal: 4,
        practiceDate: '2026-09-04',
        opensAt: '2026-09-04T00:30:00Z',
        closesAt: '2026-09-04T01:30:00Z',
        adjustment: null,
      },
    ];
    const occurrences = generateSchedule(
      schedule({ durationValue: 3, localTime: '06:00', attribution: 'civil', windowMinutes: 60 }),
      retained,
    );

    expect(occurrences).toHaveLength(3);
    expect(occurrences[0]).toEqual(retained[0]);
    expect(occurrences.slice(1).map(({ ordinal }) => ordinal)).toEqual([5, 6]);
  });

  it('fills the remaining allowance when a retained practice date matches the new recurrence', () => {
    const retained = [
      {
        ordinal: 1,
        practiceDate: '2026-09-05',
        opensAt: '2026-09-05T00:30:00Z',
        closesAt: '2026-09-05T01:30:00Z',
        adjustment: null,
      },
    ];
    const occurrences = generateSchedule(
      schedule({ durationValue: 3, localTime: '06:00', attribution: 'civil', windowMinutes: 60 }),
      retained,
    );

    expect(occurrences.map(({ practiceDate }) => practiceDate)).toEqual([
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ]);
  });
});
