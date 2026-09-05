import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SessionStatus } from '@/domain/contracts';
import styles from '@/styles/sanctuary.module.css';

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className={`${styles.header} ${action ? styles.headerRow : ''}`}>
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function ProgressRing({
  complete,
  total,
  percent,
}: {
  complete: number;
  total: number;
  percent: number;
}) {
  const circumference = 2 * Math.PI * 86;
  return (
    <div
      className={styles.progressRing}
      role="img"
      aria-label={`${complete} of ${total} sessions completed, ${percent}% complete`}
    >
      <svg viewBox="0 0 190 190" aria-hidden="true">
        <circle cx="95" cy="95" r="86" className={styles.ringTrack} />
        <circle
          cx="95"
          cy="95"
          r="86"
          className={styles.ringFill}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
        />
      </svg>
      <div className={styles.ringValue} aria-hidden="true">
        {percent}%<small>complete</small>
      </div>
    </div>
  );
}

const labels: Record<SessionStatus, string> = {
  upcoming: 'Upcoming',
  open: 'Open now',
  partial: 'Partial',
  complete: 'Complete',
  missed: 'Missed',
};
export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className={styles.status} data-status={status}>
      {labels[status]}
    </span>
  );
}

export function EmptyJourney() {
  return (
    <div className={styles.empty}>
      <h2>A practice of your choosing.</h2>
      <p>
        Give your intention a place and a time. Your first journey begins with what matters to you.
      </p>
      <Link className={styles.button} href="/setup">
        New journey
      </Link>
    </div>
  );
}

export function formatInstant(instant: string, timeZone: string, includeDate = true) {
  return new Intl.DateTimeFormat('en', {
    timeZone,
    ...(includeDate ? ({ day: 'numeric', month: 'long', year: 'numeric' } as const) : {}),
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant));
}

export function formatPracticeDate(date: string) {
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}
