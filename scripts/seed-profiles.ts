import { randomUUID } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPool } from '../src/server/db/client';
import { activateJourney, createJourney } from '../src/server/journeys/service';
import { confirmSession, getSessionHistory, savePractices } from '../src/server/sessions/service';
import { M1_DEMO_NOW, M2_DEMO_NOW, M3_DEMO_NOW, type DemoProfile } from '../tests/fixtures/ids';

// Called only after seed.ts verifies the local runtime and exact synthetic account marker.
export async function populateProfile(profile: DemoProfile, userId: string, root: string) {
  if (profile === 'M1') return M1_DEMO_NOW;
  const previousClock = process.env.DEMO_CLOCK_FILE;
  const clockPath = resolve(root, `.local/seed-clock-${process.pid}.json`);
  const setClock = (now: string) => {
    const temporary = `${clockPath}.tmp`;
    writeFileSync(temporary, JSON.stringify({ now }), { mode: 0o600 });
    renameSync(temporary, clockPath);
  };
  process.env.DEMO_CLOCK_FILE = clockPath;
  try {
    setClock('2026-09-05T15:30:00Z');
    const draft = await createJourney(userId, {
      title: '21-night Sankalpa',
      intention: 'Return to practice with steadiness and attention.',
      practices: ['Kunjika', 'Bhairav Stotra'].map((label, order) => ({
        id: randomUUID(),
        label,
        order,
        kind: 'checkbox' as const,
        target: null,
      })),
      schedule: {
        startDate: '2026-09-05',
        durationMode: 'occurrences',
        durationValue: 21,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        localTime: '00:00',
        timeZone: 'Asia/Kolkata',
        attribution: 'previous_evening',
        windowMinutes: 240,
      },
      reminders: { enabled: false, offsets: [-120, -30, -5, 0], quietHours: null, detailed: false },
    });
    const activated = await activateJourney(userId, draft.journey.id, {
      operationId: randomUUID(),
      baseRevision: draft.journey.revision,
      payload: { fingerprint: draft.fingerprint },
    });
    if (profile === 'M3') {
      const session = activated.sessions[0];
      setClock(new Date(Date.parse(session.opensAt) + 15 * 60_000).toISOString());
      await savePractices(userId, session.id, {
        operationId: randomUUID(),
        baseRevision: session.revision,
        payload: { values: { [session.practices[0].id]: true } },
      });
      setClock(M3_DEMO_NOW);
      await getSessionHistory(userId, session.id);
      const morning = await createJourney(userId, {
        title: 'Morning grounding',
        intention: 'Make space for a quiet beginning.',
        practices: ['Sit quietly', 'Set an intention'].map((label, order) => ({
          id: randomUUID(),
          label,
          order,
          kind: 'checkbox' as const,
          target: null,
        })),
        schedule: {
          startDate: '2026-09-06',
          durationMode: 'occurrences',
          durationValue: 21,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          localTime: '05:00',
          timeZone: 'Asia/Kolkata',
          attribution: 'civil',
          windowMinutes: 60,
        },
        reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
      });
      await activateJourney(userId, morning.journey.id, {
        operationId: randomUUID(),
        baseRevision: morning.journey.revision,
        payload: { fingerprint: morning.fingerprint },
      });
      return M3_DEMO_NOW;
    }
    for (const session of activated.sessions.slice(0, 7)) {
      const performedAt = new Date(Date.parse(session.opensAt) + 15 * 60_000).toISOString();
      setClock(performedAt);
      const saved = await savePractices(userId, session.id, {
        operationId: randomUUID(),
        baseRevision: session.revision,
        payload: {
          values: Object.fromEntries(session.practices.map((practice) => [practice.id, true])),
        },
      });
      await confirmSession(userId, session.id, {
        operationId: randomUUID(),
        baseRevision: saved.session.revision,
        payload: { performedAt },
      });
    }
    return M2_DEMO_NOW;
  } finally {
    if (previousClock === undefined) delete process.env.DEMO_CLOCK_FILE;
    else process.env.DEMO_CLOCK_FILE = previousClock;
    rmSync(clockPath, { force: true });
    const pool = getPool();
    await pool.end();
    delete (globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> })
      .sankalpaPool;
  }
}
