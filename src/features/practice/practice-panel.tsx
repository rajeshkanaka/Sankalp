'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MutationEnvelope, SessionRecord } from '@/domain/contracts';
import { deriveStatus, targetsMet } from '@/domain/status';
import { requestJson, RequestError } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import { formatInstant, StatusBadge } from '@/components/presentation';
import { PracticeValueInput } from './practice-value-input';
import { countdownLabel, usePracticeClock } from './use-practice-clock';
import styles from '@/styles/sanctuary.module.css';

type PracticeValue = boolean | number;
type PracticeMutation = MutationEnvelope<{ values: Record<string, PracticeValue> }>;
type CompletionMutation = MutationEnvelope<{ performedAt: string }>;

interface PendingPracticeSave {
  practiceId: string;
  value: PracticeValue;
  mutation: PracticeMutation;
}

function savedValues(session: SessionRecord): Record<string, PracticeValue> {
  return Object.fromEntries(session.practices.map((practice) => [practice.id, practice.value]));
}

function numericDrafts(session: SessionRecord) {
  return Object.fromEntries(
    session.practices
      .filter((practice) => practice.kind !== 'checkbox')
      .map((practice) => [practice.id, String(practice.value)]),
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
  const [values, setValues] = useState<Record<string, PracticeValue>>(() =>
    savedValues(initialSession),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() => numericDrafts(initialSession));
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<'save' | 'complete' | null>(null);
  const [failedPracticeId, setFailedPracticeId] = useState<string | null>(null);
  const [message, setMessage] = useState('Changes are saved individually.');
  const [error, setError] = useState<Error | null>(null);
  const pendingSave = useRef<PendingPracticeSave | null>(null);
  const pendingCompletion = useRef<CompletionMutation | null>(null);
  const now = usePracticeClock(initialNow, demo);
  const status = deriveStatus(session, now);
  const beforeOpening = Date.parse(now) < Date.parse(session.opensAt);
  const closed = Date.parse(now) >= Date.parse(session.closesAt);
  const unsaved = dirtyIds.size > 0;
  const canEdit = !beforeOpening && !closed && !session.confirmed && !pending && !failedPracticeId;
  const canConfirm = canEdit && !unsaved && targetsMet(session);
  const conflict =
    error instanceof RequestError &&
    (error.code.includes('CONFLICT') || error.code.includes('REVISION'));

  function markDirty(practiceId: string) {
    setDirtyIds((current) => new Set(current).add(practiceId));
  }

  function editNumeric(practiceId: string, value: string) {
    setDrafts((current) => ({ ...current, [practiceId]: value }));
    markDirty(practiceId);
    if (pendingSave.current?.practiceId === practiceId) pendingSave.current = null;
    setError(null);
    setMessage('Not saved. Your entry is still on this page.');
  }

  async function savePractice(practiceId: string, value: PracticeValue, retry = false) {
    if (!retry && failedPracticeId && pendingSave.current) {
      setMessage('Retry the failed save before changing another practice.');
      return;
    }
    setPending('save');
    setError(null);
    setMessage('Saving your practice…');
    pendingCompletion.current = null;
    if (!retry || !pendingSave.current) {
      pendingSave.current = {
        practiceId,
        value,
        mutation: {
          operationId: crypto.randomUUID(),
          baseRevision: session.revision,
          payload: { values: { [practiceId]: value } },
        },
      };
    }
    const attempt = pendingSave.current;
    try {
      const result = await requestJson<{ session: SessionRecord }>(
        `/api/sessions/${session.id}/practices`,
        'PUT',
        attempt.mutation,
      );
      setSession(result.session);
      const serverValues = savedValues(result.session);
      setValues((current) => {
        for (const dirtyId of dirtyIds) {
          if (dirtyId !== attempt.practiceId) serverValues[dirtyId] = current[dirtyId];
        }
        return serverValues;
      });
      if (typeof attempt.value === 'number') {
        setDrafts((current) => ({ ...current, [attempt.practiceId]: String(attempt.value) }));
      }
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(attempt.practiceId);
        return next;
      });
      pendingSave.current = null;
      setFailedPracticeId(null);
      setMessage(
        [...dirtyIds].some((dirtyId) => dirtyId !== attempt.practiceId)
          ? 'Saved this value. Other entries are not saved.'
          : 'Saved.',
      );
    } catch (cause) {
      const label = session.practices.find((practice) => practice.id === attempt.practiceId)?.label;
      setFailedPracticeId(attempt.practiceId);
      setError(
        cause instanceof Error ? cause : new Error('Could not save. Your entry is still here.'),
      );
      setMessage(
        `Not saved. Retry ${label ?? 'this practice'} before changing another practice. Your entry is still here.`,
      );
    } finally {
      setPending(null);
    }
  }

  function saveNumeric(practiceId: string) {
    const raw = drafts[practiceId] ?? '';
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
      setError(new Error('Enter a whole number from 0 to 1,000,000. Your entry is still here.'));
      setMessage('Not saved. Check the number and try again.');
      return;
    }
    setValues((current) => ({ ...current, [practiceId]: value }));
    void savePractice(practiceId, value);
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
            <PracticeValueInput
              practice={practice}
              value={values[practice.id] ?? (practice.kind === 'checkbox' ? false : 0)}
              numericDraft={drafts[practice.id] ?? ''}
              disabled={!canEdit}
              dirty={dirtyIds.has(practice.id)}
              onCheckboxChange={(checked) => {
                setValues((current) => ({ ...current, [practice.id]: checked }));
                markDirty(practice.id);
                void savePractice(practice.id, checked);
              }}
              onNumericChange={(value) => editNumeric(practice.id, value)}
              onNumericSave={() => saveNumeric(practice.id)}
            />
          </li>
        ))}
      </ul>
      <p className={styles.saveState} role="status" aria-live="polite">
        {message}
      </p>
      <RequestErrorMessage error={error} />
      {unsaved && failedPracticeId && pendingSave.current && !conflict && (
        <button
          type="button"
          className={`${styles.button} ${styles.secondary}`}
          disabled={Boolean(pending) || beforeOpening || closed}
          onClick={() => {
            const attempt = pendingSave.current;
            if (attempt) void savePractice(attempt.practiceId, attempt.value, true);
          }}
        >
          Try saving again
        </button>
      )}
      {conflict && (
        <div>
          <p className={styles.muted}>
            Another change may have been saved. Your local entries remain visible above.
          </p>
          <button
            type="button"
            className={`${styles.button} ${styles.secondary}`}
            onClick={() => window.location.reload()}
          >
            Discard local entries and load saved practice
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
          <Link
            prefetch={false}
            className={styles.button}
            href={`/today?journey=${session.journeyId}`}
          >
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
