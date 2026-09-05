import { Temporal } from '@js-temporal/polyfill';

import type { SessionRecord, SessionStatus } from './contracts';

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
