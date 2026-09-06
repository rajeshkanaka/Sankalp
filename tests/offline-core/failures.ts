import {
  createOfflineCore,
  ReplayError,
  type LocalView,
  type QueueOperation,
} from '../../src/offline/core';
import { createFetchTransport } from '../../src/offline/core/transport';
import { ACCOUNT, snapshot } from './fixtures';
import { check, copy, enqueue, environment, rejects, values } from './helpers';

const review = (view: LocalView, row: QueueOperation) => ({
  expectedComparisonId: row.conflict!.comparisonId,
  expectedOperationIds: view.operations
    .filter((item) => item.stream === row.stream)
    .map((item) => item.operationId),
  expectedDraftRevision: view.draftRevision,
});
/** Fault injection is scoped to this isolated document and restored before the next assertion. */
async function abortWrite<T>(
  store: string,
  method: 'put' | 'delete' | 'clear',
  action: () => Promise<T>,
): Promise<T> {
  const original = IDBObjectStore.prototype[method];
  let injected = false;
  const replacement = function (this: IDBObjectStore, ...args: unknown[]) {
    const request = Reflect.apply(original, this, args) as IDBRequest;
    if (!injected && this.name === store) {
      injected = true;
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
    }
    return request;
  };
  Object.defineProperty(IDBObjectStore.prototype, method, {
    configurable: true,
    writable: true,
    value: replacement,
  });
  try {
    return await action();
  } finally {
    Object.defineProperty(IDBObjectStore.prototype, method, {
      configurable: true,
      writable: true,
      value: original,
    });
  }
}

export const failures = {
  async flushStorageSetupFailure(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    try {
      await core.saveSnapshot(scope, snapshot);
      await enqueue(core, scope, values);
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function () {
        throw new DOMException('Synthetic transient transaction failure', 'UnknownError');
      };
      try {
        const result = await core.flush(scope);
        check(result.reason === 'storage', 'Transient setup failure reports storage');
        check(result.acknowledged === 0, 'Failed setup cannot claim acknowledgment');
      } finally {
        IDBDatabase.prototype.transaction = original;
      }
      check(env.sent.length === 0, 'No transport starts after failed transaction setup');
      check(
        (await core.read(scope, snapshot.session.id))!.operations.length === 1,
        'Failed setup preserves queued operation',
      );
      check((await core.flush(scope)).acknowledged === 1, 'Recovered storage can replay');
      // Browser runner also asserts zero uncaught page errors after this handled failure.
      return { checks: 5 };
    } finally {
      core.close();
    }
  },
  async storageFailures(name: string) {
    const env = environment(name);
    let core = env.create();
    let scope = await core.bindAccount(ACCOUNT);
    const raw = { reflection: { text: 'preserved through failed commit', moods: ['synthetic'] } };
    try {
      await core.saveSnapshot(scope, snapshot);
      await core.saveDraft(scope, snapshot.session.id, raw, 0);
      await rejects(
        () =>
          abortWrite('drafts', 'put', () =>
            core.saveDraft(
              scope,
              snapshot.session.id,
              { reflection: { text: 'must roll back', moods: [] } },
              1,
            ),
          ),
        'STORAGE_UNAVAILABLE',
      );
      check(
        (await core.read(scope, snapshot.session.id))!.draft?.reflection?.text ===
          raw.reflection.text,
        'Aborted draft preserves previous text',
      );
      await rejects(
        () => abortWrite('meta', 'put', () => enqueue(core, scope, values)),
        'STORAGE_UNAVAILABLE',
      );
      check(
        (await core.read(scope, snapshot.session.id))!.operations.length === 0,
        'Aborted enqueue cannot claim persistence',
      );
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
        if (this.name === 'drafts')
          throw new DOMException('Synthetic quota rejection', 'QuotaExceededError');
        return Reflect.apply(original, this, args);
      };
      try {
        await rejects(() => core.saveDraft(scope, snapshot.session.id, null, 1), 'STORAGE_FULL');
      } finally {
        IDBObjectStore.prototype.put = original;
      }
      check(
        (await core.read(scope, snapshot.session.id))!.draftRevision === 1,
        'Quota rejection retains draft revision',
      );
      await enqueue(core, scope, values);
      const failedAck = await abortWrite('operations', 'delete', () => core.flush(scope));
      check(failedAck.reason === 'storage', 'Aborted acknowledgment reports failure');
      const pending = (await core.read(scope, snapshot.session.id))!;
      check(
        pending.operations.length === 1 && pending.snapshot.session.revision === 1,
        'Acknowledgment and snapshot roll back together',
      );
      const attempted = JSON.stringify(pending.operations[0].request);
      check(
        (await core.flush(scope)).acknowledged === 1,
        'Exact retry recovers accepted server operation',
      );
      check(
        JSON.stringify(env.sent.at(-1)!.request) === attempted && env.receipts.size === 1,
        'Retry does not duplicate server effect',
      );
      await rejects(
        () => abortWrite('sessions', 'clear', () => core.clearAccount(scope, 'discard_confirmed')),
        'STORAGE_UNAVAILABLE',
      );
      check(
        (await core.getDeviceState()).scope?.generation === scope.generation,
        'Failed purge retains account generation',
      );
      check(
        (await core.read(scope, snapshot.session.id))!.draft?.reflection?.text ===
          raw.reflection.text,
        'Failed purge retains private draft',
      );
      core.close();
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        get() {
          throw new DOMException('Synthetic storage denial', 'SecurityError');
        },
      });
      const denied = env.create();
      try {
        await rejects(() => denied.bindAccount(ACCOUNT), 'STORAGE_UNAVAILABLE');
      } finally {
        denied.close();
        if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
        else Reflect.deleteProperty(globalThis, 'indexedDB');
      }
      core = env.create();
      scope = await core.bindAccount(ACCOUNT);
      check(
        (await core.read(scope, snapshot.session.id))!.draft?.reflection?.text ===
          raw.reflection.text,
        'Reopen after denied storage preserves prior durable data',
      );
      return { checks: 12 };
    } finally {
      core.close();
    }
  },
  async queueCeiling(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    try {
      await core.saveSnapshot(scope, snapshot);
      for (let n = 0; n < 499; n++) await enqueue(core, scope, values);
      await enqueue(core, scope, {
        kind: 'reflection',
        payload: { text: 'other stream stays queued', moods: [] },
      });
      await rejects(() => enqueue(core, scope, values), 'QUEUE_FULL');
      check(
        (await core.read(scope, snapshot.session.id))!.operations.length === 500,
        'Exactly five hundred retained',
      );
      const external = copy(snapshot.session);
      external.revision = 2;
      env.setServer(external);
      env.setReflection({
        sessionId: external.id,
        journeyId: external.journeyId,
        scheduleVersionId: external.scheduleVersionId,
        text: 'new remote note',
        moods: [],
        revision: 1,
        createdAt: snapshot.clock.serverNow,
        updatedAt: snapshot.clock.serverNow,
      });
      await core.flush(scope);
      const view = (await core.read(scope, snapshot.session.id))!;
      const row = view.operations[0];
      const replacements = Array.from({ length: 500 }, () => ({
        operationId: crypto.randomUUID(),
        intent: values,
      }));
      await rejects(
        () =>
          core.resolve(scope, row.operationId, {
            kind: 'submit_reviewed',
            ...review(view, row),
            currentRevision: 2,
            replacements,
          }),
        'QUEUE_FULL',
      );
      check(
        (await core.read(scope, snapshot.session.id))!.operations.length === 500,
        'Failed replacement limit preserves both streams',
      );
      await core.resolve(scope, row.operationId, {
        kind: 'submit_reviewed',
        ...review(view, row),
        currentRevision: 2,
        replacements: replacements.slice(0, 499),
      });
      const replaced = (await core.read(scope, snapshot.session.id))!;
      check(
        replaced.operations.length === 500 &&
          replaced.operations.filter((item) => item.stream === 'reflection').length === 1,
        'Capacity accounting subtracts replaced stream only',
      );
      return { checks: 5 };
    } finally {
      core.close();
    }
  },
  async resolutionBoundaries(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    try {
      await core.saveSnapshot(scope, snapshot);
      await enqueue(core, scope, { kind: 'reflection', payload: { text: 'first', moods: [] } });
      await enqueue(core, scope, { kind: 'reflection', payload: { text: 'latest', moods: [] } });
      env.setReflection({
        sessionId: snapshot.session.id,
        journeyId: snapshot.session.journeyId,
        scheduleVersionId: snapshot.session.scheduleVersionId,
        text: 'remote',
        moods: [],
        revision: 1,
        createdAt: snapshot.clock.serverNow,
        updatedAt: snapshot.clock.serverNow,
      });
      await core.flush(scope);
      await enqueue(core, scope, values);
      await enqueue(core, scope, {
        kind: 'completion',
        payload: { performedAt: snapshot.clock.serverNow },
      });
      await core.flush(scope);
      const view = (await core.read(scope, snapshot.session.id))!;
      const row = view.operations[0];
      const proposed = {
        kind: 'submit_reviewed' as const,
        ...review(view, row),
        currentRevision: 1,
        replacements: [{ operationId: crypto.randomUUID(), intent: row.intent }],
      };
      await rejects(
        () => core.resolve(scope, row.operationId, { ...proposed, replacements: [] }),
        'INVALID_REPLACEMENTS',
      );
      await rejects(
        () =>
          core.resolve(scope, row.operationId, {
            ...proposed,
            replacements: [{ operationId: row.operationId, intent: row.intent }],
          }),
        'OPERATION_ID_REUSED',
      );
      await rejects(
        () =>
          core.resolve(scope, row.operationId, {
            ...proposed,
            replacements: [proposed.replacements[0], proposed.replacements[0]],
          }),
        'OPERATION_ID_REUSED',
      );
      await rejects(
        () =>
          core.resolve(scope, row.operationId, {
            ...proposed,
            replacements: [{ operationId: crypto.randomUUID(), intent: values }],
          }),
        'INVALID_REPLACEMENTS',
      );
      await rejects(
        () =>
          core.resolve(scope, row.operationId, {
            ...proposed,
            expectedOperationIds: [...proposed.expectedOperationIds].reverse(),
          }),
        'LOCAL_CONFLICT',
      );
      await core.saveDraft(
        scope,
        snapshot.session.id,
        {
          reflection: { text: 'raw not queued', moods: [] },
          numericValues: { [snapshot.session.practices[1].id]: 'unfinished' },
        },
        0,
      );
      await rejects(() => core.resolve(scope, row.operationId, proposed), 'LOCAL_CONFLICT');
      const fresh = (await core.read(scope, snapshot.session.id))!;
      await rejects(
        () =>
          abortWrite('operations', 'delete', () =>
            core.resolve(scope, row.operationId, { ...proposed, ...review(fresh, row) }),
          ),
        'STORAGE_UNAVAILABLE',
      );
      check(
        (await core.read(scope, snapshot.session.id))!.operations
          .map((item) => item.operationId)
          .join() === fresh.operations.map((item) => item.operationId).join(),
        'Aborted resolution retains original sequence',
      );
      await core.resolve(scope, row.operationId, {
        ...proposed,
        ...review(fresh, row),
        replacements: fresh.operations.map((item) => ({
          operationId: crypto.randomUUID(),
          intent: item.intent,
        })),
      });
      await core.flush(scope);
      const final = (await core.read(scope, snapshot.session.id))!;
      check(
        final.snapshot.session.confirmed && final.snapshot.session.revision === 3,
        'Reflection resolution preserves independent completion',
      );
      check(
        final.snapshot.reflection?.text === 'latest' && final.snapshot.reflection.revision === 3,
        'Ordered reflection replacements finish at latest note',
      );
      check(
        final.draft?.reflection?.text === 'raw not queued' && !!final.draft.numericValues,
        'Submitting reviewed sequence retains both raw streams',
      );
      const device = await core.getDeviceState();
      check(
        device.managementScope?.generation === scope.generation,
        'Private mode exposes management generation',
      );
      const shared = await core.setSharedDevice(scope, true, 'discard_confirmed');
      const publicOnly = await core.getDeviceState();
      check(
        publicOnly.scope === null && publicOnly.managementScope?.generation === shared.generation,
        'Shared mode exposes management only',
      );
      await rejects(() => core.read(shared, snapshot.session.id), 'SHARED_DEVICE');
      return { checks: 14 };
    } finally {
      core.close();
    }
  },
  async transportFailures(name: string) {
    let now = snapshot.clock.serverNow;
    let responseMode: 'malformed' | 'rate' | 'expired' | 'ok' = 'malformed';
    const requests: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (path, init) => {
      if (path === '/api/auth/session') return Response.json({ accountId: ACCOUNT, now });
      check(
        init?.credentials === 'same-origin' &&
          init.cache === 'no-store' &&
          init.redirect === 'error',
        'Fetch preserves private transport policy',
      );
      check(
        new Headers(init?.headers).get('X-Sankalpa-Account') === ACCOUNT,
        'Every mutation carries expected account',
      );
      requests.push(String(init?.body));
      if (responseMode === 'malformed')
        return Response.json({ session: { id: snapshot.session.id } });
      if (responseMode === 'rate')
        return Response.json(
          { error: { code: 'RATE_LIMITED' } },
          { status: 429, headers: { 'Retry-After': '20' } },
        );
      if (responseMode === 'expired')
        return Response.json({ error: { code: 'SIGN_IN_REQUIRED' } }, { status: 401 });
      const session = copy(snapshot.session);
      session.revision = 2;
      return Response.json({ session });
    };
    const core = createOfflineCore({
      databaseName: name,
      now: () => now,
      transport: createFetchTransport(),
    });
    const scope = await core.bindAccount(ACCOUNT);
    try {
      await core.saveSnapshot(scope, snapshot);
      await enqueue(core, scope, values);
      check((await core.flush(scope)).reason === 'retry', 'Malformed success never acknowledges');
      const pending = (await core.read(scope, snapshot.session.id))!;
      check(
        pending.operations.length === 1 && pending.snapshot.session.revision === 1,
        'Malformed reply retains canonical and pending envelope',
      );
      now = '2026-09-05T01:01:00.000Z';
      responseMode = 'rate';
      const rate = await core.flush(scope);
      check(rate.retryAt === '2026-09-05T01:01:20.000Z', 'Rate limit honors retry time');
      await core.flush(scope);
      check(requests.length === 2, 'No retry before server delay');
      now = '2026-09-05T01:02:00.000Z';
      responseMode = 'expired';
      check((await core.flush(scope)).reason === 'auth', 'Expired auth pauses the batch');
      check(
        (await core.getDeviceState()).pendingOperations === 1,
        'Expired auth retains pending data',
      );
      responseMode = 'ok';
      check(
        (await core.flush(scope)).acknowledged === 1,
        'Recovered auth acknowledges original intent',
      );
      check(
        requests.every((request) => request === requests[0]),
        'Every uncertain retry preserves exact attempted envelope',
      );
      return { checks: 8 };
    } finally {
      core.close();
      globalThis.fetch = original;
    }
  },
  async comparisonAccountChange(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    try {
      await core.saveSnapshot(scope, snapshot);
      await enqueue(core, scope, values);
      env.advance(31);
      await core.flush(scope);
      const view = (await core.read(scope, snapshot.session.id))!;
      env.failCurrent(new ReplayError(409, 'ACCOUNT_CHANGED'));
      await rejects(
        () => core.refreshConflict(scope, view.operations[0].operationId),
        'ACCOUNT_CHANGED',
      );
      const state = await core.getDeviceState();
      check(
        state.quarantined &&
          state.scope === null &&
          state.managementScope === null &&
          state.pendingOperations === 1,
        'Comparison account change hides both scopes without deleting pending data',
      );
      return { checks: 2 };
    } finally {
      core.close();
    }
  },
};
