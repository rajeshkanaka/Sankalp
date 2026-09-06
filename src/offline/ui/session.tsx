'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { deriveCompletionTiming, deriveStatus, targetsMet } from '@/domain/status';
import type { ReflectionPayload, SessionPractice } from '@/domain/contracts';
import {
  OfflineError,
  enqueue,
  read,
  refreshConflict,
  resolve,
  saveDraft,
  saveSnapshot,
  subscribe,
  type AccountScope,
  type EnqueueInput,
  type FlushResult,
  type Intent,
  type LocalView,
  type QueueOperation,
  type RawDraft,
  type Snapshot,
  type Stream,
} from '../core';
import shared from '@/styles/sanctuary.module.css';
import styles from './offline.module.css';
import { DraftSummary, IntentSummary, OfflineConflict, SavedSummary } from './conflict';
import { effectiveNow, formatInstant, instantFromLocalInput, localInputValue } from './format';
import { OfflineReflectionEditor, reflectionError } from './reflection-controls';
import { useOfflineAccount } from './account-context';

const AUTOSAVE_DELAY = 900;

function numericInputs(view: LocalView): Record<string, string> {
  return Object.fromEntries(
    view.projectedSession.practices
      .filter((practice) => practice.kind !== 'checkbox')
      .map((practice) => [
        practice.id,
        view.draft?.numericValues?.[practice.id] ?? String(practice.value),
      ]),
  );
}

function reflectionInput(view: LocalView): ReflectionPayload {
  return view.draft?.reflection
    ? { text: view.draft.reflection.text, moods: [...view.draft.reflection.moods] }
    : {
        text: view.projectedReflection.text,
        moods: [...view.projectedReflection.moods],
      };
}

function pendingCount(view: LocalView): number {
  return view.operations.filter(({ state }) => state !== 'conflict' && state !== 'review_required')
    .length;
}

function retryMessage(result: FlushResult): string {
  switch (result.reason) {
    case 'drained':
      return 'Saved.';
    case 'offline':
      return 'Saved on this device. Waiting for a connection.';
    case 'auth':
      return 'Saved on this device. Sign in to this account again before syncing.';
    case 'conflict':
      return 'Saved on this device. Review the conflict below.';
    case 'retry':
    case 'not_leader':
      return 'Saved on this device. Another sync attempt is scheduled.';
    case 'storage':
    case 'unsupported':
      return 'The local queue needs attention before it can sync.';
    case 'account_changed':
      return 'Sync stopped because the verified account changed.';
    case 'aborted':
      return 'Sync paused. Your queued change remains on this device.';
  }
}

function safeLocalError(error: unknown): string {
  if (error instanceof OfflineError) return error.message;
  return 'This change was not saved on this device. Keep this page open and try again.';
}

function streamRevision(view: LocalView, stream: Stream): number {
  return stream === 'reflection'
    ? (view.snapshot.reflection?.revision ?? 0)
    : view.snapshot.session.revision;
}

function reviewedOperationIds(view: LocalView, operation: QueueOperation): string[] {
  return view.operations
    .filter((candidate) => candidate.stream === operation.stream)
    .map(({ operationId }) => operationId);
}

function canonicalChanged(before: LocalView, after: LocalView): boolean {
  return (
    before.snapshot.session.revision !== after.snapshot.session.revision ||
    (before.snapshot.reflection?.revision ?? 0) !== (after.snapshot.reflection?.revision ?? 0)
  );
}

function NumericPractice({
  practice,
  value,
  disabled,
  onChange,
  onSave,
}: {
  practice: SessionPractice;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  onSave(): void;
}) {
  const recorded = typeof practice.value === 'number' ? practice.value : 0;
  const unit = practice.kind === 'minutes' ? 'minutes' : 'repetitions';
  return (
    <div className={styles.numericPractice}>
      <div>
        <strong>{practice.label}</strong>
        <small>
          Recorded {recorded.toLocaleString('en')} of {practice.target?.toLocaleString('en')} {unit}
        </small>
      </div>
      <div className={styles.numericEntry}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={1_000_000}
          step={1}
          aria-label={practice.label}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={disabled || value === String(practice.value)}
          aria-label={`Save value for ${practice.label}`}
          onClick={onSave}
        >
          Save value
        </button>
        <small>
          Whole {unit}; target {practice.target?.toLocaleString('en')}.
        </small>
      </div>
    </div>
  );
}

export function OfflineSession(props: {
  snapshot: Snapshot;
  now: string;
  demo: boolean;
  onCanonicalChange?: () => void;
}) {
  const { scope } = useOfflineAccount();
  return (
    <SessionEditor
      key={`${scope?.generation ?? 'unavailable'}:${props.snapshot.session.id}`}
      {...props}
    />
  );
}

function SessionEditor({
  snapshot,
  now,
  demo,
  onCanonicalChange,
}: {
  snapshot: Snapshot;
  now: string;
  demo: boolean;
  onCanonicalChange?: () => void;
}) {
  const { status, scope, frozen, flushNow, registerEditor, isFrozen, invalidate, onlineOnly } =
    useOfflineAccount();
  const [view, setView] = useState<LocalView | null>(null);
  const viewRef = useRef<LocalView | null>(null);
  const [numeric, setNumeric] = useState<Record<string, string>>({});
  const numericRef = useRef<Record<string, string>>({});
  const [reflection, setReflection] = useState<ReflectionPayload>({ text: '', moods: [] });
  const reflectionRef = useRef(reflection);
  const rawDraftRef = useRef<RawDraft | null>(null);
  const draftRevisionRef = useRef(0);
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const draftSequence = useRef(0);
  const inputDirty = useRef(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [pendingLocal, setPendingLocal] = useState<EnqueueInput | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('Preparing offline saving…');
  const [reflectionMessage, setReflectionMessage] = useState('No reflection saved yet.');
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [editingCompletion, setEditingCompletion] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [performedInput, setPerformedInput] = useState('');
  const [performedError, setPerformedError] = useState<string | null>(null);
  const [deviceNow, setDeviceNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (demo) return;
    const timer = window.setInterval(() => setDeviceNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, [demo]);
  const initialized = useRef(false);
  const alive = useRef(true);
  const readSequence = useRef(0);
  const commitRef = useRef<Promise<void> | null>(null);
  const draftBlocked = useRef(false);
  const [draftFailure, setDraftFailure] = useState(false);
  const [draftComparison, setDraftComparison] = useState<LocalView | null>(null);
  const [enqueueComparison, setEnqueueComparison] = useState<LocalView | null>(null);
  const pendingRetry = useRef<{ input: EnqueueInput; draftAfter: RawDraft | null } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(
    () =>
      registerEditor({
        settle: async () => {
          await draftQueue.current;
          await commitRef.current;
        },
        hasUnstoredInput: () => inputDirty.current || Boolean(pendingRetry.current),
      }),
    [registerEditor],
  );

  const applyView = useCallback((next: LocalView) => {
    if (!alive.current) return;
    viewRef.current = next;
    setView(next);
    if (!inputDirty.current) {
      draftRevisionRef.current = next.draftRevision;
      rawDraftRef.current = next.draft;
      const nextNumeric = numericInputs(next);
      const nextReflection = reflectionInput(next);
      numericRef.current = nextNumeric;
      reflectionRef.current = nextReflection;
      setNumeric(nextNumeric);
      setReflection(nextReflection);
    }
  }, []);

  const load = useCallback(
    async (activeScope: AccountScope, notifyCanonical = false) => {
      const ticket = ++readSequence.current;
      const before = viewRef.current;
      const next = await read(activeScope, snapshot.session.id);
      if (!next) throw new OfflineError('SNAPSHOT_MISSING', 'Open this practice online once more.');
      if (!alive.current || ticket !== readSequence.current) return next;
      applyView(next);
      if (notifyCanonical && before && canonicalChanged(before, next)) onCanonicalChange?.();
      return next;
    },
    [applyView, onCanonicalChange, snapshot.session.id],
  );

  const flushAndRefresh = useCallback(async () => {
    if (!scope || frozen) return;
    setWorking(true);
    try {
      const result = await flushNow();
      setRetryAt(result.retryAt);
      const next = await load(scope, true);
      const waiting = pendingCount(next);
      const nextMessage =
        result.blocked ||
        next.operations.some(({ state }) => state === 'conflict' || state === 'review_required')
          ? 'Saved on this device. Review the conflict below.'
          : waiting
            ? retryMessage(result)
            : result.reason === 'drained'
              ? 'Saved.'
              : retryMessage(result);
      setMessage(nextMessage);
      setReflectionMessage(nextMessage);
      setError(null);
    } catch (cause) {
      if (cause instanceof OfflineError && cause.code === 'ACCOUNT_CHANGED') {
        invalidate();
        return;
      }
      setError(safeLocalError(cause));
      setMessage('Saved on this device. Sync needs attention.');
      setReflectionMessage('Saved on this device. Sync needs attention.');
    } finally {
      setWorking(false);
    }
  }, [flushNow, frozen, invalidate, load, scope]);

  useEffect(() => {
    if (status !== 'ready' || !scope) return;
    let active = true;
    initialized.current = false;
    const prepare = async () => {
      try {
        if (snapshot.session.id !== snapshot.reflection?.sessionId && snapshot.reflection !== null)
          throw new OfflineError(
            'IDENTITY_MISMATCH',
            'This reflection does not match the practice.',
          );
        if (snapshot.clock.serverNow !== now || snapshot.clock.simulated !== demo)
          throw new OfflineError(
            'CLOCK_MISMATCH',
            'The saved practice clock could not be verified.',
          );
        effectiveNow(snapshot.clock);
        await saveSnapshot(scope, snapshot);
        const next = await read(scope, snapshot.session.id);
        if (!active || !next) return;
        applyView(next);
        const deviceNow = effectiveNow(next.snapshot.clock);
        setPerformedInput(
          localInputValue(
            next.projectedSession.performedAt ?? deviceNow,
            next.projectedSession.timeZone,
          ),
        );
        const waiting = pendingCount(next);
        setMessage(
          waiting
            ? `Saved on this device. ${waiting} change(s) waiting to sync.`
            : 'Changes are saved individually.',
        );
        setReflectionMessage(
          waiting
            ? 'Saved on this device. Waiting to sync.'
            : next.snapshot.reflection
              ? 'Saved.'
              : 'No reflection saved yet.',
        );
        initialized.current = true;
        if (waiting) void flushAndRefresh();
      } catch (cause) {
        if (!active) return;
        if (cause instanceof OfflineError && cause.code === 'ACCOUNT_CHANGED') {
          invalidate();
          return;
        }
        if (!viewRef.current && !inputDirty.current)
          onlineOnly(
            'This device could not prepare offline saving. Use the online controls to continue.',
          );
        setError(safeLocalError(cause));
      }
    };
    void prepare();
    const stop = subscribe(scope, () => {
      if (initialized.current && !inputDirty.current)
        void load(scope).catch((cause) => {
          if (cause instanceof OfflineError && cause.code === 'ACCOUNT_CHANGED') invalidate();
          else setError(safeLocalError(cause));
        });
    });
    return () => {
      active = false;
      initialized.current = false;
      stop();
    };
  }, [
    applyView,
    demo,
    flushAndRefresh,
    invalidate,
    load,
    now,
    onlineOnly,
    scope,
    snapshot,
    status,
  ]);

  useEffect(() => {
    if (!scope || frozen) return;
    const retry = () => void flushAndRefresh();
    const focus = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('online', retry);
    window.addEventListener('pageshow', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', focus);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('pageshow', retry);
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [flushAndRefresh, frozen, scope]);

  useEffect(() => {
    if (!retryAt || frozen) return;
    const wait = Math.max(0, Math.min(60_000, Date.parse(retryAt) - Date.now()));
    const timer = window.setTimeout(() => void flushAndRefresh(), wait);
    return () => window.clearTimeout(timer);
  }, [flushAndRefresh, frozen, retryAt]);

  const persistDraft = useCallback(
    (next: RawDraft | null, target: 'practice' | 'reflection') => {
      if (!scope || !alive.current) return Promise.reject(new OfflineError('ACCOUNT_CHANGED'));
      rawDraftRef.current = next;
      inputDirty.current = true;
      const sequence = ++draftSequence.current;
      setDraftSaving(true);
      if (target === 'practice') setMessage('Saving draft on this device…');
      else setReflectionMessage('Saving draft on this device…');
      const previous = draftQueue.current.catch(() => undefined);
      const job = previous
        .then(async () => {
          if (!alive.current) throw new OfflineError('ACCOUNT_CHANGED');
          if (draftBlocked.current)
            throw new OfflineError(
              'LOCAL_CONFLICT',
              'Your unsaved input needs review before another draft write.',
            );
          const revision = await saveDraft(
            scope,
            snapshot.session.id,
            next,
            draftRevisionRef.current,
          );
          draftRevisionRef.current = revision;
          if (alive.current && sequence === draftSequence.current) {
            inputDirty.current = false;
            setDraftFailure(false);
            setDraftComparison(null);
            setDraftSaving(false);
            if (target === 'practice') setMessage('Draft saved on this device.');
            else setReflectionMessage('Draft saved on this device.');
          }
        })
        .catch((cause) => {
          draftBlocked.current = true;
          if (cause instanceof OfflineError && cause.code === 'ACCOUNT_CHANGED') {
            invalidate();
            throw cause;
          }
          if (alive.current && sequence === draftSequence.current) {
            inputDirty.current = true;
            setDraftFailure(true);
            setDraftSaving(false);
            setError(safeLocalError(cause));
            if (target === 'practice') setMessage('Not saved on this device. Keep this page open.');
            else setReflectionMessage('Not saved on this device. Keep this page open.');
          }
          throw cause;
        });
      draftQueue.current = job.catch(() => undefined);
      return job;
    },
    [invalidate, scope, snapshot.session.id],
  );

  const commit = useCallback(
    async (input: EnqueueInput, draftAfter: RawDraft | null = rawDraftRef.current) => {
      if (!scope || isFrozen() || commitRef.current) return;
      pendingRetry.current = { input, draftAfter };
      setPendingLocal(input);
      setWorking(true);
      setError(null);
      const job = (async () => {
        let queued = false;
        try {
          await draftQueue.current;
          await enqueue(scope, input);
          queued = true;
          pendingRetry.current = null;
          setPendingLocal(null);
          setEnqueueComparison(null);
          if (draftAfter !== rawDraftRef.current)
            await persistDraft(
              draftAfter,
              input.intent.kind === 'reflection' ? 'reflection' : 'practice',
            );
          const next = await load(scope);
          const text = `Saved on this device. ${pendingCount(next)} change(s) waiting to sync.`;
          if (input.intent.kind === 'reflection') setReflectionMessage(text);
          else setMessage(text);
        } catch (cause) {
          if (!alive.current) return;
          if (cause instanceof OfflineError && cause.code === 'ACCOUNT_CHANGED') {
            invalidate();
            return;
          }
          setError(safeLocalError(cause));
          if (!queued && cause instanceof OfflineError && cause.code === 'LOCAL_CONFLICT') {
            const latest = await read(scope, snapshot.session.id).catch(() => null);
            if (alive.current) setEnqueueComparison(latest);
          }
          const text = queued
            ? 'Change saved on this device; its draft still needs attention.'
            : 'Not saved on this device. Keep this page open and try again.';
          if (input.intent.kind === 'reflection') setReflectionMessage(text);
          else setMessage(text);
        }
      })();
      commitRef.current = job;
      await job;
      commitRef.current = null;
      if (alive.current) {
        setWorking(false);
        if (!pendingRetry.current && !draftBlocked.current) void flushAndRefresh();
      }
    },
    [flushAndRefresh, invalidate, isFrozen, load, persistDraft, scope, snapshot.session.id],
  );

  function makeInput(intent: Intent): EnqueueInput | null {
    const current = viewRef.current;
    if (!current) return null;
    const stream: Stream = intent.kind === 'reflection' ? 'reflection' : 'session';
    return {
      operationId: crypto.randomUUID(),
      sessionId: current.snapshot.session.id,
      scheduleVersionId: current.snapshot.session.scheduleVersionId,
      baseRevision: streamRevision(current, stream),
      expectedLocalHead: current.heads[stream],
      intent,
    };
  }

  function queueIntent(intent: Intent, draftAfter?: RawDraft | null) {
    const input = makeInput(intent);
    if (input) void commit(input, draftAfter);
  }

  function changeNumeric(practiceId: string, value: string) {
    if (isFrozen()) return;
    const nextNumeric = { ...numericRef.current, [practiceId]: value };
    numericRef.current = nextNumeric;
    setNumeric(nextNumeric);
    setError(null);
    const nextDraft: RawDraft = {
      ...(rawDraftRef.current ?? {}),
      numericValues: { ...(rawDraftRef.current?.numericValues ?? {}), [practiceId]: value },
    };
    void persistDraft(nextDraft, 'practice').catch(() => undefined);
  }

  async function saveNumeric(practice: SessionPractice) {
    await draftQueue.current;
    if (draftBlocked.current || isFrozen()) return;
    const raw = numericRef.current[practice.id] ?? '';
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
      setError('Enter a whole number from 0 to 1,000,000. Your entry is still here.');
      setMessage('Not saved. Check the number and try again.');
      return;
    }
    const remaining = { ...(rawDraftRef.current?.numericValues ?? {}) };
    delete remaining[practice.id];
    const draftAfter: RawDraft | null =
      Object.keys(remaining).length || rawDraftRef.current?.reflection
        ? { ...(rawDraftRef.current ?? {}), numericValues: remaining }
        : null;
    if (practice.value === value) {
      await persistDraft(draftAfter, 'practice').catch(() => undefined);
      if (!inputDirty.current && scope) await load(scope);
      return;
    }
    queueIntent({ kind: 'practices', payload: { values: { [practice.id]: value } } }, draftAfter);
  }

  function changeReflection(next: ReflectionPayload) {
    if (isFrozen()) return;
    reflectionRef.current = next;
    setReflection(next);
    setError(null);
    const nextDraft: RawDraft = { ...(rawDraftRef.current ?? {}), reflection: next };
    void persistDraft(nextDraft, 'reflection').catch(() => undefined);
  }

  async function saveReflection() {
    await draftQueue.current;
    if (draftBlocked.current || isFrozen()) return;
    const payload = reflectionRef.current;
    const validation = reflectionError(payload);
    if (validation) {
      setError(validation);
      setReflectionMessage('Not saved. Check the reflection and try again.');
      return;
    }
    const draftAfter = rawDraftRef.current?.numericValues
      ? { numericValues: rawDraftRef.current.numericValues }
      : null;
    if (JSON.stringify(payload) === JSON.stringify(viewRef.current?.projectedReflection)) {
      await persistDraft(draftAfter, 'reflection').catch(() => undefined);
      if (!inputDirty.current && scope) await load(scope);
      return;
    }
    queueIntent({ kind: 'reflection', payload }, draftAfter);
  }

  useEffect(() => {
    if (
      !view ||
      frozen ||
      working ||
      draftSaving ||
      pendingLocal ||
      draftFailure ||
      view.operations.some(({ state }) => state === 'conflict' || state === 'review_required') ||
      Date.parse(effectiveNow(view.snapshot.clock)) < Date.parse(view.snapshot.session.opensAt)
    )
      return;
    const payload = reflectionRef.current;
    if (
      reflectionError(payload) ||
      JSON.stringify(payload) === JSON.stringify(view.projectedReflection)
    )
      return;
    const timer = window.setTimeout(() => void saveReflection(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  });

  async function retryLocalSave() {
    if (pendingRetry.current)
      await commit(pendingRetry.current.input, pendingRetry.current.draftAfter);
  }

  async function resolveConflict(
    operation: QueueOperation,
    kind: 'use_server' | 'submit_reviewed',
  ) {
    if (!scope || !view) return;
    setWorking(true);
    setError(null);
    try {
      if (!operation.conflict?.comparisonId || inputDirty.current)
        throw new OfflineError(
          'LOCAL_CONFLICT',
          'Save or review your local draft before resolving this comparison.',
        );
      const expectedComparisonId = operation.conflict.comparisonId;
      const expectedOperationIds = reviewedOperationIds(view, operation);
      if (kind === 'use_server') {
        await resolve(scope, operation.operationId, {
          kind,
          expectedComparisonId,
          expectedOperationIds,
          expectedDraftRevision: view.draftRevision,
        });
      } else {
        const current =
          operation.stream === 'reflection'
            ? operation.conflict?.currentReflection
            : operation.conflict?.currentSession;
        if (!operation.conflict?.currentAvailable || !operation.conflict.currentSession)
          throw new OfflineError(
            'CURRENT_UNAVAILABLE',
            'Refresh the saved version before continuing.',
          );
        await resolve(scope, operation.operationId, {
          kind,
          expectedComparisonId,
          expectedOperationIds,
          expectedDraftRevision: view.draftRevision,
          replacements: view.operations
            .filter((item) => item.stream === operation.stream)
            .map((item) => ({ operationId: crypto.randomUUID(), intent: item.intent })),
          currentRevision: current?.revision ?? 0,
        });
      }
      const next = await load(scope);
      setMessage('Conflict choice saved on this device.');
      setReflectionMessage('Conflict choice saved on this device.');
      if (pendingCount(next)) void flushAndRefresh();
    } catch (cause) {
      setError(safeLocalError(cause));
    } finally {
      setWorking(false);
    }
  }

  async function updateConflict(operation: QueueOperation) {
    if (!scope) return;
    setWorking(true);
    setError(null);
    try {
      await refreshConflict(scope, operation.operationId);
      await load(scope);
    } catch (cause) {
      setError(safeLocalError(cause));
    } finally {
      setWorking(false);
    }
  }

  async function reviewDraft() {
    if (!scope) return;
    await draftQueue.current;
    try {
      const latest = await read(scope, snapshot.session.id);
      if (alive.current) setDraftComparison(latest);
    } catch (cause) {
      if (cause instanceof OfflineError && cause.code === 'ACCOUNT_CHANGED') invalidate();
      else setError(safeLocalError(cause));
    }
  }
  async function retryDraft(keepLocal = false) {
    if (!scope || isFrozen()) return;
    await draftQueue.current;
    if (keepLocal && draftComparison) draftRevisionRef.current = draftComparison.draftRevision;
    draftBlocked.current = false;
    await persistDraft(rawDraftRef.current, 'reflection').catch(() => undefined);
    if (!inputDirty.current) await load(scope);
  }
  async function chooseStoredDraft() {
    if (!scope || !draftComparison) return;
    const latest = await read(scope, snapshot.session.id);
    if (!latest || latest.draftRevision !== draftComparison.draftRevision) {
      setDraftComparison(latest);
      setError('The saved draft changed again. Review it before choosing.');
      return;
    }
    inputDirty.current = false;
    draftBlocked.current = false;
    setDraftFailure(false);
    setDraftComparison(null);
    setError(null);
    applyView(latest);
  }
  async function retryReviewedEnqueue() {
    if (!pendingRetry.current || !enqueueComparison) return;
    const previous = pendingRetry.current;
    const stream = previous.input.intent.kind === 'reflection' ? 'reflection' : 'session';
    const input = {
      ...previous.input,
      operationId: crypto.randomUUID(),
      baseRevision: streamRevision(enqueueComparison, stream),
      expectedLocalHead: enqueueComparison.heads[stream],
    };
    await commit(input, previous.draftAfter);
  }

  if (status !== 'ready' || !scope) return null;
  if (!view)
    return (
      <section className={shared.panel} aria-busy="true">
        <p role="status">Preparing this practice for offline use…</p>
        {error && <p role="alert">{error}</p>}
      </section>
    );

  const projected = view.projectedSession;
  const canonical = view.snapshot.session;
  const currentNow = effectiveNow(view.snapshot.clock, deviceNow);
  const hasPracticeDraft = Object.keys(rawDraftRef.current?.numericValues ?? {}).length > 0;
  const beforeOpening = Date.parse(currentNow) < Date.parse(projected.opensAt);
  const closed = Date.parse(currentNow) >= Date.parse(projected.closesAt);
  const conflict = view.operations.find(
    ({ state }) => state === 'conflict' || state === 'review_required',
  );
  const controlsDisabled =
    frozen ||
    working ||
    Boolean(pendingLocal) ||
    draftFailure ||
    Boolean(conflict) ||
    Boolean(projected.supersededAt);
  const canEditValues = !controlsDisabled && !beforeOpening && !projected.confirmed;
  const timing = deriveCompletionTiming(canonical);
  const completionPending = projected.confirmed && !canonical.confirmed;
  const pending = view.operations.length;
  const statusLabel = deriveStatus(projected, currentNow);

  function recordCompletion() {
    let performedAt = currentNow;
    if (closed || canonical.confirmed || editingCompletion) {
      try {
        performedAt = instantFromLocalInput(performedInput, projected.timeZone);
        if (
          Date.parse(performedAt) < Date.parse(projected.opensAt) ||
          Date.parse(performedAt) > Date.parse(currentNow)
        ) {
          setPerformedError('Choose a time between this session opening and the current time.');
          return;
        }
        if (
          canonical.performedAt &&
          Date.parse(performedAt) === Date.parse(canonical.performedAt)
        ) {
          setPerformedError('Choose a different practice time before saving a correction.');
          return;
        }
      } catch (cause) {
        setPerformedError(cause instanceof Error ? cause.message : 'Enter a valid practice time.');
        return;
      }
    }
    setPerformedError(null);
    setEditingCompletion(false);
    queueIntent({ kind: 'completion', payload: { performedAt } });
  }

  return (
    <div className={styles.sessionLayout}>
      <section className={shared.panel} aria-label="Practice checklist">
        <div className={styles.sessionMeta}>
          <strong>{statusLabel}</strong>
          <span>
            {formatInstant(projected.opensAt, projected.timeZone)}–
            {formatInstant(projected.closesAt, projected.timeZone)}
          </span>
        </div>
        {beforeOpening && (
          <p className={shared.quietNote}>
            This practice has not opened yet. Offline changes are unavailable until its saved
            opening time.
          </p>
        )}
        {closed && !projected.confirmed && (
          <p className={shared.quietNote}>
            This window has closed. Save every practice, then enter when you actually practiced.
          </p>
        )}
        <ul className={styles.checklist}>
          {projected.practices.map((practice) => (
            <li key={practice.id}>
              {practice.kind === 'checkbox' ? (
                <label className={shared.practiceCheck}>
                  <input
                    type="checkbox"
                    aria-label={practice.label}
                    checked={practice.value === true}
                    disabled={!canEditValues}
                    onChange={(event) =>
                      queueIntent({
                        kind: 'practices',
                        payload: { values: { [practice.id]: event.target.checked } },
                      })
                    }
                  />
                  <span>
                    {practice.label}
                    <small>
                      {practice.value === true ? 'Saved on this device' : 'Mark when complete'}
                    </small>
                  </span>
                </label>
              ) : (
                <NumericPractice
                  practice={practice}
                  value={numeric[practice.id] ?? String(practice.value)}
                  disabled={!canEditValues}
                  onChange={(value) => changeNumeric(practice.id, value)}
                  onSave={() => void saveNumeric(practice)}
                />
              )}
            </li>
          ))}
        </ul>
        <p className={styles.saveState} role="status" aria-live="polite">
          {draftSaving ? 'Saving draft on this device…' : message}
        </p>
        {error && (
          <p className={shared.error} role="alert">
            {error}
          </p>
        )}
        {pendingLocal && (
          <button
            type="button"
            className={`${shared.button} ${shared.secondary}`}
            disabled={working || frozen}
            onClick={() => void retryLocalSave()}
          >
            Try saving on this device
          </button>
        )}
        {pending > 0 && (
          <div className={styles.pending} role="status">
            <strong>{pending} change(s) saved on this device.</strong>
            <p>They are local feedback until the server acknowledges them.</p>
            {completionPending && (
              <p>Reminders may continue until this completion syncs with the server.</p>
            )}
            <button
              type="button"
              className={`${shared.button} ${shared.secondary}`}
              disabled={working || frozen}
              onClick={() => void flushAndRefresh()}
            >
              Retry sync
            </button>
          </div>
        )}

        {canonical.confirmed ? (
          <div className={shared.success} role="status">
            <h2>Your practice is recorded.</h2>
            <p>Take this moment with you.</p>
            {timing.practiceTiming === 'practiced_late' ? (
              <p>Practiced late.</p>
            ) : timing.recordedLater ? (
              <p>Recorded later.</p>
            ) : (
              <p>On schedule.</p>
            )}
            <a className={shared.button} href={`/today?journey=${canonical.journeyId}`}>
              Done
            </a>
          </div>
        ) : completionPending ? (
          <div className={styles.pending} role="status">
            <h2>Completion saved on this device.</h2>
            <p>It will be recorded after the server acknowledges the queued change.</p>
          </div>
        ) : null}

        {!projected.confirmed && !closed && (
          <div className={shared.actions}>
            <button
              type="button"
              className={shared.button}
              disabled={
                controlsDisabled || beforeOpening || hasPracticeDraft || !targetsMet(projected)
              }
              onClick={recordCompletion}
            >
              Complete this session
            </button>
            <span className={`${shared.small} ${shared.muted}`}>
              {targetsMet(projected)
                ? 'Confirm that you completed your practice.'
                : 'Complete every practice before confirming.'}
            </span>
          </div>
        )}

        {(!projected.confirmed && closed) || editingCompletion ? (
          <section className={styles.completion} aria-label="Completion record">
            <h2>{canonical.confirmed ? 'Correct practice time' : 'Completion record'}</h2>
            <div className={shared.field}>
              <label htmlFor={`offline-performed-${projected.id}`}>
                Actual practice time in {projected.timeZone}
              </label>
              <input
                id={`offline-performed-${projected.id}`}
                type="datetime-local"
                step={60}
                value={performedInput}
                disabled={controlsDisabled}
                onChange={(event) => {
                  setPerformedInput(event.target.value);
                  setPerformedError(null);
                }}
              />
            </div>
            {performedError && (
              <p className={shared.error} role="alert">
                {performedError}
              </p>
            )}
            <div className={shared.actions}>
              <button
                type="button"
                className={shared.button}
                disabled={controlsDisabled || hasPracticeDraft || !targetsMet(projected)}
                onClick={recordCompletion}
              >
                {canonical.confirmed
                  ? 'Save corrected practice time'
                  : 'Record historical completion'}
              </button>
              {canonical.confirmed && (
                <button
                  type="button"
                  className={`${shared.button} ${shared.secondary}`}
                  disabled={controlsDisabled}
                  onClick={() => setEditingCompletion(false)}
                >
                  Cancel time correction
                </button>
              )}
            </div>
          </section>
        ) : null}

        {canonical.confirmed && !editingCompletion && !confirmingRemoval && (
          <section className={styles.completion} aria-label="Completion record">
            <h2>Completion record</h2>
            <p>
              Practiced {formatInstant(canonical.performedAt!, canonical.timeZone)} in{' '}
              {canonical.timeZone}.
            </p>
            <div className={shared.actions}>
              <button
                type="button"
                className={`${shared.button} ${shared.secondary}`}
                disabled={controlsDisabled}
                onClick={() => {
                  setPerformedInput(
                    localInputValue(canonical.performedAt ?? currentNow, canonical.timeZone),
                  );
                  setEditingCompletion(true);
                }}
              >
                Correct practice time
              </button>
              <button
                type="button"
                className={`${shared.button} ${shared.secondary}`}
                disabled={controlsDisabled}
                onClick={() => setConfirmingRemoval(true)}
              >
                Remove completion
              </button>
            </div>
          </section>
        )}
        {canonical.confirmed && confirmingRemoval && (
          <section className={styles.completion} aria-label="Completion record">
            <h2>Remove completion?</h2>
            <p>Saved practice values and history will remain.</p>
            <div className={shared.actions}>
              <button
                type="button"
                className={shared.button}
                disabled={controlsDisabled}
                onClick={() => {
                  setConfirmingRemoval(false);
                  queueIntent({ kind: 'completion_undo', payload: {} });
                }}
              >
                Confirm remove completion
              </button>
              <button
                type="button"
                className={`${shared.button} ${shared.secondary}`}
                disabled={controlsDisabled}
                onClick={() => setConfirmingRemoval(false)}
              >
                Keep completion
              </button>
            </div>
          </section>
        )}
      </section>

      {draftFailure && (
        <section className={shared.panel} role="alert">
          <h2>Your draft has not been saved</h2>
          <p>
            Your input remains in this page. Review the other local draft before replacing either
            version.
          </p>
          <button
            type="button"
            className={shared.button}
            disabled={working || frozen}
            onClick={() => void reviewDraft()}
          >
            Review saved local draft
          </button>
          <button
            type="button"
            className={`${shared.button} ${shared.secondary}`}
            disabled={working || frozen}
            onClick={() => void retryDraft()}
          >
            Try saving draft again
          </button>
          {draftComparison && (
            <>
              <div className={styles.versions}>
                <section aria-label="Your unsaved draft">
                  <h3>Your unsaved draft</h3>
                  <DraftSummary session={view.snapshot.session} draft={rawDraftRef.current} />
                </section>
                <section aria-label="Current local draft">
                  <h3>Current local draft</h3>
                  <DraftSummary session={view.snapshot.session} draft={draftComparison.draft} />
                </section>
              </div>
              <button
                type="button"
                className={shared.button}
                disabled={working || frozen}
                onClick={() => void retryDraft(true)}
              >
                Keep my reviewed local draft
              </button>
              <button
                type="button"
                className={`${shared.button} ${shared.secondary}`}
                disabled={working || frozen}
                onClick={() => void chooseStoredDraft()}
              >
                Use saved local draft
              </button>
            </>
          )}
        </section>
      )}
      {enqueueComparison && pendingLocal && (
        <section className={shared.panel} role="alert">
          <h2>Another tab changed this local practice</h2>
          <p>Your change was not queued. Review the latest state before applying it.</p>
          <div className={styles.versions}>
            <section aria-label="Your unqueued change">
              <h3>Your unqueued change</h3>
              <IntentSummary session={view.snapshot.session} intent={pendingLocal.intent} />
            </section>
            <section aria-label="Latest local practice">
              <h3>Latest local practice</h3>
              {pendingLocal.intent.kind === 'reflection' ? (
                <IntentSummary
                  session={view.snapshot.session}
                  intent={{ kind: 'reflection', payload: enqueueComparison.projectedReflection }}
                />
              ) : (
                <SavedSummary session={enqueueComparison.projectedSession} />
              )}
            </section>
          </div>
          <button
            type="button"
            className={shared.button}
            disabled={working || frozen}
            onClick={() => void retryReviewedEnqueue()}
          >
            Apply my change to this reviewed local state
          </button>
        </section>
      )}
      {conflict && (
        <OfflineConflict
          view={view}
          operation={conflict}
          pending={working || frozen}
          onRefresh={() => void updateConflict(conflict)}
          onUseServer={() => void resolveConflict(conflict, 'use_server')}
          onKeepLocal={() => void resolveConflict(conflict, 'submit_reviewed')}
        />
      )}

      <OfflineReflectionEditor
        sessionId={projected.id}
        value={reflection}
        preferences={view.snapshot.preferences}
        disabled={controlsDisabled || beforeOpening}
        deviceSaving={draftSaving}
        message={reflectionMessage}
        onChange={changeReflection}
        onSave={() => void saveReflection()}
      />

      <p className={shared.small}>
        Last server sync: {formatInstant(view.snapshot.lastSyncedAt, projected.timeZone)}.
      </p>
    </div>
  );
}
