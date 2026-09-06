import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

import type { IsoInstant, ReminderPreferences, SessionRecord } from './contracts';

const minuteTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
const quietHoursSchema = z
  .strictObject({ start: minuteTimeSchema, end: minuteTimeSchema })
  .refine(({ start, end }) => start !== end, {
    message: 'Quiet hours must have different start and end times',
    path: ['end'],
  });

export const reminderPreferencesSchema = z
  .strictObject({
    enabled: z.boolean(),
    offsets: z
      .array(z.int().min(-1_440).max(0))
      .max(8)
      .refine((offsets) => new Set(offsets).size === offsets.length, {
        message: 'Reminder offsets must be unique',
      }),
    quietHours: quietHoursSchema.nullable(),
    detailed: z.boolean(),
  })
  .refine(({ enabled, offsets }) => !enabled || offsets.length > 0, {
    message: 'Choose at least one reminder before enabling reminders',
    path: ['offsets'],
  });

export type ReminderSession = Pick<
  SessionRecord,
  'opensAt' | 'closesAt' | 'timeZone' | 'confirmed' | 'supersededAt'
>;
export type ReminderSuppressionReason =
  'disabled' | 'completed' | 'superseded' | 'past' | 'quiet_hours';
export interface PlannedReminder {
  offsetMinutes: number;
  scheduledAt: IsoInstant;
  expiresAt: IsoInstant;
  suppressionReason: ReminderSuppressionReason | null;
}
export type SnoozePlan =
  | { eligible: true; scheduledAt: IsoInstant; expiresAt: IsoInstant }
  | {
      eligible: false;
      reason:
        | 'disabled'
        | 'completed'
        | 'superseded'
        | 'not_open'
        | 'window_closed'
        | 'deadline'
        | 'quiet_hours';
    };

/** Evaluate the actual instant's local clock, including either occurrence of a DST fold. */
export function quietHoursContain(
  instant: IsoInstant,
  timeZone: string,
  quietHours: ReminderPreferences['quietHours'],
): boolean {
  if (quietHours === null) return false;
  const hours = quietHoursSchema.parse(quietHours);
  const localTime = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainTime();
  const start = Temporal.PlainTime.from(hours.start);
  const end = Temporal.PlainTime.from(hours.end);
  const afterStart = Temporal.PlainTime.compare(localTime, start) >= 0;
  const beforeEnd = Temporal.PlainTime.compare(localTime, end) < 0;
  return Temporal.PlainTime.compare(start, end) < 0
    ? afterStart && beforeEnd
    : afterStart || beforeEnd;
}

function sessionWindow(session: ReminderSession) {
  const opensAt = Temporal.Instant.from(session.opensAt);
  const closesAt = Temporal.Instant.from(session.closesAt);
  if (Temporal.Instant.compare(opensAt, closesAt) >= 0)
    throw new RangeError('The session must close after it opens');
  return { opensAt, closesAt };
}

function expiry(target: Temporal.Instant, closesAt: Temporal.Instant): IsoInstant {
  const latest = target.add({ minutes: 5 });
  return (Temporal.Instant.compare(latest, closesAt) < 0 ? latest : closesAt).toString();
}

function inactiveReason(
  session: ReminderSession,
  preferences: ReminderPreferences,
): 'disabled' | 'completed' | 'superseded' | null {
  if (!preferences.enabled) return 'disabled';
  if (session.confirmed) return 'completed';
  if (session.supersededAt !== null) return 'superseded';
  return null;
}

/** Pure preview only: callers must enforce account/device eligibility and job generations. */
export function planSessionReminders(
  session: ReminderSession,
  prefs: ReminderPreferences,
  now: IsoInstant,
): PlannedReminder[] {
  const preferences = reminderPreferencesSchema.parse(prefs);
  const { opensAt, closesAt } = sessionWindow(session);
  const current = Temporal.Instant.from(now);
  const inactive = inactiveReason(session, preferences);
  return [...preferences.offsets]
    .sort((left, right) => left - right)
    .map((offsetMinutes) => {
      const target = opensAt.add({ minutes: offsetMinutes });
      const scheduledAt = target.toString();
      const suppressionReason =
        inactive ??
        (Temporal.Instant.compare(target, current) <= 0
          ? 'past'
          : quietHoursContain(scheduledAt, session.timeZone, preferences.quietHours)
            ? 'quiet_hours'
            : null);
      return {
        offsetMinutes,
        scheduledAt,
        expiresAt: expiry(target, closesAt),
        suppressionReason,
      };
    });
}

/** The caller atomically replaces pending jobs in [now, scheduledAt] after eligibility checks. */
export function planSnooze(
  session: ReminderSession,
  prefs: ReminderPreferences,
  now: IsoInstant,
): SnoozePlan {
  const preferences = reminderPreferencesSchema.parse(prefs);
  const { opensAt, closesAt } = sessionWindow(session);
  const current = Temporal.Instant.from(now);
  const inactive = inactiveReason(session, preferences);
  if (inactive) return { eligible: false, reason: inactive };
  if (Temporal.Instant.compare(current, opensAt) < 0)
    return { eligible: false, reason: 'not_open' };
  if (Temporal.Instant.compare(current, closesAt) >= 0)
    return { eligible: false, reason: 'window_closed' };
  const target = current.add({ minutes: 10 });
  if (Temporal.Instant.compare(target, closesAt) >= 0)
    return { eligible: false, reason: 'deadline' };
  const scheduledAt = target.toString();
  if (quietHoursContain(scheduledAt, session.timeZone, preferences.quietHours))
    return { eligible: false, reason: 'quiet_hours' };
  return { eligible: true, scheduledAt, expiresAt: expiry(target, closesAt) };
}
