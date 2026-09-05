import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { MutationEnvelope, SessionRecord } from '../../domain/contracts';
import { targetsMet } from '../../domain/status';
import { getRuntimeInfo } from '../config';
import { withUser } from '../db/client';
import { assertRevision, idempotent } from '../db/operations';
import { AppError, notFound } from '../errors';
import { readSessions } from '../journeys/service';

async function lockSession(client: pg.PoolClient, id: string, revision: number) {
  const parent = await client.query<{ journey_id: string }>(
    'select journey_id from app.session where id=$1',
    [id],
  );
  if (!parent.rows[0]) throw notFound();
  const journey = await client.query('select state from app.journey where id=$1 for update', [
    parent.rows[0].journey_id,
  ]);
  if (journey.rows[0]?.state !== 'active')
    throw new AppError(409, 'JOURNEY_INACTIVE', 'This journey is not active.');
  await client.query('select id from app.session where id=$1 for update', [id]);
  const session = (await readSessions(client, parent.rows[0].journey_id)).find(
    (row) => row.id === id,
  );
  if (!session) throw notFound();
  if (session.supersededAt)
    throw new AppError(
      409,
      'SESSION_REPLACED',
      'The schedule changed. Review this practice before saving.',
      session,
    );
  assertRevision(session.revision, revision, session);
  if (Date.parse(getRuntimeInfo().now) < Date.parse(session.opensAt))
    throw new AppError(422, 'NOT_OPEN', 'This practice has not opened yet.');
  return session;
}
async function amendment(
  client: pg.PoolClient,
  userId: string,
  session: SessionRecord,
  kind: string,
  detail: unknown,
  now: string,
) {
  await client.query(
    'insert into app.amendment(id,owner_id,journey_id,session_id,schedule_version_id,kind,recorded_at,detail) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      randomUUID(),
      userId,
      session.journeyId,
      session.id,
      session.scheduleVersionId,
      kind,
      now,
      JSON.stringify(detail),
    ],
  );
}
export async function savePractices(
  userId: string,
  id: string,
  input: MutationEnvelope<{ values: Record<string, boolean | number> }>,
) {
  const { now } = getRuntimeInfo();
  return withUser(userId, (client) =>
    idempotent(client, userId, input.operationId, `values:${id}`, input, async () => {
      const session = await lockSession(client, id, input.baseRevision);
      if (session.confirmed)
        throw new AppError(
          409,
          'ALREADY_CONFIRMED',
          'Remove the completion before correcting practice values.',
          session,
        );
      for (const [practiceId, value] of Object.entries(input.payload.values)) {
        const practice = session.practices.find((item) => item.id === practiceId);
        if (!practice)
          throw new AppError(
            422,
            'UNKNOWN_PRACTICE',
            'A practice does not belong to this session.',
          );
        if (
          (practice.kind === 'checkbox' && typeof value !== 'boolean') ||
          (practice.kind !== 'checkbox' &&
            (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000000))
        )
          throw new AppError(422, 'INVALID_VALUE', 'Enter a valid practice value.');
        await client.query(
          'update app.session_practice set checkbox_value=$3,numeric_value=$4 where session_id=$1 and practice_id=$2',
          [
            id,
            practiceId,
            practice.kind === 'checkbox' ? value : null,
            practice.kind === 'checkbox' ? null : value,
          ],
        );
      }
      await client.query('update app.session set revision=revision+1 where id=$1', [id]);
      await amendment(
        client,
        userId,
        session,
        'values_saved',
        {
          before: session.practices.map(({ id, value }) => ({ id, value })),
          values: input.payload.values,
        },
        now,
      );
      return {
        session: (await readSessions(client, session.journeyId)).find((row) => row.id === id)!,
      };
    }),
  );
}
export async function confirmSession(
  userId: string,
  id: string,
  input: MutationEnvelope<{ performedAt: string }>,
) {
  const { now } = getRuntimeInfo();
  return withUser(userId, (client) =>
    idempotent(client, userId, input.operationId, `complete:${id}`, input, async () => {
      const session = await lockSession(client, id, input.baseRevision);
      if (session.confirmed)
        throw new AppError(
          409,
          'ALREADY_CONFIRMED',
          'This practice is already confirmed.',
          session,
        );
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
      await client.query(
        'update app.session set confirmed=true,performed_at=$2,recorded_at=$3,revision=revision+1 where id=$1',
        [id, input.payload.performedAt, now],
      );
      await amendment(
        client,
        userId,
        session,
        'confirmed',
        { performedAt: input.payload.performedAt },
        now,
      );
      return {
        session: (await readSessions(client, session.journeyId)).find((row) => row.id === id)!,
      };
    }),
  );
}
