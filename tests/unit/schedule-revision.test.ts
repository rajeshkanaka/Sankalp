import { describe, expect, it } from 'vitest';

import type { PlannedOccurrence, ScheduleRevisionCandidate } from '../../src/domain/contracts';
import { generateScheduleRevision } from '../../src/domain/schedule';

const NOW = '2026-09-06T00:00:00Z';

function candidate(overrides: Partial<ScheduleRevisionCandidate> = {}): ScheduleRevisionCandidate {
  return {
    effectivePracticeDate: '2026-09-07',
    practices: [
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        label: 'Japa',
        order: 0,
        kind: 'repetitions',
        target: 108,
      },
    ],
    schedule: {
      durationMode: 'occurrences',
      durationValue: 4,
      weekdays: [1, 3, 5],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    ...overrides,
  };
}

function retained(
  ordinal: number,
  practiceDate: string,
  opensAt = `${practiceDate}T00:30:00Z`,
): PlannedOccurrence {
  return {
    ordinal,
    practiceDate,
    opensAt,
    closesAt: new Date(Date.parse(opensAt) + 60 * 60_000).toISOString(),
    adjustment: null,
  };
}

describe('generateScheduleRevision', () => {
  it('counts retained sessions toward an occurrence duration and continues stable ordinals', () => {
    const result = generateScheduleRevision(
      '2026-09-05',
      candidate(),
      [retained(1, '2026-09-05'), retained(3, '2026-09-07')],
      NOW,
    );

    expect(result.remainingAllowance).toBe(2);
    expect(result.proposed.map(({ ordinal, practiceDate }) => ({ ordinal, practiceDate }))).toEqual(
      [
        { ordinal: 4, practiceDate: '2026-09-09' },
        { ordinal: 5, practiceDate: '2026-09-11' },
      ],
    );
  });

  it('keeps calendar duration anchored to the original start while applying the effective floor', () => {
    const result = generateScheduleRevision(
      '2026-09-01',
      candidate({
        effectivePracticeDate: '2026-09-07',
        schedule: {
          ...candidate().schedule,
          durationMode: 'calendar_days',
          durationValue: 10,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
        },
      }),
      [retained(1, '2026-09-01')],
      NOW,
    );

    expect(result.proposed.map(({ practiceDate }) => practiceDate)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
    ]);
    expect(result.remainingAllowance).toBe(4);
  });

  it('rejects occurrence reductions below the retained count', () => {
    expect(() =>
      generateScheduleRevision(
        '2026-09-01',
        candidate({ schedule: { ...candidate().schedule, durationValue: 1 } }),
        [retained(1, '2026-09-01'), retained(2, '2026-09-03')],
        NOW,
      ),
    ).toThrow(/retained/i);
  });

  it('rejects a shortened calendar span that would remove retained history', () => {
    expect(() =>
      generateScheduleRevision(
        '2026-09-01',
        candidate({
          schedule: {
            ...candidate().schedule,
            durationMode: 'calendar_days',
            durationValue: 5,
          },
        }),
        [retained(8, '2026-09-08')],
        NOW,
      ),
    ).toThrow(/retained/i);
  });

  it('rejects an effective date before the immutable original start', () => {
    expect(() =>
      generateScheduleRevision(
        '2026-09-05',
        candidate({ effectivePracticeDate: '2026-09-04' }),
        [],
        NOW,
      ),
    ).toThrow(/original start/i);
  });

  it('rejects every proposed session whose opening boundary has arrived', () => {
    expect(() =>
      generateScheduleRevision(
        '2026-09-05',
        candidate({
          effectivePracticeDate: '2026-09-06',
          schedule: {
            ...candidate().schedule,
            durationValue: 1,
            weekdays: [7],
          },
        }),
        [],
        '2026-09-06T00:30:00Z',
      ),
    ).toThrow(/already opened/i);
  });
});
