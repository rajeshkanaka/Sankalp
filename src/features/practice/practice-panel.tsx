'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MutationEnvelope, SessionRecord } from '@/domain/contracts';
import { deriveStatus, targetsMet } from '@/domain/status';
import { requestJson, RequestError } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import { formatInstant, StatusBadge } from '@/components/presentation';
import { countdownLabel, usePracticeClock } from './use-practice-clock';
import styles from '@/styles/sanctuary.module.css';

type PracticeMutation = MutationEnvelope<{ values: Record<string, boolean> }>;
type CompletionMutation = MutationEnvelope<{ performedAt: string }>;

function checkboxValues(session: SessionRecord) {
  return Object.fromEntries(
    session.practices.map((practice) => [practice.id, practice.value === true]),
  );
}

export function PracticePanel({
  initialSession,
  initialNow,
  demo,
}: {
  initialSession: SessionRecord;
  initialNow: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [values, setValues] = useState(() => checkboxValues(initialSession));
  const [pending, setPending] = useState<'save' | 'complete' | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [message, setMessage] = useState('Changes are saved individually.');
  const [error, setError] = useState<Error | null>(null);
  const pendingSave = useRef<PracticeMutation | null>(null);
  const pendingCompletion = useRef<CompletionMutation | null>(null);
  const now = usePracticeClock(initialNow, demo);
  const status = deriveStatus(session, now);
  const beforeOpening = Date.parse(now) < Date.parse(session.opensAt);
  const closed = Date.parse(now) >= Date.parse(session.closesAt);
  const canEdit = !beforeOpening && !closed && !session.confirmed && !pending;
  const canConfirm = canEdit && !unsaved && targetsMet(session);
  const conflict =
    error instanceof RequestError &&
    (error.code.includes('CONFLICT') || error.code.includes('REVISION'));

  async function saveValues(nextValues: Record<string, boolean>, retry = false) {
    setValues(nextValues);
    setUnsaved(true);
    setPending('save');
    setError(null);
    setMessage('Saving your practice…');
    pendingCompletion.current = null;
    if (!retry || !pendingSave.current)
      pendingSave.current = {
        operationId: crypto.randomUUID(),
        baseRevision: session.revision,
        payload: { values: nextValues },
      };
    try {
      const result = await requestJson<{ session: SessionRecord }>(
        `/api/sessions/${session.id}/practices`,
        'PUT',
        pendingSave.current,
      );
      setSession(result.session);
      setValues(checkboxValues(result.session));
      setUnsaved(false);
      pendingSave.current = null;
      setMessage('Saved.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error('Could not save. Your choices are still here.'),
      );
      setMessage('Not saved. Your choices are still on this page.');
    } finally {
      setPending(null);
    }
  }

  async function confirm() {
    if (!canConfirm) return;
    setPending('complete');
    setError(null);
    setMessage('Recording your session…');
    pendingCompletion.current ??= {
      operationId: crypto.randomUUID(),
      baseRevision: session.revision,
      payload: { performedAt: now },
    };
    try {
      const result = await requestJson<{ session: SessionRecord }>(
        `/api/sessions/${session.id}/completion`,
        'POST',
        pendingCompletion.current,
      );
      setSession(result.session);
      setMessage('Session recorded.');
      pendingCompletion.current = null;
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error('Could not record this session. Try again.'),
      );
      setMessage(
        'Session has not been confirmed on this page. Try again to check and record it safely.',
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.panel} aria-label="Practice checklist">
      <div className={styles.sessionMeta}>
        <StatusBadge status={status} />
        <span>
          {formatInstant(session.opensAt, session.timeZone, false)}–
          {formatInstant(session.closesAt, session.timeZone, false)}
        </span>
      </div>
      {beforeOpening && (
        <p className={styles.quietNote}>
          Your practice opens in {countdownLabel(session.opensAt, now)}, at{' '}
          {formatInstant(session.opensAt, session.timeZone)}. You can prepare now and record when
          the window opens.
        </p>
      )}
      {closed && !session.confirmed && (
        <p className={styles.quietNote}>
          This practice window has closed. Your saved progress remains visible. Historical
          corrections will be available in a later update.
        </p>
      )}
      <ul className={styles.checklist}>
        {session.practices.map((practice) => (
          <li key={practice.id}>
            <label className={styles.practiceCheck}>
              <input
                type="checkbox"
                aria-label={practice.label}
                checked={values[practice.id] ?? false}
                disabled={!canEdit || practice.kind !== 'checkbox'}
                onChange={(event) =>
                  void saveValues({ ...values, [practice.id]: event.target.checked })
                }
              />
              <span>
                {practice.label}
                <small>
                  {session.confirmed ? 'Recorded complete' : 'Mark when your practice is complete'}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className={styles.saveState} role="status" aria-live="polite">
        {pending ? message : unsaved ? 'Not saved. Your choices are still on this page.' : message}
      </p>
      <RequestErrorMessage error={error} />
      {unsaved && !conflict && (
        <button
          type="button"
          className={`${styles.button} ${styles.secondary}`}
          disabled={Boolean(pending) || beforeOpening || closed}
          onClick={() => void saveValues(values, true)}
        >
          Try saving again
        </button>
      )}
      {conflict && (
        <div>
          <p className={styles.muted}>
            Another change may have been saved. Your local choices remain visible above.
          </p>
          <button
            type="button"
            className={`${styles.button} ${styles.secondary}`}
            onClick={() => window.location.reload()}
          >
            Discard local choices and load saved practice
          </button>
        </div>
      )}
      {session.confirmed ? (
        <>
          <div className={styles.success} role="status">
            <h2>Your practice is recorded.</h2>
            <p>Take this moment with you.</p>
            {session.recordedAt && (
              <p className={styles.small}>
                Recorded {formatInstant(session.recordedAt, session.timeZone)}.
              </p>
            )}
          </div>
          <p className={`${styles.small} ${styles.muted}`}>
            Private reflections and corrections are not available yet.
          </p>
          <Link className={styles.button} href={`/today?journey=${session.journeyId}`}>
            Done
          </Link>
        </>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={!canConfirm}
            onClick={() => void confirm()}
          >
            {pending === 'complete' ? 'Recording…' : 'Complete this session'}
          </button>
          <span className={`${styles.small} ${styles.muted}`}>
            {unsaved
              ? 'Save your changes before confirming.'
              : beforeOpening
                ? 'Available when your practice opens.'
                : closed
                  ? 'The completion window is closed.'
                  : targetsMet(session)
                    ? 'Confirm that you have completed your practice.'
                    : 'Complete every practice before confirming.'}
          </span>
        </div>
      )}
    </section>
  );
}
