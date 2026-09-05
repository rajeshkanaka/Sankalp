import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setUiClock } from './helpers/clock';
import { capturedSignIn } from './helpers/sign-in';

const M1_NOW = '2026-09-05T00:45:00Z';
const M2_NOW = '2026-09-12T04:01:00+05:30';

test('@M2 @M2-schedule personalized schedules preview accurately and numeric targets require saved completion', async ({
  page,
}, info) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(`${error.name}: ${error.message}`));
  setUiClock(M2_NOW);

  try {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    await page.goto('/setup');

    await expect(page.getByLabel('Journey title', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Practice 1', { exact: true })).toHaveValue('');
    await expect(page.getByText('Kunjika', { exact: true })).toHaveCount(0);
    await page.getByLabel('Journey title', { exact: true }).fill('Custom dawn prayer');
    await page.getByLabel('Practice 1', { exact: true }).fill('Prayer');
    await page.getByLabel('Start date', { exact: true }).fill('2026-09-12');
    await page.getByLabel('Number of sessions', { exact: true }).fill('40');
    await page.getByLabel('Practice time', { exact: true }).fill('06:00');
    await page.getByLabel('Completion window (minutes)', { exact: true }).fill('60');
    await page.getByLabel('Practice timezone', { exact: true }).fill('Asia/Kolkata');
    await page.getByLabel('I confirm this practice timezone.').check();
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
    await expect(page.getByText(/40 sessions from 40 scheduled sessions/)).toBeVisible();
    await expect(page.getByText('Prayer · Completion checkbox', { exact: true })).toBeVisible();
    await expect(page.getByText('Kunjika', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/same civil date/i)).toBeVisible();
    await expect(page.getByText(/no reminder will be sent/i)).toBeVisible();
    await page.getByRole('button', { name: 'Edit details', exact: true }).click();

    await page.getByRole('button', { name: 'Use 21-night example', exact: true }).click();
    await expect(page.getByLabel('Journey title', { exact: true })).toHaveValue(
      '21-night Sankalpa',
    );
    await expect(page.getByLabel('Practice 1', { exact: true })).toHaveValue('Kunjika');
    await expect(page.getByLabel('Practice 2', { exact: true })).toHaveValue('Bhairav Stotra');
    await expect(page.getByLabel('I confirm this practice timezone.')).not.toBeChecked();
    await page.getByLabel('Start date', { exact: true }).fill('2026-09-05');
    await page.getByLabel('I confirm this practice timezone.').check();
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Review your journey' })).toBeFocused();
    await expect(page.getByText(/21 sessions from 21 scheduled sessions/)).toBeVisible();
    await expect(page.getByText(/6 September 2026/, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/26 September 2026/, { exact: false }).first()).toBeVisible();
    await expect(page.getByText('5 Sep 2026', { exact: true })).toBeVisible();
    await expect(page.getByText('25 Sep 2026', { exact: true })).toBeVisible();
    await expect(page.getByText(/previous calendar night/i)).toBeVisible();
    await expect(page.getByText(/no reminder will be sent/i)).toBeVisible();
    await expect(
      page.getByLabel('First practice reminder suggestions').getByRole('listitem'),
    ).toHaveCount(4);

    await page.getByRole('button', { name: 'Edit details', exact: true }).click();
    await page.getByLabel('Journey title', { exact: true }).fill('Monday Thursday meditation');
    await page.getByLabel('Practice 1', { exact: true }).fill('Meditation');
    await page.getByRole('button', { name: 'Remove practice 2', exact: true }).click();
    await page.getByLabel('Target type for Practice 1', { exact: true }).selectOption('minutes');
    await page.getByLabel('Target for Practice 1', { exact: true }).fill('20');
    await page.getByLabel('Start date', { exact: true }).fill('2026-09-07');
    await page.getByLabel('Number of sessions', { exact: true }).fill('12');
    await page.getByRole('radio', { name: /Selected weekdays/ }).check();
    for (const day of [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]) {
      await page.getByLabel(day, { exact: true }).uncheck();
    }
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Choose at least one practice day');
    await expect(page.getByLabel('Journey title', { exact: true })).toHaveValue(
      'Monday Thursday meditation',
    );
    await page.getByLabel('Monday', { exact: true }).check();
    await page.getByLabel('Thursday', { exact: true }).check();
    await page.getByLabel('Practice time', { exact: true }).fill('18:30');
    await page.getByRole('radio', { name: /Same civil date/ }).check();
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();

    await expect(
      page.getByText(/12 sessions from 12 scheduled sessions; Monday, Thursday/),
    ).toBeVisible();
    await expect(page.getByText('Meditation · 20 minutes', { exact: true })).toBeVisible();
    await expect(page.getByText(/15 October 2026/, { exact: false }).first()).toBeVisible();
    const evidence = resolve('docs/evidence/M2', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, 'weekday-preview.png'), fullPage: true });

    await page.getByRole('button', { name: 'Edit details', exact: true }).click();
    await page.getByLabel('Duration counts', { exact: true }).selectOption('calendar_days');
    await page.getByLabel('Number of calendar days', { exact: true }).fill('30');
    await page.getByLabel('Start date', { exact: true }).fill('2026-09-05');
    await page.getByLabel('Monday', { exact: true }).uncheck();
    await page.getByLabel('Thursday', { exact: true }).uncheck();
    await page.getByLabel('Tuesday', { exact: true }).check();
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
    await expect(page.getByText(/4 sessions from 30 calendar days; Tuesday/)).toBeVisible();
    await expect(page.getByText(/29 September 2026/, { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Edit details', exact: true }).click();
    await page.getByLabel('Journey title', { exact: true }).fill('Open numeric meditation');
    await page.getByLabel('Duration counts', { exact: true }).selectOption('occurrences');
    await page.getByLabel('Number of sessions', { exact: true }).fill('2');
    await page.getByLabel('Start date', { exact: true }).fill('2026-09-12');
    await page.getByRole('radio', { name: /Every day/ }).check();
    await page.getByLabel('Practice time', { exact: true }).fill('04:00');
    await page.getByLabel('Completion window (minutes)', { exact: true }).fill('60');
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
    await page.getByRole('button', { name: 'Activate journey', exact: true }).click();
    await expect(page).toHaveURL(/\/today\?journey=/);
    await page.getByRole('link', { name: 'Open practice', exact: true }).click();

    const complete = page.getByRole('button', { name: 'Complete this session', exact: true });
    const numeric = page.getByLabel('Meditation', { exact: true });
    await page.route('**/api/sessions/*/practices', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'TEMPORARY_TEST_FAILURE',
            message: 'Temporary test failure. Your entry is still here.',
            correlationId: 'synthetic-m2-retry',
          },
        }),
      });
    });
    await numeric.fill('5');
    await expect(complete).toBeDisabled();
    await page.getByRole('button', { name: 'Save Meditation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Temporary test failure');
    await expect(numeric).toHaveValue('5');
    await page.unroute('**/api/sessions/*/practices');
    await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect(page.getByText('Partial', { exact: true })).toBeVisible();
    await expect(complete).toBeDisabled();
    await numeric.fill('20');
    await expect(complete).toBeDisabled();
    await page.getByRole('button', { name: 'Save Meditation', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect(complete).toBeEnabled();
    await complete.click();
    await expect(
      page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
    ).toBeVisible();

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    setUiClock(M1_NOW);
  }
});
