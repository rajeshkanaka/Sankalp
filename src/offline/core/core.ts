import type { ReflectionRecord, SessionRecord } from '../../domain/contracts';
import { targetsMet } from '../../domain/status';
import {
  Storage,
  counts,
  prune,
  purge,
  sessionOperations,
  type OperationRow,
  type Transaction,
} from './store';
import { createFetchTransport, ReplayError } from './transport';
import {
  MAX_OPERATIONS,
  OfflineError,
  applyIntent,
  dueForReview,
  instant,
  makeView,
  parseSession,
  parseReflection,
  revision,
  retryAt,
  stableJson,
  streamFor,
  uuid,
  validateDraft,
  validateIntent,
  validateSnapshot,
} from './model';
import type {
  AccountScope,
  ClearAction,
  Conflict,
  CoreOptions,
  DeviceState,
  EnqueueInput,
  FlushResult,
  LocalView,
  OfflineCore,
  QueueOperation,
  ReplayReply,
} from './types';

const key = (scope: AccountScope, id: string): [string, string] => [scope.accountId, id];
function publicOperation(row: OperationRow): QueueOperation {
  const { inputKey, ...operation } = row;
  void inputKey;
  return operation;
}
async function localView(
  tx: Transaction,
  scope: AccountScope,
  id: string,
): Promise<LocalView | null> {
  const row = await tx.objectStore('sessions').get(key(scope, id));
  if (!row) return null;
  const draft = await tx.objectStore('drafts').get(key(scope, id));
  return makeView(
    row.snapshot,
    (await sessionOperations(tx, scope.accountId, id)).map(publicOperation),
    draft?.draft ?? null,
    draft?.revision ?? 0,
  );
}
const unknownConflict = (code: string): Conflict => ({
  comparisonId: crypto.randomUUID(),
  code,
  currentSession: null,
  currentReflection: null,
  currentAvailable: false,
});
const lockingAvailable = (): boolean => typeof navigator !== 'undefined' && !!navigator.locks;
const pausedStates = new Set(['conflict', 'review_required']);

// Firefox can report rejected lock callbacks as uncaught even when the request is
// awaited and handled. Settle inside the callback, then rethrow outside the lock.
async function settleLock<T>(action: () => Promise<T>) {
  try {
    return { ok: true as const, value: await action() };
  } catch (error) {
    return { ok: false as const, error };
  }
}

export function createOfflineCore(options: CoreOptions = {}): OfflineCore {
  const now = options.now ?? (() => new Date().toISOString());
  const transport = options.transport ?? createFetchTransport();
  const databaseName = options.databaseName ?? 'sankalpa-offline';
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | null = null;
  let closed = false;
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Subscriber failures must not change committed storage outcomes. */
      }
    }
  };
  const storage = new Storage(databaseName, notify);
  function announce(scope?: AccountScope, sessionId?: string) {
    notify();
    channel?.postMessage({
      kind: 'invalidate',
      accountId: scope?.accountId ?? null,
      generation: scope?.generation ?? null,
      sessionId: sessionId ?? null,
    });
  }
  function initializeChannel() {
    if (!channel && !closed && typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(`${databaseName}:changes`);
      channel.onmessage = (event) => {
        // The channel is a hint, never a source of private data or storage authority.
        if (event.data?.kind === 'invalidate') notify();
      };
    }
  }
  async function enforceLocks() {
    if (!lockingAvailable())
      throw new OfflineError(
        'LOCKS_UNAVAILABLE',
        'Offline replay is unavailable in this browser. Connect before editing.',
      );
  }
  async function countResult(
    scope: AccountScope,
    reason: FlushResult['reason'],
    acknowledged = 0,
    next: string | null = null,
  ): Promise<FlushResult> {
    const operations = await storage.run(scope, (tx) => sessionOperations(tx, scope.accountId));
    return {
      acknowledged,
      pending: operations.length,
      blocked: operations.filter((row) => pausedStates.has(row.state)).length,
      reason,
      retryAt: next,
    };
  }
  async function exclusive<T>(scope: AccountScope, action: () => Promise<T>): Promise<T> {
    if (!lockingAvailable()) return action(); // Purge is safe without replay support: generation invalidation still applies.
    const result = await navigator.locks.request(
      `sankalpa-sync:${scope.accountId}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          return {
            ok: false as const,
            error: new OfflineError(
              'SYNC_BUSY',
              'A tab is syncing. Wait briefly before clearing local changes.',
            ),
          };
        return settleLock(action);
      },
    );
    if (!result.ok) throw result.error;
    return result.value;
  }
  async function quarantine(scope: AccountScope): Promise<void> {
    await storage.run(scope, async (tx, meta) => {
      meta.activeAccountId = null;
      meta.quarantinedAccountId = scope.accountId;
      meta.generation = crypto.randomUUID();
      await tx.objectStore('meta').put(meta);
    });
    announce();
  }
  async function comparison(
    scope: AccountScope,
    operation: QueueOperation,
    signal: AbortSignal,
  ): Promise<Conflict> {
    const identity = await transport.identity(signal);
    if (identity.accountId !== scope.accountId) {
      await quarantine(scope);
      throw new OfflineError('ACCOUNT_CHANGED');
    }
    try {
      const result = await transport.current(scope, operation, signal);
      await storage.run(scope, async () => undefined);
      const currentSession =
        result.currentSession === null ? null : parseSession(result.currentSession);
      const currentReflection = parseReflection(result.currentReflection);
      if (
        typeof result.currentAvailable !== 'boolean' ||
        (currentSession &&
          (currentSession.id !== operation.sessionId ||
            currentSession.scheduleVersionId !== operation.scheduleVersionId)) ||
        (currentReflection &&
          (!currentSession ||
            currentReflection.sessionId !== currentSession.id ||
            currentReflection.scheduleVersionId !== currentSession.scheduleVersionId ||
            currentReflection.journeyId !== currentSession.journeyId))
      )
        throw new ReplayError(0, 'INVALID_RESPONSE');
      return { ...result, currentSession, currentReflection, comparisonId: crypto.randomUUID() };
    } catch (error) {
      if (error instanceof ReplayError && error.code === 'ACCOUNT_CHANGED') {
        await quarantine(scope);
        throw new OfflineError('ACCOUNT_CHANGED');
      }
      throw error;
    }
  }
  async function storeConflict(
    scope: AccountScope,
    operation: OperationRow,
    conflict: Conflict,
    review = false,
  ) {
    await storage.run(scope, async (tx) => {
      const row = await tx.objectStore('operations').get(key(scope, operation.operationId));
      if (
        !row ||
        stableJson(row.request) !== stableJson(operation.request) ||
        row.conflict?.comparisonId !== operation.conflict?.comparisonId
      )
        throw new OfflineError('LOCAL_CONFLICT');
      row.state = review ? 'review_required' : 'conflict';
      row.conflict = conflict;
      row.retryAfter = null;
      await tx.objectStore('operations').put(row);
    });
    announce(scope, operation.sessionId);
  }
  async function acknowledge(
    scope: AccountScope,
    operation: OperationRow,
    reply: ReplayReply,
  ): Promise<void> {
    const expected = operation.request!.baseRevision + 1;
    if (
      (reply.kind === 'session' &&
        (operation.stream !== 'session' ||
          reply.session.id !== operation.sessionId ||
          reply.session.scheduleVersionId !== operation.scheduleVersionId ||
          reply.session.revision !== expected)) ||
      (reply.kind === 'reflection' &&
        (operation.stream !== 'reflection' ||
          reply.sessionId !== operation.sessionId ||
          reply.revision !== expected))
    )
      throw new ReplayError(0, 'INVALID_RESPONSE');
    if (reply.kind === 'session') parseSession(reply.session);
    else instant(reply.updatedAt);
    await storage.run(scope, async (tx) => {
      const row = await tx.objectStore('operations').get(key(scope, operation.operationId));
      if (!row || stableJson(row.request) !== stableJson(operation.request))
        throw new OfflineError('LOCAL_CONFLICT');
      const saved = await tx.objectStore('sessions').get(key(scope, operation.sessionId));
      if (!saved) throw new OfflineError('SNAPSHOT_MISSING');
      if (reply.kind === 'session') {
        if (reply.session.revision >= saved.snapshot.session.revision)
          saved.snapshot.session = reply.session;
      } else if (
        operation.intent.kind === 'reflection' &&
        reply.revision >= (saved.snapshot.reflection?.revision ?? 0)
      ) {
        // The safe server receipt deliberately contains no private note. Reconstruct from the exact accepted payload.
        const reflection: ReflectionRecord = {
          ...operation.intent.payload,
          sessionId: operation.sessionId,
          journeyId: saved.snapshot.session.journeyId,
          scheduleVersionId: operation.scheduleVersionId,
          revision: reply.revision,
          createdAt: saved.snapshot.reflection?.createdAt ?? reply.updatedAt,
          updatedAt: reply.updatedAt,
        };
        saved.snapshot.reflection = reflection;
      }
      saved.snapshot.lastSyncedAt = now();
      await tx.objectStore('sessions').put(saved);
      // Only an acknowledged local predecessor may rebase an unattempted successor.
      for (const next of await sessionOperations(tx, scope.accountId, operation.sessionId)) {
        if (next.predecessorId === operation.operationId) {
          if (next.request) throw new OfflineError('QUEUE_INVARIANT');
          next.predecessorId = null;
          next.baseRevision = expected;
          await tx.objectStore('operations').put(next);
        }
      }
      await tx.objectStore('operations').delete(key(scope, operation.operationId));
      await prune(tx, scope.accountId);
    });
    announce(scope, operation.sessionId);
  }
  async function satisfyUnchanged(
    scope: AccountScope,
    operation: OperationRow,
    value: unknown,
  ): Promise<boolean> {
    let current:
      { kind: 'session'; record: SessionRecord } | { kind: 'reflection'; record: ReflectionRecord };
    try {
      if (operation.stream === 'session') {
        const record = parseSession(value);
        if (
          (record.confirmed
            ? record.performedAt === null ||
              record.recordedAt === null ||
              Date.parse(record.performedAt) < Date.parse(record.opensAt) ||
              Date.parse(record.performedAt) > Date.parse(record.recordedAt)
            : record.performedAt !== null || record.recordedAt !== null) ||
          record.practices.some((practice) =>
            practice.kind === 'checkbox'
              ? typeof practice.value !== 'boolean'
              : typeof practice.value !== 'number' ||
                !Number.isInteger(practice.value) ||
                practice.value < 0 ||
                practice.value > 1_000_000,
          )
        )
          return false;
        const intent = operation.intent;
        const equivalent =
          intent.kind === 'practices'
            ? !record.confirmed &&
              Object.entries(intent.payload.values).every(
                ([id, expected]) =>
                  record.practices.find((practice) => practice.id === id)?.value === expected,
              )
            : intent.kind === 'completion'
              ? record.confirmed &&
                targetsMet(record) &&
                record.recordedAt !== null &&
                record.performedAt !== null &&
                Date.parse(record.performedAt) === Date.parse(intent.payload.performedAt)
              : intent.kind === 'completion_undo' &&
                !record.confirmed &&
                record.performedAt === null &&
                record.recordedAt === null;
        if (!equivalent || record.id !== operation.sessionId || record.supersededAt !== null)
          return false;
        current = { kind: 'session', record };
      } else {
        const record = parseReflection(value);
        if (
          !record ||
          record.revision < 1 ||
          Date.parse(record.createdAt) > Date.parse(record.updatedAt) ||
          operation.intent.kind !== 'reflection' ||
          record.sessionId !== operation.sessionId ||
          record.text !== operation.intent.payload.text ||
          stableJson(record.moods) !== stableJson(operation.intent.payload.moods)
        )
          return false;
        current = { kind: 'reflection', record };
      }
      if (
        operation.accountId !== scope.accountId ||
        current.record.scheduleVersionId !== operation.scheduleVersionId ||
        current.record.revision !== operation.request!.baseRevision ||
        stableJson(operation.request!.payload) !== stableJson(operation.intent.payload)
      )
        return false;
    } catch {
      return false;
    }
    const satisfied = await storage.run(scope, async (tx) => {
      const row = await tx.objectStore('operations').get(key(scope, operation.operationId));
      if (!row || stableJson(row.request) !== stableJson(operation.request))
        throw new OfflineError('LOCAL_CONFLICT');
      const saved = await tx.objectStore('sessions').get(key(scope, operation.sessionId));
      if (!saved) throw new OfflineError('SNAPSHOT_MISSING');
      if (current.record.journeyId !== saved.snapshot.session.journeyId) return false;
      if (current.kind === 'session') {
        const layout = (session: SessionRecord) => {
          const { confirmed, performedAt, recordedAt, revision, practices, ...fixed } = session;
          void confirmed;
          void performedAt;
          void recordedAt;
          void revision;
          return {
            ...fixed,
            practices: practices.map(({ value, ...definition }) => {
              void value;
              return definition;
            }),
          };
        };
        if (stableJson(layout(current.record)) !== stableJson(layout(saved.snapshot.session)))
          return false;
      }
      const savedRevision =
        current.kind === 'session'
          ? saved.snapshot.session.revision
          : (saved.snapshot.reflection?.revision ?? 0);
      // A newer local canonical comparison must be reviewed, never overwritten by an older response.
      if (savedRevision > current.record.revision) return false;
      const operations = await sessionOperations(tx, scope.accountId, operation.sessionId);
      if (
        row.predecessorId !== null ||
        operations.find((item) => item.stream === row.stream)?.operationId !== row.operationId
      )
        throw new OfflineError('QUEUE_INVARIANT');
      if (current.kind === 'session') saved.snapshot.session = current.record;
      else saved.snapshot.reflection = current.record;
      saved.snapshot.lastSyncedAt = now();
      await tx.objectStore('sessions').put(saved);
      // The server verified the exact intent was already satisfied. It made no mutation,
      // so release only this head and keep the same revision for its direct successor.
      for (const next of operations) {
        if (next.predecessorId === operation.operationId) {
          if (next.request) throw new OfflineError('QUEUE_INVARIANT');
          next.predecessorId = null;
          next.baseRevision = current.record.revision;
          await tx.objectStore('operations').put(next);
        }
      }
      await tx.objectStore('operations').delete(key(scope, operation.operationId));
      await prune(tx, scope.accountId);
      return true;
    });
    if (satisfied) announce(scope, operation.sessionId);
    return satisfied;
  }
  const core: OfflineCore = {
    async bindAccount(accountId, bindOptions = {}) {
      uuid(accountId);
      if (bindOptions.expectedGeneration !== undefined) uuid(bindOptions.expectedGeneration);
      initializeChannel();
      const previous = await storage.run(null, async (tx, meta) => {
        if (
          bindOptions.expectedGeneration !== undefined &&
          meta.generation !== bindOptions.expectedGeneration
        )
          throw new OfflineError('ACCOUNT_CHANGED');
        const previous = meta.quarantinedAccountId ?? meta.activeAccountId;
        if (previous && previous !== accountId) {
          // Hide the previous account before waiting for its potentially in-flight replay.
          meta.activeAccountId = null;
          meta.quarantinedAccountId = previous;
          meta.generation = crypto.randomUUID();
          await tx.objectStore('meta').put(meta);
          return { accountId: previous, generation: meta.generation };
        }
        return null;
      });
      if (previous) announce();
      const bind = () =>
        storage.run(null, async (tx, meta) => {
          const current = meta.quarantinedAccountId ?? meta.activeAccountId;
          if (previous) {
            if (current !== previous.accountId || meta.generation !== previous.generation)
              throw new OfflineError('ACCOUNT_CHANGED');
            const pending = await counts(tx, previous.accountId);
            if ((pending.operations || pending.drafts) && !bindOptions.discardPrevious) return null;
            await purge(tx);
          } else if (
            (bindOptions.expectedGeneration !== undefined &&
              meta.generation !== bindOptions.expectedGeneration) ||
            (current && current !== accountId)
          ) {
            throw new OfflineError('ACCOUNT_CHANGED');
          }
          if (meta.activeAccountId !== accountId || meta.quarantinedAccountId)
            meta.generation = crypto.randomUUID();
          meta.activeAccountId = accountId;
          meta.quarantinedAccountId = null;
          await tx.objectStore('meta').put(meta);
          return { accountId, generation: meta.generation };
        });
      const result = previous ? await exclusive(previous, bind) : await bind();
      announce();
      if (!result)
        throw new OfflineError(
          'ACCOUNT_CHANGE_PENDING',
          'Another account has unsynced changes on this device. Recover that account or explicitly discard them.',
        );
      return result;
    },
    async getDeviceState(): Promise<DeviceState> {
      initializeChannel();
      return storage.run(null, async (tx, meta) => {
        const pending = await counts(tx, meta.quarantinedAccountId ?? meta.activeAccountId);
        return {
          bindingGeneration: meta.generation,
          scope:
            meta.activeAccountId && !meta.quarantinedAccountId && !meta.sharedDevice
              ? { accountId: meta.activeAccountId, generation: meta.generation }
              : null,
          managementScope:
            meta.activeAccountId && !meta.quarantinedAccountId
              ? { accountId: meta.activeAccountId, generation: meta.generation }
              : null,
          quarantined: !!meta.quarantinedAccountId,
          sharedDevice: meta.sharedDevice,
          pendingOperations: pending.operations,
          pendingDrafts: pending.drafts,
          locksAvailable: lockingAvailable(),
        };
      });
    },
    async saveSnapshot(scope, value) {
      const snapshot = validateSnapshot(value);
      await storage.run(scope, async (tx) => {
        const prior = await tx.objectStore('sessions').get(key(scope, snapshot.session.id));
        if (
          prior &&
          prior.snapshot.session.scheduleVersionId !== snapshot.session.scheduleVersionId
        )
          throw new OfflineError('IDENTITY_MISMATCH');
        if (prior && prior.snapshot.session.revision > snapshot.session.revision)
          snapshot.session = prior.snapshot.session;
        if (
          prior &&
          (prior.snapshot.reflection?.revision ?? 0) > (snapshot.reflection?.revision ?? 0)
        )
          snapshot.reflection = prior.snapshot.reflection;
        await tx.objectStore('sessions').put({
          accountId: scope.accountId,
          sessionId: snapshot.session.id,
          snapshot,
          accessedAt: now(),
        });
        await prune(tx, scope.accountId);
      });
      announce(scope, snapshot.session.id);
    },
    async saveDraft(scope, sessionId, value, expectedRevision) {
      uuid(sessionId);
      revision(expectedRevision);
      const draft = validateDraft(value);
      if (draft) await enforceLocks();
      const next = await storage.run(scope, async (tx) => {
        if (!(await tx.objectStore('sessions').get(key(scope, sessionId))))
          throw new OfflineError(
            'SNAPSHOT_MISSING',
            'Open this practice online before saving it offline.',
          );
        const previous = await tx.objectStore('drafts').get(key(scope, sessionId));
        if ((previous?.revision ?? 0) !== expectedRevision)
          throw new OfflineError(
            'LOCAL_CONFLICT',
            'Another tab changed this draft. Keep your text and review both versions.',
          );
        const nextRevision = expectedRevision + 1;
        await tx
          .objectStore('drafts')
          .put({ accountId: scope.accountId, sessionId, draft, revision: nextRevision });
        await prune(tx, scope.accountId);
        return nextRevision;
      });
      announce(scope, sessionId);
      return next;
    },
    async enqueue(scope, input) {
      await enforceLocks();
      uuid(input.operationId);
      uuid(input.sessionId);
      uuid(input.scheduleVersionId);
      revision(input.baseRevision);
      if (input.expectedLocalHead !== null) uuid(input.expectedLocalHead);
      const normalized: EnqueueInput = {
        operationId: input.operationId,
        sessionId: input.sessionId,
        scheduleVersionId: input.scheduleVersionId,
        baseRevision: input.baseRevision,
        expectedLocalHead: input.expectedLocalHead,
        intent: validateIntent(input.intent),
      };
      const inputKey = stableJson(normalized);
      const result = await storage.run(scope, async (tx, meta) => {
        const duplicate = await tx.objectStore('operations').get(key(scope, input.operationId));
        if (duplicate) {
          if (duplicate.inputKey !== inputKey) throw new OfflineError('OPERATION_ID_REUSED');
          return publicOperation(duplicate);
        }
        const view = await localView(tx, scope, input.sessionId);
        if (!view)
          throw new OfflineError(
            'SNAPSHOT_MISSING',
            'Open this practice online before saving it offline.',
          );
        if (
          view.snapshot.session.scheduleVersionId !== input.scheduleVersionId ||
          view.snapshot.session.supersededAt
        )
          throw new OfflineError('SESSION_REPLACED');
        const stream = streamFor(normalized.intent);
        const canonicalRevision =
          stream === 'session'
            ? view.snapshot.session.revision
            : (view.snapshot.reflection?.revision ?? 0);
        if (
          view.heads[stream] !== input.expectedLocalHead ||
          canonicalRevision !== input.baseRevision
        )
          throw new OfflineError(
            'LOCAL_CONFLICT',
            'Another tab changed this practice. Keep your input and review the latest local version.',
          );
        if (view.operations.some((row) => row.stream === stream && pausedStates.has(row.state)))
          throw new OfflineError(
            'REVIEW_REQUIRED',
            'Resolve the existing conflict before adding another change.',
          );
        applyIntent(view.projectedSession, normalized.intent);
        if (
          (await tx.objectStore('operations').index('account').count(scope.accountId)) >=
          MAX_OPERATIONS
        )
          throw new OfflineError(
            'QUEUE_FULL',
            'Sync or review pending changes before saving more on this device.',
          );
        meta.sequence += 1;
        const operation: OperationRow = {
          ...normalized,
          accountId: scope.accountId,
          stream,
          sequence: meta.sequence,
          createdAt: now(),
          state: 'queued',
          predecessorId: view.heads[stream],
          request: null,
          attempts: 0,
          attemptedAt: null,
          retryAfter: null,
          conflict: null,
          inputKey,
        };
        await tx.objectStore('operations').put(operation);
        await tx.objectStore('meta').put(meta);
        return publicOperation(operation);
      });
      announce(scope, input.sessionId);
      return result;
    },
    async read(scope, sessionId) {
      uuid(sessionId);
      return storage.run(scope, (tx) => localView(tx, scope, sessionId));
    },
    async listSavedSessions(scope) {
      return storage.run(scope, async (tx) => {
        const sessions = await tx.objectStore('sessions').index('account').getAll(scope.accountId);
        const result: LocalView[] = [];
        for (const row of sessions.sort((a, b) => b.accessedAt.localeCompare(a.accessedAt))) {
          const view = await localView(tx, scope, row.sessionId);
          if (view) result.push(view);
        }
        return result;
      });
    },
    async flush(scope, signal) {
      if (!lockingAvailable()) return countResult(scope, 'unsupported');
      try {
        const outcome = await navigator.locks.request(
          `sankalpa-sync:${scope.accountId}`,
          { ifAvailable: true },
          (lock) =>
            settleLock(async (): Promise<FlushResult> => {
              if (!lock) return countResult(scope, 'not_leader', 0, retryAt(now(), 1));
              if (signal?.aborted) return countResult(scope, 'aborted');
              const bounded = AbortSignal.any([
                ...(signal ? [signal] : []),
                AbortSignal.timeout(25_000),
              ]);
              await storage.run(scope, async () => undefined);
              let identity;
              try {
                identity = await transport.identity(bounded);
              } catch (error) {
                return countResult(
                  scope,
                  error instanceof ReplayError && error.status === 401 ? 'auth' : 'offline',
                  0,
                  retryAt(now(), 1),
                );
              }
              if (identity.accountId !== scope.accountId) {
                await quarantine(scope);
                return {
                  acknowledged: 0,
                  pending: 0,
                  blocked: 0,
                  reason: 'account_changed',
                  retryAt: null,
                };
              }
              instant(identity.now);
              let acknowledged = 0;
              for (let turn = 0; turn < 50 && !bounded.aborted; turn += 1) {
                const prepared = await storage.run(scope, async (tx) => {
                  const operations = await sessionOperations(tx, scope.accountId);
                  const first = new Map<string, OperationRow>();
                  for (const row of operations) {
                    const streamKey = `${row.sessionId}:${row.stream}`;
                    if (!first.has(streamKey)) first.set(streamKey, row);
                  }
                  for (const row of first.values()) {
                    if (pausedStates.has(row.state)) continue;
                    if (dueForReview(row, now())) {
                      row.state = 'review_required';
                      row.conflict = unknownConflict('OLDER_THAN_30_DAYS');
                      await tx.objectStore('operations').put(row);
                      continue;
                    }
                    if (row.retryAfter && row.retryAfter > now()) continue;
                    if (row.predecessorId) throw new OfflineError('QUEUE_INVARIANT');
                    row.request ??= {
                      operationId: row.operationId,
                      baseRevision: row.baseRevision,
                      payload: structuredClone(row.intent.payload),
                    };
                    row.state = 'sending';
                    row.attempts += 1;
                    row.attemptedAt = now();
                    await tx.objectStore('operations').put(row);
                    return row;
                  }
                  return null;
                });
                if (!prepared) break;
                announce(scope, prepared.sessionId);
                // Transaction is committed before any request leaves the browser.
                await storage.run(scope, async () => undefined);
                try {
                  const reply = await transport.send(scope, publicOperation(prepared), bounded);
                  await acknowledge(scope, prepared, reply);
                  acknowledged += 1;
                } catch (error) {
                  if (error instanceof OfflineError) throw error;
                  if (
                    error instanceof ReplayError &&
                    error.status === 409 &&
                    error.code === 'NO_CHANGE' &&
                    (await satisfyUnchanged(scope, prepared, error.current))
                  )
                    continue;
                  if (
                    error instanceof ReplayError &&
                    (error.status === 401 || error.code === 'ACCOUNT_CHANGED')
                  ) {
                    if (error.code === 'ACCOUNT_CHANGED') {
                      await quarantine(scope);
                      return {
                        acknowledged,
                        pending: 0,
                        blocked: 0,
                        reason: 'account_changed',
                        retryAt: null,
                      };
                    }
                    return countResult(scope, 'auth', acknowledged);
                  }
                  if (
                    error instanceof ReplayError &&
                    error.status >= 400 &&
                    error.status < 500 &&
                    error.status !== 429 &&
                    error.status !== 408
                  ) {
                    let current = unknownConflict(error.code);
                    try {
                      current = {
                        ...(await comparison(scope, prepared, bounded)),
                        code: error.code,
                      };
                    } catch (readError) {
                      if (readError instanceof OfflineError) throw readError;
                    }
                    await storeConflict(scope, prepared, current);
                  } else {
                    const next = retryAt(
                      now(),
                      prepared.attempts,
                      error instanceof ReplayError ? error.retryAfterSeconds : 0,
                    );
                    await storage.run(scope, async (tx) => {
                      const row = await tx
                        .objectStore('operations')
                        .get(key(scope, prepared.operationId));
                      if (!row || stableJson(row.request) !== stableJson(prepared.request))
                        throw new OfflineError('LOCAL_CONFLICT');
                      row.state = 'queued';
                      row.retryAfter = next;
                      await tx.objectStore('operations').put(row);
                    });
                    announce(scope, prepared.sessionId);
                  }
                }
              }
              const remaining = await storage.run(scope, (tx) =>
                sessionOperations(tx, scope.accountId),
              );
              const pendingRetry =
                remaining
                  .map((row) => row.retryAfter)
                  .filter((value): value is string => !!value)
                  .sort()[0] ?? null;
              const blocked = remaining.filter((row) => pausedStates.has(row.state)).length;
              announce(scope);
              return {
                acknowledged,
                pending: remaining.length,
                blocked,
                reason: bounded.aborted
                  ? 'aborted'
                  : !remaining.length
                    ? 'drained'
                    : blocked
                      ? 'conflict'
                      : 'retry',
                retryAt: remaining.length > blocked ? (pendingRetry ?? retryAt(now(), 1)) : null,
              };
            }),
        );
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      } catch (error) {
        if (error instanceof OfflineError && error.code === 'ACCOUNT_CHANGED')
          return {
            acknowledged: 0,
            pending: 0,
            blocked: 0,
            reason: 'account_changed',
            retryAt: null,
          };
        if (error instanceof OfflineError)
          return { acknowledged: 0, pending: 0, blocked: 0, reason: 'storage', retryAt: null };
        throw error;
      }
    },
    async refreshConflict(scope, operationId, signal) {
      uuid(operationId);
      const operation = await storage.run(scope, (tx) =>
        tx.objectStore('operations').get(key(scope, operationId)),
      );
      if (!operation || !pausedStates.has(operation.state))
        throw new OfflineError('REVIEW_REQUIRED');
      const current = await comparison(
        scope,
        operation,
        AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
      );
      await storeConflict(
        scope,
        operation,
        { ...current, code: operation.conflict?.code ?? 'REVIEW_REQUIRED' },
        operation.state === 'review_required',
      );
    },
    async resolve(scope, operationId, choice) {
      uuid(operationId);
      uuid(choice.expectedComparisonId);
      revision(choice.expectedDraftRevision);
      const reviewed =
        choice.kind === 'submit_reviewed'
          ? choice.replacements.map((item) => ({
              operationId: uuid(item.operationId),
              intent: validateIntent(item.intent),
            }))
          : [];
      if (choice.kind === 'submit_reviewed') {
        revision(choice.currentRevision);
        if (!reviewed.length || reviewed.length > MAX_OPERATIONS)
          throw new OfflineError('INVALID_REPLACEMENTS');
      }
      await exclusive(scope, () =>
        storage.run(scope, async (tx, meta) => {
          const operation = await tx.objectStore('operations').get(key(scope, operationId));
          if (
            !operation ||
            !pausedStates.has(operation.state) ||
            !operation.conflict?.currentAvailable
          )
            throw new OfflineError(
              'COMPARISON_REQUIRED',
              'Reconnect and refresh the server comparison before resolving.',
            );
          const all = await sessionOperations(tx, scope.accountId);
          const rows = all.filter(
            (row) => row.sessionId === operation.sessionId && row.stream === operation.stream,
          );
          const draft = await tx.objectStore('drafts').get(key(scope, operation.sessionId));
          if (
            operation.conflict.comparisonId !== choice.expectedComparisonId ||
            stableJson(rows.map((row) => row.operationId)) !==
              stableJson(choice.expectedOperationIds) ||
            (draft?.revision ?? 0) !== choice.expectedDraftRevision
          )
            throw new OfflineError(
              'LOCAL_CONFLICT',
              'Local changes or a new comparison arrived. Review them before resolving.',
            );
          const saved = await tx.objectStore('sessions').get(key(scope, operation.sessionId));
          if (!saved) throw new OfflineError('SNAPSHOT_MISSING');
          const { currentSession, currentReflection } = operation.conflict;
          if (
            currentSession &&
            (currentSession.id !== operation.sessionId ||
              currentSession.scheduleVersionId !== operation.scheduleVersionId ||
              currentSession.journeyId !== saved.snapshot.session.journeyId)
          )
            throw new OfflineError('IDENTITY_MISMATCH');
          const currentRevision =
            operation.stream === 'session'
              ? (currentSession?.revision ?? 0)
              : (currentReflection?.revision ?? 0);
          const localRevision =
            operation.stream === 'session'
              ? saved.snapshot.session.revision
              : (saved.snapshot.reflection?.revision ?? 0);
          // An established deletion may be explicitly accepted; an older existing record may not.
          if (currentSession && localRevision > currentRevision)
            throw new OfflineError(
              'LOCAL_CONFLICT',
              'A newer confirmed version arrived. Refresh the comparison before resolving.',
            );
          if (choice.kind === 'submit_reviewed') {
            if (!currentSession || currentSession.supersededAt)
              throw new OfflineError('SESSION_REPLACED');
            if (choice.currentRevision !== currentRevision)
              throw new OfflineError('LOCAL_CONFLICT');
            if (all.length - rows.length + reviewed.length > MAX_OPERATIONS)
              throw new OfflineError('QUEUE_FULL');
            const ids = new Set(all.map((row) => row.operationId));
            let projected = currentSession;
            for (const item of reviewed) {
              if (ids.has(item.operationId)) throw new OfflineError('OPERATION_ID_REUSED');
              ids.add(item.operationId);
              if (streamFor(item.intent) !== operation.stream)
                throw new OfflineError('INVALID_REPLACEMENTS');
              projected = applyIntent(projected, item.intent);
            }
          }
          if (currentSession) {
            if (currentSession.revision >= saved.snapshot.session.revision)
              saved.snapshot.session = currentSession;
            if ((currentReflection?.revision ?? 0) >= (saved.snapshot.reflection?.revision ?? 0))
              saved.snapshot.reflection = currentReflection;
            saved.snapshot.lastSyncedAt = now();
            await tx.objectStore('sessions').put(saved);
          }
          let predecessorId: string | null = null;
          for (const item of reviewed) {
            const input: EnqueueInput = {
              operationId: item.operationId,
              sessionId: operation.sessionId,
              scheduleVersionId: operation.scheduleVersionId,
              baseRevision: currentRevision,
              expectedLocalHead: predecessorId,
              intent: item.intent,
            };
            meta.sequence += 1;
            await tx.objectStore('operations').put({
              ...input,
              accountId: scope.accountId,
              stream: operation.stream,
              sequence: meta.sequence,
              createdAt: now(),
              state: 'queued',
              predecessorId,
              request: null,
              attempts: 0,
              attemptedAt: null,
              retryAfter: null,
              conflict: null,
              inputKey: stableJson(input),
            });
            predecessorId = item.operationId;
          }
          if (reviewed.length) await tx.objectStore('meta').put(meta);
          for (const row of rows)
            await tx.objectStore('operations').delete(key(scope, row.operationId));
          // Submission replaces only validated intents. Raw unfinished text is still unsent input.
          if (draft && choice.kind === 'use_server') {
            if (draft.draft) {
              if (operation.stream === 'reflection') delete draft.draft.reflection;
              else delete draft.draft.numericValues;
              if (!Object.keys(draft.draft).length) draft.draft = null;
            }
            draft.revision += 1;
            await tx.objectStore('drafts').put(draft);
          }
          if (
            !currentSession &&
            !(await sessionOperations(tx, scope.accountId, operation.sessionId)).length &&
            !draft?.draft
          )
            await tx.objectStore('sessions').delete(key(scope, operation.sessionId));
          await prune(tx, scope.accountId);
        }),
      );
      announce(scope);
    },
    async clearAccount(scope, action: ClearAction) {
      await exclusive(scope, () =>
        storage.run(
          scope,
          async (tx, meta) => {
            const pending = await counts(tx, scope.accountId);
            if (action !== 'discard_confirmed' && (pending.operations || pending.drafts))
              throw new OfflineError(
                'PENDING_WORK',
                'Sync or explicitly discard local changes before clearing this device.',
              );
            await purge(tx);
            meta.activeAccountId = null;
            meta.quarantinedAccountId = null;
            meta.generation = crypto.randomUUID();
            await tx.objectStore('meta').put(meta);
          },
          true,
        ),
      );
      announce();
    },
    async setSharedDevice(scope, enabled, action = 'synced') {
      const result = await exclusive(scope, () =>
        storage.run(
          scope,
          async (tx, meta) => {
            const pending = await counts(tx, scope.accountId);
            if (enabled && action !== 'discard_confirmed' && (pending.operations || pending.drafts))
              throw new OfflineError(
                'PENDING_WORK',
                'Sync or explicitly discard local changes before enabling shared-device mode.',
              );
            if (enabled) await purge(tx);
            meta.sharedDevice = enabled;
            meta.generation = crypto.randomUUID();
            await tx.objectStore('meta').put(meta);
            return { accountId: scope.accountId, generation: meta.generation };
          },
          true,
        ),
      );
      announce();
      return result;
    },
    subscribe(_scope, changed) {
      initializeChannel();
      listeners.add(changed);
      return () => {
        listeners.delete(changed);
      };
    },
    close() {
      closed = true;
      listeners.clear();
      channel?.close();
      channel = null;
      storage.close();
    },
  };
  return core;
}
