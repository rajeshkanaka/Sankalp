import type pg from 'pg';
import type { JourneyRecord } from '../../domain/contracts';
import { getRuntimeInfo } from '../config';
import { notFound } from '../errors';
import { readSessions } from '../journeys/service';

/** Every history/reflection mutation and closure read uses this lock order and one clock. */
export async function lockSessionSnapshot(client: pg.PoolClient, id: string) {
  const parent = await client.query<{ journey_id: string }>(
    'select journey_id from app.session where id=$1',
    [id],
  );
  if (!parent.rows[0]) throw notFound();
  const journey = await client.query<{ state: JourneyRecord['state'] }>(
    'select state from app.journey where id=$1 for update',
    [parent.rows[0].journey_id],
  );
  if (!journey.rows[0]) throw notFound();
  await client.query('select id from app.session where id=$1 for update', [id]);
  const session = (await readSessions(client, parent.rows[0].journey_id)).find(
    (row) => row.id === id,
  );
  if (!session) throw notFound();
  return { session, journeyState: journey.rows[0].state, now: getRuntimeInfo().now };
}
