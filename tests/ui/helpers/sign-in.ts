import { expect, type Page } from '@playwright/test';
import { resetUiSignInLimits } from './rate-limits';

export async function capturedSignIn(page: Page, email: string) {
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
  // Raw browser reports stay local: their step metadata includes this URL.
  try {
    await page.goto(target.href);
  } catch {
    throw new Error('Captured local sign-in navigation failed; authentication URL omitted.');
  }
  await expect.poll(() => new URL(page.url()).pathname).toBe('/today');
  expect(new URL(page.url()).origin).toBe(process.env.UI_ORIGIN);
}
