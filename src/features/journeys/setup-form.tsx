'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { JourneyDraft, JourneyRecord, JourneyView, SchedulePreview } from '@/domain/contracts';
import { formatInstant } from '@/components/presentation';
import { requestJson } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import styles from '@/styles/sanctuary.module.css';

interface DraftPreview {
  journey: JourneyRecord;
  preview: SchedulePreview;
  fingerprint: string;
}
interface PracticeInput {
  key: number;
  label: string;
}

export function SetupForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [intention, setIntention] = useState('');
  const [practices, setPractices] = useState<PracticeInput[]>([{ key: 1, label: '' }]);
  const nextKey = useRef(2);
  const [startDate, setStartDate] = useState('');
  const [duration, setDuration] = useState('');
  const [localTime, setLocalTime] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const [windowMinutes, setWindowMinutes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const activationId = useRef<string | null>(null);
  const creationAttempt = useRef<{ signature: string; id: string; draft: JourneyDraft } | null>(
    null,
  );
  const previewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  async function previewJourney(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const draft: JourneyDraft = {
      title: title.trim(),
      intention: intention.trim(),
      practices: practices.map((practice, order) => ({
        id: crypto.randomUUID(),
        label: practice.label.trim(),
        order,
        kind: 'checkbox',
        target: null,
      })),
      schedule: {
        startDate,
        durationMode: 'occurrences',
        durationValue: Number(duration),
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        localTime,
        timeZone: timeZone.trim(),
        attribution: 'civil',
        windowMinutes: Number(windowMinutes),
      },
      reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
    };
    const signature = JSON.stringify({
      ...draft,
      practices: draft.practices.map(({ label, order, kind, target }) => ({
        label,
        order,
        kind,
        target,
      })),
    });
    if (!creationAttempt.current || creationAttempt.current.signature !== signature)
      creationAttempt.current = { signature, id: crypto.randomUUID(), draft };
    try {
      const result = await requestJson<DraftPreview>(
        '/api/journeys',
        'POST',
        creationAttempt.current.draft,
        creationAttempt.current.id,
      );
      activationId.current = crypto.randomUUID();
      setPreview(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error('Could not preview this journey. Your entries are still here.'),
      );
    } finally {
      setPending(false);
    }
  }

  async function activate() {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      const view = await requestJson<JourneyView>(
        `/api/journeys/${preview.journey.id}/activate`,
        'POST',
        {
          operationId: activationId.current,
          baseRevision: preview.journey.revision,
          payload: { fingerprint: preview.fingerprint },
        },
      );
      router.push(`/today?journey=${view.journey.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error('Could not activate this journey. Try again.'),
      );
      setPending(false);
    }
  }

  if (preview) {
    const first = preview.preview.occurrences[0];
    const last = preview.preview.occurrences.at(-1);
    return (
      <section className={styles.panel}>
        <h2 ref={previewHeading} tabIndex={-1}>
          Review your journey
        </h2>
        <p className={styles.muted}>Check the actual dates and times before you begin.</p>
        <dl>
          <div className={styles.previewRow}>
            <dt>Journey</dt>
            <dd>{preview.journey.title}</dd>
          </div>
          {preview.journey.intention && (
            <div className={styles.previewRow}>
              <dt>Intention</dt>
              <dd>{preview.journey.intention}</dd>
            </div>
          )}
          <div className={styles.previewRow}>
            <dt>Practices</dt>
            <dd>
              {preview.journey.practices.map((practice) => (
                <div key={practice.id}>{practice.label}</div>
              ))}
            </dd>
          </div>
          <div className={styles.previewRow}>
            <dt>Schedule</dt>
            <dd>
              {preview.preview.total} daily sessions, each with a{' '}
              {preview.journey.schedule.windowMinutes}-minute window
            </dd>
          </div>
          {first && (
            <div className={styles.previewRow}>
              <dt>First practice</dt>
              <dd>{formatInstant(first.opensAt, timeZone)}</dd>
            </div>
          )}
          {last && (
            <div className={styles.previewRow}>
              <dt>Final practice</dt>
              <dd>{formatInstant(last.opensAt, timeZone)}</dd>
            </div>
          )}
          <div className={styles.previewRow}>
            <dt>Practice timezone</dt>
            <dd>{preview.journey.schedule.timeZone}</dd>
          </div>
          <div className={styles.previewRow}>
            <dt>Calendar date</dt>
            <dd>The date practice begins (civil date)</dd>
          </div>
          <div className={styles.previewRow}>
            <dt>Reminders</dt>
            <dd>Off. Reminders are not available in this first release.</dd>
          </div>
        </dl>
        {preview.preview.warnings.length > 0 && (
          <div className={styles.quietNote}>
            <ul>
              {preview.preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        <RequestErrorMessage error={error} />
        <div className={styles.actions}>
          <button className={styles.button} onClick={activate} disabled={pending}>
            {pending ? 'Activating…' : 'Activate journey'}
          </button>
          <button
            className={`${styles.button} ${styles.secondary}`}
            disabled={pending}
            onClick={() => {
              setPreview(null);
              setError(null);
            }}
          >
            Edit details
          </button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={previewJourney} className={styles.panel}>
      <fieldset className={styles.formSection} disabled={pending}>
        <legend>Your intention</legend>
        <div className={styles.field}>
          <label htmlFor="journey-title">Journey title</label>
          <input
            id="journey-title"
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="intention">
            Personal intention <span className={styles.muted}>(optional)</span>
          </label>
          <textarea
            id="intention"
            maxLength={4000}
            value={intention}
            onChange={(event) => setIntention(event.target.value)}
            aria-describedby="intention-help"
          />
          <small id="intention-help">A few words about what brings you to this practice.</small>
        </div>
      </fieldset>
      <fieldset className={styles.formSection} disabled={pending}>
        <legend>Your practices</legend>
        <p className={styles.muted}>
          Name the activities you will complete together. Every activity is required before
          confirming the session.
        </p>
        {practices.map((practice, index) => (
          <div className={styles.field} key={practice.key}>
            <label htmlFor={`practice-${practice.key}`}>Practice {index + 1}</label>
            <div className={styles.practiceInput}>
              <input
                id={`practice-${practice.key}`}
                required
                maxLength={120}
                value={practice.label}
                onChange={(event) =>
                  setPractices((current) =>
                    current.map((item) =>
                      item.key === practice.key ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className={styles.removeButton}
                disabled={practices.length === 1}
                aria-label={`Remove practice ${index + 1}`}
                onClick={() =>
                  setPractices((current) => current.filter((item) => item.key !== practice.key))
                }
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className={`${styles.button} ${styles.secondary}`}
          disabled={practices.length >= 20}
          onClick={() => {
            const key = nextKey.current++;
            setPractices((current) => [...current, { key, label: '' }]);
          }}
        >
          Add practice
        </button>
        <p className={`${styles.muted} ${styles.small}`} style={{ marginTop: 15 }}>
          Simple checkboxes are available now. Counts and minute targets come later.
        </p>
      </fieldset>
      <fieldset className={styles.formSection} disabled={pending}>
        <legend>A place in your day</legend>
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label htmlFor="start-date">Start date</label>
            <input
              id="start-date"
              type="date"
              required
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="duration">Number of sessions</label>
            <input
              id="duration"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              required
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
        </div>
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label htmlFor="practice-time">Practice time</label>
            <input
              id="practice-time"
              type="time"
              required
              value={localTime}
              onChange={(event) => setLocalTime(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="window">Completion window (minutes)</label>
            <input
              id="window"
              type="number"
              inputMode="numeric"
              min={1}
              max={1439}
              step={1}
              required
              value={windowMinutes}
              onChange={(event) => setWindowMinutes(event.target.value)}
            />
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor="timezone">Practice timezone</label>
          <input
            id="timezone"
            required
            value={timeZone}
            onChange={(event) => {
              setTimeZone(event.target.value);
              setZoneConfirmed(false);
            }}
            aria-describedby="timezone-help"
          />
          <small id="timezone-help">
            Suggested from your device. Use an IANA name, such as Asia/Kolkata. The journey keeps
            this timezone when you travel.
          </small>
        </div>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={zoneConfirmed}
            onChange={(event) => setZoneConfirmed(event.target.checked)}
            required
          />
          <span>I confirm this practice timezone.</span>
        </label>
        <p className={styles.quietNote}>
          One session every day, on the date practice begins. For independent morning and evening
          routines, create separate journeys. Weekday schedules, overnight attribution and reminders
          will follow.
        </p>
      </fieldset>
      <RequestErrorMessage error={error} />
      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? 'Preparing preview…' : 'Preview journey'}
      </button>
    </form>
  );
}
