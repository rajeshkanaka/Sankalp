'use client';

import Link from 'next/link';
import type { JourneyView, ProgressPreferences } from '@/domain/contracts';
import { computeMetrics } from '@/domain/metrics';
import { journeyProgressItem } from '@/domain/progress';
import { PageHeader } from '@/components/presentation';
import { Icon } from '@/components/icons';
import { ProgressTimeline } from './timeline';
import { StreakPreference } from './preferences';
import { JourneySummary } from './summary';
import { useProgressClock } from './use-progress-clock';
import shared from '@/styles/sanctuary.module.css';

export function JourneyProgress({
  view,
  preferences,
  demo,
}: {
  view: JourneyView;
  preferences: ProgressPreferences;
  demo: boolean;
}) {
  const now = useProgressClock(
    view.now,
    demo,
    view.sessions
      .filter((session) => !session.supersededAt)
      .flatMap((session) => [session.opensAt, session.closesAt]),
  );
  const item = journeyProgressItem({ ...view, now, metrics: computeMetrics(view.sessions, now) });
  const { journey } = item;
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const rhythm =
    journey.schedule.weekdays.length === 7
      ? 'Every day'
      : journey.schedule.weekdays.map((day) => days[day - 1]).join(', ');
  return (
    <>
      <Link prefetch={false} href="/journeys" className={shared.back}>
        <Icon name="back" />
        All journeys
      </Link>
      <PageHeader
        title={journey.title}
        description={journey.intention || 'Your intention, held through daily practice.'}
      />
      <div className={shared.todayGrid}>
        <section className={shared.panel}>
          <h2>Your chosen rhythm</h2>
          <p>
            {rhythm} at {journey.schedule.localTime} in {journey.schedule.timeZone}.<br />
            {journey.schedule.windowMinutes} minutes to complete each session.
          </p>
          <p className={shared.muted}>
            Current practices: {journey.practices.map((practice) => practice.label).join(', ')}
          </p>
          <p className={`${shared.muted} ${shared.small}`}>
            {journey.schedule.attribution === 'previous_evening'
              ? 'Nights are shown on the date the evening begins.'
              : 'Sessions use the civil date on which practice begins.'}{' '}
            Historical sessions keep their original dates and timezone.
          </p>
          <div className={shared.actions}>
            <Link
              prefetch={false}
              className={`${shared.button} ${shared.secondary}`}
              href={`/today?journey=${journey.id}`}
            >
              Open Today
            </Link>
            <Link
              prefetch={false}
              className={shared.textButton}
              href={`/calendar?month=${journey.schedule.startDate.slice(0, 7)}&journey=${journey.id}`}
            >
              View calendar
            </Link>
          </div>
        </section>
        <div>
          <JourneySummary metrics={item.metrics} preferences={preferences} />
        </div>
      </div>
      <StreakPreference preferences={preferences} />
      <section className={shared.section}>
        <h2 className={shared.sectionTitle}>Your session history</h2>
        <ProgressTimeline sessions={item.timeline} />
      </section>
      <p className={shared.quietNote}>
        Reflections and PDF export are not available yet. Your saved practice records remain here.
      </p>
    </>
  );
}
