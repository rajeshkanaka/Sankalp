'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RequestError, requestJson } from '@/components/api';
import { useOnlineEditorCheckpoint } from '@/features/practice/use-online-editor-checkpoint';
import { RequestErrorMessage } from '@/components/request-error';
import type {
  MutationEnvelope,
  ReflectionMutationResult,
  ReflectionPayload,
  ReflectionPreferences,
  ReflectionRecord,
  SessionRecord,
} from '@/domain/contracts';
import shared from '@/styles/sanctuary.module.css';
import styles from './journal.module.css';

const MAX_TEXT = 20_000;
const MAX_MOOD = 40;
const AUTOSAVE_DELAY = 900;

interface ConflictVersions {
  local: ReflectionPayload;
  server: ReflectionRecord | null;
}

function signature(payload: ReflectionPayload): string {
  return JSON.stringify(payload);
}

function matchesReflection(payload: ReflectionPayload, reflection: ReflectionRecord): boolean {
  return signature(payload) === signature({ text: reflection.text, moods: reflection.moods });
}

function hasInvalidPlainText(value: string): boolean {
  if (value.includes('\0')) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function payloadError(payload: ReflectionPayload): string | null {
  if (Array.from(payload.text).length > MAX_TEXT)
    return `Use no more than ${MAX_TEXT.toLocaleString('en')} characters.`;
  if (hasInvalidPlainText(payload.text)) return 'Remove unsupported characters from the note.';
  if (payload.moods.length > 5) return 'Choose up to five mood tags.';
  if (new Set(payload.moods).size !== payload.moods.length) return 'Mood tags must be unique.';
  if (payload.moods.some((mood) => !mood || Array.from(mood).length > MAX_MOOD))
    return 'Each mood must use 1 to 40 characters.';
  return null;
}

function reflectionFromConflict(
  value: unknown,
  sessionId: string,
): ReflectionRecord | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.sessionId !== sessionId ||
    typeof record.journeyId !== 'string' ||
    typeof record.scheduleVersionId !== 'string' ||
    typeof record.text !== 'string' ||
    !Array.isArray(record.moods) ||
    !record.moods.every((mood) => typeof mood === 'string') ||
    typeof record.revision !== 'number' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  )
    return undefined;
  return record as unknown as ReflectionRecord;
}

function promptLabel(prompt: ReflectionPreferences['prompts'][number]): string {
  return prompt === 'noticed'
    ? 'What did you notice?'
    : 'What would you like to carry into tomorrow?';
}

function Version({ label, payload }: { label: string; payload: ReflectionPayload }) {
  return (
    <section className={styles.version} aria-label={label}>
      <h4>{label}</h4>
      <p className={styles.reflectionText}>{payload.text || 'No written note.'}</p>
      <p className={shared.small}>
        {payload.moods.length ? payload.moods.join(', ') : 'No mood tags.'}
      </p>
    </section>
  );
}

export function ReflectionEditor({
  session,
  initialReflection,
  preferences,
  now,
}: {
  session: SessionRecord;
  initialReflection: ReflectionRecord | null;
  preferences: ReflectionPreferences;
  now: string;
}) {
  if (initialReflection && initialReflection.sessionId !== session.id)
    throw new Error('Reflection does not belong to this session.');

  const initialPayload = useMemo<ReflectionPayload>(
    () => ({
      text: initialReflection?.text ?? '',
      moods: initialReflection ? [...initialReflection.moods] : [],
    }),
    [initialReflection],
  );
  const [text, setText] = useState(initialPayload.text);
  const [moods, setMoods] = useState(initialPayload.moods);
  const [moodInput, setMoodInput] = useState('');
  const [revision, setRevision] = useState(initialReflection?.revision ?? 0);
  const [savedSignature, setSavedSignature] = useState(() => signature(initialPayload));
  const [pending, setPending] = useState(false);
  const [autosaveBlocked, setAutosaveBlocked] = useState(false);
  const [retryRequired, setRetryRequired] = useState(false);
  const [state, setState] = useState(initialReflection ? 'Saved.' : 'No reflection saved yet.');
  const [error, setError] = useState<Error | null>(null);
  const [conflict, setConflict] = useState<ConflictVersions | null>(null);
  const attempt = useRef<{
    signature: string;
    mutation: MutationEnvelope<ReflectionPayload>;
  } | null>(null);
  const revisionRef = useRef(revision);
  const pendingRef = useRef(false);
  const latestPayload = useRef(initialPayload);
  const payload = useMemo<ReflectionPayload>(() => ({ text, moods }), [text, moods]);
  latestPayload.current = payload;
  revisionRef.current = revision;
  const currentSignature = signature(payload);
  const { frozen, isFrozen, trackRequest } = useOnlineEditorCheckpoint(
    currentSignature !== savedSignature || moodInput.length > 0 || pending || Boolean(conflict),
  );
  const validationMessage = payloadError(payload);
  const unavailable =
    Boolean(session.supersededAt) || Date.parse(now) < Date.parse(session.opensAt);

  const persist = useCallback(
    async (options?: { retry?: boolean; payload?: ReflectionPayload; baseRevision?: number }) => {
      if (pendingRef.current || isFrozen()) return;
      const nextPayload = options?.payload ?? latestPayload.current;
      const nextError = payloadError(nextPayload);
      if (nextError) {
        setError(new Error(nextError));
        setState('Not saved.');
        return;
      }
      const nextSignature = signature(nextPayload);
      if (!options?.retry || !attempt.current || attempt.current.signature !== nextSignature) {
        attempt.current = {
          signature: nextSignature,
          mutation: {
            operationId: crypto.randomUUID(),
            baseRevision: options?.baseRevision ?? revisionRef.current,
            payload: nextPayload,
          },
        };
      }
      const currentAttempt = attempt.current;
      pendingRef.current = true;
      setPending(true);
      setState('Saving…');
      setError(null);
      try {
        const saved = await trackRequest(() =>
          requestJson<ReflectionMutationResult>(
            `/api/sessions/${session.id}/reflection`,
            'PUT',
            currentAttempt.mutation,
          ),
        );
        revisionRef.current = saved.revision;
        setRevision(saved.revision);
        setSavedSignature(currentAttempt.signature);
        setState('Saved.');
        setAutosaveBlocked(false);
        setRetryRequired(false);
        setConflict(null);
        attempt.current = null;
      } catch (cause) {
        if (
          cause instanceof RequestError &&
          (cause.code === 'REVISION_CONFLICT' || cause.code === 'NO_CHANGE')
        ) {
          const server = reflectionFromConflict(cause.current, session.id);
          if (server && matchesReflection(currentAttempt.mutation.payload, server)) {
            revisionRef.current = server.revision;
            setRevision(server.revision);
            setText(server.text);
            setMoods([...server.moods]);
            setSavedSignature(signature({ text: server.text, moods: server.moods }));
            setState('Saved.');
            setAutosaveBlocked(false);
            setRetryRequired(false);
            setConflict(null);
            setError(null);
            attempt.current = null;
            return;
          }
          if (cause.code === 'REVISION_CONFLICT' && server !== undefined) {
            setConflict({ local: currentAttempt.mutation.payload, server });
            setState('Choose which version to keep.');
            setAutosaveBlocked(true);
            setRetryRequired(false);
            attempt.current = null;
            return;
          }
        }
        setError(
          cause instanceof Error
            ? cause
            : new Error('Could not save this reflection. Your note is still here.'),
        );
        setState('Not saved.');
        setAutosaveBlocked(true);
        const uncertain =
          cause instanceof RequestError &&
          (cause.code === 'NETWORK_ERROR' ||
            cause.code === 'RESPONSE_ERROR' ||
            (typeof cause.status === 'number' && cause.status >= 500));
        setRetryRequired(uncertain);
        if (!uncertain) attempt.current = null;
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [session.id, isFrozen, trackRequest],
  );

  useEffect(() => {
    if (
      frozen ||
      currentSignature === savedSignature ||
      validationMessage ||
      pending ||
      autosaveBlocked ||
      retryRequired ||
      conflict ||
      unavailable
    )
      return;
    setState('Not saved. Autosave is waiting.');
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [
    autosaveBlocked,
    frozen,
    conflict,
    currentSignature,
    pending,
    persist,
    retryRequired,
    savedSignature,
    unavailable,
    validationMessage,
  ]);

  function addMood() {
    if (isFrozen()) return;
    const mood = moodInput.trim();
    if (!mood || Array.from(mood).length > MAX_MOOD) {
      setError(new Error('Enter a mood using 1 to 40 characters.'));
      return;
    }
    if (moods.includes(mood)) {
      setError(new Error('That mood is already selected.'));
      return;
    }
    if (moods.length >= 5) {
      setError(new Error('Choose up to five mood tags.'));
      return;
    }
    setMoods((current) => [...current, mood]);
    setMoodInput('');
    setError(null);
    setAutosaveBlocked(false);
    setRetryRequired(false);
  }

  function useSavedVersion() {
    if (isFrozen()) return;
    if (!conflict) return;
    const next = conflict.server
      ? { text: conflict.server.text, moods: [...conflict.server.moods] }
      : { text: '', moods: [] };
    const nextRevision = conflict.server?.revision ?? 0;
    setText(next.text);
    setMoods(next.moods);
    revisionRef.current = nextRevision;
    setRevision(nextRevision);
    setSavedSignature(signature(next));
    setConflict(null);
    setError(null);
    setAutosaveBlocked(false);
    setRetryRequired(false);
    setState(conflict.server ? 'Loaded the saved version.' : 'Loaded the empty saved version.');
  }

  function keepLocalVersion() {
    if (isFrozen()) return;
    if (!conflict) return;
    const local = conflict.local;
    const baseRevision = conflict.server?.revision ?? 0;
    setText(local.text);
    setMoods([...local.moods]);
    revisionRef.current = baseRevision;
    setRevision(baseRevision);
    setConflict(null);
    setError(null);
    setAutosaveBlocked(false);
    setRetryRequired(false);
    attempt.current = null;
    void persist({ payload: local, baseRevision });
  }

  if (unavailable) {
    return (
      <section className={shared.panel} aria-label="Private reflection">
        <h2>Private reflection</h2>
        <p className={shared.muted}>
          {session.supersededAt
            ? 'This session was replaced by a schedule change, so its reflection cannot be edited.'
            : 'You can add a reflection after this practice opens.'}
        </p>
      </section>
    );
  }

  return (
    <section className={shared.panel} aria-label="Private reflection">
      <h2>Private reflection</h2>
      <p className={shared.muted}>This plain-text note is visible only in your account.</p>
      {preferences.prompts.length > 0 && (
        <ul className={styles.prompts} aria-label="Optional reflection prompts">
          {preferences.prompts.map((prompt) => (
            <li key={prompt}>{promptLabel(prompt)}</li>
          ))}
        </ul>
      )}
      <div className={shared.field}>
        <label htmlFor={`reflection-${session.id}`}>Your reflection</label>
        <textarea
          id={`reflection-${session.id}`}
          className={styles.editor}
          value={text}
          disabled={frozen || pending || Boolean(conflict) || retryRequired}
          aria-describedby={`reflection-count-${session.id}`}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
            setAutosaveBlocked(false);
          }}
        />
        <small id={`reflection-count-${session.id}`}>
          {Array.from(text).length.toLocaleString('en')} of {MAX_TEXT.toLocaleString('en')}{' '}
          characters
        </small>
      </div>
      <div className={shared.field}>
        <label htmlFor={`mood-${session.id}`}>Mood tag (optional)</label>
        <div className={styles.moodEntry}>
          <input
            id={`mood-${session.id}`}
            value={moodInput}
            disabled={frozen || pending || Boolean(conflict) || retryRequired || moods.length >= 5}
            onChange={(event) => setMoodInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addMood();
              }
            }}
          />
          <button
            type="button"
            className={`${shared.button} ${shared.secondary}`}
            disabled={frozen || pending || Boolean(conflict) || retryRequired || moods.length >= 5}
            onClick={addMood}
          >
            Add mood
          </button>
        </div>
        {moods.length > 0 && (
          <ul className={styles.moods} aria-label="Selected moods">
            {moods.map((mood) => (
              <li key={mood}>
                <span>{mood}</span>
                <button
                  type="button"
                  aria-label={`Remove mood ${mood}`}
                  disabled={frozen || pending || Boolean(conflict) || retryRequired}
                  onClick={() => {
                    setMoods((current) => current.filter((item) => item !== mood));
                    setError(null);
                    setAutosaveBlocked(false);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className={styles.saveState} role="status" aria-live="polite">
        {validationMessage ?? state}
      </p>
      {!conflict && <RequestErrorMessage error={error} />}
      {conflict && (
        <div className={styles.conflict} role="alert">
          <h3>Another device saved a different reflection.</h3>
          <p>Both versions are preserved here. Choose one deliberately.</p>
          <div className={styles.versions}>
            <Version label="Your unsaved reflection" payload={conflict.local} />
            <Version
              label="Saved reflection"
              payload={
                conflict.server
                  ? { text: conflict.server.text, moods: conflict.server.moods }
                  : { text: '', moods: [] }
              }
            />
          </div>
          <div className={shared.actions}>
            <button
              type="button"
              className={shared.button}
              disabled={frozen}
              onClick={keepLocalVersion}
            >
              Keep my version
            </button>
            <button
              type="button"
              className={`${shared.button} ${shared.secondary}`}
              disabled={frozen}
              onClick={useSavedVersion}
            >
              Use saved version
            </button>
          </div>
        </div>
      )}
      <div className={shared.actions}>
        <button
          type="button"
          className={shared.button}
          disabled={
            frozen ||
            pending ||
            Boolean(conflict) ||
            retryRequired ||
            Boolean(validationMessage) ||
            currentSignature === savedSignature
          }
          onClick={() => void persist()}
        >
          {pending ? 'Saving…' : 'Save reflection'}
        </button>
        {error && retryRequired && attempt.current && !conflict && (
          <button
            type="button"
            className={`${shared.button} ${shared.secondary}`}
            disabled={frozen || pending}
            onClick={() => void persist({ retry: true })}
          >
            Try saving again
          </button>
        )}
      </div>
    </section>
  );
}
