import { test, expect } from './test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SessionRecord } from '../../src/domain/contracts';
import { setUiClock } from './helpers/clock';
import { setUiNetworkDisconnected } from './helpers/network';
import { capturedSignIn } from './helpers/sign-in';
import { observePublicServiceWorker } from './helpers/service-worker-diagnostics';

const M1_NOW = '2026-09-05T00:45:00Z';
const M2_NOW = '2026-09-12T04:01:00+05:30';
const LONG_PRACTICE = 'M'.repeat(120);

test.describe('Online-only fallback: personalized schedules and synthetic save retries', () => {
  test.use({ serviceWorkers: 'block' });

  test('@M2 @M2-schedule personalized schedules preview accurately and numeric targets require saved completion', async ({
    page,
  }, info) => {
    const consoleErrors: string[] = [];
    let phase = 'login';
    page.on('pageerror', (error) =>
      consoleErrors.push(
        `${phase}: ${error.name}: ${error.message.replace(/https?:\/\/[^\s]+/g, '<url>')}`,
      ),
    );
    setUiClock(M2_NOW);

    try {
      await capturedSignIn(
        page,
        info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
      );
      phase = 'custom setup';
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

      phase = 'template preview';
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
      await expect(
        page.getByText('September 6, 2026 at 12:00 AM', { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText('September 26, 2026 at 12:00 AM', { exact: true })).toBeVisible();
      await expect(page.getByText('Sep 5, 2026', { exact: true })).toBeVisible();
      await expect(page.getByText('Sep 25, 2026', { exact: true })).toBeVisible();
      await expect(page.getByText(/previous calendar night/i)).toBeVisible();
      await expect(page.getByText(/no reminder will be sent/i)).toBeVisible();
      await expect(
        page.getByLabel('First practice reminder suggestions').getByRole('listitem'),
      ).toHaveCount(4);

      phase = 'weekday preview';
      await page.getByRole('button', { name: 'Edit details', exact: true }).click();
      await page.getByLabel('Journey title', { exact: true }).fill('Monday Thursday meditation');
      await page.getByLabel('Practice 1', { exact: true }).fill('Meditation');
      await page.getByRole('button', { name: 'Remove practice 2', exact: true }).click();
      const measurement = page.getByLabel('How it is measured for Practice 1', { exact: true });
      await expect(measurement).toHaveAccessibleName('How it is measured for Practice 1');
      await measurement.selectOption('minutes');
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
      await expect(
        page.getByRole('alert').filter({ hasText: 'Choose at least one practice day' }),
      ).toContainText('Your other entries are still here');
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
      await expect(page.getByText('October 15, 2026 at 6:30 PM', { exact: true })).toBeVisible();
      const evidence = resolve('docs/evidence/M2', process.env.UI_RUN_ID!, info.project.name);
      mkdirSync(evidence, { recursive: true });
      if (process.env.SANKALPA_MILESTONE_EVIDENCE === '1')
        await page.screenshot({ path: resolve(evidence, 'weekday-preview.png'), fullPage: true });

      phase = 'calendar-span preview';
      await page.getByRole('button', { name: 'Edit details', exact: true }).click();
      await page.getByLabel('Duration counts', { exact: true }).selectOption('calendar_days');
      await page.getByLabel('Number of calendar days', { exact: true }).fill('30');
      await page.getByLabel('Start date', { exact: true }).fill('2026-09-05');
      await page.getByLabel('Monday', { exact: true }).uncheck();
      await page.getByLabel('Thursday', { exact: true }).uncheck();
      await page.getByLabel('Tuesday', { exact: true }).check();
      await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
      await expect(page.getByText(/4 sessions from 30 calendar days; Tuesday/)).toBeVisible();
      await expect(page.getByText('September 29, 2026 at 6:30 PM', { exact: true })).toBeVisible();
      await expect(page.getByText('Sep 29, 2026', { exact: true })).toBeVisible();

      phase = 'numeric practice';
      await page.getByRole('button', { name: 'Edit details', exact: true }).click();
      await page.getByLabel('Journey title', { exact: true }).fill('Open numeric meditation');
      await page.getByLabel('Practice 1', { exact: true }).fill(LONG_PRACTICE);
      await page.getByRole('button', { name: 'Add practice', exact: true }).click();
      await page.getByLabel('Practice 2', { exact: true }).fill('Closing breath');
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
      await expect(
        page.getByText(
          'Offline saving is unavailable. You can continue using the online controls.',
          {
            exact: true,
          },
        ),
      ).toBeVisible();

      const complete = page.getByRole('button', { name: 'Complete this session', exact: true });
      const numeric = page.getByLabel(LONG_PRACTICE, { exact: true });
      const checkbox = page.getByRole('checkbox', { name: 'Closing breath', exact: true });
      await page.route('**/api/sessions/*/practices', async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'TEMPORARY_TEST_FAILURE',
              message: 'Temporary checkbox failure. The choice is still here.',
              correlationId: 'synthetic-m2-checkbox-retry',
            },
          }),
        });
      });
      await checkbox.check();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Temporary checkbox failure' }),
      ).toContainText('The choice is still here');
      await expect(checkbox).toBeChecked();
      await expect(numeric).toBeDisabled();
      await expect(
        page.getByRole('region', { name: 'Practice checklist', exact: true }).getByRole('status'),
      ).toContainText('Retry Closing breath before changing another practice');
      await page.unroute('**/api/sessions/*/practices');
      await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
      await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
      await expect(numeric).toBeEnabled();

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
      await page
        .getByRole('button', { name: `Save value for ${LONG_PRACTICE}`, exact: true })
        .click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Temporary test failure' }),
      ).toContainText('Your entry is still here');
      await expect(numeric).toHaveValue('5');
      await page.unroute('**/api/sessions/*/practices');
      await page.getByRole('button', { name: 'Try saving again', exact: true }).click();
      await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
      await expect(page.getByText('Partial', { exact: true })).toBeVisible();
      await expect(complete).toBeDisabled();
      await numeric.fill('20');
      await expect(complete).toBeDisabled();
      await page
        .getByRole('button', { name: `Save value for ${LONG_PRACTICE}`, exact: true })
        .click();
      await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
      await expect(complete).toBeEnabled();
      await complete.click();
      await expect(
        page.getByRole('heading', { name: 'Your practice is recorded.', exact: true }),
      ).toBeVisible();
      if (process.env.SANKALPA_MILESTONE_EVIDENCE === '1')
        await page.screenshot({ path: resolve(evidence, 'numeric-complete.png'), fullPage: true });

      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.setViewportSize({ width: 320, height: 800 });
      await expect(page.getByText(LONG_PRACTICE, { exact: true })).toBeVisible();
      const saveValue = page.getByRole('button', {
        name: `Save value for ${LONG_PRACTICE}`,
        exact: true,
      });
      await expect(saveValue).toBeVisible();
      await expect(saveValue).toHaveText('Save value');
      await expect(saveValue).toHaveAccessibleName(`Save value for ${LONG_PRACTICE}`);
      const saveBox = await saveValue.boundingBox();
      expect(saveBox).not.toBeNull();
      expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(320);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(consoleErrors).toEqual([]);
    } finally {
      setUiClock(M1_NOW);
    }
  });
});

test('@M2 @M2-schedule unified numeric practice survives real disconnection and completes once after replay', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const workerDiagnostic = await observePublicServiceWorker(page);
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(error.name));
  setUiClock(M2_NOW);
  try {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    await page.goto('/setup');
    await page.getByLabel('Journey title', { exact: true }).fill('Offline numeric meditation');
    await page.getByLabel('Practice 1', { exact: true }).fill('Quiet minutes');
    await page
      .getByLabel('How it is measured for Practice 1', { exact: true })
      .selectOption('minutes');
    await page.getByLabel('Target for Practice 1', { exact: true }).fill('20');
    await page.getByRole('button', { name: 'Add practice', exact: true }).click();
    await page.getByLabel('Practice 2', { exact: true }).fill('Closing breath');
    await page.getByLabel('Start date', { exact: true }).fill('2026-09-12');
    await page.getByLabel('Number of sessions', { exact: true }).fill('2');
    await page.getByLabel('Practice time', { exact: true }).fill('04:00');
    await page.getByLabel('Completion window (minutes)', { exact: true }).fill('60');
    await page.getByLabel('Practice timezone', { exact: true }).fill('Asia/Kolkata');
    await page.getByLabel('I confirm this practice timezone.').check();
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
    await expect(page.getByText('Quiet minutes · 20 minutes', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Activate journey', exact: true }).click();
    await expect(page).toHaveURL(/\/today\?journey=/);
    const journeyId = new URL(page.url()).searchParams.get('journey');
    expect(journeyId).toMatch(/^[a-f0-9-]{36}$/);
    await page.getByRole('link', { name: 'Open practice', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/journeys/${journeyId}/sessions/[a-f0-9-]{36}$`));
    const sessionId = new URL(page.url()).pathname.split('/').at(-1);
    expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
    const checklist = page.getByRole('region', { name: 'Practice checklist', exact: true });
    const numeric = checklist.getByLabel('Quiet minutes', { exact: true });
    const save = checklist.getByRole('button', {
      name: 'Save value for Quiet minutes',
      exact: true,
    });
    const checkbox = checklist.getByRole('checkbox', { name: 'Closing breath', exact: true });
    const complete = checklist.getByRole('button', { name: 'Complete this session', exact: true });
    const saveState = checklist.locator('p[role=status]');
    await expect(numeric).toBeEnabled();
    await expect(numeric).toHaveValue('0');
    await expect(complete).toBeDisabled();
    try {
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const controller = navigator.serviceWorker?.controller;
            if (!controller) return false;
            return new Promise<boolean>((done) => {
              const channel = new MessageChannel();
              const timeout = setTimeout(() => {
                channel.port1.close();
                done(false);
              }, 2000);
              channel.port1.onmessage = (event) => {
                clearTimeout(timeout);
                channel.port1.close();
                done(event.data?.type === 'PUBLIC_CACHE_READY' && event.data.ready === true);
              };
              controller.postMessage({ type: 'PUBLIC_CACHE_READY' }, [channel.port2]);
            });
          }),
        )
        .toBe(true);
    } catch (error) {
      await workerDiagnostic.save(
        resolve(
          'docs/evidence/M2',
          process.env.UI_RUN_ID!,
          info.project.name,
          'service-worker-readiness.json',
        ),
      );
      throw error;
    }
    await expect(
      page.getByText('Offline saving is unavailable. You can continue using the online controls.', {
        exact: true,
      }),
    ).toHaveCount(0);
    const baselineResponse = await page.request.get(`/api/sessions/${sessionId}`);
    expect(baselineResponse.ok()).toBe(true);
    const baseline = ((await baselineResponse.json()) as { session: SessionRecord }).session;
    expect(baseline).toMatchObject({ confirmed: false, revision: 0 });

    // Cut actual connections in every engine; Chromium also exercises navigator offline mode.
    await setUiNetworkDisconnected(true);
    if (info.project.name === 'chromium') await page.context().setOffline(true);
    await numeric.fill('5');
    await expect(complete).toBeDisabled();
    await save.click();
    await expect(saveState).toContainText('Saved on this device');
    await expect(checklist.getByText('Recorded 5 of 20 minutes', { exact: true })).toBeVisible();
    await expect(complete).toBeDisabled();

    await numeric.fill('1e-');
    await expect(saveState).toHaveText('Draft saved on this device.');
    await save.click();
    await expect(checklist.getByRole('alert')).toHaveText(
      'Enter a whole number from 0 to 1,000,000. Your entry is still here.',
    );
    await expect(numeric).toHaveValue('1e-');
    await expect(complete).toBeDisabled();
    await page.reload();
    await expect(numeric).toHaveValue('1e-');
    await expect(checklist.getByText('Recorded 5 of 20 minutes', { exact: true })).toBeVisible();
    await expect(complete).toBeDisabled();
    await checkbox.check();
    await expect(saveState).toContainText('Saved on this device');
    await expect(checkbox).toBeChecked();
    await expect(numeric).toHaveValue('1e-');
    await expect(complete).toBeDisabled();

    await numeric.fill('20');
    await expect(saveState).toHaveText('Draft saved on this device.');
    await expect(complete).toBeDisabled();
    await save.click();
    await expect(checklist.getByText('Recorded 20 of 20 minutes', { exact: true })).toBeVisible();
    await expect(complete).toBeEnabled();
    await complete.click();
    const pendingCompletion = page.getByRole('heading', {
      name: 'Completion saved on this device.',
      exact: true,
    });
    const canonicalCompletion = page.getByRole('heading', {
      name: 'Your practice is recorded.',
      exact: true,
    });
    await expect(pendingCompletion).toBeVisible();
    await expect(canonicalCompletion).toHaveCount(0);
    await expect(
      checklist.getByText('4 change(s) saved on this device.', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(pendingCompletion).toBeVisible();
    await expect(canonicalCompletion).toHaveCount(0);
    await expect(numeric).toHaveValue('20');
    await expect(checkbox).toBeChecked();
    await expect(
      checklist.getByText('4 change(s) saved on this device.', { exact: true }),
    ).toBeVisible();
    const evidence = resolve('docs/evidence/M2', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    if (process.env.SANKALPA_MILESTONE_EVIDENCE === '1')
      await page.screenshot({
        path: resolve(evidence, 'numeric-offline-pending.png'),
        fullPage: true,
      });

    await page.context().setOffline(false);
    await setUiNetworkDisconnected(false);
    await page.reload();
    await expect(canonicalCompletion).toBeVisible({ timeout: 30000 });
    await expect(pendingCompletion).toHaveCount(0);
    await expect(numeric).toHaveValue('20');
    await expect(checkbox).toBeChecked();
    const canonicalResponse = await page.request.get(`/api/sessions/${sessionId}`);
    expect(canonicalResponse.ok()).toBe(true);
    const canonical = ((await canonicalResponse.json()) as { session: SessionRecord }).session;
    expect(canonical).toMatchObject({
      id: sessionId,
      journeyId,
      scheduleVersionId: baseline.scheduleVersionId,
      confirmed: true,
      revision: 4,
      performedAt: new Date(M2_NOW).toISOString(),
      recordedAt: new Date(M2_NOW).toISOString(),
    });
    expect(canonical.practices.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Quiet minutes', value: 20 },
      { label: 'Closing breath', value: true },
    ]);
    const history = page.getByRole('list', { name: 'Session history', exact: true });
    await expect(history.getByText('Practice values saved.', { exact: true })).toHaveCount(3);
    await expect(history.getByText('Completion confirmed.', { exact: true })).toHaveCount(1);
    await page.reload();
    await expect(canonicalCompletion).toBeVisible();
    await expect(history.getByText('Practice values saved.', { exact: true })).toHaveCount(3);
    await expect(history.getByText('Completion confirmed.', { exact: true })).toHaveCount(1);
    const repeatedResponse = await page.request.get(`/api/sessions/${sessionId}`);
    expect(repeatedResponse.ok()).toBe(true);
    expect(((await repeatedResponse.json()) as { session: SessionRecord }).session).toEqual(
      canonical,
    );
    await page.getByRole('link', { name: 'Your journey', exact: true }).click();
    const progress = page.getByRole('region', { name: 'Journey progress', exact: true });
    await expect(progress.getByText('1 of 2 sessions completed', { exact: true })).toBeVisible();
    await expect(progress.getByText('1 upcoming', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(canonicalCompletion).toBeVisible();
    if (process.env.SANKALPA_MILESTONE_EVIDENCE === '1')
      await page.screenshot({
        path: resolve(evidence, 'numeric-offline-complete.png'),
        fullPage: true,
      });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    workerDiagnostic.stop();
    await page.context().setOffline(false);
    await setUiNetworkDisconnected(false);
    setUiClock(M1_NOW);
  }
});
