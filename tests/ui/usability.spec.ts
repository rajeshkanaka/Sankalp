import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// These response mocks exercise UI recovery only. They do not verify email delivery or authentication.
test.describe('Welcome usability with simulated transport responses', () => {
  test.setTimeout(30_000);

  test('@M1 @M1-usability keyboard, invalid link and 320px reflow preserve input after a network error', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.route('**/api/auth/sign-in', (route) => route.abort('failed'));
    await page.goto('/welcome?error=expired');
    await expect(
      page.getByRole('heading', { name: 'A quiet space for your daily practice.' }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sign in' }).getByRole('alert')).toContainText(
      'invalid or has expired',
    );
    const email = page.getByRole('textbox', { name: 'Email address' });
    await page.keyboard.press('Tab');
    await expect(email).toBeFocused();
    await page.keyboard.type('usability@example.test');
    await page.keyboard.press('Tab');
    const submit = page.getByRole('button', { name: 'Send sign-in link', exact: true });
    await expect(submit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sign-in-error')).toContainText('Could not connect');
    await expect(email).toHaveValue('usability@example.test');
    await expect(submit).toBeEnabled();
    await expect(email).toHaveAttribute('aria-describedby', 'email-help sign-in-error');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const bounds = await submit.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('@M1 @M1-usability server field errors identify the email field and clear when edited', async ({
    page,
  }) => {
    await page.route('**/api/auth/sign-in', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'VALIDATION',
            message: 'Please check the highlighted fields.',
            correlationId: 'synthetic-validation',
            fields: { email: ['Use a valid email address.'] },
          },
        }),
      }),
    );
    await page.goto('/welcome');
    const email = page.getByRole('textbox', { name: 'Email address' });
    await email.fill('usability@example.test');
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('region', { name: 'Sign in' }).getByRole('alert')).toContainText(
      'Email address: Use a valid email address.',
    );
    await expect(
      page.getByRole('region', { name: 'Sign in' }).getByRole('alert'),
    ).not.toContainText('highlighted');
    await email.fill('corrected@example.test');
    await expect(email).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByRole('region', { name: 'Sign in' }).getByRole('alert')).toHaveCount(0);
  });

  test('@M1 @M1-usability a failed resend does not keep claiming the new request succeeded', async ({
    page,
  }) => {
    let attempts = 0;
    await page.route('**/api/auth/sign-in', (route) => {
      attempts += 1;
      return route.fulfill({
        status: attempts === 1 ? 200 : 429,
        contentType: 'application/json',
        body: JSON.stringify(
          attempts === 1
            ? { ok: true }
            : {
                error: {
                  code: 'SIGN_IN_UNAVAILABLE',
                  message: 'Please wait a little before requesting another link.',
                  correlationId: 'synthetic-rate-limit',
                },
              },
        ),
      });
    });
    await page.goto('/welcome?error=expired');
    await page.getByRole('textbox', { name: 'Email address' }).fill('usability@example.test');
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('No email was sent outside this device');
    await expect(page.getByRole('region', { name: 'Sign in' }).getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Send another link' }).click();
    await expect(page.locator('#sign-in-error')).toContainText('Please wait a little');
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveValue(
      'usability@example.test',
    );
    expect(attempts).toBe(2);
  });

  test('@M1 @M1-usability an expired-session error offers another tab without discarding the current input', async ({
    page,
  }) => {
    await page.route('**/api/auth/sign-in', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SIGN_IN_REQUIRED',
            message: 'Please sign in again. Your unsaved input is still here.',
            correlationId: 'synthetic-expiry',
          },
        }),
      }),
    );
    await page.goto('/welcome');
    await page.getByRole('textbox', { name: 'Email address' }).fill('usability@example.test');
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
    const recovery = page.getByRole('link', { name: 'Sign in again in a new tab' });
    await expect(recovery).toHaveAttribute('href', '/welcome');
    await expect(recovery).toHaveAttribute('target', '_blank');
    await expect(recovery).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveValue(
      'usability@example.test',
    );
  });
});
