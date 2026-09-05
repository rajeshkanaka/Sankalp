'use client';

import Link from 'next/link';
import { Temporal } from '@js-temporal/polyfill';
import type { CalendarView, SessionStatus } from '@/domain/contracts';
import { PageHeader, formatPracticeDate } from '@/components/presentation';
import { ProgressTimeline } from './timeline';
import { useProgressClock } from './use-progress-clock';
import shared from '@/styles/sanctuary.module.css';
import styles from './progress.module.css';

const labels: Record<SessionStatus, string> = {
  complete: 'Complete',
  partial: 'Partial',
  missed: 'Missed',
  open: 'Open now',
  upcoming: 'Upcoming',
};
const weekdayLabels = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export function Calendar({
  view,
  month,
  journeyId,
  mode,
  date,
  demo,
}: {
  view: CalendarView;
  month: string;
  journeyId?: string;
  mode: 'grid' | 'list';
  date?: string;
  demo: boolean;
}) {
  useProgressClock(
    view.now,
    demo,
    view.sessions.flatMap((session) => [session.opensAt, session.closesAt]),
  );
  const selectedMonth = Temporal.PlainYearMonth.from(month);
  const first = selectedMonth.toPlainDate({ day: 1 });
  const gridStart = first.subtract({ days: first.dayOfWeek - 1 });
  const cellCount = Math.ceil((first.dayOfWeek - 1 + selectedMonth.daysInMonth) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) =>
    gridStart.add({ days: index }).toString(),
  );
  const rows = Array.from({ length: cellCount / 7 }, (_, week) =>
    cells.slice(week * 7, week * 7 + 7),
  );
  const inMonth = view.sessions.filter((session) => session.practiceDate.startsWith(month));
  const visibleSessions = date
    ? inMonth.filter((session) => session.practiceDate === date)
    : inMonth;
  const shownJourneys = journeyId
    ? view.journeys.filter((journey) => journey.id === journeyId)
    : view.journeys;
  const monthLabel = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`));
  const today = Temporal.Instant.from(view.now)
    .toZonedDateTimeISO(
      view.journeys.find((journey) => journey.id === journeyId)?.timeZone ?? 'UTC',
    )
    .toPlainDate()
    .toString();
  function href(changes: { month?: string; mode?: 'grid' | 'list'; date?: string }) {
    const params = new URLSearchParams({
      month: changes.month ?? month,
      mode: changes.mode ?? mode,
    });
    if (journeyId) params.set('journey', journeyId);
    const chosenDate = changes.date ?? (changes.month ? '' : date);
    if (chosenDate) params.set('date', chosenDate);
    return `/calendar?${params.toString()}`;
  }
  return (
    <>
      <PageHeader
        title="Your practice calendar"
        description="Every session has its own date. See what you recorded and what lies ahead."
      />
      <form action="/calendar" method="get" className={shared.panel}>
        <div className={styles.filters}>
          <div className={shared.field}>
            <label htmlFor="calendar-month">Month</label>
            <input
              id="calendar-month"
              name="month"
              type="month"
              required
              defaultValue={month}
              key={month}
            />
          </div>
          <div className={shared.field}>
            <label htmlFor="calendar-journey">Journey</label>
            <select
              id="calendar-journey"
              name="journey"
              defaultValue={journeyId ?? ''}
              key={journeyId ?? 'all'}
            >
              <option value="">All journeys</option>
              {view.journeys.map((journey) => (
                <option key={journey.id} value={journey.id}>
                  {journey.title}
                </option>
              ))}
            </select>
          </div>
          <div className={shared.field}>
            <label htmlFor="calendar-date">Practice date (optional)</label>
            <input
              id="calendar-date"
              name="date"
              type="date"
              min={first.toString()}
              max={first.with({ day: selectedMonth.daysInMonth }).toString()}
              defaultValue={date ?? ''}
              key={date ?? 'all'}
            />
          </div>
        </div>
        <fieldset className={styles.viewChoices}>
          <legend>Calendar view</legend>
          <label>
            <input
              type="radio"
              name="mode"
              value="grid"
              defaultChecked={mode === 'grid'}
              key={`grid-${mode}`}
            />
            Month grid
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="list"
              defaultChecked={mode === 'list'}
              key={`list-${mode}`}
            />
            Session list
          </label>
        </fieldset>
        <button type="submit" className={shared.button}>
          Apply filters
        </button>
      </form>
      <nav aria-label="Calendar navigation" className={styles.calendarToolbar}>
        <Link
          prefetch={false}
          href={href({ month: selectedMonth.subtract({ months: 1 }).toString() })}
        >
          Previous month
        </Link>
        <Link prefetch={false} href={href({ month: today.slice(0, 7), date: today })}>
          Today
        </Link>
        <Link prefetch={false} href={href({ month: selectedMonth.add({ months: 1 }).toString() })}>
          Next month
        </Link>
        <Link prefetch={false} href={href({ mode: mode === 'grid' ? 'list' : 'grid' })}>
          {mode === 'grid' ? 'Use session list' : 'Use month grid'}
        </Link>
        {date && (
          <Link prefetch={false} href={href({ date: '' })}>
            Show whole month
          </Link>
        )}
      </nav>
      <p className={shared.quietNote}>
        Each entry uses its saved practice date and journey timezone. Nights are shown on the date
        the evening begins; civil sessions use the date practice begins. Device time never moves a
        calendar entry.
      </p>
      {shownJourneys.length > 0 && (
        <section aria-label="Full journey progress">
          <h2 className={shared.sectionTitle}>Across your journeys</h2>
          <ul className={styles.journeyTotals}>
            {shownJourneys.map((journey) => (
              <li key={journey.id}>
                <Link prefetch={false} href={`/journeys/${journey.id}`}>
                  {journey.title}
                </Link>
                <p>
                  {journey.metrics.complete} of {journey.metrics.total} sessions completed ·{' '}
                  {journey.metrics.percent}% complete
                </p>
              </li>
            ))}
          </ul>
          <p className={`${shared.small} ${shared.muted}`}>
            These totals cover each whole journey, including sessions outside this month.
          </p>
        </section>
      )}
      {mode === 'grid' && (
        <>
          <table className={styles.grid} aria-describedby="calendar-legend">
            <caption>{monthLabel}</caption>
            <thead>
              <tr>
                {weekdayLabels.map((day) => (
                  <th key={day} scope="col">
                    <abbr title={day}>{day.slice(0, 3)}</abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((week) => (
                <tr key={week[0]}>
                  {week.map((day) => {
                    const sessions = view.sessions.filter(
                      (session) => session.practiceDate === day,
                    );
                    const outside = !day.startsWith(month);
                    return (
                      <td
                        key={day}
                        data-date={day}
                        data-selected={date === day}
                        data-outside={outside}
                      >
                        <Link
                          prefetch={false}
                          className={styles.dayLink}
                          href={href({ month: day.slice(0, 7), date: day })}
                          aria-label={`Sessions for ${formatPracticeDate(day)}`}
                          aria-current={day === today ? 'date' : undefined}
                        >
                          {Number(day.slice(-2))}
                        </Link>
                        {sessions.map((session) => (
                          <Link
                            prefetch={false}
                            key={session.id}
                            className={styles.calendarEntry}
                            data-status={session.status}
                            href={`/journeys/${session.journeyId}/sessions/${session.id}`}
                            aria-label={`${session.journeyTitle}, ${formatPracticeDate(day)}, ${labels[session.status]}${session.practiceTiming === 'practiced_late' ? ', Practiced late' : ''}${session.recordedLater ? ', Recorded later' : ''}`}
                          >
                            <span>{session.journeyTitle}</span>
                            <span>{labels[session.status]}</span>
                            {session.practiceTiming === 'practiced_late' && (
                              <span>Practiced late</span>
                            )}
                            {session.recordedLater && <span>Recorded later</span>}
                          </Link>
                        ))}
                        {sessions.length === 0 && (
                          <span className={styles.emptyDay}>{outside ? '' : '—'}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p id="calendar-legend" className={styles.legend}>
            Complete · Partial · Missed · Open now · Upcoming. A dash means no scheduled session.
          </p>
        </>
      )}
      <section className={shared.section} aria-label="Selected sessions">
        <h2 className={shared.sectionTitle}>
          {date ? `Sessions for ${formatPracticeDate(date)}` : `${monthLabel} sessions`}
        </h2>
        <ProgressTimeline sessions={visibleSessions} showJourneys />
      </section>
      <p className={`${shared.small} ${shared.muted}`}>
        Open a session to see its actual times and saved checklist. Reflections and reminder history
        will appear when available.
      </p>
    </>
  );
}
