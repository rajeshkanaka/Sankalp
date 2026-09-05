import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type User } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyDraft, JourneyView } from '../../src/domain/contracts';
import { getPool, withUser } from '../../src/server/db/client';
import { activateJourney, createJourney } from '../../src/server/journeys/service';
import { confirmSession, savePractices } from '../../src/server/sessions/service';
import {
  getCalendarView,
  getProgressDashboard,
  getProgressPreferences,
  saveProgressPreferences,
} from '../../src/server/progress/service';
import {
  buildSyntheticMarker,
  isExpectedSyntheticUser,
  loadGuardedIntegrationRuntime,
  SYNTHETIC_MARKER_KEY,
} from './local-test-runtime';

const NOW = '2026-09-11T22:31:00Z';
const clockPath = resolve('.local', `progress-integration-clock-${process.pid}.json`);
const previousClock = process.env.DEMO_CLOCK_FILE;
const accounts = ['maya', 'arun'].map((person) => ({
  email: `integration-${person}-progress@example.test`,
  marker: buildSyntheticMarker('activation', `progress-${person}`),
}));
const owned = new Map<string, (typeof accounts)[number]>();
let maya = '';
let arun = '';
let overnight: JourneyView;
let civil: JourneyView;
let privateJourney: JourneyView;

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.LOCAL_SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
function setClock(now: string) {
  const temporary = `${clockPath}.tmp`;
  writeFileSync(temporary, JSON.stringify({ now }), { mode: 0o600 });
  renameSync(temporary, clockPath);
}
async function removeOwned(id: string) {
  const account = owned.get(id);
  if (!account) throw new Error('Refusing to delete an unowned progress fixture.');
  const result = await admin().auth.admin.getUserById(id);
  if (result.error || !isExpectedSyntheticUser(result.data.user, account.email, account.marker))
    throw new Error('Progress fixture identity changed; refusing deletion.');
  const removed = await admin().auth.admin.deleteUser(id);
  if (removed.error) throw new Error('Could not remove the owned progress fixture.');
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
  const prior = users.find((user) => user.email === account.email);
  if (prior) {
    if (!isExpectedSyntheticUser(prior, account.email, account.marker))
      throw new Error('Reserved progress address belongs to another account.');
    owned.set(prior.id, account);
    await removeOwned(prior.id);
  }
  const result = await admin().auth.admin.createUser({
    email: account.email,
    email_confirm: true,
    app_metadata: { [SYNTHETIC_MARKER_KEY]: account.marker },
  });
  if (result.error || !isExpectedSyntheticUser(result.data.user, account.email, account.marker))
    throw new Error('Could not create the guarded progress account.');
  owned.set(result.data.user.id, account);
  return result.data.user.id;
}
async function activate(userId: string, title: string, attribution: 'civil' | 'previous_evening') {
  const input: JourneyDraft = {
    title,
    intention: 'Synthetic progress fixture.',
    practices: ['Puja', 'Quiet practice'].map((label, order) => ({
      id: randomUUID(),
      label,
      order,
      kind: 'checkbox',
      target: null,
    })),
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 21,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: attribution === 'civil' ? '06:00' : '00:00',
      timeZone: 'Asia/Kolkata',
      attribution,
      windowMinutes: 240,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  };
  const created = await createJourney(userId, input);
  return activateJourney(userId, created.journey.id, {
    operationId: randomUUID(),
    baseRevision: created.journey.revision,
    payload: { fingerprint: created.fingerprint },
  });
}

beforeAll(async () => {
  loadGuardedIntegrationRuntime();
  mkdirSync(resolve('.local'), { recursive: true, mode: 0o700 });
  process.env.DEMO_CLOCK_FILE = clockPath;
  setClock('2026-09-05T15:30:00Z');
  maya = await createAccount(accounts[0]);
  arun = await createAccount(accounts[1]);
  overnight = await activate(maya, 'Progress overnight', 'previous_evening');
  for (const session of overnight.sessions.slice(0, 7)) {
    const performedAt = new Date(Date.parse(session.opensAt) + 15 * 60_000).toISOString();
    setClock(performedAt);
    const saved = await savePractices(maya, session.id, {
      operationId: randomUUID(),
      baseRevision: session.revision,
      payload: {
        values: Object.fromEntries(session.practices.map((practice) => [practice.id, true])),
      },
    });
    await confirmSession(maya, session.id, {
      operationId: randomUUID(),
      baseRevision: saved.session.revision,
      payload: { performedAt },
    });
  }
  setClock(NOW);
  civil = await activate(maya, 'Progress civil', 'civil');
  privateJourney = await activate(arun, 'Private Arun sentinel', 'civil');
}, 30000);

afterEach(() => setClock(NOW));
afterAll(async () => {
  for (const id of [...owned.keys()]) await removeOwned(id);
  const globalDb = globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> };
  if (globalDb.sankalpaPool) {
    const pool = globalDb.sankalpaPool;
    delete globalDb.sankalpaPool;
    await pool.end();
  }
  rmSync(clockPath, { force: true });
  if (previousClock === undefined) delete process.env.DEMO_CLOCK_FILE;
  else process.env.DEMO_CLOCK_FILE = previousClock;
});

describe('owner-scoped progress reads', () => {
  it('excludes a saved draft from the calendar and rejects its direct filter', async () => {
    const created = await createJourney(maya, {
      title: 'Draft only',
      intention: '',
      practices: overnight.journey.practices.map((practice) => ({ ...practice, id: randomUUID() })),
      schedule: overnight.journey.schedule,
      reminders: overnight.journey.reminders,
    });
    const calendar = await getCalendarView(maya, { from: '2026-09-01', to: '2026-09-30' });
    expect(calendar.journeys.some((journey) => journey.id === created.journey.id)).toBe(false);
    await expect(
      getCalendarView(maya, {
        from: '2026-09-01',
        to: '2026-09-30',
        journeyId: created.journey.id,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('shares 7/21/33% between dashboard and calendar without counting only the filtered day', async () => {
    const dashboard = await getProgressDashboard(maya);
    const item = dashboard.journeys.find((journey) => journey.journey.id === overnight.journey.id)!;
    expect(item.metrics).toMatchObject({
      total: 21,
      complete: 7,
      upcoming: 14,
      percent: 33,
      currentStreak: 7,
    });
    expect(item.current).toMatchObject({ practiceDate: '2026-09-12', status: 'upcoming' });
    const calendar = await getCalendarView(maya, {
      from: '2026-09-05',
      to: '2026-09-05',
      journeyId: overnight.journey.id,
    });
    expect(calendar.sessions).toHaveLength(1);
    expect(calendar.sessions[0]).toMatchObject({
      practiceDate: '2026-09-05',
      status: 'complete',
      opensAt: '2026-09-05T18:30:00.000Z',
    });
    expect(
      calendar.journeys.find((journey) => journey.id === overnight.journey.id)?.metrics,
    ).toEqual(item.metrics);
  });

  it('keeps multiple journey identities on the same practice date and applies the journey filter', async () => {
    const input = { from: '2026-09-05', to: '2026-09-05' };
    const all = await getCalendarView(maya, input);
    expect(all.sessions.map((session) => session.journeyId).sort()).toEqual(
      [overnight.journey.id, civil.journey.id].sort(),
    );
    expect(all.sessions.map((session) => session.attribution).sort()).toEqual([
      'civil',
      'previous_evening',
    ]);
    const filtered = await getCalendarView(maya, { ...input, journeyId: civil.journey.id });
    expect(filtered.sessions).toHaveLength(1);
    expect(filtered.sessions[0]).toMatchObject({
      journeyId: civil.journey.id,
      practiceDate: '2026-09-05',
    });
  });

  it('excludes other owners from data and selectors and returns identical not-found behavior for guessed IDs', async () => {
    const calendar = await getCalendarView(maya, { from: '2026-09-01', to: '2026-09-30' });
    const dashboard = await getProgressDashboard(maya);
    expect(JSON.stringify([calendar, dashboard])).not.toContain(privateJourney.journey.id);
    expect(JSON.stringify([calendar, dashboard])).not.toContain('Private Arun sentinel');
    for (const journeyId of [privateJourney.journey.id, randomUUID()])
      await expect(
        getCalendarView(maya, { from: '2026-09-01', to: '2026-09-30', journeyId }),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('rejects invalid date filters before database reads', async () => {
    expect(() => getCalendarView(maya, { from: '2026-09-01', to: '2026-11-01' })).toThrow();
    expect(() => getCalendarView(maya, { from: '2026-09-30', to: '2026-09-01' })).toThrow();
    expect(() => getCalendarView(maya, { from: '2026-02-30', to: '2026-03-01' })).toThrow();
  });

  it('recomputes the current occurrence and closure status at the exact deadline', async () => {
    const session = civil.sessions.find((session) => session.practiceDate === '2026-09-12')!;
    setClock(session.opensAt);
    const open = (await getProgressDashboard(maya)).journeys.find(
      (journey) => journey.journey.id === civil.journey.id,
    )!;
    expect(open.current).toMatchObject({ id: session.id, status: 'open', windowClosed: false });
    setClock(session.closesAt);
    const closed = (await getProgressDashboard(maya)).journeys.find(
      (journey) => journey.journey.id === civil.journey.id,
    )!;
    expect(closed.timeline.find((item) => item.id === session.id)).toMatchObject({
      status: 'missed',
      windowClosed: true,
    });
    expect(closed.current?.id).not.toBe(session.id);
    expect(closed.metrics.missed).toBe(open.metrics.missed + 1);
  });

  it('excludes superseded sessions from the month and full journey denominator', async () => {
    const last = civil.sessions.at(-1)!;
    await withUser(maya, (client) =>
      client.query('update app.session set superseded_at=$1 where id=$2', [NOW, last.id]),
    );
    try {
      const calendar = await getCalendarView(maya, {
        from: '2026-09-01',
        to: '2026-09-30',
        journeyId: civil.journey.id,
      });
      expect(calendar.sessions).toHaveLength(20);
      expect(calendar.sessions.some((session) => session.id === last.id)).toBe(false);
      expect(
        calendar.journeys.find((journey) => journey.id === civil.journey.id)?.metrics.total,
      ).toBe(20);
    } finally {
      await withUser(maya, (client) =>
        client.query('update app.session set superseded_at=null where id=$1', [last.id]),
      );
    }
  });

  it('retains archived history in the calendar while removing it from the active dashboard', async () => {
    await withUser(maya, (client) =>
      client.query("update app.journey set state='archived' where id=$1", [civil.journey.id]),
    );
    try {
      const calendar = await getCalendarView(maya, {
        from: '2026-09-01',
        to: '2026-09-30',
        journeyId: civil.journey.id,
      });
      expect(calendar.sessions).toHaveLength(21);
      expect(
        (await getProgressDashboard(maya)).journeys.some(
          (item) => item.journey.id === civil.journey.id,
        ),
      ).toBe(false);
    } finally {
      await withUser(maya, (client) =>
        client.query("update app.journey set state='active' where id=$1", [civil.journey.id]),
      );
    }
  });

  it('persists the streak preference only for its owner and rejects extra fields', async () => {
    expect(await getProgressPreferences(maya)).toEqual({ hideStreaks: false });
    expect(await saveProgressPreferences(maya, { hideStreaks: true })).toEqual({
      hideStreaks: true,
    });
    expect((await getProgressDashboard(maya)).preferences).toEqual({ hideStreaks: true });
    expect(await getProgressPreferences(arun)).toEqual({ hideStreaks: false });
    expect(() =>
      saveProgressPreferences(maya, { hideStreaks: true, ownerId: arun } as {
        hideStreaks: boolean;
      }),
    ).toThrow();
    expect(() =>
      saveProgressPreferences(maya, { hideStreaks: 'true' } as unknown as { hideStreaks: boolean }),
    ).toThrow();
    await saveProgressPreferences(maya, { hideStreaks: false });
  });
});
