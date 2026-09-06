import { describe, expect, it } from 'vitest';

import {
  completionSchema,
  journeyDraftSchema,
  mutationEnvelopeSchema,
  practiceValuesSchema,
} from '../../src/domain/validation';

const CHECKBOX_ID = '11111111-1111-4111-8111-111111111111';
const MINUTES_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

function validDraft() {
  return {
    title: '  Morning ध्यान  ',
    intention: '  Begin with attention.  ',
    practices: [
      { id: CHECKBOX_ID, label: '  Puja  ', order: 0, kind: 'checkbox', target: null },
      { id: MINUTES_ID, label: 'Meditation', order: 1, kind: 'minutes', target: 20 },
    ],
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 21,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: {
      enabled: false,
      offsets: [-120, -30, 0],
      quietHours: { start: '21:00', end: '23:00' },
      detailed: false,
    },
  };
}

describe('journeyDraftSchema', () => {
  it('trims surrounding text while preserving Unicode and valid typed practices', () => {
    const parsed = journeyDraftSchema.parse(validDraft());

    expect(parsed.title).toBe('Morning ध्यान');
    expect(parsed.intention).toBe('Begin with attention.');
    expect(parsed.practices[0]?.label).toBe('Puja');
    expect(parsed.practices[1]).toMatchObject({ kind: 'minutes', target: 20 });
  });

  it.each([
    ['blank title', { title: '   ' }],
    ['title over 120 characters', { title: 'x'.repeat(121) }],
    ['intention over 4,000 characters', { intention: 'x'.repeat(4_001) }],
    ['empty practices', { practices: [] }],
    [
      'more than 20 practices',
      {
        practices: Array.from({ length: 21 }, (_, order) => ({
          id: `${String(order).padStart(8, '0')}-1111-4111-8111-111111111111`,
          label: `Practice ${order}`,
          order,
          kind: 'checkbox',
          target: null,
        })),
      },
    ],
  ])('rejects the D04 text/list limit: %s', (_name, change) => {
    expect(journeyDraftSchema.safeParse({ ...validDraft(), ...change }).success).toBe(false);
  });

  it.each([
    ['zero duration', { durationValue: 0 }],
    ['duration above 365', { durationValue: 366 }],
    ['an invalid ISO weekday', { weekdays: [0, 2] }],
    ['duplicate weekdays', { weekdays: [1, 1] }],
    ['an invalid local time', { localTime: '24:00' }],
    ['an invalid IANA timezone', { timeZone: 'Moon/Sea_of_Tranquility' }],
    ['a zero-minute window', { windowMinutes: 0 }],
    ['a 24-hour window', { windowMinutes: 1_440 }],
  ])('rejects the schedule limit: %s', (_name, scheduleChange) => {
    const input = validDraft();
    input.schedule = { ...input.schedule, ...scheduleChange } as typeof input.schedule;

    expect(journeyDraftSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ['malformed practice UUID', { id: 'practice-1' }],
    ['zero repetitions', { kind: 'repetitions', target: 0 }],
    ['repetitions above 1,000,000', { kind: 'repetitions', target: 1_000_001 }],
    ['minutes above 1,439', { kind: 'minutes', target: 1_440 }],
  ])('rejects the practice constraint: %s', (_name, practiceChange) => {
    const input = validDraft();
    input.practices[1] = {
      ...input.practices[1],
      ...practiceChange,
    } as (typeof input.practices)[1];

    expect(journeyDraftSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ['duplicate offsets', [-30, -30]],
    ['offset before the supported range', [-1_441]],
    ['positive offset', [1]],
    ['more than eight offsets', [-80, -70, -60, -50, -40, -30, -20, -10, 0]],
  ])('rejects reminder %s', (_name, offsets) => {
    const input = validDraft();
    input.reminders.offsets = offsets;

    expect(journeyDraftSchema.safeParse(input).success).toBe(false);
  });
});

describe('mutation payload schemas', () => {
  it('accepts UUID-keyed typed values in a revision envelope', () => {
    const parsed = mutationEnvelopeSchema(practiceValuesSchema).parse({
      operationId: OPERATION_ID,
      baseRevision: 4,
      payload: { values: { [CHECKBOX_ID]: true, [MINUTES_ID]: 5 } },
    });

    expect(parsed.payload.values).toEqual({ [CHECKBOX_ID]: true, [MINUTES_ID]: 5 });
  });

  it.each([
    ['a malformed operation UUID', { operationId: 'retry-one' }],
    ['a negative base revision', { baseRevision: -1 }],
    ['a malformed practice UUID', { payload: { values: { practice: true } } }],
    ['an empty values record', { payload: { values: {} } }],
    ['a negative numeric value', { payload: { values: { [MINUTES_ID]: -1 } } }],
    ['a numeric value over 1,000,000', { payload: { values: { [MINUTES_ID]: 1_000_001 } } }],
    ['a fractional numeric value', { payload: { values: { [MINUTES_ID]: 1.5 } } }],
  ])('rejects %s', (_name, change) => {
    const envelope = {
      operationId: OPERATION_ID,
      baseRevision: 0,
      payload: { values: { [CHECKBOX_ID]: true } },
      ...change,
    };

    expect(mutationEnvelopeSchema(practiceValuesSchema).safeParse(envelope).success).toBe(false);
  });

  it('requires an ISO datetime with an offset for completion', () => {
    expect(completionSchema.parse({ performedAt: '2026-09-05T06:15:00+05:30' })).toEqual({
      performedAt: '2026-09-05T06:15:00+05:30',
    });
    expect(completionSchema.safeParse({ performedAt: '2026-09-05 06:15' }).success).toBe(false);
  });
});
