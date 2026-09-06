import { z } from 'zod';
import type { MutationEnvelope, ReminderPreferences } from '../../../domain/contracts';
import type { ReminderPreferenceView } from '../../../domain/reminder-contracts';
import { reminderPreferencesSchema } from '../../../domain/reminders';

export interface PreferenceFields {
  enabled: boolean;
  offsets: string[];
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  detailed: boolean;
}
export interface FieldIssue {
  field: string;
  message: string;
}

export function fieldsFromPreferences(preferences: ReminderPreferences): PreferenceFields {
  return {
    enabled: preferences.enabled,
    offsets: preferences.offsets.map((offset) => String(-offset)),
    quietEnabled: preferences.quietHours !== null,
    quietStart: preferences.quietHours?.start ?? '',
    quietEnd: preferences.quietHours?.end ?? '',
    detailed: preferences.detailed,
  };
}

export function validateFields(
  fields: PreferenceFields,
): { success: true; preferences: ReminderPreferences } | { success: false; issues: FieldIssue[] } {
  // Text controls retain incomplete input. Only whole-minute text reaches the shared schema.
  const result = reminderPreferencesSchema.safeParse({
    enabled: fields.enabled,
    offsets: fields.offsets.map((value) => {
      if (!/^\d+$/.test(value)) return NaN;
      const minutes = Number(value);
      return minutes === 0 ? 0 : -minutes;
    }),
    quietHours: fields.quietEnabled ? { start: fields.quietStart, end: fields.quietEnd } : null,
    detailed: fields.detailed,
  });
  if (result.success) return { success: true, preferences: result.data };
  return {
    success: false,
    issues: result.error.issues.map((issue) => {
      const field = issue.path.join('.');
      let message = issue.message;
      if (field.startsWith('offsets.'))
        message = `Reminder ${Number(issue.path[1]) + 1}: enter a whole number from 0 to 1440 minutes.`;
      else if (field === 'offsets') {
        message = !fields.offsets.length
          ? 'Add at least one reminder time before enabling reminders.'
          : fields.offsets.length > 8
            ? 'Choose up to eight reminder times.'
            : 'Choose a different time for each reminder.';
      } else if (field.startsWith('quietHours.'))
        message =
          /^\d{2}:\d{2}$/.test(fields.quietStart) && fields.quietStart === fields.quietEnd
            ? 'Quiet hours must start and end at different times.'
            : `Quiet hours ${String(issue.path[1])}: use the 24-hour HH:mm format.`;
      return { field, message };
    }),
  };
}

/** Retained privately; callers receive a clone so they cannot alter a later retry. */
export function createReminderAttempt(
  preferences: ReminderPreferences,
  baseRevision: number,
  operationId: string,
): MutationEnvelope<ReminderPreferences> {
  const payload = reminderPreferencesSchema.parse(preferences);
  Object.freeze(payload.offsets);
  if (payload.quietHours) Object.freeze(payload.quietHours);
  Object.freeze(payload);
  return Object.freeze({ operationId, baseRevision, payload });
}

const viewSchema = z.object({
  journeyId: z.uuid(),
  journeyTitle: z.string(),
  revision: z.int().nonnegative(),
  preferences: reminderPreferencesSchema,
  preview: z.array(
    z.object({
      sessionId: z.uuid(),
      practiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeZone: z.string(),
      offsetMinutes: z.int().min(-1440).max(0),
      scheduledAt: z.iso.datetime({ offset: true }),
      expiresAt: z.iso.datetime({ offset: true }),
      suppressionReason: z
        .enum(['disabled', 'completed', 'superseded', 'past', 'quiet_hours'])
        .nullable(),
    }),
  ),
  activeDeviceCount: z.int().nonnegative(),
  simulated: z.boolean(),
});

export function readPreferenceView(
  value: unknown,
  journeyId: string,
): ReminderPreferenceView | null {
  const result = viewSchema.safeParse(value);
  return result.success && result.data.journeyId === journeyId ? result.data : null;
}

export function formatPreviewTime(instant: string, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }).format(new Date(instant));
  } catch {
    return null;
  }
}
