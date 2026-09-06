import { Storage } from '../../src/offline/core/store';
import { ACCOUNT, OTHER, snapshot } from './fixtures';
import { check, enqueue, environment, rejects, values } from './helpers';

export const bindingRegressions = {
  async bindingGeneration(name: string) {
    const env = environment(name);
    const core = env.create();
    const other = env.create();
    try {
      const empty = await core.getDeviceState();
      check(typeof empty.bindingGeneration === 'string', 'Unbound device exposes a CAS token');
      const first = await core.bindAccount(ACCOUNT, {
        expectedGeneration: empty.bindingGeneration,
      });
      check(first.generation !== empty.bindingGeneration, 'First binding advances generation');
      const firstState = await core.getDeviceState();
      check(
        firstState.bindingGeneration === first.generation,
        'Binding token matches the active scope',
      );
      const second = await other.bindAccount(OTHER, {
        expectedGeneration: firstState.bindingGeneration,
      });
      await other.saveSnapshot(second, snapshot);
      await enqueue(other, second, values);
      await other.saveDraft(
        second,
        snapshot.session.id,
        { reflection: { text: 'Synthetic second-account unsent draft', moods: [] } },
        0,
      );
      const before = await other.getDeviceState();
      const beforeView = await other.read(second, snapshot.session.id);
      let invalidRejected = false;
      try {
        await core.bindAccount(ACCOUNT, { expectedGeneration: 'not-a-uuid' });
      } catch (error) {
        invalidRejected = error instanceof Error && error.name === 'ZodError';
      }
      check(invalidRejected, 'Malformed expected generation is rejected before storage');
      await rejects(
        () =>
          core.bindAccount(ACCOUNT, {
            expectedGeneration: firstState.bindingGeneration,
            discardPrevious: true,
          }),
        'ACCOUNT_CHANGED',
      );
      check(
        JSON.stringify(await other.getDeviceState()) === JSON.stringify(before),
        'Stale first account cannot quarantine or change second-account metadata',
      );
      check(
        JSON.stringify(await other.read(second, snapshot.session.id)) ===
          JSON.stringify(beforeView),
        'Stale discard cannot purge or change the second-account canonical, queue or raw draft',
      );
      await rejects(() => core.read(first, snapshot.session.id), 'ACCOUNT_CHANGED');
      await other.clearAccount(second, 'discard_confirmed');
      const cleared = await core.getDeviceState();
      check(
        cleared.scope === null &&
          cleared.managementScope === null &&
          cleared.bindingGeneration !== before.bindingGeneration,
        'Clearing advances the binding token without an active account',
      );
      await rejects(
        () => core.bindAccount(OTHER, { expectedGeneration: before.bindingGeneration }),
        'ACCOUNT_CHANGED',
      );
      check(
        JSON.stringify(await core.getDeviceState()) === JSON.stringify(cleared),
        'Stale response cannot revive the cleared account',
      );
      const fresh = await core.bindAccount(ACCOUNT, {
        expectedGeneration: cleared.bindingGeneration,
      });
      check((await core.listSavedSessions(fresh)).length === 0, 'Fresh verified binding succeeds');
      const shared = await core.setSharedDevice(fresh, true);
      const sharedState = await core.getDeviceState();
      check(
        sharedState.scope === null && sharedState.bindingGeneration === shared.generation,
        'Shared mode keeps a management CAS token without granting private access',
      );
      const recovered = await core.setSharedDevice(shared, false);
      await core.saveSnapshot(recovered, snapshot);
      await enqueue(core, recovered, values);
      await rejects(
        () => core.bindAccount(OTHER, { expectedGeneration: recovered.generation }),
        'ACCOUNT_CHANGE_PENDING',
      );
      const quarantined = await core.getDeviceState();
      check(
        quarantined.quarantined &&
          quarantined.scope === null &&
          quarantined.managementScope === null &&
          quarantined.bindingGeneration !== recovered.generation,
        'Quarantine exposes only its fresh binding token and safe counts',
      );
      await rejects(
        () => core.bindAccount(ACCOUNT, { expectedGeneration: recovered.generation }),
        'ACCOUNT_CHANGED',
      );
      check(
        JSON.stringify(await core.getDeviceState()) === JSON.stringify(quarantined),
        'Stale recovery cannot mutate quarantine',
      );
      const restored = await core.bindAccount(ACCOUNT, {
        expectedGeneration: quarantined.bindingGeneration,
      });
      check(
        (await core.read(restored, snapshot.session.id))!.operations.length === 1,
        'Fresh verified recovery preserves pending work',
      );
      return { checks: 18 };
    } finally {
      core.close();
      other.close();
    }
  },
  async bindingClearRace(name: string) {
    const env = environment(name);
    const core = env.create();
    const other = env.create();
    const original = Storage.prototype.run;
    try {
      const scope = await core.bindAccount(ACCOUNT);
      await core.saveSnapshot(scope, snapshot);
      await enqueue(core, scope, values);
      await other.getDeviceState();
      let phases = 0;
      let clearedGeneration: string | null = null;
      // Pause between the actual binding transactions, then clear through another core instance.
      // Both clear and bind still use real IndexedDB/Web Locks; only their ordering is controlled.
      Object.defineProperty(Storage.prototype, 'run', {
        configurable: true,
        writable: true,
        value: async function (this: Storage, ...args: unknown[]) {
          phases += 1;
          if (phases === 2) {
            Storage.prototype.run = original;
            await other.clearAccount(scope, 'discard_confirmed');
            clearedGeneration = (await other.getDeviceState()).bindingGeneration;
          }
          return Reflect.apply(original, this, args);
        },
      });
      await rejects(
        () => core.bindAccount(ACCOUNT, { expectedGeneration: scope.generation }),
        'ACCOUNT_CHANGED',
      );
      check(phases === 2 && clearedGeneration !== null, 'Clear committed between both phases');
      const after = await other.getDeviceState();
      check(
        after.scope === null &&
          after.managementScope === null &&
          after.bindingGeneration === clearedGeneration &&
          after.pendingOperations === 0,
        'Final binding transaction cannot resurrect a cleared generation',
      );
      await rejects(() => core.read(scope, snapshot.session.id), 'ACCOUNT_CHANGED');
      const fresh = await core.bindAccount(ACCOUNT, {
        expectedGeneration: after.bindingGeneration,
      });
      check((await core.listSavedSessions(fresh)).length === 0, 'Explicit clear remains durable');
      return { checks: 5 };
    } finally {
      Storage.prototype.run = original;
      core.close();
      other.close();
    }
  },
};
