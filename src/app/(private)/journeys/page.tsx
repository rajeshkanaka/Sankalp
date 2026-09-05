import Link from 'next/link';
import { getPageUser } from '@/server/auth/server';
import { listJourneyViews } from '@/server/journeys/service';
import { EmptyJourney, PageHeader } from '@/components/presentation';
import styles from '@/styles/sanctuary.module.css';

export default async function JourneysPage() {
  const user = await getPageUser();
  const journeys = (await listJourneyViews(user.id)).filter(
    (view) => view.journey.state !== 'draft',
  );
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
                <Link prefetch={false} href={`/journeys/${journey.id}`}>
                  {journey.title}
                </Link>
              </h2>
              <p>{journey.intention || 'A personal commitment, one practice at a time.'}</p>
              <p>
                {journey.schedule.localTime} · {journey.schedule.timeZone}
              </p>
              <div className={styles.progressBar} aria-hidden="true">
                <span style={{ width: `${metrics.percent}%` }} />
              </div>
              <p>
                {metrics.complete} of {metrics.total} sessions completed · {metrics.percent}%
                complete
              </p>
              <Link
                prefetch={false}
                className={`${styles.button} ${styles.secondary}`}
                href={`/journeys/${journey.id}`}
              >
                View journey
              </Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
