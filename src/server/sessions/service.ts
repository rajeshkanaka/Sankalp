import type pg from 'pg';

import type {
  AmendmentKind,
  MutationEnvelope,
  SessionHistory,
  SessionMutationResult,
  SessionRecord,
} from '../../domain/contracts';
import { targetsMet } from '../../domain/status';
import { withUser } from '../db/client';
import { assertRevision, idempotent } from '../db/operations';
import { AppError } from '../errors';
import { readSessions } from '../journeys/service';
import {
  createAmendment,
  createCorrectionEvent,
  ensureClosureEvent,
  readSessionHistory,
} from './history';
import { lockSessionSnapshot } from './locking';

type PracticeValue = boolean | number;

function assertMutable(
  session: SessionRecord,
  journeyState: 'draft' | 'active' | 'archived',
  expectedRevision: number,
  now: string,
) {
  if (journeyState !== 'active')
    throw new AppError(409, 'JOURNEY_INACTIVE', 'This journey is not active.');
  if (session.supersededAt)
    throw new AppError(
      409,
      'SESSION_REPLACED',
      'The schedule changed. Review this practice before saving.',
      session,
    );
  assertRevision(session.revision, expectedRevision, session);
  if (Date.parse(now) < Date.parse(session.opensAt))
    throw new AppError(422, 'NOT_OPEN', 'This practice has not opened yet.');
}

function validateValue(session: SessionRecord, practiceId: string, value: PracticeValue) {
  const practice = session.practices.find((item) => item.id === practiceId);
  if (!practice)
    throw new AppError(422, 'UNKNOWN_PRACTICE', 'A practice does not belong to this session.');
  if (
    (practice.kind === 'checkbox' && typeof value !== 'boolean') ||
    (practice.kind !== 'checkbox' &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000))
  )
    throw new AppError(422, 'INVALID_VALUE', 'Enter a valid practice value.');
  return practice;
}

async function updatedSession(
  client: pg.PoolClient,
  journeyId: string,
  sessionId: string,
): Promise<SessionRecord> {
  const session = (await readSessions(client, journeyId)).find((item) => item.id === sessionId);
  if (!session) throw new Error('Locked session disappeared during its mutation.');
  return session;
}

async function finishMutation(
  client: pg.PoolClient,
  userId: string,
  before: SessionRecord,
  now: string,
  closure: Awaited<ReturnType<typeof ensureClosureEvent>>,
  kind: AmendmentKind,
  detail: Record<string, unknown>,
): Promise<SessionMutationResult> {
  const nextRevision = before.revision + 1;
  const revision = await client.query<{ revision: number }>(
    'update app.session set revision=revision+1 where id=$1 and revision=$2 returning revision',
    [before.id, before.revision],
  );
  if (revision.rows[0]?.revision !== nextRevision)
    throw new Error('Locked session revision did not advance exactly once.');
  const amendment = await createAmendment(client, userId, before, kind, nextRevision, now, detail);
  const session = await updatedSession(client, before.journeyId, before.id);
  const historyEvents = closure?.created ? [closure.event] : [];
  if (Date.parse(now) >= Date.parse(before.closesAt)) {
    historyEvents.push(
      await createCorrectionEvent(client, userId, before, session, amendment, now),
    );
  }
  return { session, amendment, historyEvents };
}

export async function savePractices(
  userId: string,
  id: string,
  input: MutationEnvelope<{ values: Record<string, PracticeValue> }>,
): Promise<SessionMutationResult> {
  return withUser(userId, (client) =>
    idempotent(client, userId, input.operationId, `values:${id}`, input, async () => {
      const { session, journeyState, now } = await lockSessionSnapshot(client, id);
      assertMutable(session, journeyState, input.baseRevision, now);
      if (session.confirmed)
        throw new AppError(
          409,
          'ALREADY_CONFIRMED',
          'Remove the completion before correcting practice values.',
          session,
        );
      const changes = Object.entries(input.payload.values).map(([practiceId, value]) => {
        const practice = validateValue(session, practiceId, value);
        return { practice, value, before: practice.value };
      });
      if (changes.length === 0 || changes.every(({ before, value }) => before === value))
        throw new AppError(409, 'NO_CHANGE', 'These practice values are already saved.', session);
      const closure = await ensureClosureEvent(client, userId, session, now);
      for (const { practice, value } of changes) {
        await client.query(
          `update app.session_practice set checkbox_value=$3,numeric_value=$4
           where session_id=$1 and practice_id=$2`,
          [
            id,
            practice.id,
            practice.kind === 'checkbox' ? value : null,
            practice.kind === 'checkbox' ? null : value,
          ],
        );
      }
      return finishMutation(client, userId, session, now, closure, 'values_saved', {
        changes: changes.map(({ practice, before, value }) => ({
          practiceId: practice.id,
          before,
          after: value,
        })),
      });
    }),
  );
}

export async function confirmSession(
  userId: string,
  id: string,
  input: MutationEnvelope<{ performedAt: string }>,
): Promise<SessionMutationResult> {
  return withUser(userId, (client) =>
    idempotent(client, userId, input.operationId, `complete:${id}`, input, async () => {
      const { session, journeyState, now } = await lockSessionSnapshot(client, id);
      assertMutable(session, journeyState, input.baseRevision, now);
      if (!targetsMet(session))
        throw new AppError(
          422,
          'TARGETS_INCOMPLETE',
          'Complete every required practice before confirming.',
        );
      const performed = Date.parse(input.payload.performedAt);
      if (
        !Number.isFinite(performed) ||
        performed > Date.parse(now) ||
        performed < Date.parse(session.opensAt)
      )
        throw new AppError(
          422,
          'INVALID_PERFORMED_TIME',
          'Choose when you practiced, between the session opening and now.',
        );
      if (session.confirmed && performed === Date.parse(session.performedAt!))
        throw new AppError(409, 'NO_CHANGE', 'This practice time is already recorded.', session);

      const closure = await ensureClosureEvent(client, userId, session, now);
      await client.query(
        `update app.session set confirmed=true,performed_at=$2,recorded_at=$3
         where id=$1`,
        [id, input.payload.performedAt, now],
      );
      const kind = session.confirmed ? 'completion_corrected' : 'confirmed';
      return finishMutation(client, userId, session, now, closure, kind, {
        beforePerformedAt: session.performedAt,
        performedAt: new Date(performed).toISOString(),
      });
    }),
  );
}

export async function removeCompletion(
  userId: string,
  id: string,
  input: MutationEnvelope<Record<string, never>>,
): Promise<SessionMutationResult> {
  return withUser(userId, (client) =>
    idempotent(client, userId, input.operationId, `remove-completion:${id}`, input, async () => {
      const { session, journeyState, now } = await lockSessionSnapshot(client, id);
      assertMutable(session, journeyState, input.baseRevision, now);
      if (!session.confirmed)
        throw new AppError(409, 'NO_CHANGE', 'This session is not recorded as complete.', session);
      const closure = await ensureClosureEvent(client, userId, session, now);
      await client.query(
        `update app.session set confirmed=false,performed_at=null,recorded_at=null
         where id=$1`,
        [id],
      );
      return finishMutation(client, userId, session, now, closure, 'completion_removed', {
        performedAt: session.performedAt,
      });
    }),
  );
}

export async function getSessionHistory(userId: string, id: string): Promise<SessionHistory> {
  return withUser(userId, async (client) => {
    const { session, now } = await lockSessionSnapshot(client, id);
    await ensureClosureEvent(client, userId, session, now);
    return readSessionHistory(client, id);
  });
}
