import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runtime = JSON.parse(readFileSync('.local/runtime.json', 'utf8'));
const origin = `http://localhost:${runtime.testPort}`;
process.env.UI_ORIGIN = origin;
process.env.UI_RUN_ID ||= new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('.local', { recursive: true });
const firefoxAppData = resolve('.local/playwright-firefox-app-data');
mkdirSync(firefoxAppData, { recursive: true, mode: 0o700 });
writeFileSync('.local/ui-clock.json', JSON.stringify({ now: '2026-09-05T00:45:00.000Z' }));

export default defineConfig({
  testDir: './tests/ui',
  globalSetup: './tests/ui/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: 'artifacts/ui/results',
  reporter: [['list'], ['./scripts/safe-ui-reporter.ts']],
  use: { baseURL: origin, trace: 'off', screenshot: 'only-on-failure', video: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'webkit',
      testIgnore: ['**/http-boundaries.spec.ts', '**/offline-http.spec.ts'],
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'firefox',
      testIgnore: ['**/http-boundaries.spec.ts', '**/offline-http.spec.ts'],
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { env: { ...process.env, MOZ_APP_DATA: firefoxAppData } },
      },
    },
  ],
  webServer: {
    command: 'node scripts/run-ui-server.mjs',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 7000 },
    url: `${origin}/welcome`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      APP_ENV: 'ci',
      APP_ORIGIN: origin,
      PORT: String(runtime.testPort),
      DEMO_CLOCK_FILE: resolve('.local/ui-clock.json'),
    },
  },
});
