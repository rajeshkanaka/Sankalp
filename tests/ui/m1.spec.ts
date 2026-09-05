import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetUiSignInLimits } from './helpers/rate-limits';

async function capturedSignIn(page: Page, email: string) {
  await resetUiSignInLimits(email);
  const mail = process.env.LOCAL_MAIL_URL;
  if (!mail || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(mail))
    throw new Error('Local captured-mail URL required.');
  const search = `${mail}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`;
  const prior = (await (await fetch(search)).json()) as { messages: { ID: string }[] };
  const ids = new Set(prior.messages.map((message) => message.ID));
  await page.goto('/welcome');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check for your sign-in link' })).toBeVisible();
  let messageId = '';
  await expect
    .poll(
      async () => {
        const result = (await (await fetch(search)).json()) as { messages: { ID: string }[] };
        messageId = result.messages.find((message) => !ids.has(message.ID))?.ID || '';
        return Boolean(messageId);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const message = (await (await fetch(`${mail}/api/v1/message/${messageId}`)).json()) as {
    HTML: string;
  };
  const href = message.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  if (!href) throw new Error('Captured email omitted the sign-in link.');
  const target = new URL(href);
  if (target.origin !== process.env.UI_ORIGIN || target.pathname !== '/auth/confirm')
    throw new Error('Captured link has an unexpected destination.');
  // Never log or retain authentication links, cookies or browser traces.
  await page.goto(target.href);
  await expect(page).toHaveURL(/\/today$/);
}

test('@smoke @M1 custom journey persists completion through real email sign-in', async ({
  page,
}, info) => {
  const consoleErrors: string[] = [];
  let phase = 'login';
  page.on('pageerror', (error) =>
    consoleErrors.push(
      `${phase}: ${error.name}: ${error.message.replace(/https?:\/\/[^\s]+/g, '<url>')}`,
    ),
  );
  await capturedSignIn(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
  );
  phase = 'setup';
  await page.goto('/setup');
  await page.getByLabel('Journey title', { exact: true }).fill('Morning practice');
  await page
    .getByLabel('Personal intention (optional)', { exact: true })
    .fill('Begin with attention');
  await page.getByLabel('Practice 1', { exact: true }).fill('Puja');
  await page.getByRole('button', { name: 'Add practice', exact: true }).click();
  await page.getByLabel('Practice 2', { exact: true }).fill('Quiet reflection');
  await page.getByLabel('Start date', { exact: true }).fill('2026-09-05');
  await page.getByLabel('Number of sessions', { exact: true }).fill('21');
  await page.getByLabel('Practice time', { exact: true }).fill('06:00');
  await page.getByLabel('Completion window (minutes)', { exact: true }).fill('60');
  await page.getByLabel('Practice timezone', { exact: true }).fill('Asia/Kolkata');
  await page.getByLabel('I confirm this practice timezone.').check();
  await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
  const activate = page.getByRole('button', { name: 'Activate journey', exact: true });
  await expect(activate).toBeVisible();
  const evidence = resolve('docs/evidence/M1', process.env.UI_RUN_ID!, info.project.name);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, 'create-preview.png'), fullPage: true });
  const activation = page.waitForResponse(
    (response) =>
      /\/api\/journeys\/[^/]+\/activate$/.test(response.url()) &&
      response.request().method() === 'POST',
  );
  phase = 'activate';
  await activate.click();
  const activated = await activation;
  expect(activated.ok()).toBe(true);
  const view = await activated.json();
  const session = view.sessions[0];
  await expect(page).toHaveURL(`/today?journey=${view.journey.id}`);
  phase = 'open practice';
  await page.getByRole('link', { name: 'Open practice', exact: true }).click();
  await expect(page).toHaveURL(`/journeys/${view.journey.id}/sessions/${session.id}`);
  const confirm = page.getByRole('button', { name: 'Complete this session', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Puja', exact: true }).check();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Quiet reflection', exact: true }).check();
  await expect(confirm).toBeEnabled();
  phase = 'confirm';
  await confirm.click();
  await expect(
    page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('img', { name: '1 of 21 sessions completed, 5% complete', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'View recorded practice', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
  ).toBeVisible();
  phase = 'reload';
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
  ).toBeVisible();
  phase = 'journey';
  await page.goto(`/journeys/${view.journey.id}`);
  await expect(
    page.getByRole('img', { name: '1 of 21 sessions completed, 5% complete', exact: true }),
  ).toBeVisible();
  phase = 'today';
  await page.goto('/today');
  await expect(
    page.getByRole('img', { name: '1 of 21 sessions completed, 5% complete', exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: resolve(evidence, 'completed-today.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator('body')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: resolve(evidence, 'completed-mobile.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('@M1 invalid sign-in link offers a fresh request', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=invalid&type=email');
  await expect(page).toHaveURL(/\/welcome\?error=invalid-link$/);
  await expect(page.getByRole('region', { name: 'Sign in' }).getByRole('alert')).toContainText(
    'invalid or has expired',
  );
  await expect(page.getByLabel('Email address')).toBeEditable();
});
