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
