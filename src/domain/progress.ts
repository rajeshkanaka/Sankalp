import type { JourneyProgressItem, JourneyView, SessionListItem, SessionRecord } from './contracts';
import { deriveCompletionTiming, deriveStatus } from './status';

export function sessionListItem(
  session: SessionRecord,
  journeyTitle: string,
  now: string,
): SessionListItem {
  return {
    id: session.id,
    journeyId: session.journeyId,
    journeyTitle,
    ordinal: session.ordinal,
    practiceDate: session.practiceDate,
    opensAt: session.opensAt,
    closesAt: session.closesAt,
    adjustment: session.adjustment,
    timeZone: session.timeZone,
    attribution: session.attribution,
    status: deriveStatus(session, now),
    windowClosed: Date.parse(now) >= Date.parse(session.closesAt),
    performedAt: session.performedAt,
    recordedAt: session.recordedAt,
    ...deriveCompletionTiming(session),
  };
}

export function journeyProgressItem(view: JourneyView): JourneyProgressItem {
  const timeline = view.sessions
    .filter((session) => session.supersededAt === null)
    .map((session) => sessionListItem(session, view.journey.title, view.now))
    .sort(
      (left, right) =>
        left.practiceDate.localeCompare(right.practiceDate) || left.ordinal - right.ordinal,
    );
  const instant = Date.parse(view.now);
  const next = timeline.find((session) => Date.parse(session.opensAt) > instant) ?? null;
  const current =
    timeline.find(
      (session) => Date.parse(session.opensAt) <= instant && Date.parse(session.closesAt) > instant,
    ) ??
    next ??
    timeline.at(-1) ??
    null;
  return { journey: view.journey, metrics: view.metrics, timeline, current, next };
}
