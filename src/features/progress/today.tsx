'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ProgressDashboard } from '@/domain/contracts';
import {
  EmptyJourney,
  PageHeader,
  formatInstant,
  formatPracticeDate,
  StatusBadge,
} from '@/components/presentation';
import { countdownLabel } from '@/features/practice/use-practice-clock';
import { JourneySummary } from './summary';
import { StreakPreference } from './preferences';
import { ProgressTimeline, TimingLabels } from './timeline';
import { useProgressClock } from './use-progress-clock';
import shared from '@/styles/sanctuary.module.css';
import styles from './progress.module.css';

export function ProgressToday({
  view,
  selectedId,
  demo,
}: {
  view: ProgressDashboard;
  selectedId?: string;
  demo: boolean;
}) {
  const router = useRouter();
  const now = useProgressClock(
    view.now,
    demo,
    view.journeys.flatMap((item) =>
      item.timeline.flatMap((session) => [session.opensAt, session.closesAt]),
    ),
  );
  const selected = view.journeys.find((item) => item.journey.id === selectedId) ?? view.journeys[0];
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
  const { journey, current, next, metrics } = selected;
  const currentHref = current
    ? `/journeys/${journey.id}/sessions/${current.id}`
    : `/journeys/${journey.id}`;
  const nearby = selected.timeline
    .filter((session) => Date.parse(session.closesAt) >= Date.parse(view.now))
    .slice(0, 4);
  const previous = selected.timeline
    .filter((session) => Date.parse(session.closesAt) < Date.parse(view.now))
    .at(-1);
  const visibleSessions = previous ? [previous, ...nearby] : nearby;
  const otherUpcoming = view.journeys
    .filter((item) => item.journey.id !== journey.id && item.current)
    .slice(0, 5);
  return (
    <>
      <PageHeader
        title="A moment for your practice"
        description="Return with attention. Let each day have its own place."
        action={
          <Link prefetch={false} className={`${shared.button} ${shared.secondary}`} href="/setup">
            New journey
          </Link>
        }
      />
      {view.journeys.length > 1 && (
        <div className={`${shared.field} ${shared.journeySelect}`}>
          <label htmlFor="selected-journey">Your journey</label>
          <select
            id="selected-journey"
            value={journey.id}
            onChange={(event) => router.push(`/today?journey=${event.target.value}`)}
          >
            {view.journeys.map((item) => (
              <option key={item.journey.id} value={item.journey.id}>
                {item.journey.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={shared.todayGrid}>
        <section className={`${shared.panel} ${shared.practiceHero}`}>
          <div className={shared.sessionMeta}>
            <span>
              {current
                ? `${current.attribution === 'previous_evening' ? 'Night' : 'Session'} ${current.ordinal} of ${metrics.total}`
                : 'Your journey'}
            </span>
            {current && <StatusBadge status={current.status} />}
          </div>
          <h2>{journey.title}</h2>
          {current && (
            <>
              <p className={shared.muted}>
                {formatPracticeDate(current.practiceDate)}
                <br />
                {formatInstant(current.opensAt, current.timeZone, false)}–
                {formatInstant(current.closesAt, current.timeZone, false)} · {current.timeZone}
              </p>
              {current.status === 'upcoming' ? (
                <>
                  <p className={shared.countdown}>{countdownLabel(current.opensAt, now)}</p>
                  <p className={shared.countdownLabel}>until your next practice</p>
                </>
              ) : (
                <p className={shared.intention}>
                  {current.status === 'complete'
                    ? 'Your practice is recorded.'
                    : journey.intention || 'Arrive as you are. Begin when you are ready.'}
                </p>
              )}
              <TimingLabels session={current} />
            </>
          )}
          <div className={shared.actions}>
            <Link prefetch={false} className={shared.button} href={currentHref}>
              {current?.status === 'complete'
                ? 'View recorded practice'
                : current?.status === 'partial'
                  ? 'Continue practice'
                  : 'Open practice'}
            </Link>
          </div>
          {next && next.id !== current?.id && (
            <p className={shared.quietNote}>
              Next practice: {formatInstant(next.opensAt, next.timeZone)}.
            </p>
          )}
          <p>
            <Link prefetch={false} className={shared.textButton} href={`/journeys/${journey.id}`}>
              View journey
            </Link>
          </p>
        </section>
        <div>
          <JourneySummary metrics={metrics} preferences={view.preferences} />
        </div>
      </div>
      <StreakPreference preferences={view.preferences} />
      <p className={shared.quietNote}>
        Reminders are off and not available yet. Return to this page at your chosen practice time.
      </p>
      {otherUpcoming.length > 0 && (
        <section className={shared.section}>
          <h2 className={shared.sectionTitle}>Your other journeys</h2>
          <ul className={styles.otherJourneys}>
            {otherUpcoming.map((item) => (
              <li key={item.journey.id}>
                <Link prefetch={false} href={`/today?journey=${item.journey.id}`}>
                  {item.journey.title}
                </Link>
                <span>
                  {item.current && formatInstant(item.current.opensAt, item.current.timeZone)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={shared.section}>
        <h2 className={shared.sectionTitle}>Along your journey</h2>
        <ProgressTimeline sessions={visibleSessions} />
        <Link prefetch={false} className={shared.textButton} href={`/journeys/${journey.id}`}>
          View all {metrics.total} sessions
        </Link>
      </section>
    </>
  );
}
