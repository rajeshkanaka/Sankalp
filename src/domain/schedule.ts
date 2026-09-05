import { Temporal } from '@js-temporal/polyfill';

import type { PlannedOccurrence, ScheduleInput, SchedulePreview } from './contracts';
import { scheduleInputSchema } from './validation';

interface ResolvedWallTime {
  instant: Temporal.Instant;
  adjustment: string | null;
}

function sameWallTime(left: Temporal.PlainDateTime, right: Temporal.PlainDateTime): boolean {
  return left.equals(right);
}

function resolveWallTime(
  requested: Temporal.PlainDateTime,
  timeZone: string,
  boundary: 'opening' | 'closing',
): ResolvedWallTime {
  const earlier = requested.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  const later = requested.toZonedDateTime(timeZone, { disambiguation: 'later' });
  const earlierMatches = sameWallTime(earlier.toPlainDateTime(), requested);
  const laterMatches = sameWallTime(later.toPlainDateTime(), requested);

  if (earlierMatches && laterMatches) {
    const repeated = !earlier.toInstant().equals(later.toInstant());
    return {
      instant: earlier.toInstant(),
      adjustment: repeated
        ? `${boundary} ${requested.toString()} used the earlier occurrence in ${timeZone}`
        : null,
    };
  }

  for (let minutes = 1; minutes <= 2_880; minutes += 1) {
    const candidate = requested.add({ minutes });
    const resolved = candidate.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
    if (sameWallTime(resolved.toPlainDateTime(), candidate)) {
      return {
        instant: resolved.toInstant(),
        adjustment: `${boundary} ${requested.toString()} adjusted to ${candidate.toString()} in ${timeZone}`,
      };
    }
  }

  throw new RangeError(`Could not resolve ${boundary} in ${timeZone}`);
}

function selectedPracticeDates(
  schedule: ScheduleInput,
  count: number,
  excludedDates: Set<string>,
): Temporal.PlainDate[] {
  const start = Temporal.PlainDate.from(schedule.startDate);
  const weekdays = new Set(schedule.weekdays);
  const dates: Temporal.PlainDate[] = [];

  if (schedule.durationMode === 'calendar_days') {
    for (let offset = 0; offset < schedule.durationValue; offset += 1) {
      const date = start.add({ days: offset });
      if (weekdays.has(date.dayOfWeek) && !excludedDates.has(date.toString())) dates.push(date);
    }
    return dates;
  }

  for (let offset = 0; dates.length < count; offset += 1) {
    const date = start.add({ days: offset });
    if (weekdays.has(date.dayOfWeek) && !excludedDates.has(date.toString())) dates.push(date);
  }
  return dates;
}

function createOccurrence(
  schedule: ScheduleInput,
  practiceDate: Temporal.PlainDate,
  ordinal: number,
): PlannedOccurrence {
  const scheduledDate =
    schedule.attribution === 'previous_evening' ? practiceDate.add({ days: 1 }) : practiceDate;
  const openingWallTime = scheduledDate.toPlainDateTime(
    Temporal.PlainTime.from(schedule.localTime),
  );
  const closingWallTime = openingWallTime.add({ minutes: schedule.windowMinutes });
  const opening = resolveWallTime(openingWallTime, schedule.timeZone, 'opening');
  const closing = resolveWallTime(closingWallTime, schedule.timeZone, 'closing');
  const elapsedNanoseconds = closing.instant.epochNanoseconds - opening.instant.epochNanoseconds;
  const dayNanoseconds = 86_400_000_000_000n;

  if (elapsedNanoseconds <= 0n) {
    throw new RangeError('A practice window must have a positive elapsed duration');
  }
  if (elapsedNanoseconds >= dayNanoseconds) {
    throw new RangeError('A practice window must be shorter than 24 elapsed hours');
  }

  return {
    ordinal,
    practiceDate: practiceDate.toString(),
    opensAt: opening.instant.toString(),
    closesAt: closing.instant.toString(),
    adjustment: [opening.adjustment, closing.adjustment].filter(Boolean).join('; ') || null,
  };
}

function assertNonoverlapping(occurrences: PlannedOccurrence[]): void {
  const chronological = [...occurrences].sort((left, right) =>
    Temporal.Instant.compare(left.opensAt, right.opensAt),
  );

  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1];
    const current = chronological[index];
    if (previous && current && Temporal.Instant.compare(previous.closesAt, current.opensAt) > 0) {
      throw new RangeError('Practice windows must not overlap');
    }
  }
}

export function generateSchedule(
  input: ScheduleInput,
  retained: PlannedOccurrence[] = [],
  now?: string,
): PlannedOccurrence[] {
  const schedule = scheduleInputSchema.parse(input) as ScheduleInput;
  if (schedule.durationMode === 'occurrences' && retained.length > schedule.durationValue) {
    throw new RangeError('The duration cannot remove retained occurrences');
  }

  const retainedDates = new Set(retained.map(({ practiceDate }) => practiceDate));
  const remainingCount =
    schedule.durationMode === 'occurrences' ? schedule.durationValue - retained.length : 0;
  const candidateDates = selectedPracticeDates(schedule, remainingCount, retainedDates);
  const dates =
    schedule.durationMode === 'occurrences'
      ? candidateDates.slice(0, remainingCount)
      : candidateDates;

  if (retained.length === 0 && dates.length === 0) {
    throw new RangeError('The schedule contains no occurrences');
  }

  let nextOrdinal =
    retained.reduce((maximum, occurrence) => Math.max(maximum, occurrence.ordinal), 0) + 1;
  const generated = dates.map((date) => createOccurrence(schedule, date, nextOrdinal++));
  const occurrences = [...retained.map((occurrence) => ({ ...occurrence })), ...generated].sort(
    (left, right) => left.ordinal - right.ordinal,
  );

  assertNonoverlapping(occurrences);

  if (now !== undefined) {
    const current = Temporal.Instant.from(now);
    if (!occurrences.some(({ opensAt }) => Temporal.Instant.compare(opensAt, current) > 0)) {
      throw new RangeError(
        'Activation requires at least one occurrence whose window has not opened',
      );
    }
  }

  return occurrences;
}

export function previewSchedule(schedule: ScheduleInput, now: string): SchedulePreview {
  const occurrences = generateSchedule(schedule, [], now);
  return {
    occurrences,
    total: occurrences.length,
    warnings: occurrences.flatMap(({ adjustment }) => (adjustment ? [adjustment] : [])),
  };
}
