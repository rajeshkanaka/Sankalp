import type { SessionAmendment, SessionHistory, SessionHistoryEvent } from '@/domain/contracts';
import { formatInstant } from '@/components/presentation';
import styles from '@/styles/sanctuary.module.css';

type TimelineItem =
  { type: 'amendment'; value: SessionAmendment } | { type: 'event'; value: SessionHistoryEvent };

function amendmentLabel(amendment: SessionAmendment) {
  switch (amendment.kind) {
    case 'values_saved':
      return 'Practice values saved.';
    case 'confirmed':
      return 'Completion confirmed.';
    case 'completion_corrected':
      return 'Practice time corrected.';
    case 'completion_removed':
      return 'Completion removed; saved practice values kept.';
  }
}

function eventLabel(event: SessionHistoryEvent) {
  if (event.kind === 'session_closed') {
    return event.detail.status === 'missed'
      ? 'The practice window closed with no saved progress.'
      : 'The practice window closed with partial progress.';
  }
  const timing = event.detail.afterTiming;
  if (event.detail.action === 'completion_removed') return 'Completion was removed after closing.';
  if (timing.practiceTiming === 'practiced_late') return 'A late practice was recorded.';
  if (timing.recordedLater) return 'An in-window practice was recorded later.';
  if (event.detail.action === 'values_saved')
    return 'Practice values were corrected after closing.';
  return 'The completion record was corrected after closing.';
}

function timeline(history: SessionHistory): TimelineItem[] {
  const linked = new Set(
    history.events.flatMap((event) =>
      event.kind === 'session_corrected' ? [event.amendmentId] : [],
    ),
  );
  return [
    ...history.amendments
      .filter((amendment) => !linked.has(amendment.id))
      .map((value) => ({ type: 'amendment' as const, value })),
    ...history.events
      .filter((event) => event.kind !== 'session_closed' || event.detail.status !== 'complete')
      .map((value) => ({ type: 'event' as const, value })),
  ].sort((left, right) => {
    const leftTime = left.type === 'event' ? left.value.occurredAt : left.value.recordedAt;
    const rightTime = right.type === 'event' ? right.value.occurredAt : right.value.recordedAt;
    return (
      Date.parse(leftTime) - Date.parse(rightTime) ||
      left.value.sessionRevision - right.value.sessionRevision ||
      left.value.id.localeCompare(right.value.id)
    );
  });
}

export function HistoryTimeline({
  history,
  timeZone,
}: {
  history: SessionHistory;
  timeZone: string;
}) {
  const items = timeline(history);
  if (items.length === 0) return null;
  return (
    <section className={styles.formSection} aria-labelledby="session-history-heading">
      <h2 id="session-history-heading">Practice history</h2>
      <ol aria-label="Session history">
        {items.map((item) => {
          const instant = item.type === 'event' ? item.value.occurredAt : item.value.recordedAt;
          return (
            <li key={`${item.type}-${item.value.id}`}>
              <strong>
                {item.type === 'event' ? eventLabel(item.value) : amendmentLabel(item.value)}
              </strong>{' '}
              <span className={styles.muted}>{formatInstant(instant, timeZone)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
