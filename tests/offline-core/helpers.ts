import { createOfflineCore, ReplayError } from '../../src/offline/core';
import type {
  AccountScope,
  Intent,
  OfflineCore,
  QueueOperation,
  ReplayReply,
  ReplayTransport,
} from '../../src/offline/core';
import { ACCOUNT, snapshot } from './fixtures';

export const check = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
export async function rejects(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    check((error as { code: string }).code === code, `Expected ${code}`);
    return;
  }
  throw new Error(`Expected rejection ${code}`);
}
export const copy = <T>(value: T): T => structuredClone(value);
export function environment(databaseName: string, noChangeResponses = false) {
  let time = '2026-09-06T01:00:00.000Z';
  let server = copy(snapshot.session);
  let reflection = copy(snapshot.reflection);
  let identity = ACCOUNT;
  let loseReply = false;
  let nextError: ReplayError | null = null;
  let identityError: ReplayError | null = null;
  let currentError: ReplayError | null = null;
  let pause: (() => Promise<void>) | null = null;
  const sent: QueueOperation[] = [];
  const receipts = new Map<string, ReplayReply>();
  const transport: ReplayTransport = {
    async identity() {
      if (identityError) throw identityError;
      return { accountId: identity, now: time };
    },
    async current() {
      if (currentError) throw currentError;
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
      if (nextError) {
        const error = nextError;
        nextError = null;
        throw error;
      }
      let reply = receipts.get(op.operationId);
      if (!reply) {
        check(!!op.request, 'Wire request must have committed before send');
        const rev = op.stream === 'session' ? server.revision : (reflection?.revision ?? 0);
        if (op.request!.baseRevision !== rev) throw new ReplayError(409, 'REVISION_CONFLICT');
        if (noChangeResponses) {
          const unchanged =
            op.intent.kind === 'practices'
              ? Object.entries(op.intent.payload.values).every(
                  ([id, value]) => server.practices.find((item) => item.id === id)?.value === value,
                )
              : op.intent.kind === 'completion'
                ? server.confirmed && server.performedAt === op.intent.payload.performedAt
                : op.intent.kind === 'completion_undo'
                  ? !server.confirmed
                  : reflection &&
                    reflection.text === op.intent.payload.text &&
                    JSON.stringify(reflection.moods) === JSON.stringify(op.intent.payload.moods);
          if (unchanged)
            throw new ReplayError(
              409,
              'NO_CHANGE',
              0,
              copy(op.stream === 'session' ? server : reflection),
            );
        }
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
            server.recordedAt = null;
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
    failSend: (error: ReplayError) => {
      nextError = error;
    },
    failIdentity: (error: ReplayError | null) => {
      identityError = error;
    },
    failCurrent: (error: ReplayError | null) => {
      currentError = error;
    },
    setReflection: (value: typeof reflection) => {
      reflection = copy(value);
    },
    serverSnapshot: () => ({
      ...copy(snapshot),
      session: copy(server),
      reflection: copy(reflection),
    }),
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
export async function enqueue(core: OfflineCore, scope: AccountScope, intent: Intent) {
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
export const values = {
  kind: 'practices',
  payload: {
    values: { [snapshot.session.practices[0].id]: true, [snapshot.session.practices[1].id]: 20 },
  },
} satisfies Intent;
