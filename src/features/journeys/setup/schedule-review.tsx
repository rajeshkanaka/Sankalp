import { forwardRef } from 'react';
import type { JourneyDraftPreview, PracticeDefinition } from '@/domain/contracts';
import { formatInstant, formatPracticeDate } from '@/components/presentation';
import { RequestErrorMessage } from '@/components/request-error';
import shared from '@/styles/sanctuary.module.css';
import styles from './setup.module.css';
import { WEEKDAYS } from './types';

function practiceTarget(practice: PracticeDefinition) {
  if (practice.kind === 'checkbox') return 'Completion checkbox';
  return `${practice.target.toLocaleString('en')} ${practice.kind === 'minutes' ? 'minutes' : 'repetitions'}`;
}

function offsetLabel(offsetMinutes: number) {
  if (offsetMinutes === 0) return 'At practice time';
  const minutes = Math.abs(offsetMinutes);
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} before`;
  }
  return `${minutes} minutes before`;
}

function recurrenceLabel(result: JourneyDraftPreview) {
  const { schedule } = result.journey;
  const days = schedule.weekdays
    .map((value) => WEEKDAYS.find((day) => day.value === value)?.long)
    .filter(Boolean)
    .join(', ');
  const duration =
    schedule.durationMode === 'occurrences'
      ? `${schedule.durationValue} scheduled sessions`
      : `${schedule.durationValue} calendar days`;
  return `${result.preview.total} sessions from ${duration}; ${days}`;
}

export const ScheduleReview = forwardRef<
  HTMLHeadingElement,
  {
    result: JourneyDraftPreview;
    pending: boolean;
    error: Error | null;
    onActivate: () => void;
    onEdit: () => void;
  }
>(function ScheduleReview({ result, pending, error, onActivate, onEdit }, headingRef) {
  const first = result.preview.occurrences[0];
  const last = result.preview.occurrences.at(-1);
  const timeZone = result.journey.schedule.timeZone;
  const firstReminders = first
    ? result.reminderTimes.filter((reminder) => reminder.practiceDate === first.practiceDate)
    : [];

  return (
    <section className={shared.panel}>
      <h2 ref={headingRef} tabIndex={-1}>
        Review your journey
      </h2>
      <p className={shared.muted}>Check the actual dates and times before you begin.</p>
      <dl className={styles.scheduleFacts}>
        <div className={shared.previewRow}>
          <dt>Journey</dt>
          <dd>{result.journey.title}</dd>
        </div>
        {result.journey.intention && (
          <div className={shared.previewRow}>
            <dt>Intention</dt>
            <dd>{result.journey.intention}</dd>
          </div>
        )}
        <div className={shared.previewRow}>
          <dt>Practices</dt>
          <dd className={styles.practiceList}>
            {result.journey.practices.map((practice) => (
              <span key={practice.id}>
                {practice.label} · {practiceTarget(practice)}
              </span>
            ))}
          </dd>
        </div>
        <div className={shared.previewRow}>
          <dt>Schedule</dt>
          <dd>
            {recurrenceLabel(result)}. Each session has a {result.journey.schedule.windowMinutes}
            -minute window.
          </dd>
        </div>
        {first && (
          <>
            <div className={shared.previewRow}>
              <dt>First practice</dt>
              <dd>{formatInstant(first.opensAt, timeZone)}</dd>
            </div>
            <div className={shared.previewRow}>
              <dt>First practice date</dt>
              <dd>{formatPracticeDate(first.practiceDate)}</dd>
            </div>
          </>
        )}
        {last && (
          <>
            <div className={shared.previewRow}>
              <dt>Final practice</dt>
              <dd>{formatInstant(last.opensAt, timeZone)}</dd>
            </div>
            <div className={shared.previewRow}>
              <dt>Final practice date</dt>
              <dd>{formatPracticeDate(last.practiceDate)}</dd>
            </div>
          </>
        )}
        <div className={shared.previewRow}>
          <dt>Practice timezone</dt>
          <dd>{timeZone}</dd>
        </div>
        <div className={shared.previewRow}>
          <dt>Practice date</dt>
          <dd>
            {result.journey.schedule.attribution === 'civil'
              ? 'The same civil date on which practice begins.'
              : 'The previous calendar night. The session opens on the following civil date.'}
          </dd>
        </div>
        <div className={shared.previewRow}>
          <dt>Reminders</dt>
          <dd>
            <strong>Off.</strong> These times are suggestions only; no reminder will be sent.
            {firstReminders.length > 0 && (
              <ul className={styles.reminderList} aria-label="First practice reminder suggestions">
                {firstReminders.map((reminder) => (
                  <li key={`${reminder.practiceDate}-${reminder.offsetMinutes}`}>
                    {offsetLabel(reminder.offsetMinutes)} ·{' '}
                    {formatInstant(reminder.scheduledFor, timeZone)}{' '}
                    {reminder.isPast && <small>(past time — would be skipped)</small>}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      {result.preview.warnings.length > 0 && (
        <aside className={shared.quietNote} aria-label="Schedule notes">
          <strong>Schedule notes</strong>
          <ul className={styles.warningList}>
            {result.preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </aside>
      )}
      <RequestErrorMessage error={error} />
      <div className={shared.actions}>
        <button className={shared.button} onClick={onActivate} disabled={pending}>
          {pending ? 'Activating…' : 'Activate journey'}
        </button>
        <button
          className={`${shared.button} ${shared.secondary}`}
          disabled={pending}
          onClick={onEdit}
        >
          Edit details
        </button>
      </div>
    </section>
  );
});
