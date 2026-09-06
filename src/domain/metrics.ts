import { Temporal } from '@js-temporal/polyfill';

import type { JourneyMetrics, SessionRecord, SessionStatus } from './contracts';
import { deriveCompletionTiming, deriveStatus } from './status';

function isClosed(session: SessionRecord, now: Temporal.Instant): boolean {
  return Temporal.Instant.compare(now, session.closesAt) >= 0;
}

function isOnScheduleComplete(session: SessionRecord): boolean {
  return deriveCompletionTiming(session).practiceTiming === 'on_schedule';
}

export function computeMetrics(sessions: SessionRecord[], now: string): JourneyMetrics {
  const current = Temporal.Instant.from(now);
  const active = sessions
    .filter(({ supersededAt }) => supersededAt === null)
    .sort(
      (left, right) =>
        Temporal.Instant.compare(left.opensAt, right.opensAt) || left.ordinal - right.ordinal,
    );
  const statuses = active.map((session) => deriveStatus(session, now));
  const count = (status: SessionStatus) => statuses.filter((value) => value === status).length;
  const complete = count('complete');
  const closed = active.filter((session) => isClosed(session, current));
  const onScheduleClosed = closed.filter(isOnScheduleComplete).length;

  let runningStreak = 0;
  let longestStreak = 0;
  for (const session of active) {
    const status = deriveStatus(session, now);
    const eligible = isClosed(session, current) || status === 'complete';
    if (!eligible) continue;

    if (status === 'complete' && isOnScheduleComplete(session)) {
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }
  }

  const last = active.at(-1);
  return {
    total: active.length,
    complete,
    partial: count('partial'),
    missed: count('missed'),
    upcoming: count('upcoming'),
    open: count('open'),
    percent: active.length === 0 ? 0 : Math.round((complete / active.length) * 100),
    onScheduleRatio: closed.length === 0 ? null : onScheduleClosed / closed.length,
    currentStreak: runningStreak,
    longestStreak,
    ended: last ? Temporal.Instant.compare(current, last.closesAt) >= 0 : false,
    fullyCompleted: active.length > 0 && complete === active.length,
  };
}
