'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  MutationEnvelope,
  SessionHistory,
  SessionMutationResult,
  SessionRecord,
} from '@/domain/contracts';
import { deriveStatus, targetsMet } from '@/domain/status';
import { requestJson, RequestError } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import { formatInstant, StatusBadge } from '@/components/presentation';
import { PracticeValueInput } from './practice-value-input';
import { CompletionControls, HistoryTimeline } from './corrections';
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

interface PendingCompletion {
  performedAt: string;
  mutation: CompletionMutation;
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

function isSessionRecord(value: unknown, expectedId: string): value is SessionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<SessionRecord>;
  const validInstant = (instant: unknown) =>
    typeof instant === 'string' && Number.isFinite(Date.parse(instant));
  const validOptionalInstant = (instant: unknown) => instant === null || validInstant(instant);
  return (
    candidate.id === expectedId &&
    typeof candidate.journeyId === 'string' &&
    typeof candidate.scheduleVersionId === 'string' &&
    typeof candidate.practiceDate === 'string' &&
    typeof candidate.timeZone === 'string' &&
    (candidate.attribution === 'civil' || candidate.attribution === 'previous_evening') &&
    Number.isInteger(candidate.ordinal) &&
    Number.isInteger(candidate.revision) &&
    typeof candidate.confirmed === 'boolean' &&
    validInstant(candidate.opensAt) &&
    validInstant(candidate.closesAt) &&
    validOptionalInstant(candidate.performedAt) &&
    validOptionalInstant(candidate.recordedAt) &&
    validOptionalInstant(candidate.supersededAt) &&
    Array.isArray(candidate.practices) &&
    candidate.practices.every(
      (practice) =>
        practice &&
        typeof practice.id === 'string' &&
        typeof practice.label === 'string' &&
        Number.isInteger(practice.order) &&
        (practice.kind === 'checkbox'
          ? practice.target === null && typeof practice.value === 'boolean'
          : (practice.kind === 'repetitions' || practice.kind === 'minutes') &&
            typeof practice.target === 'number' &&
            Number.isInteger(practice.target) &&
            typeof practice.value === 'number' &&
            Number.isInteger(practice.value)),
    )
  );
}

function currentSessionFromNoChange(cause: unknown, sessionId: string) {
  if (!(cause instanceof RequestError) || cause.code !== 'NO_CHANGE') return null;
  return isSessionRecord(cause.current, sessionId) ? cause.current : null;
}

export function PracticePanel({
  initialSession,
  initialNow,
  demo,
  initialHistory = { amendments: [], events: [] },
}: {
  initialSession: SessionRecord;
  initialNow: string;
  demo: boolean;
  initialHistory?: SessionHistory;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [values, setValues] = useState<Record<string, PracticeValue>>(() =>
    savedValues(initialSession),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() => numericDrafts(initialSession));
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState(initialHistory);
  const [pending, setPending] = useState<'save' | 'complete' | 'undo' | null>(null);
  const [failedPracticeId, setFailedPracticeId] = useState<string | null>(null);
  const [message, setMessage] = useState('Changes are saved individually.');
  const [error, setError] = useState<Error | null>(null);
  const pendingSave = useRef<PendingPracticeSave | null>(null);
  const pendingCompletion = useRef<PendingCompletion | null>(null);
  const pendingRemoval = useRef<MutationEnvelope<Record<string, never>> | null>(null);
  const now = usePracticeClock(initialNow, demo);
  const status = deriveStatus(session, now);
  const beforeOpening = Date.parse(now) < Date.parse(session.opensAt);
  const closed = Date.parse(now) >= Date.parse(session.closesAt);
  const unsaved = dirtyIds.size > 0;
  const canEdit = !beforeOpening && !session.confirmed && !pending && !failedPracticeId;
  const canConfirm = canEdit && !closed && !unsaved && targetsMet(session);
  const conflict =
    error instanceof RequestError &&
    (error.code.includes('CONFLICT') || error.code.includes('REVISION'));

  function markDirty(practiceId: string) {
    setDirtyIds((current) => new Set(current).add(practiceId));
  }

  function addHistory(result: SessionMutationResult) {
    setHistory((current) => ({
      amendments: current.amendments.some(({ id }) => id === result.amendment.id)
        ? current.amendments
        : [...current.amendments, result.amendment].sort(
            (left, right) => left.sessionRevision - right.sessionRevision,
          ),
      events: [
        ...current.events,
        ...result.historyEvents.filter(
          (event) => !current.events.some(({ id }) => id === event.id),
        ),
      ],
    }));
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
      const result = await requestJson<SessionMutationResult>(
        `/api/sessions/${session.id}/practices`,
        'PUT',
        attempt.mutation,
      );
      setSession(result.session);
      addHistory(result);
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
      const currentSession = currentSessionFromNoChange(cause, session.id);
      if (currentSession) {
        setSession(currentSession);
        const serverValues = savedValues(currentSession);
        setValues((current) => {
          for (const dirtyId of dirtyIds) {
            if (dirtyId !== attempt.practiceId) serverValues[dirtyId] = current[dirtyId];
          }
          return serverValues;
        });
        if (typeof attempt.value === 'number') {
          setDrafts((current) => ({
            ...current,
            [attempt.practiceId]: String(serverValues[attempt.practiceId]),
          }));
        }
        setDirtyIds((current) => {
          const next = new Set(current);
          next.delete(attempt.practiceId);
          return next;
        });
        pendingSave.current = null;
        setFailedPracticeId(null);
        setError(null);
        setMessage('This value is already saved.');
        return;
      }
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
    if (session.practices.find(({ id }) => id === practiceId)?.value === value) {
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(practiceId);
        return next;
      });
      setError(null);
      setMessage('This value is already saved.');
      return;
    }
    setValues((current) => ({ ...current, [practiceId]: value }));
    void savePractice(practiceId, value);
  }

  async function recordCompletion(performedAt: string) {
    setPending('complete');
    setError(null);
    setMessage('Recording your session…');
    if (!pendingCompletion.current || pendingCompletion.current.performedAt !== performedAt) {
      pendingCompletion.current = {
        performedAt,
        mutation: {
          operationId: crypto.randomUUID(),
          baseRevision: session.revision,
          payload: { performedAt },
        },
      };
    }
    try {
      const result = await requestJson<SessionMutationResult>(
        `/api/sessions/${session.id}/completion`,
        'POST',
        pendingCompletion.current.mutation,
      );
      setSession(result.session);
      addHistory(result);
      setValues(savedValues(result.session));
      setDrafts(numericDrafts(result.session));
      setDirtyIds(new Set());
      setMessage(session.confirmed ? 'Practice time corrected.' : 'Session recorded.');
      pendingCompletion.current = null;
      router.refresh();
    } catch (cause) {
      const currentSession = currentSessionFromNoChange(cause, session.id);
      if (currentSession) {
        setSession(currentSession);
        setValues(savedValues(currentSession));
        setDrafts(numericDrafts(currentSession));
        setDirtyIds(new Set());
        pendingCompletion.current = null;
        setError(null);
        setMessage('This practice time is already recorded.');
        return;
      }
      setError(
        cause instanceof Error ? cause : new Error('Could not record this session. Try again.'),
      );
      setMessage(
        session.confirmed
          ? 'The practice-time correction was not saved. Your original record remains.'
          : 'Session has not been confirmed on this page. Try again to record it safely.',
      );
    } finally {
      setPending(null);
    }
  }

  async function removeRecordedCompletion() {
    setPending('undo');
    setError(null);
    setMessage('Removing the completion record…');
    pendingRemoval.current ??= {
      operationId: crypto.randomUUID(),
      baseRevision: session.revision,
      payload: {},
    };
    try {
      const result = await requestJson<SessionMutationResult>(
        `/api/sessions/${session.id}/completion`,
        'DELETE',
        pendingRemoval.current,
      );
      setSession(result.session);
      addHistory(result);
      setValues(savedValues(result.session));
      setDrafts(numericDrafts(result.session));
      setDirtyIds(new Set());
      setMessage('Completion removed. Your saved practice values remain.');
      pendingRemoval.current = null;
      pendingCompletion.current = null;
      router.refresh();
    } catch (cause) {
      const currentSession = currentSessionFromNoChange(cause, session.id);
      if (currentSession) {
        setSession(currentSession);
        setValues(savedValues(currentSession));
        setDrafts(numericDrafts(currentSession));
        setDirtyIds(new Set());
        pendingRemoval.current = null;
        pendingCompletion.current = null;
        setError(null);
        setMessage('The completion is already removed. Your saved practice values remain.');
        return;
      }
      setError(
        cause instanceof Error ? cause : new Error('Could not remove this completion. Try again.'),
      );
      setMessage('Completion was not removed. Your record remains saved.');
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
          This practice window has closed. Update the saved values, then enter when you actually
          practiced. The record will distinguish an in-window practice entered later from a late
          practice.
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
          disabled={Boolean(pending) || beforeOpening}
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
          <CompletionControls
            key={`${session.id}-${session.revision}`}
            session={session}
            now={now}
            pending={Boolean(pending) || conflict}
            onRecord={(performedAt) => void recordCompletion(performedAt)}
            onRemove={() => void removeRecordedCompletion()}
          />
          <Link
            prefetch={false}
            className={styles.button}
            href={`/today?journey=${session.journeyId}`}
          >
            Done
          </Link>
        </>
      ) : (
        <>
          {closed && !unsaved && targetsMet(session) ? (
            <CompletionControls
              key={`${session.id}-${session.revision}`}
              session={session}
              now={now}
              pending={Boolean(pending) || conflict}
              onRecord={(performedAt) => void recordCompletion(performedAt)}
              onRemove={() => void removeRecordedCompletion()}
            />
          ) : (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                disabled={!canConfirm}
                onClick={() => void recordCompletion(now)}
              >
                {pending === 'complete' ? 'Recording…' : 'Complete this session'}
              </button>
              <span className={`${styles.small} ${styles.muted}`}>
                {unsaved
                  ? 'Save your changes before confirming.'
                  : beforeOpening
                    ? 'Available when your practice opens.'
                    : closed
                      ? 'Complete every practice, then enter when you practiced.'
                      : targetsMet(session)
                        ? 'Confirm that you have completed your practice.'
                        : 'Complete every practice before confirming.'}
              </span>
            </div>
          )}
        </>
      )}
      <HistoryTimeline history={history} timeZone={session.timeZone} />
    </section>
  );
}
