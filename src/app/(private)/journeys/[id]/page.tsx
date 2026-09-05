import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPageUser } from '@/server/auth/server';
import { getJourneyView } from '@/server/journeys/service';
import { PageHeader, ProgressRing } from '@/components/presentation';
import { Icon } from '@/components/icons';
import { SessionTimeline } from '@/features/journeys/session-timeline';
import styles from '@/styles/sanctuary.module.css';

export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getPageUser();
  const { id } = await params;
  const view = await getJourneyView(user.id, id);
  if (!view) notFound();
  const { journey, metrics, sessions, now } = view;
  return (
    <>
      <Link href="/journeys" className={styles.back}>
        <Icon name="back" />
        All journeys
      </Link>
      <PageHeader
        title={journey.title}
        description={journey.intention || 'Your intention, held through daily practice.'}
      />
      <div className={styles.todayGrid}>
        <section className={styles.panel}>
          <h2>Your chosen rhythm</h2>
          <p>
            Daily at {journey.schedule.localTime} in {journey.schedule.timeZone}.<br />
            {journey.schedule.windowMinutes} minutes to complete each session.
          </p>
          <p className={styles.muted}>
            Practices: {journey.practices.map((practice) => practice.label).join(', ')}
          </p>
          <p className={`${styles.muted} ${styles.small}`}>
            Sessions are shown on the date practice begins.
          </p>
          <Link className={`${styles.button} ${styles.secondary}`} href={`/today?journey=${id}`}>
            Open Today
          </Link>
        </section>
        <section className={`${styles.panel} ${styles.progressPanel}`}>
          <ProgressRing
            complete={metrics.complete}
            total={metrics.total}
            percent={metrics.percent}
          />
          <p>
            {metrics.complete} of {metrics.total} sessions completed
          </p>
        </section>
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>Complete</dt>
          <dd>{metrics.complete}</dd>
        </div>
        <div>
          <dt>Partial</dt>
          <dd>{metrics.partial}</dd>
        </div>
        <div>
          <dt>Missed</dt>
          <dd>{metrics.missed}</dd>
        </div>
      </dl>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Your session history</h2>
        <SessionTimeline sessions={sessions} now={now} />
      </section>
      <p className={styles.quietNote}>
        Schedule editing, reflections, calendar and PDF export are not available yet. Your saved
        practice records remain here.
      </p>
    </>
  );
}
