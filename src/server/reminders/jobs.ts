import type pg from 'pg';
import { getReminderRuntime } from './config';

export async function refreshReminderJobs(client: pg.PoolClient, journeyId: string, now: string) {
  await client.query('select app.refresh_reminder_jobs($1,$2,$3)', [
    journeyId,
    now,
    getReminderRuntime().simulated,
  ]);
}
