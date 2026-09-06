import { describe, expect, it } from 'vitest';
import {
  journalQuerySchema,
  reflectionPayloadSchema,
  reflectionPreferencesSchema,
} from '../../src/domain/validation';

const JOURNEY_ID = 'b7000000-0000-4000-8000-000000000001';

describe('private reflection validation', () => {
  it('preserves paragraphs, surrounding whitespace, Unicode and hostile HTML as plain text', () => {
    const text = '\n  Today I returned.\nआज मन शांत है। 🪷\n<script>alert("text")</script>\n\t';
    expect(reflectionPayloadSchema.parse({ text, moods: ['  Calm\t', 'ध्यान'] })).toEqual({
      text,
      moods: ['Calm', 'ध्यान'],
    });
  });

  it.each(['क', '🪷'])('counts %s as one Unicode code point at the 20,000 limit', (character) => {
    const text = character.repeat(20_000);
    expect(reflectionPayloadSchema.parse({ text, moods: [] }).text).toBe(text);
    expect(reflectionPayloadSchema.safeParse({ text: text + character, moods: [] }).success).toBe(
      false,
    );
  });

  it('counts surrounding whitespace instead of trimming an over-limit reflection into validity', () => {
    expect(
      reflectionPayloadSchema.safeParse({ text: ` ${'x'.repeat(20_000)}`, moods: [] }).success,
    ).toBe(false);
    expect(reflectionPayloadSchema.parse({ text: '', moods: [] })).toEqual({ text: '', moods: [] });
  });

  it.each(['\u0000', '\ud800', '\udfff'])(
    'rejects a character PostgreSQL cannot preserve (%j)',
    (invalid) => {
      expect(
        reflectionPayloadSchema.safeParse({ text: `before${invalid}after`, moods: [] }).success,
      ).toBe(false);
      expect(
        reflectionPayloadSchema.safeParse({ text: '', moods: [`Calm${invalid}`] }).success,
      ).toBe(false);
    },
  );

  it('allows five distinct trimmed mood labels and rejects a sixth or a duplicate after trimming', () => {
    const moods = ['Calm', 'Focused', 'Tired', 'Grateful', 'ध्यान'];
    expect(reflectionPayloadSchema.parse({ text: '', moods }).moods).toEqual(moods);
    for (const invalid of [[...moods, 'Quiet'], ['Calm', '\tCalm\u00a0'], ['\n\uFEFF']]) {
      expect(reflectionPayloadSchema.safeParse({ text: '', moods: invalid }).success).toBe(false);
    }
  });

  it('uses the same 40-code-point mood limit for BMP and astral labels', () => {
    const mood = '🪷'.repeat(40);
    expect(reflectionPayloadSchema.parse({ text: '', moods: [mood] }).moods).toEqual([mood]);
    expect(reflectionPayloadSchema.safeParse({ text: '', moods: [mood + '🪷'] }).success).toBe(
      false,
    );
  });

  it('rejects unknown fields and non-text reflection data', () => {
    for (const input of [
      { text: '', moods: [], ownerId: JOURNEY_ID },
      { text: null, moods: [] },
      { text: '', moods: 'Calm' },
      { text: '', moods: [7] },
    ])
      expect(reflectionPayloadSchema.safeParse(input).success).toBe(false);
  });

  it('keeps reflection prompts optional, bounded and unique', () => {
    expect(reflectionPreferencesSchema.parse({ prompts: [] })).toEqual({ prompts: [] });
    expect(
      reflectionPreferencesSchema.parse({ prompts: ['noticed', 'carry_tomorrow'] }).prompts,
    ).toHaveLength(2);
    for (const prompts of [
      ['noticed', 'noticed'],
      ['unknown'],
      ['noticed', 'carry_tomorrow', 'noticed'],
    ]) {
      expect(reflectionPreferencesSchema.safeParse({ prompts }).success).toBe(false);
    }
  });
});

describe('bounded private journal query validation', () => {
  it('accepts empty filters and a valid leap-day range with bounded opaque cursor syntax', () => {
    expect(journalQuerySchema.parse({})).toEqual({});
    expect(
      journalQuerySchema.parse({
        journeyId: JOURNEY_ID,
        from: '2028-02-29',
        to: '2028-03-01',
        mood: '\tCalm\n',
        text: '  आज मन  ',
        cursor: 'Abc_123-xyz',
        limit: 100,
      }),
    ).toEqual({
      journeyId: JOURNEY_ID,
      from: '2028-02-29',
      to: '2028-03-01',
      mood: 'Calm',
      text: 'आज मन',
      cursor: 'Abc_123-xyz',
      limit: 100,
    });
  });

  it.each([
    ['malformed journey ID', { journeyId: 'someone-else' }],
    ['invalid calendar date', { from: '2026-02-29' }],
    ['timestamp instead of date', { to: '2026-09-06T00:00:00Z' }],
    ['reversed range', { from: '2026-09-07', to: '2026-09-06' }],
    ['zero limit', { limit: 0 }],
    ['excessive limit', { limit: 101 }],
    ['fractional limit', { limit: 1.5 }],
    ['string limit', { limit: '10' }],
    ['empty cursor', { cursor: '' }],
    ['oversized cursor', { cursor: 'a'.repeat(513) }],
    ['non-base64url cursor', { cursor: 'abc+/=' }],
    ['unknown filter', { ownerId: JOURNEY_ID }],
    ['oversized mood', { mood: '🪷'.repeat(41) }],
    ['oversized search', { text: '🪷'.repeat(201) }],
    ['NUL search', { text: 'private\u0000' }],
    ['ill-formed search', { mood: '\ud800' }],
  ])('rejects %s', (_name, input) => {
    expect(journalQuerySchema.safeParse(input).success).toBe(false);
  });

  it('allows exactly 200 code points of search text', () => {
    const text = '🪷'.repeat(200);
    expect(journalQuerySchema.parse({ text, limit: 1 }).text).toBe(text);
  });
});
