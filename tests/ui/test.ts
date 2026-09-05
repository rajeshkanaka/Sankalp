import { execFileSync } from 'node:child_process';
import { test as base, expect } from '@playwright/test';

// Every workflow starts with its own blank synthetic dataset. Multiple browser
// contexts within one test still share that dataset for conflict/recovery checks.
export const test = base.extend<{ syntheticData: void }>({
  syntheticData: [
    async ({ baseURL }, use, info) => {
      if (baseURL !== process.env.UI_ORIGIN)
        throw new Error('UI fixtures require the allocated test origin.');
      if (!info.file.endsWith('http-boundaries.spec.ts')) {
        try {
          execFileSync(
            process.execPath,
            ['--import', 'tsx', 'scripts/seed.ts', '--profile', 'M1', '--namespace', 'ui'],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          );
        } catch {
          throw new Error('Synthetic UI reset failed. Verify the local seed runtime.');
        }
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
