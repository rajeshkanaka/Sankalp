import { Temporal } from '@js-temporal/polyfill';
import type pg from 'pg';
import { z } from 'zod';
import type { CalendarView, ProgressDashboard, ProgressPreferences } from '../../domain/contracts';
import { getRuntimeInfo } from '../config';
import { withUser } from '../db/client';
import { AppError, notFound } from '../errors';
import { readJourneyView, readSessions } from '../journeys/service';
import { journeyProgressItem, sessionListItem } from '../../domain/progress';
import { computeMetrics } from '../../domain/metrics';
import { progressPreferencesSchema } from '../../domain/validation';

interface CalendarJourneyRow {
  id: string;
  title: string;
  timeZone: string;
  attribution: 'civil' | 'previous_evening';
}
const calendarQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    journeyId: z.uuid().optional(),
  })
  .strict();

export function validateCalendarRange(input: { from: string; to: string; journeyId?: string }) {
  const parsed = calendarQuerySchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(400, 'INVALID_CALENDAR_RANGE', 'Choose valid calendar dates and a journey.');
  const span = Temporal.PlainDate.from(parsed.data.from).until(parsed.data.to).days;
  if (span < 0 || span >= 42)
    throw new AppError(
      400,
      'INVALID_CALENDAR_RANGE',
      'Choose an inclusive date range of up to 42 days.',
    );
  return parsed.data;
}

async function readPreferences(client: pg.PoolClient): Promise<ProgressPreferences> {
  const result = await client.query<{ hide_streaks: boolean }>(
    'select hide_streaks from app.profile',
  );
  if (!result.rows[0]) throw notFound();
  return { hideStreaks: result.rows[0].hide_streaks };
}

export function getProgressPreferences(userId: string): Promise<ProgressPreferences> {
  return withUser(userId, readPreferences);
}

export function saveProgressPreferences(
  userId: string,
  input: ProgressPreferences,
): Promise<ProgressPreferences> {
  const preferences = progressPreferencesSchema.parse(input);
  return withUser(userId, async (client) => {
    await client.query('update app.profile set hide_streaks=$1 where owner_id=$2', [
      preferences.hideStreaks,
      userId,
    ]);
    return readPreferences(client);
  });
}

export function getProgressDashboard(userId: string): Promise<ProgressDashboard> {
  const { now } = getRuntimeInfo();
  return withUser(userId, async (client) => {
    // Active/draft journeys are limited to twenty at creation. Read every active journey.
    const result = await client.query<{ id: string }>(
      "select id from app.journey where state='active' order by created_at desc, id for share",
    );
    const journeys = [];
    for (const { id } of result.rows)
      journeys.push(journeyProgressItem(await readJourneyView(client, id, now)));
    return { now, journeys, preferences: await readPreferences(client) };
  });
}

export function getCalendarView(
  userId: string,
  input: { from: string; to: string; journeyId?: string },
): Promise<CalendarView> {
  const query = validateCalendarRange(input);
  const { now } = getRuntimeInfo();
  return withUser(userId, async (client) => {
    if (query.journeyId) {
      const owned = await client.query(
        "select id from app.journey where id=$1 and state<>'draft'",
        [query.journeyId],
      );
      if (!owned.rows[0]) throw notFound();
    }
    const journeys: CalendarView['journeys'] = [];
    const sessions: CalendarView['sessions'] = [];
    let after: string | null = null;
    for (;;) {
      // Include active journeys in the selector, plus archived journeys with history in this range.
      // Keyset batches preserve every matching journey rather than silently truncating a month.
      const batch: pg.QueryResult<CalendarJourneyRow> = await client.query<CalendarJourneyRow>(
        `select j.id,j.title,j.draft->'schedule'->>'timeZone' as "timeZone",
          j.draft->'schedule'->>'attribution' as attribution
         from app.journey j where ($1::uuid is null or j.id>$1)
          and j.state<>'draft'
          and (j.state='active' or j.id=$4::uuid or exists(
            select from app.session s where s.journey_id=j.id and s.superseded_at is null
              and s.practice_date between $2::date and $3::date))
         order by j.id limit 100 for share of j`,
        [after, query.from, query.to, query.journeyId ?? null],
      );
      for (const journey of batch.rows) {
        const records = await readSessions(client, journey.id);
        journeys.push({ ...journey, metrics: computeMetrics(records, now) });
        if (query.journeyId && journey.id !== query.journeyId) continue;
        for (const session of records) {
          if (
            session.supersededAt === null &&
            session.practiceDate >= query.from &&
            session.practiceDate <= query.to
          )
            sessions.push(sessionListItem(session, journey.title, now));
        }
      }
      if (batch.rows.length < 100) break;
      after = batch.rows.at(-1)!.id;
    }
    sessions.sort(
      (left, right) =>
        left.practiceDate.localeCompare(right.practiceDate) ||
        left.opensAt.localeCompare(right.opensAt) ||
        left.id.localeCompare(right.id),
    );
    journeys.sort(
      (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
    );
    return {
      now,
      from: query.from,
      to: query.to,
      journeys,
      sessions,
      preferences: await readPreferences(client),
    };
  });
}
