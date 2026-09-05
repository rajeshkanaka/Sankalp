import { Temporal } from '@js-temporal/polyfill';

import type { CompletionTiming, SessionRecord, SessionStatus } from './contracts';

export function deriveCompletionTiming(session: SessionRecord): CompletionTiming {
  if (!session.confirmed || !targetsMet(session) || !session.performedAt)
    return { practiceTiming: null, recordedLater: false };
  const performed = Temporal.Instant.from(session.performedAt);
  const withinWindow =
    Temporal.Instant.compare(performed, session.opensAt) >= 0 &&
    Temporal.Instant.compare(performed, session.closesAt) < 0;
  return {
    practiceTiming: withinWindow ? 'on_schedule' : 'practiced_late',
    recordedLater:
      session.recordedAt !== null &&
      Temporal.Instant.compare(session.recordedAt, session.closesAt) >= 0,
  };
}

export function targetsMet(session: SessionRecord): boolean {
  return (
    session.practices.length > 0 &&
    session.practices.every((practice) => {
      if (practice.kind === 'checkbox') return practice.value === true;
      return (
        typeof practice.target === 'number' &&
        practice.target > 0 &&
        typeof practice.value === 'number' &&
        practice.value >= practice.target
      );
    })
  );
}

function hasProgress(session: SessionRecord): boolean {
  return session.practices.some((practice) =>
    practice.kind === 'checkbox'
      ? practice.value === true
      : typeof practice.value === 'number' && practice.value > 0,
  );
}

export function deriveStatus(session: SessionRecord, now: string): SessionStatus {
  const current = Temporal.Instant.from(now);
  const opening = Temporal.Instant.from(session.opensAt);
  const closing = Temporal.Instant.from(session.closesAt);

  if (Temporal.Instant.compare(current, opening) < 0) return 'upcoming';
  if (session.confirmed && targetsMet(session)) return 'complete';
  if (hasProgress(session)) return 'partial';
  if (Temporal.Instant.compare(current, closing) < 0) return 'open';
  return 'missed';
}
