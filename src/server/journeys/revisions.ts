import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';

import type {
  JourneyDraft,
  PlannedOccurrence,
  RetainedSessionPreview,
  ScheduleRevisionCandidate,
  ScheduleRevisionPreview,
  ScheduleRevisionRequest,
  ScheduleRevisionResult,
  RevisionTimestampChange,
} from '../../domain/contracts';
import { generateScheduleRevision } from '../../domain/schedule';
import { journeyDraftSchema, scheduleRevisionCandidateSchema } from '../../domain/validation';
import { getRuntimeInfo } from '../config';
import { withUser } from '../db/client';
import { assertRevision, fingerprint, idempotent } from '../db/operations';
import { AppError, notFound } from '../errors';
import { readJourneyView } from './service';

type PreviewRequest = Extract<ScheduleRevisionRequest, { mode: 'preview' }>;
type ApplyRequest = Extract<ScheduleRevisionRequest, { mode: 'apply' }>;

interface JourneyRow {
  id: string;
  draft: JourneyDraft;
  state: 'draft' | 'active' | 'archived';
  revision: number;
  active_schedule_version_id: string | null;
}

interface ScheduleVersionRow {
  id: string;
  definition: JourneyDraft;
  version: number;
}

interface ActiveSessionRow {
  id: string;
  schedule_version_id: string;
  ordinal: number;
  practice_date: string;
  opens_at: Date;
  closes_at: Date;
  adjustment: string | null;
}

interface RevisionState {
  journey: JourneyRow;
  original: ScheduleVersionRow;
  current: ScheduleVersionRow;
  sessions: ActiveSessionRow[];
}

function normalizedCandidate(input: ScheduleRevisionCandidate): ScheduleRevisionCandidate {
  const candidate = scheduleRevisionCandidateSchema.parse(input) as ScheduleRevisionCandidate;
  return {
    ...candidate,
    practices: [...candidate.practices].sort((left, right) => left.order - right.order),
    schedule: {
      ...candidate.schedule,
      weekdays: [...candidate.schedule.weekdays].sort((left, right) => left - right),
    },
  };
}

function occurrence(row: ActiveSessionRow): PlannedOccurrence {
  return {
    ordinal: row.ordinal,
    practiceDate: row.practice_date,
    opensAt: row.opens_at.toISOString(),
    closesAt: row.closes_at.toISOString(),
    adjustment: row.adjustment,
  };
}

async function loadState(
  client: pg.PoolClient,
  id: string,
  lock: 'share' | 'update',
): Promise<RevisionState> {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const journey = await client.query<JourneyRow>(
    `select id,draft,state,revision,active_schedule_version_id from app.journey where id=$1 for ${lock}`,
    [id],
  );
  const row = journey.rows[0];
  if (!row) throw notFound();
  if (row.state !== 'active' || !row.active_schedule_version_id) {
    throw new AppError(409, 'JOURNEY_INACTIVE', 'Only an active journey can be revised.');
  }

  const versions = await client.query<ScheduleVersionRow>(
    `select id,definition,version from app.schedule_version
     where journey_id=$1 and (version=1 or id=$2) order by version`,
    [id, row.active_schedule_version_id],
  );
  const original = versions.rows.find(({ version }) => version === 1);
  const current = versions.rows.find(
    ({ id: versionId }) => versionId === row.active_schedule_version_id,
  );
  if (!original || !current) throw new Error('Active journey schedule metadata is incomplete.');

  const sessions = await client.query<ActiveSessionRow>(
    `select id,schedule_version_id,ordinal,practice_date::text,opens_at,closes_at,adjustment
     from app.session where journey_id=$1 and superseded_at is null
     order by opens_at,id${lock === 'update' ? ' for update' : ''}`,
    [id],
  );
  return { journey: row, original, current, sessions: sessions.rows };
}

function currentRecord(state: RevisionState) {
  return {
    id: state.journey.id,
    state: state.journey.state,
    revision: state.journey.revision,
    activeScheduleVersionId: state.journey.active_schedule_version_id,
  };
}

function buildTimestampChanges(
  replaceable: ActiveSessionRow[],
  proposed: PlannedOccurrence[],
): RevisionTimestampChange[] {
  const previous = new Map(replaceable.map((row) => [row.practice_date, row]));
  const next = new Map(proposed.map((row) => [row.practiceDate, row]));
  return [...new Set([...previous.keys(), ...next.keys()])].sort().map((practiceDate) => {
    const old = previous.get(practiceDate);
    return {
      practiceDate,
      previous: old
        ? { id: old.id, opensAt: old.opens_at.toISOString(), closesAt: old.closes_at.toISOString() }
        : null,
      proposed: next.get(practiceDate) ?? null,
    };
  });
}

async function buildPreview(
  client: pg.PoolClient,
  state: RevisionState,
  input: ScheduleRevisionCandidate,
  now: string,
): Promise<ScheduleRevisionPreview> {
  const candidate = normalizedCandidate(input);
  const originalDraft = journeyDraftSchema.parse(state.original.definition) as JourneyDraft;
  const retainedRows = state.sessions.filter(
    (row) =>
      row.opens_at.getTime() <= Date.parse(now) ||
      row.practice_date < candidate.effectivePracticeDate,
  );
  const replaceable = state.sessions.filter((row) => !retainedRows.includes(row));
  let generation;
  try {
    generation = generateScheduleRevision(
      originalDraft.schedule.startDate,
      candidate,
      retainedRows.map(occurrence),
      now,
    );
  } catch (error) {
    if (error instanceof RangeError) {
      throw new AppError(
        422,
        'INVALID_SCHEDULE_REVISION',
        'Choose a future schedule that preserves every retained practice.',
      );
    }
    throw error;
  }
  if (replaceable.length === 0 && generation.proposed.length === 0) {
    throw new AppError(
      422,
      'NO_FUTURE_CHANGE',
      'Choose an effective date that changes at least one future practice.',
    );
  }

  const retained: RetainedSessionPreview[] = retainedRows.map((row) => ({
    id: row.id,
    scheduleVersionId: row.schedule_version_id,
    ordinal: row.ordinal,
    practiceDate: row.practice_date,
    opensAt: row.opens_at.toISOString(),
    closesAt: row.closes_at.toISOString(),
    reason: row.opens_at.getTime() <= Date.parse(now) ? 'opened' : 'before_effective',
  }));
  const supersededSessionIds = replaceable.map(({ id: sessionId }) => sessionId);
  const timestampChanges = buildTimestampChanges(replaceable, generation.proposed);
  const basis = {
    contract: 1,
    journeyId: state.journey.id,
    baseRevision: state.journey.revision,
    currentScheduleVersionId: state.current.id,
    originalStartDate: originalDraft.schedule.startDate,
    effectivePracticeDate: candidate.effectivePracticeDate,
    candidate,
    retained: retainedRows.map((row) => ({
      id: row.id,
      scheduleVersionId: row.schedule_version_id,
      ordinal: row.ordinal,
      practiceDate: row.practice_date,
      opensAt: row.opens_at.toISOString(),
      closesAt: row.closes_at.toISOString(),
    })),
    replaceable: replaceable.map((row) => ({
      id: row.id,
      scheduleVersionId: row.schedule_version_id,
      ordinal: row.ordinal,
      practiceDate: row.practice_date,
      opensAt: row.opens_at.toISOString(),
      closesAt: row.closes_at.toISOString(),
    })),
    proposed: generation.proposed,
  };
  const warnings = [...generation.warnings];
  if (generation.proposed.length > 0) {
    const overlap = await client.query<{ overlaps: boolean }>(
      `select exists(
         select 1 from app.session s join app.journey j on j.id=s.journey_id
         join jsonb_to_recordset($2::jsonb) as proposed(opens_at timestamptz,closes_at timestamptz)
           on s.opens_at < proposed.closes_at and s.closes_at > proposed.opens_at
         where s.journey_id<>$1 and s.superseded_at is null and j.state='active'
       ) as overlaps`,
      [
        state.journey.id,
        JSON.stringify(
          generation.proposed.map((item) => ({
            opens_at: item.opensAt,
            closes_at: item.closesAt,
          })),
        ),
      ],
    );
    if (overlap.rows[0]?.overlaps) {
      warnings.push(
        'Some practice windows overlap another active journey of yours. You can keep both schedules or adjust the time.',
      );
    }
  }
  return {
    currentRevision: state.journey.revision,
    currentScheduleVersionId: state.current.id,
    originalStartDate: originalDraft.schedule.startDate,
    effectivePracticeDate: candidate.effectivePracticeDate,
    retained,
    supersededSessionIds,
    proposed: generation.proposed,
    timestampChanges,
    remainingAllowance: generation.remainingAllowance,
    totalActive: retained.length + generation.proposed.length,
    warnings,
    fingerprint: fingerprint(basis),
  };
}

export async function previewScheduleRevision(
  userId: string,
  id: string,
  body: PreviewRequest,
): Promise<ScheduleRevisionPreview> {
  return withUser(userId, async (client) => {
    const state = await loadState(client, id, 'share');
    assertRevision(state.journey.revision, body.baseRevision, currentRecord(state));
    return buildPreview(client, state, body.payload, getRuntimeInfo().now);
  });
}

export async function applyScheduleRevision(
  userId: string,
  id: string,
  body: ApplyRequest,
): Promise<ScheduleRevisionResult> {
  return withUser(userId, (client) =>
    idempotent(client, userId, body.operationId, `schedule-revision:${id}`, body, async () => {
      const state = await loadState(client, id, 'update');
      assertRevision(state.journey.revision, body.baseRevision, currentRecord(state));
      const now = getRuntimeInfo().now;
      const candidate = normalizedCandidate(body.payload.candidate);
      const preview = await buildPreview(client, state, candidate, now);
      if (preview.fingerprint !== body.payload.fingerprint) {
        throw new AppError(
          409,
          'PREVIEW_CHANGED',
          'The future schedule changed at an opening boundary. Review it again.',
          preview,
        );
      }

      const originalDraft = journeyDraftSchema.parse(state.original.definition) as JourneyDraft;
      const currentDraft = journeyDraftSchema.parse(state.journey.draft) as JourneyDraft;
      const nextDraft: JourneyDraft = {
        ...currentDraft,
        practices: candidate.practices,
        schedule: { ...candidate.schedule, startDate: originalDraft.schedule.startDate },
      };
      const versionId = randomUUID();
      await client.query(
        `insert into app.schedule_version
         (id,journey_id,owner_id,definition,created_at,version,effective_practice_date)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [
          versionId,
          id,
          userId,
          JSON.stringify(nextDraft),
          now,
          state.current.version + 1,
          candidate.effectivePracticeDate,
        ],
      );
      for (const practice of candidate.practices) {
        await client.query(
          `insert into app.practice_version
           (id,schedule_version_id,journey_id,owner_id,label,position,kind,target)
           values($1,$2,$3,$4,$5,$6,$7,$8)`,
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
      }

      if (preview.supersededSessionIds.length > 0) {
        const updated = await client.query<{ id: string }>(
          `update app.session set superseded_at=$3
           where journey_id=$1 and id=any($2::uuid[]) and superseded_at is null and opens_at>$3
           returning id`,
          [id, preview.supersededSessionIds, now],
        );
        const expected = [...preview.supersededSessionIds].sort();
        const actual = updated.rows.map(({ id: sessionId }) => sessionId).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new AppError(
            409,
            'SCHEDULE_BOUNDARY_CHANGED',
            'A practice opened while the schedule was changing. Review the schedule again.',
          );
        }
      }

      const createdSessionIds: string[] = [];
      for (const proposed of preview.proposed) {
        const sessionId = randomUUID();
        createdSessionIds.push(sessionId);
        await client.query(
          `insert into app.session
           (id,journey_id,owner_id,schedule_version_id,ordinal,practice_date,opens_at,closes_at,time_zone,attribution,adjustment)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            sessionId,
            id,
            userId,
            versionId,
            proposed.ordinal,
            proposed.practiceDate,
            proposed.opensAt,
            proposed.closesAt,
            candidate.schedule.timeZone,
            candidate.schedule.attribution,
            proposed.adjustment,
          ],
        );
        for (const practice of candidate.practices) {
          await client.query(
            `insert into app.session_practice
             (session_id,practice_id,schedule_version_id,journey_id,owner_id,kind,checkbox_value,numeric_value)
             values($1,$2,$3,$4,$5,$6,$7,$8)`,
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
      }
      await client.query(
        `update app.journey set draft=$2,title=$3,intention=$4,
         active_schedule_version_id=$5,revision=revision+1 where id=$1`,
        [id, JSON.stringify(nextDraft), nextDraft.title, nextDraft.intention, versionId],
      );
      return {
        view: await readJourneyView(client, id, now),
        retainedSessionIds: preview.retained.map(({ id: sessionId }) => sessionId),
        supersededSessionIds: preview.supersededSessionIds,
        createdSessionIds,
      };
    }),
  );
}
