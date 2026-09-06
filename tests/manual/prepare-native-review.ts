import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, type Browser } from '@playwright/test';
import { loadGuardedLocalRuntime } from '../fixtures/local';

// Prepares an isolated synthetic window. Native keyboard/zoom/VoiceOver checks
// must still be performed and observed; preparing this window is not a test pass.
async function main() {
  const runtime = loadGuardedLocalRuntime();
  if (process.platform !== 'darwin' || process.env.APP_ENV !== 'local')
    throw new Error('Native review requires the allocated local macOS runtime.');
  const fixture = JSON.parse(readFileSync(resolve('.local/fixtures/M1-demo.json'), 'utf8')) as {
    state: string;
    namespace: string;
    profile: string;
  };
  if (fixture.state !== 'ready' || fixture.namespace !== 'demo' || fixture.profile !== 'M3')
    throw new Error('Seed the synthetic M3 demo before native review.');
  const origin = `http://localhost:${runtime.port}`;
  const mail = `http://127.0.0.1:${runtime.mailPort}`;
  const search = `${mail}/api/v1/search?query=${encodeURIComponent('to:"maya@example.test"')}&limit=50`;
  const previous = (await (await fetch(search)).json()) as { messages: { ID: string }[] };
  const previousIds = new Set(previous.messages.map((message) => message.ID));
  let browser: Browser | undefined;
  let checkpoint: Record<string, unknown> | undefined;
  const close = () => void browser?.close().catch(() => undefined);
  try {
    // The bundled testing app has its own bundle ID, so native automation cannot
    // accidentally select the user's separate normal-profile Chrome process.
    browser = await chromium.launch({ headless: false });
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto('/welcome');
    await expect(page.getByText('Demo data · simulated clock', { exact: true })).toBeVisible();
    await page.getByLabel('Email address').fill('maya@example.test');
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check for your sign-in link' })).toBeVisible();
    let messageId = '';
    await expect
      .poll(
        async () => {
          const result = (await (await fetch(search)).json()) as { messages: { ID: string }[] };
          messageId = result.messages.find((message) => !previousIds.has(message.ID))?.ID ?? '';
          return Boolean(messageId);
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const message = (await (await fetch(`${mail}/api/v1/message/${messageId}`)).json()) as {
      HTML: string;
    };
    const href = message.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
    if (!href) throw new Error('Captured synthetic sign-in link is missing.');
    const target = new URL(href);
    if (target.origin !== origin || target.pathname !== '/auth/confirm')
      throw new Error('Captured synthetic sign-in destination is invalid.');
    await page.goto(target.href);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/today');
    await expect(
      page.getByText('Opening your private practice space…', { exact: true }),
    ).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByRole('main')).toContainText('Morning grounding');
    checkpoint = {
      state: 'ready',
      origin,
      profile: 'M3',
      browserVersion: browser.version(),
      sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      processId: process.pid,
      startedAt: new Date().toISOString(),
    };
    writeFileSync('.local/native-review.json', JSON.stringify(checkpoint, null, 2), {
      mode: 0o600,
    });
    console.log('Isolated synthetic native-review window ready. Native checks remain NOT RUN.');
    await new Promise<void>((done) => browser!.once('disconnected', () => done()));
  } finally {
    process.removeListener('SIGINT', close);
    process.removeListener('SIGTERM', close);
    await browser?.close().catch(() => undefined);
    if (checkpoint)
      writeFileSync(
        '.local/native-review.json',
        JSON.stringify(
          { ...checkpoint, state: 'stopped', stoppedAt: new Date().toISOString() },
          null,
          2,
        ),
        { mode: 0o600 },
      );
  }
}

void main().catch(() => {
  // Browser errors may include the one-time authentication URL; keep them out of output.
  console.error(
    'Native review preparation failed; verify the seeded demo, local services and Playwright Chromium. Authentication details omitted.',
  );
  process.exitCode = 1;
});
