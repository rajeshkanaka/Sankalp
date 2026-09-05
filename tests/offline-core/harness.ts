import { createOfflineCore, ReplayError } from '../../src/offline/core';
import type {
  AccountScope,
  Intent,
  OfflineCore,
  QueueOperation,
  ReplayReply,
  ReplayTransport,
} from '../../src/offline/core';
import { ACCOUNT, OTHER, snapshot } from './fixtures';

const check = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
async function rejects(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    check((error as { code: string }).code === code, `Expected ${code}`);
    return;
  }
  throw new Error(`Expected rejection ${code}`);
}
const copy = <T>(value: T): T => structuredClone(value);
function environment(databaseName: string) {
  let time = '2026-09-06T01:00:00.000Z';
  let server = copy(snapshot.session);
  let reflection = copy(snapshot.reflection);
  let identity = ACCOUNT;
  let loseReply = false;
  let pause: (() => Promise<void>) | null = null;
  const sent: QueueOperation[] = [];
  const receipts = new Map<string, ReplayReply>();
  const transport: ReplayTransport = {
    async identity() {
      return { accountId: identity, now: time };
    },
    async current() {
      return {
        code: 'REVIEW_REQUIRED',
        currentSession: copy(server),
        currentReflection: copy(reflection),
        currentAvailable: true,
      };
    },
    async send(_scope, op) {
      sent.push(copy(op));
      if (pause) await pause();
      let reply = receipts.get(op.operationId);
      if (!reply) {
        check(!!op.request, 'Wire request must have committed before send');
        const rev = op.stream === 'session' ? server.revision : (reflection?.revision ?? 0);
        if (op.request!.baseRevision !== rev) throw new ReplayError(409, 'REVISION_CONFLICT');
        if (op.intent.kind === 'reflection') {
          reflection = {
            ...copy(op.intent.payload),
            sessionId: server.id,
            journeyId: server.journeyId,
            scheduleVersionId: server.scheduleVersionId,
            revision: rev + 1,
            createdAt: reflection?.createdAt ?? time,
            updatedAt: time,
          };
          reply = { kind: 'reflection', sessionId: server.id, revision: rev + 1, updatedAt: time };
        } else {
          if (op.intent.kind === 'practices')
            for (const item of server.practices) {
              if (Object.hasOwn(op.intent.payload.values, item.id))
                item.value = op.intent.payload.values[item.id];
            }
          if (op.intent.kind === 'completion') {
            server.confirmed = true;
            server.performedAt = op.intent.payload.performedAt;
            server.recordedAt = time;
          }
          if (op.intent.kind === 'completion_undo') {
            server.confirmed = false;
            server.performedAt = null;
            server.recordedAt = time;
          }
          server.revision += 1;
          reply = { kind: 'session', session: copy(server) };
        }
        receipts.set(op.operationId, copy(reply));
      }
      if (loseReply) {
        loseReply = false;
        throw new ReplayError(0, 'NETWORK_UNCERTAIN');
      }
      return copy(reply);
    },
  };
  const create = () => createOfflineCore({ databaseName, now: () => time, transport });
  return {
    create,
    sent,
    receipts,
    transport,
    advance: (days = 0) => {
      time = new Date(Date.parse(time) + days * 86_400_000 + 301_000).toISOString();
    },
    lose: () => {
      loseReply = true;
    },
    setServer: (value: typeof server) => {
      server = copy(value);
    },
    setIdentity: (value: string) => {
      identity = value;
    },
    setPause: (value: (() => Promise<void>) | null) => {
      pause = value;
    },
  };
}
async function enqueue(core: OfflineCore, scope: AccountScope, intent: Intent) {
  const view = (await core.read(scope, snapshot.session.id))!;
  return core.enqueue(scope, {
    operationId: crypto.randomUUID(),
    sessionId: snapshot.session.id,
    scheduleVersionId: snapshot.session.scheduleVersionId,
    baseRevision:
      intent.kind === 'reflection'
        ? (view.snapshot.reflection?.revision ?? 0)
        : view.snapshot.session.revision,
    expectedLocalHead: view.heads[intent.kind === 'reflection' ? 'reflection' : 'session'],
    intent,
  });
}
const values = {
  kind: 'practices',
  payload: {
    values: { [snapshot.session.practices[0].id]: true, [snapshot.session.practices[1].id]: 20 },
  },
} satisfies Intent;
let held: {
  core: OfflineCore;
  release: () => void;
  started: Promise<void>;
  result: Promise<unknown>;
} | null = null;
const harness = {
  async basic(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    await core.saveSnapshot(scope, snapshot);
    const raw = {
      numericValues: { [snapshot.session.practices[1].id]: '1e-' },
      reflection: { text: '  raw\n ', moods: [] },
    };
    check(
      (await core.saveDraft(scope, snapshot.session.id, raw, 0)) === 1,
      'Draft commit revision',
    );
    await rejects(
      () =>
        core.saveDraft(scope, snapshot.session.id, { reflection: { text: 'stale', moods: [] } }, 0),
      'LOCAL_CONFLICT',
    );
    const first = await enqueue(core, scope, values);
    await rejects(
      () =>
        core.enqueue(scope, {
          ...first,
          operationId: crypto.randomUUID(),
          expectedLocalHead: null,
        }),
      'LOCAL_CONFLICT',
    );
    const confirm = await enqueue(core, scope, {
      kind: 'completion',
      payload: { performedAt: snapshot.clock.serverNow },
    });
    await enqueue(core, scope, {
      kind: 'reflection',
      payload: { text: 'private synthetic note', moods: ['calm'] },
    });
    check(
      (await core.read(scope, snapshot.session.id))!.snapshot.session.confirmed === false,
      'No premature canonical confirmation',
    );
    await core.saveDraft(scope, snapshot.session.id, null, 1);
    const result = await core.flush(scope);
    check(result.acknowledged === 3 && result.pending === 0, 'Three acknowledged intents');
    check(
      env.sent[0].request!.baseRevision === 1 &&
        env.sent[1].request!.baseRevision === 2 &&
        env.sent[2].request!.baseRevision === 0,
      'Independent revision streams',
    );
    const view = (await core.read(scope, snapshot.session.id))!;
    check(
      view.snapshot.session.confirmed &&
        view.snapshot.reflection?.text === 'private synthetic note',
      'Canonical after ack',
    );
    check(
      env.sent.find((row) => row.operationId === confirm.operationId)!.intent.kind === 'completion',
      'Frozen completion kind',
    );
    await enqueue(core, scope, { kind: 'completion_undo', payload: {} });
    await core.flush(scope);
    check(
      !(await core.read(scope, snapshot.session.id))!.snapshot.session.confirmed,
      'Undo acknowledged',
    );
    core.close();
    return { acknowledged: result.acknowledged, checks: 11 };
  },
  async uncertain(name: string) {
    const env = environment(name);
    let core = env.create();
    let scope = await core.bindAccount(ACCOUNT);
    await core.saveSnapshot(scope, snapshot);
    const first = await enqueue(core, scope, values);
    await enqueue(core, scope, {
      kind: 'completion',
      payload: { performedAt: snapshot.clock.serverNow },
    });
    env.lose();
    await core.flush(scope);
    check(
      (await core.read(scope, snapshot.session.id))!.operations[0].request !== null,
      'Attempt envelope persisted after lost response',
    );
    core.close();
    core = env.create();
    scope = await core.bindAccount(ACCOUNT);
    const external = copy(snapshot.session);
    external.revision = 9;
    env.setServer(external);
    await core.saveSnapshot(scope, { ...snapshot, session: external });
    env.advance();
    const result = await core.flush(scope);
    check(
      JSON.stringify(env.sent[0].request) === JSON.stringify(env.sent[1].request),
      'Exact retry after connection reopen',
    );
    check(env.sent[0].operationId === first.operationId, 'Stable operation ID');
    check(
      env.sent[2].request!.baseRevision === 2,
      'Only acknowledged predecessor rebases successor',
    );
    const view = (await core.read(scope, snapshot.session.id))!;
    check(
      view.snapshot.session.revision === 9 &&
        view.operations[0].conflict?.currentSession?.revision === 9,
      'Unrelated newer snapshot preserved and conflict retained',
    );
    check(result.reason === 'conflict', 'Conflict requires review');
    const conflict = view.operations[0];
    await rejects(
      () =>
        core.resolve(scope, conflict.operationId, {
          kind: 'use_server',
          expectedOperationIds: [],
          expectedDraftRevision: view.draftRevision,
        }),
      'LOCAL_CONFLICT',
    );
    await core.resolve(scope, conflict.operationId, {
      kind: 'use_server',
      expectedOperationIds: view.operations.map((row) => row.operationId),
      expectedDraftRevision: view.draftRevision,
    });
    check(
      (await core.read(scope, snapshot.session.id))!.operations.length === 0,
      'Explicit reviewed discard',
    );
    core.close();
    return { checks: 8 };
  },
  async isolation(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    await core.saveSnapshot(scope, snapshot);
    await enqueue(core, scope, values);
    await rejects(() => core.bindAccount(OTHER), 'ACCOUNT_CHANGE_PENDING');
    const device = await core.getDeviceState();
    check(
      device.scope === null && device.quarantined && device.pendingOperations === 1,
      'Quarantine contains counts only',
    );
    await rejects(() => core.read(scope, snapshot.session.id), 'ACCOUNT_CHANGED');
    const recovered = await core.bindAccount(ACCOUNT);
    check(recovered.generation !== scope.generation, 'Recovery invalidates old generation');
    check(
      (await core.read(recovered, snapshot.session.id))!.operations.length === 1,
      'Recovery preserves old pending intent',
    );
    await rejects(() => core.clearAccount(recovered, 'synced'), 'PENDING_WORK');
    await rejects(() => core.setSharedDevice(recovered, true), 'PENDING_WORK');
    const shared = await core.setSharedDevice(recovered, true, 'discard_confirmed');
    check((await core.getDeviceState()).sharedDevice, 'Shared-device preference persisted');
    await rejects(() => core.saveSnapshot(shared, snapshot), 'SHARED_DEVICE');
    await rejects(() => core.saveSnapshot(recovered, snapshot), 'ACCOUNT_CHANGED');
    const enabled = await core.setSharedDevice(shared, false);
    check((await core.listSavedSessions(enabled)).length === 0, 'Shared-device purge');
    await core.saveSnapshot(enabled, snapshot);
    await core.clearAccount(enabled, 'synced');
    await rejects(() => core.saveSnapshot(enabled, snapshot), 'ACCOUNT_CHANGED');
    const other = await core.bindAccount(OTHER);
    check((await core.listSavedSessions(other)).length === 0, 'No account leak');
    core.close();
    return { checks: 13 };
  },
  async ageAndCapacity(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    await core.saveSnapshot(scope, snapshot);
    await enqueue(core, scope, values);
    env.advance(31);
    check(
      (await core.flush(scope)).blocked === 1 && env.sent.length === 0,
      'Old intent not replayed',
    );
    let view = (await core.read(scope, snapshot.session.id))!;
    await core.refreshConflict(scope, view.operations[0].operationId);
    view = (await core.read(scope, snapshot.session.id))!;
    await core.resolve(scope, view.operations[0].operationId, {
      kind: 'submit_reviewed',
      expectedOperationIds: view.operations.map((row) => row.operationId),
      expectedDraftRevision: view.draftRevision,
      operationId: crypto.randomUUID(),
      intent: values,
      currentRevision: 1,
    });
    check((await core.flush(scope)).acknowledged === 1, 'Reviewed old intent resubmits explicitly');
    await core.saveDraft(
      scope,
      snapshot.session.id,
      { reflection: { text: 'pinned synthetic draft', moods: [] } },
      0,
    );
    for (let n = 0; n < 52; n++) {
      const s = copy(snapshot);
      s.session.id = crypto.randomUUID();
      await core.saveSnapshot(scope, s);
    }
    const saved = await core.listSavedSessions(scope);
    check(
      saved.length === 51 && saved.some((row) => row.snapshot.session.id === snapshot.session.id),
      'Fifty unpinned plus retained draft',
    );
    await core.saveDraft(scope, snapshot.session.id, null, 1);
    check((await core.listSavedSessions(scope)).length === 50, 'Unpinned limit restored');
    core.close();
    return { checks: 4 };
  },
  async seedReload(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    await core.saveSnapshot(scope, snapshot);
    await core.saveDraft(
      scope,
      snapshot.session.id,
      { reflection: { text: 'survives actual document reload', moods: [] } },
      0,
    );
    await enqueue(core, scope, values);
    await enqueue(core, scope, {
      kind: 'completion',
      payload: { performedAt: snapshot.clock.serverNow },
    });
    core.close();
    return scope;
  },
  async verifyReload(name: string) {
    const env = environment(name);
    const core = env.create();
    const device = await core.getDeviceState();
    check(!!device.scope, 'Previously verified scope available for offline shell');
    const view = (await core.read(device.scope!, snapshot.session.id))!;
    check(
      view.draft?.reflection?.text === 'survives actual document reload' &&
        view.operations.length === 2,
      'Actual reload preserved raw text and queue',
    );
    check(
      view.projectedSession.confirmed && !view.snapshot.session.confirmed,
      'Reload preserves pending distinction',
    );
    check(
      (await core.flush(device.scope!)).acknowledged === 2,
      'Reconnect after actual reload acknowledges once',
    );
    core.close();
    return { checks: 4 };
  },
  async startHeld(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    await core.saveSnapshot(scope, snapshot);
    await enqueue(core, scope, values);
    let release!: () => void;
    let started!: () => void;
    const startPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    env.setPause(async () => {
      started();
      await pause;
    });
    const result = core.flush(scope);
    held = { core, release, started: startPromise, result };
    await startPromise;
    return scope;
  },
  async otherTab(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    const result = await core.flush(scope);
    check(
      result.reason === 'not_leader' && result.retryAt !== null && env.sent.length === 0,
      'Real Web Lock excludes second tab and preserves wakeup',
    );
    core.close();
    return { checks: 1 };
  },
  async releaseHeld() {
    check(held, 'Held leader exists');
    held!.release();
    const result = await held!.result;
    held!.core.close();
    held = null;
    return result;
  },
};
Object.assign(window, { offlineHarness: harness });
