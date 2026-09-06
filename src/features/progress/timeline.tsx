'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SessionListItem } from '@/domain/contracts';
import { formatInstant, formatPracticeDate, StatusBadge } from '@/components/presentation';
import shared from '@/styles/sanctuary.module.css';
import styles from './progress.module.css';

export function TimingLabels({ session }: { session: SessionListItem }) {
  return (
    <>
      {session.practiceTiming === 'practiced_late' && (
        <span className={styles.timing}>Practiced late</span>
      )}
      {session.recordedLater && <span className={styles.timing}>Recorded later</span>}
      {session.status === 'partial' && (
        <span className={styles.timing}>
          {session.windowClosed ? 'Window closed' : 'Window open'}
        </span>
      )}
    </>
  );
}

export function ProgressTimeline({
  sessions,
  showJourneys = false,
}: {
  sessions: SessionListItem[];
  showJourneys?: boolean;
}) {
  const [deviceZone, setDeviceZone] = useState<string | null>(null);
  useEffect(() => {
    setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  if (sessions.length === 0)
    return <p className={shared.muted}>No sessions are scheduled for this selection.</p>;
  return (
    <ol className={shared.timeline} aria-label="Chronological sessions">
      {sessions.map((session) => (
        <li key={session.id} data-practice-date={session.practiceDate}>
          <Link
            prefetch={false}
            className={`${shared.timelineLink} ${styles.sessionLink}`}
            href={`/journeys/${session.journeyId}/sessions/${session.id}`}
          >
            <div>
              {showJourneys && (
                <strong className={styles.journeyName}>{session.journeyTitle}</strong>
              )}
              <div className={shared.timelineDate}>
                {session.attribution === 'previous_evening' ? 'Night' : 'Session'} {session.ordinal}{' '}
                <span className={shared.muted}>/ {formatPracticeDate(session.practiceDate)}</span>
              </div>
              <div className={shared.timelineMeta}>
                {formatInstant(session.opensAt, session.timeZone)} · {session.timeZone}
              </div>
              {deviceZone && deviceZone !== session.timeZone && (
                <div className={shared.timelineMeta}>
                  On this device: {formatInstant(session.opensAt, deviceZone)} · {deviceZone}.
                  Practice date stays {formatPracticeDate(session.practiceDate)}.
                </div>
              )}
              {session.adjustment && (
                <div className={shared.timelineMeta}>{session.adjustment}</div>
              )}
              {session.performedAt && (
                <div className={shared.timelineMeta}>
                  Reported practice: {formatInstant(session.performedAt, session.timeZone)}
                </div>
              )}
              {session.recordedAt && (
                <div className={shared.timelineMeta}>
                  Recorded: {formatInstant(session.recordedAt, session.timeZone)}
                </div>
              )}
            </div>
            <div className={styles.badges}>
              <StatusBadge status={session.status} />
              <TimingLabels session={session} />
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
