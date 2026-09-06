import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type pg from 'pg';
import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JourneyDraft, JourneyView } from '../../src/domain/contracts';
import { getPool, withUser } from '../../src/server/db/client';
import { activateJourney, createJourney } from '../../src/server/journeys/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
} from './local-test-runtime';

const NOW = '2026-09-06T00:45:00Z';
const NOTE = 'SYNTHETIC_PRIVATE_REFLECTION_BOUNDARY: आज मन शांत है। 🪷';
const clockPath = resolve('.local', `reflection-boundaries-clock-${process.pid}.json`);
const previousClock = process.env.DEMO_CLOCK_FILE;
const accounts = ['maya', 'arun'].map((person) => ({
  email: `integration-${person}-reflection-boundaries@example.test`,
  marker: buildSyntheticMarker('auth-boundaries', `reflection-boundaries-${person}`),
}));
const owned = new Map<string, (typeof accounts)[number]>();
interface Target {
  sessionId: string;
  scheduleVersionId: string;
  journeyId: string;
  ownerId: string;
}
let maya: Target;
let mayaSecond: Target;
let arun: Target;
const amendmentId = randomUUID();
const unlinkedAmendmentId = randomUUID();
const eventId = randomUUID();

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.LOCAL_SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
async function removeOwned(id: string) {
  const account = owned.get(id);
  if (!account) throw new Error('Refusing to delete an unowned reflection fixture.');
  const current = await admin().auth.admin.getUserById(id);
  if (current.error || !isExpectedSyntheticUser(current.data.user, account.email, account.marker))
    throw new Error('Reflection fixture identity changed; refusing deletion.');
  const removed = await admin().auth.admin.deleteUser(id);
  if (removed.error) throw new Error('Could not remove the owned reflection fixture.');
  owned.delete(id);
}
async function createAccount(account: (typeof accounts)[number]) {
  const users: User[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await admin().auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error('Cannot inspect local synthetic account ownership.');
    users.push(...result.data.users);
    if (result.data.users.length < 1000) break;
    if (page === 100) throw new Error('Synthetic account lookup exceeded its bounded pages.');
  }
  const previous = users.find((user) => user.email === account.email);
  if (previous) {
    if (!isExpectedSyntheticUser(previous, account.email, account.marker))
      throw new Error('Reserved reflection address belongs to another account.');
    owned.set(previous.id, account);
    await removeOwned(previous.id);
  }
  const result = await admin().auth.admin.createUser({
    email: account.email,
    email_confirm: true,
    app_metadata: { [SYNTHETIC_MARKER_KEY]: account.marker },
  });
  if (result.error || !isExpectedSyntheticUser(result.data.user, account.email, account.marker))
    throw new Error('Could not create the guarded reflection account.');
  owned.set(result.data.user.id, account);
  return result.data.user.id;
}
async function activate(ownerId: string): Promise<JourneyView> {
  const draft: JourneyDraft = {
    title: 'Reflection boundary fixture',
    intention: 'Synthetic privacy verification.',
    practices: [
      { id: randomUUID(), label: 'Quiet practice', order: 0, kind: 'checkbox', target: null },
    ],
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 3,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '05:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  };
  const created = await createJourney(ownerId, draft);
  return activateJourney(ownerId, created.journey.id, {
    operationId: randomUUID(),
    baseRevision: created.journey.revision,
    payload: { fingerprint: created.fingerprint },
  });
}
function target(view: JourneyView, ownerId: string, index = 0): Target {
  const session = view.sessions[index];
  return {
    sessionId: session.id,
    scheduleVersionId: session.scheduleVersionId,
    journeyId: session.journeyId,
    ownerId,
  };
}
function keys(value: Target) {
  return [value.sessionId, value.scheduleVersionId, value.journeyId, value.ownerId];
}
function insertReflection(client: pg.PoolClient, value: Target, text = NOTE) {
  return client.query(
    'insert into app.reflection(session_id,schedule_version_id,journey_id,owner_id,text,revision,created_at,updated_at) values($1,$2,$3,$4,$5,1,$6,$6)',
    [...keys(value), text, NOW],
  );
}
function insertMood(client: pg.PoolClient, value: Target, label: string, position = 1) {
  return client.query(
    'insert into app.reflection_mood(session_id,schedule_version_id,journey_id,owner_id,label,position) values($1,$2,$3,$4,$5,$6)',
    [...keys(value), label, position],
  );
}
function insertAmendment(client: pg.PoolClient, value: Target, id: string, revision: number) {
  return client.query(
    "insert into app.amendment(id,session_id,schedule_version_id,journey_id,owner_id,kind,recorded_at,detail,session_revision) values($5,$1,$2,$3,$4,'values_saved',$6,$7,$8)",
    [...keys(value), id, NOW, JSON.stringify({ values: {} }), revision],
  );
}
function insertCorrection(
  client: pg.PoolClient,
  value: Target,
  id: string,
  revision: number,
  historyId = randomUUID(),
) {
  return client.query(
    "insert into app.notification_event(id,session_id,schedule_version_id,journey_id,owner_id,amendment_id,kind,occurred_at,recorded_at,session_revision,detail) values($5,$1,$2,$3,$4,$6,'session_corrected',$7,$7,$8,$9)",
    [
      ...keys(value),
      historyId,
      id,
      NOW,
      revision,
      JSON.stringify({
        action: 'values_saved',
        beforeStatus: 'missed',
        afterStatus: 'partial',
        beforeTiming: { practiceTiming: null, recordedLater: false },
        afterTiming: { practiceTiming: null, recordedLater: false },
      }),
    ],
  );
}

// Even an unexpectedly permitted statement is rolled back, so failed assertions cannot
// change the shared baseline or turn a later test into misleading evidence.
async function rolledBack<T>(
  ownerId: string,
  operation: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const rollback = new Error('Intentional reflection test rollback.');
  let value!: T;
  try {
    await withUser(ownerId, async (client) => {
      value = await operation(client);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return value;
}

beforeAll(async () => {
  loadGuardedIntegrationRuntime();
  mkdirSync(resolve('.local'), { recursive: true, mode: 0o700 });
  writeFileSync(clockPath, JSON.stringify({ now: NOW }), { mode: 0o600 });
  process.env.DEMO_CLOCK_FILE = clockPath;
  const mayaId = await createAccount(accounts[0]);
  const arunId = await createAccount(accounts[1]);
  const mayaView = await activate(mayaId);
  maya = target(mayaView, mayaId);
  mayaSecond = target(mayaView, mayaId, 1);
  arun = target(await activate(arunId), arunId);
  for (const value of [maya, arun]) {
    await withUser(value.ownerId, async (client) => {
      await insertReflection(client, value);
      await insertMood(client, value, 'Calm', 0);
    });
  }
  await withUser(mayaId, async (client) => {
    await client.query('update app.session_practice set checkbox_value=true where session_id=$1', [
      maya.sessionId,
    ]);
    await client.query('update app.session set revision=1 where id=$1', [maya.sessionId]);
    await insertAmendment(client, maya, amendmentId, 1);
    await insertCorrection(client, maya, amendmentId, 1, eventId);
    await client.query('update app.session_practice set checkbox_value=true where session_id=$1', [
      mayaSecond.sessionId,
    ]);
    await client.query('update app.session set revision=1 where id=$1', [mayaSecond.sessionId]);
    await insertAmendment(client, mayaSecond, unlinkedAmendmentId, 1);
  });
}, 30000);

afterAll(async () => {
  try {
    for (const id of [...owned.keys()]) await removeOwned(id);
  } finally {
    const globalDb = globalThis as typeof globalThis & {
      sankalpaPool?: ReturnType<typeof getPool>;
    };
    const pool = globalDb.sankalpaPool;
    delete globalDb.sankalpaPool;
    if (pool) await pool.end();
    rmSync(clockPath, { force: true });
    if (previousClock === undefined) delete process.env.DEMO_CLOCK_FILE;
    else process.env.DEMO_CLOCK_FILE = previousClock;
  }
});

describe('reflection database boundaries', () => {
  it('returns only the authenticated owner rows and ignores unauthorized updates/deletes', async () => {
    await rolledBack(arun.ownerId, async (client) => {
      for (const table of ['reflection', 'reflection_mood', 'amendment', 'notification_event']) {
        const rows = await client.query(`select owner_id from app.${table} where session_id=$1`, [
          maya.sessionId,
        ]);
        expect(rows.rows).toEqual([]);
      }
      expect(
        (
          await client.query('update app.reflection set text=$2 where session_id=$1', [
            maya.sessionId,
            'Intrusion',
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query('delete from app.reflection_mood where session_id=$1', [
            maya.sessionId,
          ])
        ).rowCount,
      ).toBe(0);
      const own = await client.query('select text from app.reflection where session_id=$1', [
        arun.sessionId,
      ]);
      expect(own.rows).toEqual([{ text: NOTE }]);
    });
    const saved = await withUser(maya.ownerId, (client) =>
      client.query('select text from app.reflection where session_id=$1', [maya.sessionId]),
    );
    expect(saved.rows).toEqual([{ text: NOTE }]);
  });

  it('rejects forged owner writes and cross-owner nested session/reflection IDs', async () => {
    await expect(
      rolledBack(arun.ownerId, (client) => insertReflection(client, mayaSecond)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      rolledBack(arun.ownerId, (client) =>
        insertReflection(client, { ...mayaSecond, ownerId: arun.ownerId }),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      rolledBack(arun.ownerId, (client) =>
        insertMood(client, { ...maya, ownerId: arun.ownerId }, 'Other owner'),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      rolledBack(maya.ownerId, (client) =>
        insertReflection(client, { ...mayaSecond, scheduleVersionId: arun.scheduleVersionId }),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('ties a correction event to the exact owner, session and post-amendment revision', async () => {
    await expect(
      rolledBack(arun.ownerId, (client) => insertCorrection(client, arun, unlinkedAmendmentId, 1)),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      rolledBack(maya.ownerId, async (client) => {
        const id = randomUUID();
        await insertAmendment(client, maya, id, 2);
        await insertCorrection(client, maya, id, 3);
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      rolledBack(maya.ownerId, async (client) => {
        const id = randomUUID();
        await insertAmendment(client, maya, id, 2);
        await insertCorrection(client, mayaSecond, id, 2);
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('denies owner UPDATE/DELETE of immutable amendments and notification events', async () => {
    for (const table of ['amendment', 'notification_event']) {
      await expect(
        rolledBack(maya.ownerId, (client) =>
          client.query(`update app.${table} set detail=$2 where session_id=$1`, [
            maya.sessionId,
            '{}',
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        rolledBack(maya.ownerId, (client) =>
          client.query(`delete from app.${table} where session_id=$1`, [maya.sessionId]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      rolledBack(maya.ownerId, (client) =>
        client.query('update app.reflection set owner_id=$2 where session_id=$1', [
          maya.sessionId,
          arun.ownerId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('enforces one reflection and one amendment per session revision', async () => {
    await expect(
      rolledBack(maya.ownerId, (client) => insertReflection(client, maya)),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      rolledBack(maya.ownerId, (client) => insertAmendment(client, maya, randomUUID(), 1)),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it.each(['क', '🪷'])(
    'stores exactly 20,000 %s code points and rejects 20,001 in PostgreSQL',
    async (character) => {
      await rolledBack(maya.ownerId, async (client) => {
        const text = character.repeat(20_000);
        await client.query('update app.reflection set text=$2 where session_id=$1', [
          maya.sessionId,
          text,
        ]);
        const saved = await client.query(
          'select text,length(text) as length from app.reflection where session_id=$1',
          [maya.sessionId],
        );
        expect(saved.rows).toEqual([{ text, length: 20_000 }]);
      });
      await expect(
        rolledBack(maya.ownerId, (client) =>
          client.query('update app.reflection set text=$2 where session_id=$1', [
            maya.sessionId,
            character.repeat(20_001),
          ]),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );

  it('retains empty and paragraph-sensitive note text but rejects invalid revisions/timestamps', async () => {
    await rolledBack(maya.ownerId, async (client) => {
      for (const text of ['', '\n  आज मन\n<script>plain text</script>\n\t']) {
        const result = await client.query(
          'update app.reflection set text=$2 where session_id=$1 returning text',
          [maya.sessionId, text],
        );
        expect(result.rows).toEqual([{ text }]);
      }
    });
    await expect(
      rolledBack(maya.ownerId, (client) =>
        client.query('update app.reflection set revision=0 where session_id=$1', [maya.sessionId]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      rolledBack(maya.ownerId, (client) =>
        client.query(
          "update app.reflection set updated_at=created_at-interval '1 second' where session_id=$1",
          [maya.sessionId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('allows five mood positions and a 40-code-point label, rejecting duplicates and a sixth', async () => {
    await rolledBack(maya.ownerId, async (client) => {
      for (let position = 1; position < 5; position += 1)
        await insertMood(
          client,
          maya,
          position === 4 ? '🪷'.repeat(40) : `Mood ${position}`,
          position,
        );
      const rows = await client.query(
        'select label from app.reflection_mood where session_id=$1 order by position',
        [maya.sessionId],
      );
      expect(rows.rows).toHaveLength(5);
      expect(rows.rows[4].label).toBe('🪷'.repeat(40));
    });
    await expect(
      rolledBack(maya.ownerId, (client) => insertMood(client, maya, 'Sixth', 5)),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      rolledBack(maya.ownerId, (client) => insertMood(client, maya, 'Calm', 1)),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      rolledBack(maya.ownerId, (client) => insertMood(client, maya, 'New label', 0)),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      rolledBack(maya.ownerId, (client) => insertMood(client, maya, '🪷'.repeat(41))),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each(['', ' Calm', 'Calm ', '\t', '\nCalm\n', '\u00a0Calm', 'Calm\uFEFF'])(
    'rejects untrimmed or blank database mood label %j',
    async (label) => {
      await expect(
        rolledBack(maya.ownerId, (client) => insertMood(client, maya, label)),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );

  it('does not expose note content through application logging during successful or failed SQL', async () => {
    const spies = ['log', 'warn', 'error'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined),
    );
    try {
      await rolledBack(maya.ownerId, (client) =>
        client.query('update app.reflection set text=$2 where session_id=$1', [
          maya.sessionId,
          NOTE,
        ]),
      );
      await expect(
        rolledBack(maya.ownerId, (client) =>
          client.query('update app.reflection set text=$2 where session_id=$1', [
            maya.sessionId,
            NOTE.repeat(1000),
          ]),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toContain(NOTE);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('does not grant the application login server-file/log access or expose private tables to browser roles', async () => {
    const permissions = await withUser(maya.ownerId, (client) =>
      client.query(
        "select has_table_privilege(role_name,table_name,'SELECT') as allowed from unnest(array['anon','authenticated']) role_name cross join unnest(array['app.reflection','app.reflection_mood','app.notification_event']) table_name",
      ),
    );
    expect(permissions.rows).toHaveLength(6);
    expect(permissions.rows.every((row) => row.allowed === false)).toBe(true);
    await expect(
      rolledBack(maya.ownerId, (client) =>
        client.query("select pg_read_file('postgresql.conf',0,1024)"),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
