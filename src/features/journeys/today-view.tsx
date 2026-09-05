'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { JourneyView } from '@/domain/contracts';
import { deriveStatus } from '@/domain/status';
import {
  EmptyJourney,
  formatInstant,
  formatPracticeDate,
  PageHeader,
  ProgressRing,
  StatusBadge,
} from '@/components/presentation';
import { countdownLabel, usePracticeClock } from '@/features/practice/use-practice-clock';
import { SessionTimeline } from './session-timeline';
import styles from '@/styles/sanctuary.module.css';

export function TodayView({
  journeys,
  selectedId,
  demo,
  initialNow,
}: {
  journeys: JourneyView[];
  selectedId?: string;
  demo: boolean;
  initialNow: string;
}) {
  const router = useRouter();
  const now = usePracticeClock(initialNow, demo);
  const active = journeys.filter((view) => view.journey.state === 'active');
  const selected = active.find((view) => view.journey.id === selectedId) ?? active[0];
  if (!selected)
    return (
      <>
        <PageHeader
          title="Make space for your practice"
          description="A small, deliberate return to what matters."
        />
        <EmptyJourney />
      </>
    );
  const sessions = selected.sessions.filter((session) => !session.supersededAt);
  const inWindow = sessions.find(
    (session) =>
      Date.parse(session.opensAt) <= Date.parse(now) &&
      Date.parse(session.closesAt) > Date.parse(now),
  );
  const next = sessions.find((session) => Date.parse(session.opensAt) > Date.parse(now));
  const current = inWindow ?? next ?? sessions.at(-1);
  const status = current ? deriveStatus(current, now) : null;
  const currentHref = current
    ? `/journeys/${selected.journey.id}/sessions/${current.id}`
    : `/journeys/${selected.journey.id}`;
  const { metrics, journey } = selected;
  return (
    <>
      <PageHeader
        title="A moment for your practice"
        description="Return with attention. Let each day have its own place."
        action={
          <Link className={`${styles.button} ${styles.secondary}`} href="/setup">
            New journey
          </Link>
        }
      />
      {active.length > 1 && (
        <div className={`${styles.field} ${styles.journeySelect}`}>
          <label htmlFor="selected-journey">Your journey</label>
          <select
            id="selected-journey"
            value={journey.id}
            onChange={(event) => router.push(`/today?journey=${event.target.value}`)}
          >
            {active.map((view) => (
              <option key={view.journey.id} value={view.journey.id}>
                {view.journey.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={styles.todayGrid}>
        <section className={`${styles.panel} ${styles.practiceHero}`}>
          <div className={styles.sessionMeta}>
            <span>
              {current
                ? `${current.attribution === 'previous_evening' ? 'Night' : 'Session'} ${current.ordinal} of ${metrics.total}`
                : 'Your journey'}
            </span>
            {status && <StatusBadge status={status} />}
          </div>
          <h2>{journey.title}</h2>
          {current && (
            <>
              <p className={styles.muted}>
                {formatPracticeDate(current.practiceDate)}
                <br />
                {formatInstant(current.opensAt, current.timeZone, false)}–
                {formatInstant(current.closesAt, current.timeZone, false)} · {current.timeZone}
              </p>
              {status === 'upcoming' ? (
                <>
                  <p className={styles.countdown}>{countdownLabel(current.opensAt, now)}</p>
                  <p className={styles.countdownLabel}>until your next practice</p>
                </>
              ) : status === 'complete' ? (
                <p className={styles.intention}>Your practice is recorded.</p>
              ) : (
                <p className={styles.intention}>
                  {journey.intention || 'Arrive as you are. Begin when you are ready.'}
                </p>
              )}
            </>
          )}
          <div className={styles.actions}>
            <Link className={styles.button} href={currentHref}>
              {status === 'complete'
                ? 'View recorded practice'
                : status === 'partial'
                  ? 'Continue practice'
                  : 'Open practice'}
            </Link>
          </div>
          {inWindow?.confirmed && next && (
            <p className={styles.quietNote}>
              Next practice: {formatInstant(next.opensAt, next.timeZone)}.
            </p>
          )}
          {metrics.ended && (
            <p className={styles.quietNote}>
              {metrics.fullyCompleted
                ? 'Every session in this journey is recorded complete.'
                : 'This journey has ended. Your recorded history remains available.'}
            </p>
          )}
        </section>
        <section
          className={`${styles.panel} ${styles.progressPanel}`}
          aria-label="Journey progress"
        >
          <ProgressRing
            complete={metrics.complete}
            total={metrics.total}
            percent={metrics.percent}
          />
          <div>
            <p>
              <strong>
                {metrics.complete} of {metrics.total} sessions completed
              </strong>
            </p>
            <p className={styles.muted}>{metrics.upcoming} upcoming</p>
            <Link className={styles.textButton} href={`/journeys/${journey.id}`}>
              View journey
            </Link>
          </div>
        </section>
      </div>
      <p className={styles.quietNote}>
        Reminders are off and not available yet. Return to this page at your chosen practice time.
      </p>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Along your journey</h2>
        <SessionTimeline sessions={sessions.slice(0, 7)} now={now} />
        {sessions.length > 7 && (
          <Link className={styles.textButton} href={`/journeys/${journey.id}`}>
            View all {metrics.total} sessions
          </Link>
        )}
      </section>
    </>
  );
}
