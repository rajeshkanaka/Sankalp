import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import type {
  AmendmentKind,
  SessionAmendment,
  SessionHistory,
  SessionHistoryEvent,
  SessionRecord,
} from '../../domain/contracts';
import { deriveCompletionTiming, deriveStatus } from '../../domain/status';

interface AmendmentRow {
  id: string;
  sessionId: string;
  scheduleVersionId: string;
  kind: AmendmentKind;
  sessionRevision: number;
  recordedAt: Date;
  detail: Record<string, unknown>;
}

interface EventRow {
  id: string;
  sessionId: string;
  journeyId: string;
  amendmentId: string | null;
  kind: SessionHistoryEvent['kind'];
  occurredAt: Date;
  recordedAt: Date;
  sessionRevision: number;
  detail: SessionHistoryEvent['detail'];
}

const amendmentColumns = `id, session_id as "sessionId", schedule_version_id as "scheduleVersionId",
  kind, session_revision as "sessionRevision", recorded_at as "recordedAt", detail`;
const eventColumns = `id, session_id as "sessionId", journey_id as "journeyId",
  amendment_id as "amendmentId", kind, occurred_at as "occurredAt",
  recorded_at as "recordedAt", session_revision as "sessionRevision", detail`;

function mapAmendment(row: AmendmentRow): SessionAmendment {
  return { ...row, recordedAt: row.recordedAt.toISOString() };
}

function mapEvent(row: EventRow): SessionHistoryEvent {
  const common = {
    id: row.id,
    sessionId: row.sessionId,
    journeyId: row.journeyId,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    sessionRevision: row.sessionRevision,
  };
  if (row.kind === 'session_closed') {
    return {
      ...common,
      kind: 'session_closed',
      detail: row.detail as { status: 'complete' | 'partial' | 'missed' },
    };
  }
  return {
    ...common,
    kind: 'session_corrected',
    amendmentId: row.amendmentId!,
    detail: row.detail as Extract<SessionHistoryEvent, { kind: 'session_corrected' }>['detail'],
  };
}

export async function ensureClosureEvent(
  client: pg.PoolClient,
  userId: string,
  session: SessionRecord,
  now: string,
): Promise<{ event: SessionHistoryEvent; created: boolean } | null> {
  if (session.supersededAt || Date.parse(now) < Date.parse(session.closesAt)) return null;
  const status = deriveStatus(session, now);
  if (status === 'open' || status === 'upcoming') return null;
  const inserted = await client.query<EventRow>(
    `insert into app.notification_event
      (id,owner_id,journey_id,session_id,schedule_version_id,kind,occurred_at,recorded_at,session_revision,detail)
     values($1,$2,$3,$4,$5,'session_closed',$6,$7,$8,$9)
     on conflict(session_id) where kind='session_closed' do nothing
     returning ${eventColumns}`,
    [
      randomUUID(),
      userId,
      session.journeyId,
      session.id,
      session.scheduleVersionId,
      session.closesAt,
      now,
      session.revision,
      JSON.stringify({ status }),
    ],
  );
  if (inserted.rows[0]) return { event: mapEvent(inserted.rows[0]), created: true };
  const existing = await client.query<EventRow>(
    `select ${eventColumns} from app.notification_event
     where session_id=$1 and kind='session_closed'`,
    [session.id],
  );
  return existing.rows[0] ? { event: mapEvent(existing.rows[0]), created: false } : null;
}

export async function createAmendment(
  client: pg.PoolClient,
  userId: string,
  session: SessionRecord,
  kind: AmendmentKind,
  sessionRevision: number,
  recordedAt: string,
  detail: Record<string, unknown>,
): Promise<SessionAmendment> {
  const result = await client.query<AmendmentRow>(
    `insert into app.amendment
      (id,owner_id,journey_id,session_id,schedule_version_id,kind,recorded_at,detail,session_revision)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning ${amendmentColumns}`,
    [
      randomUUID(),
      userId,
      session.journeyId,
      session.id,
      session.scheduleVersionId,
      kind,
      recordedAt,
      JSON.stringify(detail),
      sessionRevision,
    ],
  );
  return mapAmendment(result.rows[0]);
}

export async function createCorrectionEvent(
  client: pg.PoolClient,
  userId: string,
  before: SessionRecord,
  after: SessionRecord,
  amendment: SessionAmendment,
  now: string,
): Promise<SessionHistoryEvent> {
  const result = await client.query<EventRow>(
    `insert into app.notification_event
      (id,owner_id,journey_id,session_id,schedule_version_id,amendment_id,kind,
       occurred_at,recorded_at,session_revision,detail)
     values($1,$2,$3,$4,$5,$6,'session_corrected',$7,$7,$8,$9)
     returning ${eventColumns}`,
    [
      randomUUID(),
      userId,
      before.journeyId,
      before.id,
      before.scheduleVersionId,
      amendment.id,
      now,
      amendment.sessionRevision,
      JSON.stringify({
        action: amendment.kind,
        beforeStatus: deriveStatus(before, now),
        afterStatus: deriveStatus(after, now),
        beforeTiming: deriveCompletionTiming(before),
        afterTiming: deriveCompletionTiming(after),
      }),
    ],
  );
  return mapEvent(result.rows[0]);
}

export async function readSessionHistory(
  client: pg.PoolClient,
  sessionId: string,
): Promise<SessionHistory> {
  const amendments = await client.query<AmendmentRow>(
    `select ${amendmentColumns} from app.amendment
     where session_id=$1 order by session_revision,id`,
    [sessionId],
  );
  const events = await client.query<EventRow>(
    `select ${eventColumns} from app.notification_event where session_id=$1
     order by occurred_at,
       case when kind='session_closed' then 0 else 1 end,
       session_revision,id`,
    [sessionId],
  );
  return {
    amendments: amendments.rows.map(mapAmendment),
    events: events.rows.map(mapEvent),
  };
}
