import { createOfflineCore, ReplayError, type ReplayTransport } from '../../src/offline/core';
import { createFetchTransport } from '../../src/offline/core/transport';
import { ACCOUNT, OTHER, snapshot } from './fixtures';
import { check, copy, enqueue, environment } from './helpers';
import { abortWrite } from './failures';

/** Real fetch-adapter parsing with synthetic, API-shaped responses; no app server. */
function httpTransport(env: ReturnType<typeof environment>): ReplayTransport {
  const fetchTransport = createFetchTransport();
  return {
    ...env.transport,
    async send(scope, operation, signal) {
      const original = globalThis.fetch;
      globalThis.fetch = async (_input, init) => {
        check(
          new Headers(init?.headers).get('X-Sankalpa-Account') === ACCOUNT,
          'Account header accompanies replay',
        );
        check(init?.body === JSON.stringify(operation.request), 'Wire envelope is exact');
        try {
          const reply = await env.transport.send(scope, operation, signal);
          return Response.json(reply.kind === 'session' ? { session: reply.session } : reply);
        } catch (error) {
          if (!(error instanceof ReplayError)) throw error;
          return Response.json(
            { error: { code: error.code, current: error.current } },
            { status: error.status },
          );
        }
      };
      try {
        return await fetchTransport.send(scope, operation, signal);
      } finally {
        globalThis.fetch = original;
      }
    },
  };
}

export const noChangeRegressions = {
  async noChangeReflection(name: string) {
    const env = environment(name, true);
    const core = createOfflineCore({
      databaseName: name,
      transport: httpTransport(env),
      now: () => '2026-09-06T01:00:00.000Z',
    });
    const scope = await core.bindAccount(ACCOUNT);
    try {
      const server = copy(snapshot);
      server.session.revision = 5;
      server.reflection = {
        sessionId: server.session.id,
        journeyId: server.session.journeyId,
        scheduleVersionId: server.session.scheduleVersionId,
        text: 'same',
        moods: ['calm'],
        revision: 1,
        createdAt: snapshot.lastSyncedAt,
        updatedAt: snapshot.lastSyncedAt,
      };
      env.setServer(server.session);
      env.setReflection(server.reflection);
      await core.saveSnapshot(scope, server);
      const first = await enqueue(core, scope, {
        kind: 'reflection',
        payload: { text: 'same', moods: ['calm'] },
      });
      const second = await enqueue(core, scope, {
        kind: 'reflection',
        payload: { text: 'latest', moods: ['hope'] },
      });
      await core.saveDraft(
        scope,
        snapshot.session.id,
        { reflection: { text: 'raw unqueued', moods: [] } },
        0,
      );
      const result = await core.flush(scope);
      const view = (await core.read(scope, snapshot.session.id))!;
      check(
        result.pending === 0 && result.acknowledged === 1,
        'Redundant reflection produces no mutation receipt',
      );
      check(
        env.sent.find((item) => item.operationId === second.operationId)!.request!.baseRevision ===
          1,
        'Reflection successor retains unchanged base',
      );
      check(
        view.snapshot.reflection?.text === 'latest' && view.snapshot.reflection.revision === 2,
        'Latest reflection applies exactly once',
      );
      check(
        view.snapshot.session.revision === 5 && view.draft?.reflection?.text === 'raw unqueued',
        'Independent stream and raw reflection preserved',
      );
      check(
        !env.receipts.has(first.operationId) && env.receipts.size === 1,
        'Only changed reflection has receipt',
      );
      return { checks: 5 };
    } finally {
      core.close();
    }
  },
  async noChangeCompletion(name: string) {
    for (const initiallyConfirmed of [true, false]) {
      const env = environment(`${name}-${initiallyConfirmed}`, true);
      const core = createOfflineCore({
        databaseName: `${name}-${initiallyConfirmed}`,
        transport: httpTransport(env),
        now: () => '2026-09-06T01:00:00.000Z',
      });
      const scope = await core.bindAccount(ACCOUNT);
      try {
        const server = copy(snapshot);
        server.session.practices[0].value = true;
        server.session.practices[1].value = 20;
        server.session.confirmed = initiallyConfirmed;
        server.session.performedAt = initiallyConfirmed ? snapshot.clock.serverNow : null;
        server.session.recordedAt = initiallyConfirmed ? snapshot.clock.serverNow : null;
        env.setServer(server.session);
        await core.saveSnapshot(scope, server);
        const confirmation = {
          kind: 'completion' as const,
          payload: { performedAt: snapshot.clock.serverNow },
        };
        const undo = { kind: 'completion_undo' as const, payload: {} };
        const first = await enqueue(core, scope, initiallyConfirmed ? confirmation : undo);
        const second = await enqueue(core, scope, initiallyConfirmed ? undo : confirmation);
        const result = await core.flush(scope);
        const view = (await core.read(scope, snapshot.session.id))!;
        check(
          result.pending === 0 && result.acknowledged === 1,
          'Only changed confirmation state acknowledged',
        );
        check(
          view.snapshot.session.revision === 2 &&
            view.snapshot.session.confirmed !== initiallyConfirmed,
          'Successor confirmation state retained',
        );
        check(
          env.sent.find((item) => item.operationId === second.operationId)!.request!
            .baseRevision === 1 && !env.receipts.has(first.operationId),
          'No fake confirmation revision or receipt',
        );
      } finally {
        core.close();
      }
    }
    return { checks: 6 };
  },
  async noChangeBoundaries(name: string) {
    const variants = [
      'missing',
      'malformed',
      'session',
      'version',
      'journey',
      'revision',
      'value',
      'layout',
      'invalid_time',
      'invalid_value',
      'newer',
      'wrong_code',
      'wrong_status',
    ];
    for (const variant of variants) {
      const env = environment(`${name}-${variant}`, true);
      const core = createOfflineCore({
        databaseName: `${name}-${variant}`,
        transport: httpTransport(env),
        now: () => '2026-09-06T01:00:00.000Z',
      });
      const scope = await core.bindAccount(ACCOUNT);
      try {
        const server = copy(snapshot);
        server.session.practices[0].value = true;
        env.setServer(server.session);
        await core.saveSnapshot(scope, server);
        const intent = {
          kind: 'practices' as const,
          payload: { values: { [server.session.practices[0].id]: true } },
        };
        await enqueue(core, scope, intent);
        await core.saveDraft(
          scope,
          snapshot.session.id,
          { reflection: { text: 'kept', moods: [] } },
          0,
        );
        const current = copy(server.session);
        if (variant === 'session') current.id = OTHER;
        if (variant === 'version') current.scheduleVersionId = OTHER;
        if (variant === 'journey') current.journeyId = OTHER;
        if (variant === 'revision') current.revision = 2;
        if (variant === 'value') current.practices[0].value = false;
        if (variant === 'layout') current.practices[0].label = 'unexpected layout';
        if (variant === 'invalid_time') current.performedAt = snapshot.lastSyncedAt;
        if (variant === 'invalid_value') current.practices[1].value = true;
        if (variant === 'newer') {
          server.session.revision = 3;
          await core.saveSnapshot(scope, server);
        }
        env.failSend(
          new ReplayError(
            variant === 'wrong_status' ? 422 : 409,
            variant === 'wrong_code' ? 'OTHER_CONFLICT' : 'NO_CHANGE',
            0,
            variant === 'missing' ? undefined : variant === 'malformed' ? { revision: 1 } : current,
          ),
        );
        const result = await core.flush(scope);
        const view = (await core.read(scope, snapshot.session.id))!;
        check(
          result.acknowledged === 0 &&
            view.operations.length === 1 &&
            view.operations[0].state === 'conflict',
          `Unverified ${variant} response stays in review`,
        );
        check(
          view.draft?.reflection?.text === 'kept' &&
            view.snapshot.session.revision === (variant === 'newer' ? 3 : 1),
          `Unverified ${variant} preserves canonical and raw draft`,
        );
      } finally {
        core.close();
      }
    }
    const reflectionVariants = ['text', 'moods', 'missing', 'journey', 'revision', 'newer'];
    for (const variant of reflectionVariants) {
      const env = environment(`${name}-reflection-${variant}`, true);
      const core = createOfflineCore({
        databaseName: `${name}-reflection-${variant}`,
        transport: httpTransport(env),
        now: () => '2026-09-06T01:00:00.000Z',
      });
      const scope = await core.bindAccount(ACCOUNT);
      try {
        const server = copy(snapshot);
        server.reflection = {
          sessionId: server.session.id,
          journeyId: server.session.journeyId,
          scheduleVersionId: server.session.scheduleVersionId,
          text: 'same',
          moods: ['one', 'two'],
          revision: 1,
          createdAt: snapshot.lastSyncedAt,
          updatedAt: snapshot.lastSyncedAt,
        };
        env.setReflection(server.reflection);
        await core.saveSnapshot(scope, server);
        await enqueue(core, scope, {
          kind: 'reflection',
          payload: { text: 'same', moods: ['one', 'two'] },
        });
        const current = copy(server.reflection);
        if (variant === 'text') current.text = 'different';
        if (variant === 'moods') current.moods = ['two', 'one'];
        if (variant === 'journey') current.journeyId = OTHER;
        if (variant === 'revision') current.revision = 2;
        if (variant === 'newer') {
          server.reflection.revision = 3;
          server.reflection.text = 'newer canonical';
          await core.saveSnapshot(scope, server);
        }
        env.failSend(new ReplayError(409, 'NO_CHANGE', 0, variant === 'missing' ? null : current));
        const result = await core.flush(scope);
        const view = (await core.read(scope, snapshot.session.id))!;
        check(
          result.acknowledged === 0 &&
            view.operations.length === 1 &&
            view.operations[0].state === 'conflict',
          `Unverified reflection ${variant} remains reviewable`,
        );
        check(
          view.snapshot.reflection?.revision === (variant === 'newer' ? 3 : 1),
          `Unverified reflection ${variant} cannot regress canonical`,
        );
      } finally {
        core.close();
      }
    }
    return { checks: (variants.length + reflectionVariants.length) * 2 };
  },
  async noChangeRollback(name: string) {
    const env = environment(name, true);
    const core = createOfflineCore({
      databaseName: name,
      transport: httpTransport(env),
      now: () => '2026-09-06T01:00:00.000Z',
    });
    const scope = await core.bindAccount(ACCOUNT);
    try {
      const server = copy(snapshot);
      server.session.practices[0].value = true;
      env.setServer(server.session);
      await core.saveSnapshot(scope, server);
      const first = await enqueue(core, scope, {
        kind: 'practices',
        payload: { values: { [server.session.practices[0].id]: true } },
      });
      await enqueue(core, scope, {
        kind: 'practices',
        payload: { values: { [server.session.practices[0].id]: false } },
      });
      const failed = await abortWrite('operations', 'delete', () => core.flush(scope));
      check(
        failed.reason === 'storage' && failed.acknowledged === 0,
        'Aborted satisfied-head removal reports storage failure',
      );
      const view = (await core.read(scope, snapshot.session.id))!;
      check(
        view.operations.length === 2 &&
          view.operations[1].predecessorId === first.operationId &&
          !view.operations[1].request,
        'Abort restores head and unattempted successor chain',
      );
      const recovered = await core.flush(scope);
      check(
        recovered.pending === 0 && recovered.acknowledged === 1 && env.receipts.size === 1,
        'Exact retry safely removes redundant head then performs successor once',
      );
      return { checks: 3 };
    } finally {
      core.close();
    }
  },
  async reviewedNoChange(name: string) {
    const env = environment(name, true);
    const core = createOfflineCore({
      databaseName: name,
      transport: httpTransport(env),
      now: () => '2026-09-06T01:00:00.000Z',
    });
    const scope = await core.bindAccount(ACCOUNT);
    try {
      await core.saveSnapshot(scope, snapshot);
      const yes = {
        kind: 'practices' as const,
        payload: { values: { [snapshot.session.practices[0].id]: true } },
      };
      const no = {
        kind: 'practices' as const,
        payload: { values: { [snapshot.session.practices[0].id]: false } },
      };
      await enqueue(core, scope, yes);
      await enqueue(core, scope, no);
      await enqueue(core, scope, {
        kind: 'reflection',
        payload: { text: 'independent note', moods: [] },
      });
      await core.saveDraft(
        scope,
        snapshot.session.id,
        { numericValues: { [snapshot.session.practices[1].id]: 'later' } },
        0,
      );
      const current = copy(snapshot.session);
      current.revision = 2;
      current.practices[0].value = true;
      env.setServer(current);
      check(
        (await core.flush(scope)).acknowledged === 1,
        'Other stream independently acknowledges while session conflicts',
      );
      const view = (await core.read(scope, snapshot.session.id))!;
      const row = view.operations[0];
      const replacements = [yes, no].map((intent) => ({
        operationId: crypto.randomUUID(),
        intent,
      }));
      await core.resolve(scope, row.operationId, {
        kind: 'submit_reviewed',
        expectedComparisonId: row.conflict!.comparisonId,
        expectedOperationIds: view.operations.map((item) => item.operationId),
        expectedDraftRevision: view.draftRevision,
        currentRevision: 2,
        replacements,
      });
      const result = await core.flush(scope);
      check(
        result.reason === 'drained' && result.pending === 0,
        'Reviewed redundant head permits later intent',
      );
      check(result.acknowledged === 1, 'Only the actual successor mutation is acknowledged');
      const after = (await core.read(scope, snapshot.session.id))!;
      check(
        after.snapshot.session.revision === 3 &&
          after.snapshot.session.practices[0].value === false,
        'Later false applies exactly once',
      );
      check(
        after.snapshot.reflection?.text === 'independent note',
        'Independent canonical stream survives',
      );
      check(
        after.draft?.numericValues?.[snapshot.session.practices[1].id] === 'later',
        'Unqueued raw draft survives',
      );
      const wires = env.sent.filter((item) =>
        replacements.some((replacement) => replacement.operationId === item.operationId),
      );
      check(
        wires.length === 2 && wires.every((item) => item.request!.baseRevision === 2),
        'Successor uses unchanged server revision',
      );
      check(
        !env.receipts.has(replacements[0].operationId) &&
          env.receipts.has(replacements[1].operationId),
        'No receipt invented for redundant head',
      );
      return { checks: 8 };
    } finally {
      core.close();
    }
  },
};
