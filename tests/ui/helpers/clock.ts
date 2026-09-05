import { renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadGuardedLocalRuntime } from '../../fixtures/local';

export function setUiClock(now: string) {
  const runtime = loadGuardedLocalRuntime();
  if (
    process.env.UI_ORIGIN !== `http://localhost:${runtime.testPort}` ||
    !Number.isFinite(Date.parse(now))
  )
    throw new Error('Only the allocated synthetic UI clock can be changed.');
  const target = resolve(runtime.root, '.local/ui-clock.json');
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ now: new Date(now).toISOString() }), { mode: 0o600 });
  renameSync(temporary, target);
}
