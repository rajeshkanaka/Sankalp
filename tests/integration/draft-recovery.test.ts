import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JourneyDraft } from '../../src/domain/contracts';
import { getPool, withUser } from '../../src/server/db/client';
import {
  activateJourney,
  createJourney,
  updateJourneyDraft,
} from '../../src/server/journeys/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
  type SyntheticMarker,
} from './local-test-runtime';

const NOW = '2026-09-05T00:45:00Z';
const CLOCK_PATH = resolve('.local', `draft-recovery-clock-${process.pid}.json`);
const OWNER_EMAIL = 'integration-maya-draft-recovery@example.test';
const OTHER_EMAIL = 'integration-arun-draft-recovery@example.test';
const OWNER_MARKER = buildSyntheticMarker('activation', 'draft-recovery-maya');
const OTHER_MARKER = buildSyntheticMarker('activation', 'draft-recovery-arun');

let ownerId = '';
let otherId = '';
const owned = new Map<string, { email: string; marker: SyntheticMarker }>();

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.LOCAL_SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function listUsers(): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await admin().auth.admin.listUsers({ page, perPage: 1_000 });
    if (result.error) throw result.error;
    users.push(...result.data.users);
    if (result.data.users.length < 1_000) return users;
  }
  throw new Error('Synthetic draft account lookup exceeded its bounded pages.');
}

async function removeOwned(id: string) {
  const identity = owned.get(id);
  if (!identity) throw new Error('Refusing to remove an unowned draft fixture.');
  const current = await admin().auth.admin.getUserById(id);
  if (current.error || !isExpectedSyntheticUser(current.data.user, identity.email, identity.marker))
    throw new Error('Draft fixture identity changed; refusing deletion.');
  const removed = await admin().auth.admin.deleteUser(id);
  if (removed.error) throw removed.error;
  owned.delete(id);
}

async function createAccount(email: string, marker: SyntheticMarker) {
  const existing = (await listUsers()).find((user) => user.email === email);
  if (existing) {
    if (!isExpectedSyntheticUser(existing, email, marker))
      throw new Error('Reserved draft address belongs to another account.');
    owned.set(existing.id, { email, marker });
    await removeOwned(existing.id);
  }
  const result = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { [SYNTHETIC_MARKER_KEY]: marker },
  });
  if (result.error || !isExpectedSyntheticUser(result.data.user, email, marker))
    throw new Error('Could not create the guarded draft fixture.');
  owned.set(result.data.user.id, { email, marker });
  return result.data.user.id;
}

function draft(title = 'Recoverable draft'): JourneyDraft {
  return {
    title,
    intention: 'Synthetic draft recovery.',
    practices: [
      {
        id: 'd3000000-0000-4000-8000-000000000001',
        label: 'Morning meditation',
        order: 0,
        kind: 'minutes',
        target: 20,
      },
    ],
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 21,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  };
}

async function countJourneys(userId: string) {
  return withUser(userId, async (client) => {
    const result = await client.query<{ total: number }>(
      'select count(*)::int as total from app.journey',
    );
    return result.rows[0]!.total;
  });
}

beforeAll(async () => {
  loadGuardedIntegrationRuntime();
  writeFileSync(CLOCK_PATH, JSON.stringify({ now: NOW }), { mode: 0o600 });
  process.env.DEMO_CLOCK_FILE = CLOCK_PATH;
  ownerId = await createAccount(OWNER_EMAIL, OWNER_MARKER);
  otherId = await createAccount(OTHER_EMAIL, OTHER_MARKER);
});

afterAll(async () => {
  for (const id of [...owned.keys()]) await removeOwned(id);
  const globalDb = globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> };
  if (globalDb.sankalpaPool) {
    const pool = globalDb.sankalpaPool;
    delete globalDb.sankalpaPool;
    await pool.end();
  }
  rmSync(CLOCK_PATH, { force: true });
  delete process.env.DEMO_CLOCK_FILE;
});

describe('recoverable journey drafts', () => {
  it('updates one draft with exact retry results and activates the latest preview', async () => {
    const created = await createJourney(ownerId, draft());
    const changed = draft('Recovered and edited');
    changed.intention = 'The latest saved intention.';
    changed.practices[0] = {
      id: changed.practices[0]!.id,
      label: changed.practices[0]!.label,
      order: 0,
      kind: 'minutes',
      target: 30,
    };
    const operationId = randomUUID();
    const request = {
      operationId,
      baseRevision: created.journey.revision,
      payload: changed,
    };

    let updated = await updateJourneyDraft(ownerId, created.journey.id, request);
    expect(updated.journey).toMatchObject({
      id: created.journey.id,
      state: 'draft',
      revision: created.journey.revision + 1,
      title: changed.title,
      intention: changed.intention,
      practices: changed.practices,
    });
    expect(await countJourneys(ownerId)).toBe(1);
    await expect(updateJourneyDraft(ownerId, created.journey.id, request)).resolves.toEqual(
      updated,
    );

    await expect(
      updateJourneyDraft(ownerId, created.journey.id, {
        ...request,
        payload: { ...changed, title: 'A different request' },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'OPERATION_REUSED' });

    for (let edit = 1; edit <= 20; edit += 1) {
      const nextDraft = { ...changed, title: `Recovered edit ${edit}` };
      updated = await updateJourneyDraft(ownerId, created.journey.id, {
        operationId: randomUUID(),
        baseRevision: updated.journey.revision,
        payload: nextDraft,
      });
    }
    expect(updated.journey).toMatchObject({
      id: created.journey.id,
      revision: 21,
      title: 'Recovered edit 20',
    });
    expect(await countJourneys(ownerId)).toBe(1);

    const activated = await activateJourney(ownerId, created.journey.id, {
      operationId: randomUUID(),
      baseRevision: updated.journey.revision,
      payload: { fingerprint: updated.fingerprint },
    });
    expect(activated.journey).toMatchObject({ title: 'Recovered edit 20', state: 'active' });
    expect(activated.sessions[0]!.practices[0]).toMatchObject({
      id: changed.practices[0]!.id,
      label: changed.practices[0]!.label,
      target: 30,
    });
  });

  it('protects ownership, revision conflicts and active journeys without partial updates', async () => {
    const created = await createJourney(ownerId, draft('Protected draft'));
    const changed = draft('Valid edit');

    await expect(
      updateJourneyDraft(otherId, created.journey.id, {
        operationId: randomUUID(),
        baseRevision: created.journey.revision,
        payload: changed,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(
      updateJourneyDraft(ownerId, created.journey.id, {
        operationId: randomUUID(),
        baseRevision: created.journey.revision + 1,
        payload: changed,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });

    const invalid = draft('Invalid edit');
    invalid.schedule.startDate = '2020-01-01';
    await expect(
      updateJourneyDraft(ownerId, created.journey.id, {
        operationId: randomUUID(),
        baseRevision: created.journey.revision,
        payload: invalid,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_SCHEDULE' });

    const unchanged = await withUser(ownerId, (client) =>
      client.query<{ title: string; revision: number }>(
        'select title,revision from app.journey where id=$1',
        [created.journey.id],
      ),
    );
    expect(unchanged.rows[0]).toEqual({ title: created.journey.title, revision: 0 });

    await activateJourney(ownerId, created.journey.id, {
      operationId: randomUUID(),
      baseRevision: created.journey.revision,
      payload: { fingerprint: created.fingerprint },
    });
    await expect(
      updateJourneyDraft(ownerId, created.journey.id, {
        operationId: randomUUID(),
        baseRevision: created.journey.revision,
        payload: changed,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('serializes two edits from the same revision and accepts exactly one', async () => {
    const created = await createJourney(ownerId, draft('Concurrent draft'));
    const results = await Promise.allSettled(
      ['First concurrent edit', 'Second concurrent edit'].map((title) =>
        updateJourneyDraft(ownerId, created.journey.id, {
          operationId: randomUUID(),
          baseRevision: created.journey.revision,
          payload: draft(title),
        }),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { status: 409, code: 'REVISION_CONFLICT' },
    });
    const persisted = await withUser(ownerId, (client) =>
      client.query<{ title: string; revision: number }>(
        'select title,revision from app.journey where id=$1',
        [created.journey.id],
      ),
    );
    expect(persisted.rows[0]).toMatchObject({ revision: 1 });
    expect(['First concurrent edit', 'Second concurrent edit']).toContain(persisted.rows[0]!.title);
  });
});
