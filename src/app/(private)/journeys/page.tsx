import Link from 'next/link';
import { getPageUser } from '@/server/auth/server';
import { listJourneyViews } from '@/server/journeys/service';
import { EmptyJourney, PageHeader } from '@/components/presentation';
import styles from '@/styles/sanctuary.module.css';

export default async function JourneysPage() {
  const user = await getPageUser();
  const journeys = await listJourneyViews(user.id);
  return (
    <>
      <PageHeader
        title="Your journeys"
        description="Each intention has its own rhythm and history."
        action={
          journeys.length > 0 ? (
            <Link prefetch={false} className={styles.button} href="/setup">
              New journey
            </Link>
          ) : undefined
        }
      />
      {journeys.length === 0 ? (
        <EmptyJourney />
      ) : (
        <div className={styles.journeyCards}>
          {journeys.map(({ journey, metrics }) => (
            <article className={`${styles.panel} ${styles.journeyCard}`} key={journey.id}>
              <h2>
                <Link
                  prefetch={false}
                  href={
                    journey.state === 'draft'
                      ? `/setup?draft=${journey.id}`
                      : `/journeys/${journey.id}`
                  }
                >
                  {journey.title}
                </Link>
              </h2>
              <p>{journey.intention || 'A personal commitment, one practice at a time.'}</p>
              <p>
                {journey.schedule.localTime} · {journey.schedule.timeZone}
              </p>
              {journey.state === 'draft' ? (
                <p>Saved draft · Review and activate when you are ready.</p>
              ) : (
                <>
                  <div className={styles.progressBar} aria-hidden="true">
                    <span style={{ width: `${metrics.percent}%` }} />
                  </div>
                  <p>
                    {metrics.complete} of {metrics.total} sessions completed · {metrics.percent}%
                    complete
                  </p>
                </>
              )}
              <Link
                prefetch={false}
                className={`${styles.button} ${styles.secondary}`}
                href={
                  journey.state === 'draft'
                    ? `/setup?draft=${journey.id}`
                    : `/journeys/${journey.id}`
                }
              >
                {journey.state === 'draft' ? 'Resume draft' : 'View journey'}
              </Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
