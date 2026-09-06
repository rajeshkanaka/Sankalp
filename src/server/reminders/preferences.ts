import type pg from 'pg';
import { z } from 'zod';
import type { MutationEnvelope, ReminderPreferences } from '../../domain/contracts';
import type { ReminderPreferenceView } from '../../domain/reminder-contracts';
import { planSessionReminders, reminderPreferencesSchema } from '../../domain/reminders';
import { withUser } from '../db/client';
import { assertRevision, fingerprint, idempotent } from '../db/operations';
import { AppError, notFound } from '../errors';
import { readSessions } from '../journeys/service';
import { getReminderRuntime } from './config';
import { refreshReminderJobs } from './jobs';

export async function readReminderPreferences(
  client: pg.PoolClient,
  id: string,
  now: string,
): Promise<ReminderPreferenceView> {
  const result = await client.query<{
    title: string;
    reminder_revision: number;
    preferences: unknown;
  }>(
    "select title,reminder_revision,draft->'reminders' as preferences from app.journey where id=$1",
    [id],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  const preferences = reminderPreferencesSchema.parse(row.preferences);
  const sessions = (await readSessions(client, id)).filter((session) => !session.supersededAt);
  const previous = sessions
    .filter((session) => Date.parse(session.opensAt) <= Date.parse(now))
    .at(-1);
  const future = sessions
    .filter((session) => Date.parse(session.opensAt) > Date.parse(now))
    .slice(0, 8);
  const { simulated } = getReminderRuntime();
  const devices = await client.query<{ count: number }>(
    'select count(*)::int as count from app.push_subscription where revoked_at is null and simulated=$1',
    [simulated],
  );
  return {
    journeyId: id,
    journeyTitle: row.title,
    revision: row.reminder_revision,
    preferences,
    activeDeviceCount: devices.rows[0].count,
    simulated,
    preview: [...(previous ? [previous] : []), ...future].flatMap((session) =>
      planSessionReminders(session, preferences, now).map((item) => ({
        ...item,
        sessionId: session.id,
        practiceDate: session.practiceDate,
        timeZone: session.timeZone,
      })),
    ),
  };
}
export async function getReminderPreferences(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  return withUser(userId, (client) =>
    readReminderPreferences(client, id, getReminderRuntime().now),
  );
}
export async function updateReminderPreferences(
  userId: string,
  id: string,
  input: MutationEnvelope<ReminderPreferences>,
) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const preferences = reminderPreferencesSchema.parse(input.payload);
  const request = { ...input, payload: preferences };
  return withUser(userId, (client) =>
    idempotent(
      client,
      userId,
      input.operationId,
      `reminder-preferences:${id}`,
      request,
      async () => {
        const locked = await client.query<{ state: string }>(
          'select state from app.journey where id=$1 for update',
          [id],
        );
        if (!locked.rows[0]) throw notFound();
        if (locked.rows[0].state === 'archived')
          throw new AppError(409, 'JOURNEY_INACTIVE', 'This journey is archived.');
        const { now } = getReminderRuntime();
        const current = await readReminderPreferences(client, id, now);
        assertRevision(current.revision, input.baseRevision, current);
        if (fingerprint(current.preferences) === fingerprint(preferences))
          throw new AppError(
            409,
            'NO_CHANGE',
            'These reminder choices are already saved.',
            current,
          );
        await client.query(
          "update app.journey set draft=jsonb_set(draft,'{reminders}',$2::jsonb),revision=revision+1 where id=$1",
          [id, JSON.stringify(preferences)],
        );
        await refreshReminderJobs(client, id, now);
        return readReminderPreferences(client, id, now);
      },
    ),
  );
}
