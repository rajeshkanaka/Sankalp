import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JourneyDraft, JourneyView, ReflectionPayload } from '../../src/domain/contracts';
import { getPool, withUser } from '../../src/server/db/client';
import {
  getReflection,
  getReflectionPreferences,
  queryJournal,
  saveReflection,
  saveReflectionPreferences,
} from '../../src/server/journal';
import { activateJourney, createJourney } from '../../src/server/journeys/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
  type SyntheticMarker,
} from './local-test-runtime';

const CLOCK_PATH = resolve('.local', `reflection-clock-${process.pid}.json`);
const BEFORE_OPEN = '2026-09-05T00:00:00Z';
const NOW = '2026-09-07T00:45:00Z';
const MAYA_EMAIL = 'integration-maya-reflections@example.test';
const ARUN_EMAIL = 'integration-arun-reflections@example.test';
const MAYA_MARKER = buildSyntheticMarker('activation', 'reflections-maya');
const ARUN_MARKER = buildSyntheticMarker('activation', 'reflections-arun');
const previousClock = process.env.DEMO_CLOCK_FILE;

let maya = '';
let arun = '';
let primary: JourneyView;
let archived: JourneyView;
let privateJourney: JourneyView;
const owned = new Map<string, { email: string; marker: SyntheticMarker }>();

function setClock(now: string) {
  mkdirSync(resolve('.local'), { recursive: true, mode: 0o700 });
  writeFileSync(CLOCK_PATH, JSON.stringify({ now }), { mode: 0o600 });
  process.env.DEMO_CLOCK_FILE = CLOCK_PATH;
}

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
  throw new Error('Synthetic reflection account lookup exceeded its bounded pages.');
}

async function removeOwned(id: string) {
  const identity = owned.get(id);
  if (!identity) throw new Error('Refusing to remove an unowned reflection fixture.');
  const current = await admin().auth.admin.getUserById(id);
  if (current.error || !isExpectedSyntheticUser(current.data.user, identity.email, identity.marker))
    throw new Error('Reflection fixture identity changed; refusing deletion.');
  const removed = await admin().auth.admin.deleteUser(id);
  if (removed.error) throw removed.error;
  owned.delete(id);
}

async function createAccount(email: string, marker: SyntheticMarker) {
  const existing = (await listUsers()).find((user) => user.email === email);
  if (existing) {
    if (!isExpectedSyntheticUser(existing, email, marker))
      throw new Error('Reserved reflection address belongs to another account.');
    owned.set(existing.id, { email, marker });
    await removeOwned(existing.id);
  }
  const result = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { [SYNTHETIC_MARKER_KEY]: marker },
  });
  if (result.error || !isExpectedSyntheticUser(result.data.user, email, marker))
    throw new Error('Could not create the guarded reflection account.');
  owned.set(result.data.user.id, { email, marker });
  return result.data.user.id;
}

function draft(title: string): JourneyDraft {
  return {
    title,
    intention: 'Synthetic reflection fixture.',
    practices: [
      {
        id: randomUUID(),
        label: 'Quiet attention',
        order: 0,
        kind: 'checkbox',
        target: null,
      },
    ],
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 5,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  };
}

async function activate(ownerId: string, title: string) {
  const created = await createJourney(ownerId, draft(title));
  return activateJourney(ownerId, created.journey.id, {
    operationId: randomUUID(),
    baseRevision: created.journey.revision,
    payload: { fingerprint: created.fingerprint },
  });
}

async function save(
  ownerId: string,
  sessionId: string,
  payload: ReflectionPayload,
  baseRevision = 0,
  operationId = randomUUID(),
) {
  return saveReflection(ownerId, sessionId, { operationId, baseRevision, payload });
}

beforeAll(async () => {
  loadGuardedIntegrationRuntime();
  setClock(BEFORE_OPEN);
  maya = await createAccount(MAYA_EMAIL, MAYA_MARKER);
  arun = await createAccount(ARUN_EMAIL, ARUN_MARKER);
  primary = await activate(maya, 'Maya journal');
  archived = await activate(maya, 'Archived journal');
  privateJourney = await activate(arun, 'Arun private journal');
  setClock(NOW);
  await withUser(maya, (client) =>
    client.query("update app.journey set state='archived' where id=$1", [archived.journey.id]),
  );
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
  if (previousClock === undefined) delete process.env.DEMO_CLOCK_FILE;
  else process.env.DEMO_CLOCK_FILE = previousClock;
});

describe('private reflections', () => {
  it('preserves 20,000 Unicode code points and stores only a safe receipt acknowledgement', async () => {
    const sessionId = primary.sessions[0]!.id;
    const text = '🙏'.repeat(20_000);
    const moods = ['Calm', 'शांत', 'Steady', 'Present', 'Custom mood'];
    const operationId = randomUUID();
    const saved = await save(maya, sessionId, { text, moods }, 0, operationId);
    expect(saved).toEqual({ sessionId, revision: 1, updatedAt: NOW });
    await expect(getReflection(maya, sessionId)).resolves.toMatchObject({
      text,
      moods,
      revision: 1,
    });
    await expect(save(maya, sessionId, { text, moods }, 0, operationId)).resolves.toEqual(saved);
    await expect(
      save(maya, sessionId, { text: `${text}changed`, moods }, 0, operationId),
    ).rejects.toMatchObject({ status: 409, code: 'OPERATION_REUSED' });

    const receipt = await withUser(maya, (client) =>
      client.query<{ response: unknown }>(
        'select response from app.operation_receipt where operation_id=$1',
        [operationId],
      ),
    );
    expect(receipt.rows[0]!.response).toEqual(saved);
    expect(JSON.stringify(receipt.rows[0]!.response)).not.toContain('🙏');
    expect(JSON.stringify(receipt.rows[0]!.response)).not.toContain('Calm');

    await expect(
      save(maya, sessionId, { text: '🙏'.repeat(20_001), moods }, 1),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      save(maya, sessionId, { text: 'still here', moods: [...moods, 'Sixth'] }, 1),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      save(maya, sessionId, { text: 'still here', moods: [' Calm ', 'Calm'] }, 1),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect((await getReflection(maya, sessionId))?.revision).toBe(1);

    const hostile = '\n  <img src=x onerror=alert(1)> आज मन शांत है।\n\nClosing paragraph.  \n';
    await save(maya, sessionId, { text: hostile, moods: ['शांत'] }, 1);
    await expect(getReflection(maya, sessionId)).resolves.toMatchObject({
      text: hostile,
      moods: ['शांत'],
      revision: 2,
    });
    const privateDetails = await withUser(maya, (client) =>
      client.query<{ details: unknown }>(
        `select jsonb_build_object(
          'amendments',coalesce((select jsonb_agg(detail) from app.amendment),'[]'),
          'events',coalesce((select jsonb_agg(detail) from app.notification_event),'[]')
        ) as details`,
      ),
    );
    expect(JSON.stringify(privateDetails.rows[0]!.details)).not.toContain(hostile);
  });

  it('returns the authorized winner when concurrent editors start at one revision', async () => {
    const sessionId = primary.sessions[1]!.id;
    const initial = await save(maya, sessionId, { text: 'Initial local copy', moods: [] });
    const attempts = await Promise.allSettled([
      save(maya, sessionId, { text: 'First device', moods: ['Calm'] }, initial.revision),
      save(maya, sessionId, { text: 'Second device', moods: ['Steady'] }, initial.revision),
    ]);
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: {
        status: 409,
        code: 'REVISION_CONFLICT',
        current: { sessionId, revision: 2 },
      },
    });
    const current = await getReflection(maya, sessionId);
    expect(current?.revision).toBe(2);
    expect(['First device', 'Second device']).toContain(current?.text);
    await expect(
      save(maya, sessionId, { text: current!.text, moods: current!.moods }, current!.revision),
    ).rejects.toMatchObject({ status: 409, code: 'NO_CHANGE' });
  });

  it('allows archived opened sessions while rejecting unopened, superseded and foreign sessions', async () => {
    const archivedSession = archived.sessions[0]!;
    await expect(
      save(maya, archivedSession.id, { text: 'Archived and retained', moods: [] }),
    ).resolves.toMatchObject({ sessionId: archivedSession.id, revision: 1 });

    const unopened = primary.sessions[3]!;
    await expect(save(maya, unopened.id, { text: 'Too early', moods: [] })).rejects.toMatchObject({
      status: 422,
      code: 'NOT_OPEN',
    });
    const superseded = primary.sessions[4]!;
    await withUser(maya, (client) =>
      client.query('update app.session set superseded_at=$2 where id=$1', [superseded.id, NOW]),
    );
    await expect(
      save(maya, superseded.id, { text: 'Wrong schedule version', moods: [] }),
    ).rejects.toMatchObject({ status: 409, code: 'SESSION_REPLACED' });

    await expect(getReflection(arun, primary.sessions[0]!.id)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    await expect(
      save(arun, primary.sessions[0]!.id, { text: 'Cross-owner write', moods: [] }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect((await queryJournal(arun, {})).items).toEqual([]);
    await expect(queryJournal(arun, { journeyId: primary.journey.id })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    await expect(getReflection(arun, privateJourney.sessions[0]!.id)).resolves.toBeNull();
  });

  it('searches literal text with intersecting private filters and stable bounded pages', async () => {
    const session = primary.sessions[2]!;
    const pattern = `100% steady_under\\sky ${'क'.repeat(300)}`;
    await save(maya, session.id, { text: pattern, moods: ['Focused'] });

    for (const text of ['%', '_', '\\']) {
      const result = await queryJournal(maya, { text });
      expect(result.items.map(({ sessionId }) => sessionId)).toEqual([session.id]);
    }
    const intersected = await queryJournal(maya, {
      journeyId: primary.journey.id,
      from: session.practiceDate,
      to: session.practiceDate,
      mood: 'Focused',
      text: 'steady_',
    });
    expect(intersected.items).toHaveLength(1);
    expect(intersected.items[0]).toMatchObject({
      sessionId: session.id,
      journeyId: primary.journey.id,
      practiceDate: session.practiceDate,
      moods: ['Focused'],
      reflectionRevision: 1,
    });
    expect(Array.from(intersected.items[0]!.textPreview)).toHaveLength(280);

    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await queryJournal(maya, { limit: 2, cursor });
      ids.push(...page.items.map(({ sessionId }) => sessionId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(session.id);
    expect(ids).toContain(archived.sessions[0]!.id);

    await expect(queryJournal(maya, { cursor: 'bm90LWpzb24' })).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_CURSOR',
    });
  });

  it('keeps empty reflection revision state out of the journal and stores optional prompts', async () => {
    const sessionId = archived.sessions[1]!.id;
    await save(maya, sessionId, { text: '', moods: [] });
    await expect(getReflection(maya, sessionId)).resolves.toMatchObject({
      text: '',
      moods: [],
      revision: 1,
    });
    expect((await queryJournal(maya, {})).items.map((item) => item.sessionId)).not.toContain(
      sessionId,
    );

    await expect(getReflectionPreferences(maya)).resolves.toEqual({ prompts: [] });
    await expect(
      saveReflectionPreferences(maya, { prompts: ['noticed', 'carry_tomorrow'] }),
    ).resolves.toEqual({ prompts: ['noticed', 'carry_tomorrow'] });
    await expect(getReflectionPreferences(maya)).resolves.toEqual({
      prompts: ['noticed', 'carry_tomorrow'],
    });
    await expect(saveReflectionPreferences(maya, { prompts: [] })).resolves.toEqual({
      prompts: [],
    });
  });
});
