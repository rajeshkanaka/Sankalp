import { z } from 'zod';

const uuidSchema = z.uuid();
const trimmedText = (maximum: number) => z.string().trim().max(maximum);
const requiredTrimmedText = (maximum: number) => trimmedText(maximum).min(1);
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

const uniqueArray = <T>(values: T[]) => new Set(values).size === values.length;

const timeZoneSchema = z.string().refine((timeZone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}, 'Expected an IANA time zone');

const practiceBaseSchema = z.object({
  id: uuidSchema,
  label: requiredTrimmedText(120),
  order: z.int().nonnegative(),
});

const practiceDefinitionSchema = z.discriminatedUnion('kind', [
  practiceBaseSchema.extend({ kind: z.literal('checkbox'), target: z.null() }).strict(),
  practiceBaseSchema
    .extend({ kind: z.literal('repetitions'), target: z.int().min(1).max(1_000_000) })
    .strict(),
  practiceBaseSchema
    .extend({ kind: z.literal('minutes'), target: z.int().min(1).max(1_439) })
    .strict(),
]);

export const scheduleInputSchema = z
  .object({
    startDate: z.iso.date(),
    durationMode: z.enum(['calendar_days', 'occurrences']),
    durationValue: z.int().min(1).max(365),
    weekdays: z
      .array(z.int().min(1).max(7))
      .min(1)
      .max(7)
      .refine(uniqueArray, 'Weekdays must be unique'),
    localTime: localTimeSchema,
    timeZone: timeZoneSchema,
    attribution: z.enum(['civil', 'previous_evening']),
    windowMinutes: z.int().min(1).max(1_439),
  })
  .strict();

const reminderPreferencesSchema = z
  .object({
    enabled: z.boolean(),
    offsets: z
      .array(z.int().min(-1_440).max(0))
      .max(8)
      .refine(uniqueArray, 'Reminder offsets must be unique'),
    quietHours: z.object({ start: localTimeSchema, end: localTimeSchema }).strict().nullable(),
    detailed: z.boolean(),
  })
  .strict();

export const journeyDraftSchema = z
  .object({
    title: requiredTrimmedText(120),
    intention: trimmedText(4_000),
    practices: z
      .array(practiceDefinitionSchema)
      .min(1)
      .max(20)
      .superRefine((practices, context) => {
        const ids = practices.map(({ id }) => id);
        if (!uniqueArray(ids)) {
          context.addIssue({ code: 'custom', message: 'Practice IDs must be unique' });
        }

        const orders = practices.map(({ order }) => order);
        if (!uniqueArray(orders)) {
          context.addIssue({ code: 'custom', message: 'Practice order values must be unique' });
        }
      }),
    schedule: scheduleInputSchema,
    reminders: reminderPreferencesSchema,
  })
  .strict();

export const mutationEnvelopeSchema = <Payload extends z.ZodType>(payloadSchema: Payload) =>
  z
    .object({
      operationId: uuidSchema,
      baseRevision: z.int().nonnegative(),
      payload: payloadSchema,
    })
    .strict();

export const practiceValuesSchema = z
  .object({
    values: z
      .record(uuidSchema, z.union([z.boolean(), z.int().min(0).max(1_000_000)]))
      .refine(
        (values) => Object.keys(values).length > 0,
        'At least one practice value is required',
      ),
  })
  .strict();

export const completionSchema = z
  .object({ performedAt: z.iso.datetime({ offset: true }) })
  .strict();

export const scheduleRevisionCandidateSchema = z.strictObject({
  effectivePracticeDate: z.iso.date(),
  practices: journeyDraftSchema.shape.practices,
  schedule: scheduleInputSchema.omit({ startDate: true }),
});
export const scheduleRevisionRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('preview'),
    baseRevision: z.int().nonnegative(),
    payload: scheduleRevisionCandidateSchema,
  }),
  mutationEnvelopeSchema(
    z.strictObject({
      candidate: scheduleRevisionCandidateSchema,
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ).extend({ mode: z.literal('apply') }),
]);
export const journeyMetadataSchema = journeyDraftSchema.pick({ title: true, intention: true });
export const progressPreferencesSchema = z.strictObject({ hideStreaks: z.boolean() });

const unicodeText = (maximum: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) => Array.from(value).length <= maximum,
      `Use no more than ${maximum} characters`,
    );
export const reflectionPayloadSchema = z.strictObject({
  text: unicodeText(20_000),
  moods: z
    .array(unicodeText(40).refine((value) => value.length > 0, 'Enter a mood'))
    .max(5)
    .refine(uniqueArray, 'Mood tags must be unique'),
});
export const reflectionPreferencesSchema = z.strictObject({
  prompts: z
    .array(z.enum(['noticed', 'carry_tomorrow']))
    .max(2)
    .refine(uniqueArray, 'Prompts must be unique'),
});
export const journalQuerySchema = z
  .strictObject({
    journeyId: uuidSchema.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    mood: unicodeText(40).optional(),
    text: unicodeText(200).optional(),
    cursor: z
      .string()
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    limit: z.int().min(1).max(100).optional(),
  })
  .refine(
    (query) => !query.from || !query.to || query.from <= query.to,
    'Start date must precede end date',
  );
export const completionUndoSchema = z.strictObject({});
