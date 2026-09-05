'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { requestJson } from '@/components/api';
import { formatPracticeDate, StatusBadge } from '@/components/presentation';
import { RequestErrorMessage } from '@/components/request-error';
import type { CursorPage, JournalEntry, JournalQuery } from '@/domain/contracts';
import shared from '@/styles/sanctuary.module.css';
import styles from './journal.module.css';

export interface JournalJourneyOption {
  id: string;
  title: string;
}

function JournalCards({ items }: { items: JournalEntry[] }) {
  if (!items.length) return <p className={styles.empty}>No reflections match these filters.</p>;
  return (
    <div className={styles.entries} aria-live="polite">
      {items.map((entry) => (
        <article className={shared.panel} key={entry.sessionId}>
          <div className={styles.entryHeader}>
            <div>
              <h2>{entry.journeyTitle}</h2>
              <p>{formatPracticeDate(entry.practiceDate)}</p>
            </div>
            <StatusBadge status={entry.status} />
          </div>
          {entry.textPreview && <p className={styles.reflectionText}>{entry.textPreview}</p>}
          {entry.moods.length > 0 && (
            <p className={styles.moodSummary}>Mood: {entry.moods.join(', ')}</p>
          )}
          <Link
            prefetch={false}
            className={`${shared.button} ${shared.secondary}`}
            href={`/journeys/${entry.journeyId}/sessions/${entry.sessionId}`}
          >
            Open reflection
          </Link>
        </article>
      ))}
    </div>
  );
}

export function Journal({
  initialPage,
  journeys,
}: {
  initialPage: CursorPage<JournalEntry>;
  journeys: JournalJourneyOption[];
}) {
  const [journeyId, setJourneyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mood, setMood] = useState('');
  const [text, setText] = useState('');
  const [page, setPage] = useState(initialPage);
  const [applied, setApplied] = useState<JournalQuery>({ limit: 20 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function runQuery(query: JournalQuery, append: boolean) {
    setPending(true);
    setError(null);
    try {
      const result = await requestJson<CursorPage<JournalEntry>>(
        '/api/journal/query',
        'POST',
        query,
      );
      setPage((current) =>
        append
          ? {
              items: [
                ...current.items,
                ...result.items.filter(
                  (item) =>
                    !current.items.some((existing) => existing.sessionId === item.sessionId),
                ),
              ],
              nextCursor: result.nextCursor,
            }
          : result,
      );
      if (!append) setApplied(query);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error('Could not load the journal. Your filters are still here.'),
      );
    } finally {
      setPending(false);
    }
  }

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query: JournalQuery = {
      ...(journeyId ? { journeyId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(mood.trim() ? { mood: mood.trim() } : {}),
      ...(text.trim() ? { text: text.trim() } : {}),
      limit: 20,
    };
    void runQuery(query, false);
  }

  return (
    <div className={styles.journalLayout}>
      <form className={`${shared.panel} ${styles.filters}`} onSubmit={filter}>
        <h2>Filter reflections</h2>
        <div className={shared.field}>
          <label htmlFor="journal-journey">Journey</label>
          <select
            id="journal-journey"
            value={journeyId}
            disabled={pending}
            onChange={(event) => setJourneyId(event.target.value)}
          >
            <option value="">All journeys</option>
            {journeys.map((journey) => (
              <option key={journey.id} value={journey.id}>
                {journey.title}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.dateFields}>
          <div className={shared.field}>
            <label htmlFor="journal-from">From practice date</label>
            <input
              id="journal-from"
              type="date"
              value={from}
              disabled={pending}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className={shared.field}>
            <label htmlFor="journal-to">To practice date</label>
            <input
              id="journal-to"
              type="date"
              value={to}
              disabled={pending}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        <div className={shared.field}>
          <label htmlFor="journal-mood">Mood tag</label>
          <input
            id="journal-mood"
            value={mood}
            disabled={pending}
            onChange={(event) => setMood(event.target.value)}
          />
        </div>
        <div className={shared.field}>
          <label htmlFor="journal-text">Reflection contains</label>
          <input
            id="journal-text"
            value={text}
            disabled={pending}
            onChange={(event) => setText(event.target.value)}
          />
          <small>Searches your private plain-text notes. Search terms stay out of the URL.</small>
        </div>
        <button type="submit" className={shared.button} disabled={pending}>
          {pending ? 'Filtering…' : 'Apply filters'}
        </button>
      </form>
      <section aria-label="Journal entries">
        <JournalCards items={page.items} />
        <RequestErrorMessage error={error} />
        {page.nextCursor && (
          <button
            type="button"
            className={`${shared.button} ${shared.secondary} ${styles.loadMore}`}
            disabled={pending}
            onClick={() =>
              void runQuery({ ...applied, cursor: page.nextCursor ?? undefined }, true)
            }
          >
            {pending ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>
    </div>
  );
}
