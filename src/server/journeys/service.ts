import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  JourneyDraft,
  JourneyRecord,
  JourneyView,
  MutationEnvelope,
  SessionRecord,
} from '../../domain/contracts';
import { journeyDraftSchema } from '../../domain/validation';
import { previewSchedule } from '../../domain/schedule';
import { computeMetrics } from '../../domain/metrics';
import { getRuntimeInfo } from '../config';
import { withUser } from '../db/client';
import { assertRevision, fingerprint, idempotent } from '../db/operations';
import { AppError, notFound } from '../errors';

interface JourneyRow {
  id: string;
  draft: JourneyDraft;
  state: JourneyRecord['state'];
  revision: number;
  active_schedule_version_id: string | null;
  created_at: Date;
}
function toJourney(row: JourneyRow): JourneyRecord {
  return {
    ...row.draft,
    id: row.id,
    state: row.state,
    revision: row.revision,
    activeScheduleVersionId: row.active_schedule_version_id,
    createdAt: row.created_at.toISOString(),
  };
}
export async function readSessions(
  client: pg.PoolClient,
  journeyId: string,
): Promise<SessionRecord[]> {
  const result = await client.query(
    `select s.id, s.journey_id as "journeyId", s.schedule_version_id as "scheduleVersionId", s.ordinal,
    s.practice_date::text as "practiceDate", s.opens_at as "opensAt", s.closes_at as "closesAt", s.time_zone as "timeZone", s.attribution, s.adjustment,
    s.confirmed, s.performed_at as "performedAt", s.recorded_at as "recordedAt", s.revision, s.superseded_at as "supersededAt",
    coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'order', p.position, 'kind', p.kind, 'target', p.target,
      'value', case when p.kind = 'checkbox' then to_jsonb(v.checkbox_value) else to_jsonb(v.numeric_value) end) order by p.position) filter(where p.id is not null), '[]') as practices
    from app.session s left join app.session_practice v on v.session_id=s.id
    left join app.practice_version p on p.id=v.practice_id and p.schedule_version_id=v.schedule_version_id
    where s.journey_id=$1 group by s.id order by s.practice_date, s.superseded_at nulls first`,
    [journeyId],
  );
  return result.rows.map((row) => ({
    ...row,
    opensAt: row.opensAt.toISOString(),
    closesAt: row.closesAt.toISOString(),
    performedAt: row.performedAt?.toISOString() ?? null,
    recordedAt: row.recordedAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
  }));
}
export async function readJourneyView(
  client: pg.PoolClient,
  id: string,
  now: string,
): Promise<JourneyView> {
  const result = await client.query<JourneyRow>('select * from app.journey where id=$1', [id]);
  if (!result.rows[0]) throw notFound();
  const sessions = await readSessions(client, id);
  return {
    journey: toJourney(result.rows[0]),
    sessions,
    metrics: computeMetrics(sessions, now),
    now,
  };
}
export async function listJourneyViews(userId: string): Promise<JourneyView[]> {
  const { now } = getRuntimeInfo();
  return withUser(userId, async (client) => {
    const result = await client.query<{ id: string }>(
      'select id from app.journey order by created_at desc limit 100',
    );
    const views: JourneyView[] = [];
    for (const row of result.rows) views.push(await readJourneyView(client, row.id, now));
    return views;
  });
}
export async function getJourneyView(userId: string, id: string): Promise<JourneyView> {
  return withUser(userId, (client) => readJourneyView(client, id, getRuntimeInfo().now));
}
export async function createJourney(userId: string, input: JourneyDraft) {
  const draft = journeyDraftSchema.parse(input);
  if (draft.reminders.enabled)
    throw new AppError(
      422,
      'REMINDERS_UNAVAILABLE',
      'Reminder delivery is not available in this milestone.',
    );
  const { now } = getRuntimeInfo();
  const preview = previewSchedule(draft.schedule, now);
  if (!preview.total)
    throw new AppError(422, 'EMPTY_SCHEDULE', 'Choose a schedule with at least one practice.');
  return withUser(userId, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 1))', [userId]);
    const count = await client.query(
      "select count(*)::int as total from app.journey where state <> 'archived'",
    );
    if (count.rows[0].total >= 20)
      throw new AppError(
        422,
        'JOURNEY_LIMIT',
        'Archive a journey before adding another. Up to 20 active or draft journeys are supported.',
      );
    const result = await client.query<JourneyRow>(
      'insert into app.journey(id,owner_id,title,intention,draft,created_at) values($1,$2,$3,$4,$5,$6) returning *',
      [randomUUID(), userId, draft.title, draft.intention, JSON.stringify(draft), now],
    );
    return { journey: toJourney(result.rows[0]), preview, fingerprint: fingerprint(draft) };
  });
}
export async function activateJourney(
  userId: string,
  id: string,
  input: MutationEnvelope<{ fingerprint: string }>,
) {
  const { now } = getRuntimeInfo();
  return withUser(userId, (client) =>
    idempotent(client, userId, input.operationId, `activate:${id}`, input, async () => {
      const result = await client.query<JourneyRow>(
        'select * from app.journey where id=$1 for update',
        [id],
      );
      const row = result.rows[0];
      if (!row) throw notFound();
      assertRevision(row.revision, input.baseRevision, toJourney(row));
      if (row.state !== 'draft')
        throw new AppError(409, 'ALREADY_ACTIVE', 'This journey has already been activated.');
      const draft = journeyDraftSchema.parse(row.draft);
      if (fingerprint(draft) !== input.payload.fingerprint)
        throw new AppError(409, 'PREVIEW_CHANGED', 'Please review the updated schedule preview.');
      const schedule = previewSchedule(draft.schedule, now);
      if (!schedule.total)
        throw new AppError(422, 'EMPTY_SCHEDULE', 'Choose a schedule with at least one practice.');
      const versionId = randomUUID();
      await client.query(
        'insert into app.schedule_version(id,journey_id,owner_id,definition,created_at) values($1,$2,$3,$4,$5)',
        [versionId, id, userId, JSON.stringify(draft), now],
      );
      for (const practice of draft.practices)
        await client.query(
          'insert into app.practice_version(id,schedule_version_id,journey_id,owner_id,label,position,kind,target) values($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            practice.id,
            versionId,
            id,
            userId,
            practice.label,
            practice.order,
            practice.kind,
            practice.target,
          ],
        );
      for (const occurrence of schedule.occurrences) {
        const sessionId = randomUUID();
        await client.query(
          'insert into app.session(id,journey_id,owner_id,schedule_version_id,ordinal,practice_date,opens_at,closes_at,time_zone,attribution,adjustment) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            sessionId,
            id,
            userId,
            versionId,
            occurrence.ordinal,
            occurrence.practiceDate,
            occurrence.opensAt,
            occurrence.closesAt,
            draft.schedule.timeZone,
            draft.schedule.attribution,
            occurrence.adjustment,
          ],
        );
        for (const practice of draft.practices)
          await client.query(
            'insert into app.session_practice(session_id,practice_id,schedule_version_id,journey_id,owner_id,kind,checkbox_value,numeric_value) values($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              sessionId,
              practice.id,
              versionId,
              id,
              userId,
              practice.kind,
              practice.kind === 'checkbox' ? false : null,
              practice.kind === 'checkbox' ? null : 0,
            ],
          );
      }
      await client.query(
        "update app.journey set state='active',active_schedule_version_id=$2,revision=revision+1 where id=$1",
        [id, versionId],
      );
      return readJourneyView(client, id, now);
    }),
  );
}
