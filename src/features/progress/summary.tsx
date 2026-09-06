import type { JourneyMetrics, ProgressPreferences } from '@/domain/contracts';
import { ProgressRing } from '@/components/presentation';
import shared from '@/styles/sanctuary.module.css';
import styles from './progress.module.css';

export function JourneySummary({
  metrics,
  preferences,
}: {
  metrics: JourneyMetrics;
  preferences: ProgressPreferences;
}) {
  return (
    <>
      <section className={`${shared.panel} ${shared.progressPanel}`} aria-label="Journey progress">
        <ProgressRing complete={metrics.complete} total={metrics.total} percent={metrics.percent} />
        <div>
          <p>
            <strong>
              {metrics.complete} of {metrics.total} sessions completed
            </strong>
          </p>
          <p className={shared.muted}>{metrics.upcoming} upcoming</p>
          {metrics.fullyCompleted ? (
            <p className={styles.endState}>Fully completed</p>
          ) : (
            metrics.ended && (
              <p className={styles.endState}>Ended · {metrics.complete} recorded complete</p>
            )
          )}
        </div>
      </section>
      <dl className={styles.statistics}>
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
        <div>
          <dt>Open now</dt>
          <dd>{metrics.open}</dd>
        </div>
        <div>
          <dt>On-schedule consistency</dt>
          <dd>
            {metrics.onScheduleRatio === null
              ? '—'
              : `${Math.round(metrics.onScheduleRatio * 100)}%`}
          </dd>
        </div>
        {!preferences.hideStreaks && (
          <>
            <div>
              <dt>Current streak</dt>
              <dd>{metrics.currentStreak}</dd>
            </div>
            <div>
              <dt>Longest streak</dt>
              <dd>{metrics.longestStreak}</dd>
            </div>
          </>
        )}
      </dl>
      <p className={`${shared.small} ${shared.muted}`}>
        Consistency counts only closed windows. Open and upcoming sessions are excluded; partial
        practice earns no completion credit.
      </p>
    </>
  );
}
