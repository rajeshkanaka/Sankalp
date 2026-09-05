import type pg from 'pg';
import { z } from 'zod';

import type {
  CursorPage,
  JournalEntry,
  JournalQuery,
  MutationEnvelope,
  ReflectionMutationResult,
  ReflectionPayload,
  ReflectionPreferences,
  ReflectionRecord,
  SessionRecord,
} from '../../domain/contracts';
import {
  journalQuerySchema,
  reflectionPayloadSchema,
  reflectionPreferencesSchema,
} from '../../domain/validation';
import { deriveCompletionTiming, deriveStatus } from '../../domain/status';
import { getRuntimeInfo } from '../config';
import { withUser } from '../db/client';
import { assertRevision, idempotent } from '../db/operations';
import { AppError, notFound } from '../errors';
import { lockSessionSnapshot } from '../sessions/locking';

interface ReflectionRow {
  sessionId: string;
  journeyId: string;
  scheduleVersionId: string;
  text: string;
  moods: string[];
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

interface JournalRow {
  sessionId: string;
  journeyId: string;
  journeyTitle: string;
  scheduleVersionId: string;
  practiceDate: string;
  opensAt: Date;
  closesAt: Date;
  timeZone: string;
  attribution: SessionRecord['attribution'];
  adjustment: string | null;
  confirmed: boolean;
  performedAt: Date | null;
  recordedAt: Date | null;
  sessionRevision: number;
  supersededAt: Date | null;
  practices: SessionRecord['practices'];
  text: string;
  moods: string[];
  reflectionRevision: number;
  updatedAt: Date;
}

const cursorSchema = z.strictObject({
  practiceDate: z.iso.date(),
  sessionId: z.uuid(),
});

function toIso(value: Date): string {
  return value.toISOString();
}

function toReflection(row: ReflectionRow): ReflectionRecord {
  return {
    sessionId: row.sessionId,
    journeyId: row.journeyId,
    scheduleVersionId: row.scheduleVersionId,
    text: row.text,
    moods: row.moods,
    revision: row.revision,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function readReflection(
  client: pg.PoolClient,
  sessionId: string,
): Promise<ReflectionRecord | null> {
  const result = await client.query<ReflectionRow>(
    `select r.session_id as "sessionId",r.journey_id as "journeyId",
      r.schedule_version_id as "scheduleVersionId",r.text,r.revision,
      r.created_at as "createdAt",r.updated_at as "updatedAt",
      coalesce(array_agg(m.label order by m.position) filter(where m.label is not null),'{}') as moods
    from app.reflection r
    left join app.reflection_mood m on m.session_id=r.session_id
    where r.session_id=$1
    group by r.session_id,r.journey_id,r.schedule_version_id,r.text,r.revision,r.created_at,r.updated_at`,
    [sessionId],
  );
  return result.rows[0] ? toReflection(result.rows[0]) : null;
}

async function assertSessionExists(client: pg.PoolClient, sessionId: string): Promise<void> {
  const session = await client.query('select 1 from app.session where id=$1', [sessionId]);
  if (!session.rows[0]) throw notFound();
}

function decodeCursor(cursor: string): z.infer<typeof cursorSchema> {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return cursorSchema.parse(value);
  } catch {
    throw new AppError(422, 'INVALID_CURSOR', 'Reload the journal and try again.');
  }
}

function encodeCursor(value: z.infer<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function textPreview(text: string): string {
  return Array.from(text).slice(0, 280).join('');
}

export async function getReflection(
  userId: string,
  sessionId: string,
): Promise<ReflectionRecord | null> {
  if (!z.uuid().safeParse(sessionId).success) throw notFound();
  return withUser(userId, async (client) => {
    await assertSessionExists(client, sessionId);
    return readReflection(client, sessionId);
  });
}

export async function saveReflection(
  userId: string,
  id: string,
  input: MutationEnvelope<ReflectionPayload>,
): Promise<ReflectionMutationResult> {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const payload = reflectionPayloadSchema.parse(input.payload);
  const request = { ...input, payload };
  return withUser(userId, (client) =>
    idempotent(client, userId, input.operationId, `reflection:${id}`, request, async () => {
      const { session, journeyState, now } = await lockSessionSnapshot(client, id);
      if (session.supersededAt)
        throw new AppError(
          409,
          'SESSION_REPLACED',
          'The schedule changed. Review this practice before saving your reflection.',
        );
      if (journeyState !== 'active' && journeyState !== 'archived')
        throw new AppError(409, 'JOURNEY_UNAVAILABLE', 'This journey cannot accept reflections.');
      if (Date.parse(now) < Date.parse(session.opensAt))
        throw new AppError(422, 'NOT_OPEN', 'This practice has not opened yet.');

      const current = await readReflection(client, id);
      assertRevision(current?.revision ?? 0, input.baseRevision, current);
      if (
        current &&
        current.text === payload.text &&
        current.moods.length === payload.moods.length &&
        current.moods.every((mood, index) => mood === payload.moods[index])
      )
        throw new AppError(409, 'NO_CHANGE', 'This reflection already has those details.');

      const revision = (current?.revision ?? 0) + 1;
      if (current) {
        await client.query(
          'update app.reflection set text=$2,revision=$3,updated_at=$4 where session_id=$1',
          [id, payload.text, revision, now],
        );
        await client.query('delete from app.reflection_mood where session_id=$1', [id]);
      } else {
        await client.query(
          `insert into app.reflection(session_id,schedule_version_id,journey_id,owner_id,text,revision,created_at,updated_at)
           values($1,$2,$3,$4,$5,$6,$7,$7)`,
          [id, session.scheduleVersionId, session.journeyId, userId, payload.text, revision, now],
        );
      }
      for (const [position, mood] of payload.moods.entries())
        await client.query(
          `insert into app.reflection_mood(session_id,schedule_version_id,journey_id,owner_id,position,label)
           values($1,$2,$3,$4,$5,$6)`,
          [id, session.scheduleVersionId, session.journeyId, userId, position, mood],
        );

      return { sessionId: id, revision, updatedAt: now };
    }),
  );
}

export async function queryJournal(
  userId: string,
  input: JournalQuery,
): Promise<CursorPage<JournalEntry>> {
  const query = journalQuerySchema.parse(input);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const limit = query.limit ?? 20;
  const now = getRuntimeInfo().now;

  return withUser(userId, async (client) => {
    if (query.journeyId) {
      const journey = await client.query('select 1 from app.journey where id=$1', [
        query.journeyId,
      ]);
      if (!journey.rows[0]) throw notFound();
    }

    const values: unknown[] = [];
    const parameter = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const conditions = ["(r.text <> '' or cardinality(coalesce(m.moods,'{}')) > 0)"];
    if (query.journeyId) conditions.push(`r.journey_id=${parameter(query.journeyId)}::uuid`);
    if (query.from) conditions.push(`s.practice_date>=${parameter(query.from)}::date`);
    if (query.to) conditions.push(`s.practice_date<=${parameter(query.to)}::date`);
    if (query.mood)
      conditions.push(
        `exists(select 1 from app.reflection_mood filter_mood where filter_mood.session_id=r.session_id and filter_mood.label=${parameter(query.mood)})`,
      );
    if (query.text)
      conditions.push(
        `r.text ilike '%' || ${parameter(escapeLike(query.text))} || '%' escape '\\'`,
      );
    if (cursor)
      conditions.push(
        `(s.practice_date,s.id)<(${parameter(cursor.practiceDate)}::date,${parameter(cursor.sessionId)}::uuid)`,
      );
    const resultLimit = parameter(limit + 1);

    const result = await client.query<JournalRow>(
      `select s.id as "sessionId",s.journey_id as "journeyId",j.title as "journeyTitle",
        s.schedule_version_id as "scheduleVersionId",s.practice_date::text as "practiceDate",
        s.opens_at as "opensAt",s.closes_at as "closesAt",s.time_zone as "timeZone",
        s.attribution,s.adjustment,s.confirmed,s.performed_at as "performedAt",
        s.recorded_at as "recordedAt",s.revision as "sessionRevision",
        s.superseded_at as "supersededAt",coalesce(p.practices,'[]') as practices,
        r.text,r.revision as "reflectionRevision",r.updated_at as "updatedAt",
        coalesce(m.moods,'{}') as moods
      from app.reflection r
      join app.session s on s.id=r.session_id
      join app.journey j on j.id=r.journey_id
      left join lateral (
        select array_agg(rm.label order by rm.position) as moods
        from app.reflection_mood rm where rm.session_id=r.session_id
      ) m on true
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'id',pv.id,'label',pv.label,'order',pv.position,'kind',pv.kind,'target',pv.target,
          'value',case when pv.kind='checkbox' then to_jsonb(sp.checkbox_value) else to_jsonb(sp.numeric_value) end
        ) order by pv.position) as practices
        from app.session_practice sp
        join app.practice_version pv on pv.id=sp.practice_id and pv.schedule_version_id=sp.schedule_version_id
        where sp.session_id=s.id
      ) p on true
      where ${conditions.join(' and ')}
      order by s.practice_date desc,s.id desc
      limit ${resultLimit}`,
      values,
    );
    const pageRows = result.rows.slice(0, limit);
    const items = pageRows.map((row): JournalEntry => {
      const session: SessionRecord = {
        id: row.sessionId,
        journeyId: row.journeyId,
        scheduleVersionId: row.scheduleVersionId,
        ordinal: 0,
        practiceDate: row.practiceDate,
        opensAt: toIso(row.opensAt),
        closesAt: toIso(row.closesAt),
        timeZone: row.timeZone,
        attribution: row.attribution,
        adjustment: row.adjustment,
        practices: row.practices,
        confirmed: row.confirmed,
        performedAt: row.performedAt ? toIso(row.performedAt) : null,
        recordedAt: row.recordedAt ? toIso(row.recordedAt) : null,
        revision: row.sessionRevision,
        supersededAt: row.supersededAt ? toIso(row.supersededAt) : null,
      };
      return {
        sessionId: row.sessionId,
        journeyId: row.journeyId,
        journeyTitle: row.journeyTitle,
        practiceDate: row.practiceDate,
        status: deriveStatus(session, now),
        completionTiming: deriveCompletionTiming(session),
        textPreview: textPreview(row.text),
        moods: row.moods,
        reflectionRevision: row.reflectionRevision,
        updatedAt: toIso(row.updatedAt),
      };
    });
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > limit && last
          ? encodeCursor({ practiceDate: last.practiceDate, sessionId: last.sessionId })
          : null,
    };
  });
}

export async function getReflectionPreferences(userId: string): Promise<ReflectionPreferences> {
  return withUser(userId, async (client) => {
    const result = await client.query<{ prompts: ReflectionPreferences['prompts'] }>(
      'select reflection_prompts as prompts from app.profile where owner_id=$1',
      [userId],
    );
    return { prompts: result.rows[0]?.prompts ?? [] };
  });
}

export async function saveReflectionPreferences(
  userId: string,
  input: ReflectionPreferences,
): Promise<ReflectionPreferences> {
  const preferences = reflectionPreferencesSchema.parse(input);
  return withUser(userId, async (client) => {
    await client.query('update app.profile set reflection_prompts=$2 where owner_id=$1', [
      userId,
      preferences.prompts,
    ]);
    return preferences;
  });
}
