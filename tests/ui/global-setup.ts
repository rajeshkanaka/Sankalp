import { execFileSync } from 'node:child_process';

export default function setup() {
  for (const namespace of ['ui', 'ui-http'])
    execFileSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/seed.ts', '--profile', 'M1', '--namespace', namespace],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
}
