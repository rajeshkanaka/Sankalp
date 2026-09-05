import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { getPool } from '../../src/server/db/client';
import { listJourneyViews } from '../../src/server/journeys/service';
import { fixtureIdentityFileName } from '../fixtures/ids';
import { loadGuardedIntegrationRuntime } from './local-test-runtime';

function seed(profile: 'M1' | 'M2', overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/seed.ts', '--profile', profile, '--namespace', 'integration'],
    { env: { ...process.env, ...overrides }, encoding: 'utf8', timeout: 30000 },
  );
}

it('failed application authentication preserves an existing synthetic profile and demo clock', async () => {
  const runtime = loadGuardedIntegrationRuntime();
  const clock = resolve(runtime.root, '.local/demo-clock.json');
  const beforeClock = existsSync(clock) ? readFileSync(clock, 'utf8') : null;
  expect(seed('M2').status).toBe(0);
  const manifestPath = resolve(
    runtime.root,
    '.local/fixtures',
    fixtureIdentityFileName('integration'),
  );
  const beforeManifest = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(beforeManifest);
  expect(manifest.state).toBe('ready');
  const before = await listJourneyViews(manifest.accounts.maya.id);
  expect(before).toHaveLength(1);
  expect(before[0].sessions).toHaveLength(21);
  expect(before[0].sessions.filter((session) => session.confirmed)).toHaveLength(7);

  const wrong = new URL(runtime.applicationDatabaseUrl);
  wrong.password = 'deliberately-invalid-synthetic-test-password';
  expect(seed('M2', { DATABASE_URL: wrong.href }).status).toBe(1);
  expect(readFileSync(manifestPath, 'utf8')).toBe(beforeManifest);
  const after = await listJourneyViews(manifest.accounts.maya.id);
  expect(after[0].sessions).toEqual(before[0].sessions);
  expect(existsSync(clock) ? readFileSync(clock, 'utf8') : null).toBe(beforeClock);
}, 30000);

afterAll(async () => {
  // The seeder rechecks each exact synthetic account marker before clearing its rows.
  expect(seed('M1').status).toBe(0);
  await getPool().end();
  delete (globalThis as typeof globalThis & { sankalpaPool?: ReturnType<typeof getPool> })
    .sankalpaPool;
});
