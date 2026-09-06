import { z } from 'zod';
import { parseReflection, parseSession, instant, uuid } from './model';
import type { AccountScope, Conflict, QueueOperation, ReplayReply, ReplayTransport } from './types';

export class ReplayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterSeconds = 0,
    public readonly current?: unknown,
  ) {
    super('The server could not acknowledge this change.');
    this.name = 'ReplayError';
  }
}
async function json(
  path: string,
  signal: AbortSignal,
  scope?: AccountScope,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(scope ? { 'X-Sankalpa-Account': scope.accountId } : {}),
      },
    });
  } catch {
    throw new ReplayError(0, 'NETWORK_UNCERTAIN');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ReplayError(response.ok ? 0 : response.status, 'INVALID_RESPONSE');
  }
  if (!response.ok) {
    const parsed = z
      .object({
        error: z.object({
          code: z.string().regex(/^[A-Z_]{1,80}$/),
          current: z.unknown().optional(),
        }),
      })
      .safeParse(body);
    const retry = response.headers.get('Retry-After');
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 0;
    throw new ReplayError(
      response.status,
      parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
      Math.min(300, seconds),
      parsed.success ? parsed.data.error.current : undefined,
    );
  }
  return body;
}
const route = (operation: QueueOperation): { path: string; method: string } => {
  const id = uuid(operation.sessionId);
  switch (operation.intent.kind) {
    case 'practices':
      return { path: `/api/sessions/${id}/practices`, method: 'PUT' };
    case 'completion':
      return { path: `/api/sessions/${id}/completion`, method: 'POST' };
    case 'completion_undo':
      return { path: `/api/sessions/${id}/completion`, method: 'DELETE' };
    case 'reflection':
      return { path: `/api/sessions/${id}/reflection`, method: 'PUT' };
  }
};
export function createFetchTransport(): ReplayTransport {
  return {
    async identity(signal) {
      const result = z
        .object({ accountId: z.uuid(), now: z.iso.datetime({ offset: true }) })
        .parse(await json('/api/auth/session', signal));
      return result;
    },
    async send(scope, operation, signal): Promise<ReplayReply> {
      if (!operation.request) throw new ReplayError(0, 'INVALID_RESPONSE');
      const { path, method } = route(operation);
      const body = await json(path, signal, scope, {
        method,
        body: JSON.stringify(operation.request),
      });
      try {
        if (operation.stream === 'reflection') {
          const result = z
            .object({
              sessionId: z.uuid(),
              revision: z.int().nonnegative(),
              updatedAt: z.iso.datetime({ offset: true }),
            })
            .parse(body);
          return { kind: 'reflection', ...result };
        }
        return {
          kind: 'session',
          session: parseSession(z.object({ session: z.unknown() }).parse(body).session),
        };
      } catch {
        throw new ReplayError(0, 'INVALID_RESPONSE');
      }
    },
    async current(scope, operation, signal): Promise<Omit<Conflict, 'comparisonId'>> {
      const path = `/api/sessions/${uuid(operation.sessionId)}`;
      try {
        const result = z
          .object({ session: z.unknown(), now: z.unknown() })
          .parse(await json(path, signal, scope));
        instant(result.now);
        const session = parseSession(result.session);
        const reflection = parseReflection(await json(`${path}/reflection`, signal, scope));
        if (
          session.id !== operation.sessionId ||
          session.scheduleVersionId !== operation.scheduleVersionId ||
          (reflection &&
            (reflection.sessionId !== operation.sessionId ||
              reflection.scheduleVersionId !== operation.scheduleVersionId))
        ) {
          throw new ReplayError(0, 'INVALID_RESPONSE');
        }
        return {
          code: 'REVIEW_REQUIRED',
          currentSession: session,
          currentReflection: reflection,
          currentAvailable: true,
        };
      } catch (error) {
        if (error instanceof ReplayError && error.status === 404)
          return {
            code: 'NOT_FOUND',
            currentSession: null,
            currentReflection: null,
            currentAvailable: true,
          };
        throw error;
      }
    },
  };
}
