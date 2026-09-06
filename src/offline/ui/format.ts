import { Temporal } from '@js-temporal/polyfill';

import type { IsoInstant } from '@/domain/contracts';
import type { Snapshot } from '../core';

export function effectiveNow(
  clock: Snapshot['clock'],
  deviceNow = new Date().toISOString(),
): IsoInstant {
  const server = Date.parse(clock.serverNow);
  const captured = Date.parse(clock.capturedAt);
  const device = Date.parse(deviceNow);
  if (![server, captured, device].every(Number.isFinite))
    throw new RangeError('The saved practice clock is invalid.');
  if (clock.simulated) return clock.serverNow;
  return new Date(server + Math.max(0, device - captured)).toISOString();
}

export function formatInstant(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instant));
}

export function formatPracticeDate(date: string): string {
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    dateStyle: 'long',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function localInputValue(instant: string, timeZone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}

export function instantFromLocalInput(value: string, timeZone: string): IsoInstant {
  const local = Temporal.PlainDateTime.from(value);
  const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  if (!zoned.toPlainDateTime().equals(local))
    throw new RangeError('That local time does not exist in this practice timezone.');
  return zoned.toInstant().toString();
}
