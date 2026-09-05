import Link from 'next/link';
import type { SessionRecord } from '@/domain/contracts';
import { deriveStatus } from '@/domain/status';
import { formatInstant, formatPracticeDate, StatusBadge } from '@/components/presentation';
import styles from '@/styles/sanctuary.module.css';

export function SessionTimeline({ sessions, now }: { sessions: SessionRecord[]; now: string }) {
  return (
    <ol className={styles.timeline}>
      {sessions
        .filter((session) => !session.supersededAt)
        .map((session) => (
          <li key={session.id}>
            <Link
              className={styles.timelineLink}
              href={`/journeys/${session.journeyId}/sessions/${session.id}`}
            >
              <div>
                <div className={styles.timelineDate}>
                  {session.attribution === 'previous_evening' ? 'Night' : 'Session'}{' '}
                  {session.ordinal}{' '}
                  <span className={styles.muted}>/ {formatPracticeDate(session.practiceDate)}</span>
                </div>
                <div className={styles.timelineMeta}>
                  {formatInstant(session.opensAt, session.timeZone, false)} · {session.timeZone}
                </div>
              </div>
              <StatusBadge status={deriveStatus(session, now)} />
            </Link>
          </li>
        ))}
    </ol>
  );
}
