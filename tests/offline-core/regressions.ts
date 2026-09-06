import { ReplayError, type LocalView, type QueueOperation } from '../../src/offline/core';
import { ACCOUNT, OTHER, snapshot } from './fixtures';
import { check, copy, enqueue, environment, rejects, values } from './helpers';

const review = (view: LocalView, operation: QueueOperation) => ({
  expectedComparisonId: operation.conflict!.comparisonId,
  expectedOperationIds: view.operations
    .filter((row) => row.stream === operation.stream)
    .map((row) => row.operationId),
  expectedDraftRevision: view.draftRevision,
});
async function conflictEnvironment(name: string) {
  const env = environment(name);
  const core = env.create();
  const scope = await core.bindAccount(ACCOUNT);
  await core.saveSnapshot(scope, snapshot);
  await enqueue(core, scope, values);
  const external = copy(snapshot.session);
  external.revision = 2;
  env.setServer(external);
  await core.flush(scope);
  return { env, core, scope };
}

export const regressions = {
  async staleResolution(name: string) {
    const { env, core, scope } = await conflictEnvironment(name);
    try {
      const view = (await core.read(scope, snapshot.session.id))!;
      const row = view.operations[0];
      const newer = env.serverSnapshot();
      newer.session.revision = 3;
      await core.saveSnapshot(scope, newer);
      await rejects(
        () => core.resolve(scope, row.operationId, { kind: 'use_server', ...review(view, row) }),
        'LOCAL_CONFLICT',
      );
      const retained = (await core.read(scope, snapshot.session.id))!;
      check(retained.snapshot.session.revision === 3, 'Stale comparison cannot regress canonical');
      check(retained.operations.length === 1, 'Stale choice must preserve original intent');
      env.setServer(newer.session);
      await core.refreshConflict(scope, row.operationId);
      const fresh = (await core.read(scope, snapshot.session.id))!;
      await core.resolve(scope, row.operationId, {
        kind: 'use_server',
        ...review(fresh, fresh.operations[0]),
      });
      check(
        (await core.read(scope, snapshot.session.id))!.operations.length === 0,
        'Fresh review succeeds',
      );
      return { checks: 4 };
    } finally {
      core.close();
    }
  },
  async independentResolution(name: string) {
    const { core, scope } = await conflictEnvironment(name);
    try {
      await enqueue(core, scope, {
        kind: 'reflection',
        payload: { text: 'latest acknowledged', moods: [] },
      });
      await core.flush(scope);
      const view = (await core.read(scope, snapshot.session.id))!;
      check(view.snapshot.reflection?.revision === 1, 'Independent note acknowledged');
      await core.resolve(scope, view.operations[0].operationId, {
        kind: 'use_server',
        ...review(view, view.operations[0]),
      });
      const final = (await core.read(scope, snapshot.session.id))!;
      check(
        final.snapshot.reflection?.text === 'latest acknowledged',
        'Resolution preserves independently acknowledged reflection',
      );
      return { checks: 2 };
    } finally {
      core.close();
    }
  },
  async comparisonVersion(name: string) {
    const { env, core, scope } = await conflictEnvironment(name);
    try {
      const view = (await core.read(scope, snapshot.session.id))!;
      const row = view.operations[0];
      const newer = env.serverSnapshot();
      newer.session.revision = 3;
      env.setServer(newer.session);
      await core.refreshConflict(scope, row.operationId);
      await rejects(
        () => core.resolve(scope, row.operationId, { kind: 'use_server', ...review(view, row) }),
        'LOCAL_CONFLICT',
      );
      check(
        (await core.read(scope, snapshot.session.id))!.operations.length === 1,
        'Unseen refreshed comparison cannot discard intent',
      );
      return { checks: 2 };
    } finally {
      core.close();
    }
  },
  async orderedReplacement(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    try {
      await core.saveSnapshot(scope, snapshot);
      await enqueue(core, scope, values);
      await enqueue(core, scope, {
        kind: 'completion',
        payload: { performedAt: snapshot.clock.serverNow },
      });
      await core.saveDraft(
        scope,
        snapshot.session.id,
        {
          numericValues: { [snapshot.session.practices[1].id]: '1e-' },
          reflection: { text: 'unsent raw note', moods: [] },
        },
        0,
      );
      const external = copy(snapshot.session);
      external.revision = 2;
      env.setServer(external);
      await core.flush(scope);
      const view = (await core.read(scope, snapshot.session.id))!;
      const first = view.operations[0];
      await rejects(
        () =>
          core.resolve(scope, first.operationId, {
            kind: 'submit_reviewed',
            ...review(view, first),
            currentRevision: 2,
            replacements: [
              {
                operationId: crypto.randomUUID(),
                intent: { kind: 'completion', payload: { performedAt: snapshot.clock.serverNow } },
              },
              { operationId: crypto.randomUUID(), intent: values },
            ],
          }),
        'TARGETS_INCOMPLETE',
      );
      const ids = [crypto.randomUUID(), crypto.randomUUID()];
      await core.resolve(scope, first.operationId, {
        kind: 'submit_reviewed',
        ...review(view, first),
        currentRevision: 2,
        replacements: [
          { operationId: ids[0], intent: values },
          {
            operationId: ids[1],
            intent: { kind: 'completion', payload: { performedAt: snapshot.clock.serverNow } },
          },
        ],
      });
      const queued = (await core.read(scope, snapshot.session.id))!;
      check(
        JSON.stringify(queued.draft) === JSON.stringify(view.draft),
        'Submit preserves all raw draft fields',
      );
      check(
        queued.operations[1].predecessorId === ids[0],
        'Reviewed sequence has stable predecessor chain',
      );
      env.lose();
      await core.flush(scope);
      env.advance();
      await core.flush(scope);
      const final = (await core.read(scope, snapshot.session.id))!;
      check(
        final.snapshot.session.confirmed && final.operations.length === 0,
        'Whole reviewed workflow acknowledged',
      );
      check(
        final.snapshot.session.performedAt === snapshot.clock.serverNow,
        'Original performed time retained',
      );
      check(
        env.sent.at(-1)!.request!.baseRevision === 3,
        'Second replacement uses only predecessor acknowledgment',
      );
      return { checks: 6 };
    } finally {
      core.close();
    }
  },
  async accountChanged(name: string) {
    const env = environment(name);
    const core = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    try {
      await core.saveSnapshot(scope, snapshot);
      await enqueue(core, scope, values);
      env.failSend(new ReplayError(409, 'ACCOUNT_CHANGED'));
      env.setPause(async () => {
        env.failIdentity(new ReplayError(0, 'NETWORK_UNCERTAIN'));
      });
      const result = await core.flush(scope);
      const state = await core.getDeviceState();
      check(
        result.reason === 'account_changed' && state.scope === null && state.quarantined,
        'Account response immediately quarantines even if identity read is unavailable',
      );
      check(state.pendingOperations === 1, 'Quarantine preserves pending work');
      await rejects(() => core.read(scope, snapshot.session.id), 'ACCOUNT_CHANGED');
      return { checks: 3 };
    } finally {
      core.close();
    }
  },
  async switchDuringReplay(name: string) {
    const env = environment(name);
    const core = env.create();
    const other = env.create();
    const scope = await core.bindAccount(ACCOUNT);
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    let flush: Promise<unknown> | undefined;
    try {
      await core.saveSnapshot(scope, snapshot);
      await enqueue(core, scope, values);
      env.setPause(async () => {
        started();
        await held;
      });
      flush = core.flush(scope);
      await began;
      await rejects(() => other.bindAccount(OTHER, { discardPrevious: true }), 'SYNC_BUSY');
      const state = await other.getDeviceState();
      check(
        state.quarantined && state.pendingOperations === 1,
        'Busy account switch hides and preserves in-flight work',
      );
      release();
      await flush;
      const switched = await other.bindAccount(OTHER, { discardPrevious: true });
      check(
        (await other.listSavedSessions(switched)).length === 0,
        'Retry discards only after replay exits',
      );
      return { checks: 3 };
    } finally {
      release();
      await flush;
      core.close();
      other.close();
    }
  },
};
