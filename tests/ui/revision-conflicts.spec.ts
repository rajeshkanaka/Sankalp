import { expect, test } from './test';

import { setUiClock } from './helpers/clock';
import { capturedSignIn } from './helpers/sign-in';

const M1_NOW = '2026-09-05T00:45:00Z';
const BEFORE_SECOND_OPEN = '2026-09-06T00:29:00Z';
const AT_SECOND_OPEN = '2026-09-06T00:30:00Z';

test('@M2 @M2-revisions stale schedule previews preserve edits and require fresh review', async ({
  browser,
  page,
}, info) => {
  setUiClock(BEFORE_SECOND_OPEN);
  let otherDevice: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    await page.goto('/setup');
    await page.getByRole('button', { name: 'Use 21-night example', exact: true }).click();
    await page.getByLabel('Start date', { exact: true }).fill('2026-09-05');
    await page.getByLabel('Practice time', { exact: true }).fill('06:00');
    await page.getByRole('radio', { name: /Same civil date/ }).check();
    await page.getByLabel('I confirm this practice timezone.').check();
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
    await page.getByRole('button', { name: 'Activate journey', exact: true }).click();
    await expect(page).toHaveURL(/\/today\?journey=/);
    const journeyId = new URL(page.url()).searchParams.get('journey');
    expect(journeyId).toMatch(/^[a-f0-9-]{36}$/);
    await page.goto(`/journeys/${journeyId}`);

    const operationIds: string[] = [];
    page.on('request', (request) => {
      if (!request.url().endsWith(`/api/journeys/${journeyId}/schedule-revisions`)) return;
      const body = request.postDataJSON() as { mode?: unknown; operationId?: unknown } | null;
      if (body?.mode === 'apply' && typeof body.operationId === 'string') {
        operationIds.push(body.operationId);
      }
    });

    await page.getByLabel('Practice 1', { exact: true }).fill('Boundary-preserved Kunjika');
    await page.getByLabel('Change from practice date', { exact: true }).fill('2026-09-06');
    await page.getByRole('button', { name: 'Preview future changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review future changes' })).toBeVisible();

    setUiClock(AT_SECOND_OPEN);
    await page.getByRole('button', { name: 'Apply future change', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'The future schedule changed at an opening boundary',
    );
    await expect(page.getByLabel('Practice 1', { exact: true })).toHaveValue(
      'Boundary-preserved Kunjika',
    );
    await expect(page.getByText(/Preview them again to review the updated schedule/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review future changes' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Preview future changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review future changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Apply future change', exact: true }).click();
    await expect(page.getByText('Future schedule updated.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Practices: Boundary-preserved Kunjika/)).toBeVisible();
    expect(operationIds).toHaveLength(2);
    expect(operationIds[1]).not.toBe(operationIds[0]);

    await page.getByLabel('Practice 1', { exact: true }).fill('Other-device preserved Kunjika');
    await page.getByLabel('Change from practice date', { exact: true }).fill('2026-09-07');
    await page.getByRole('button', { name: 'Preview future changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review future changes' })).toBeVisible();

    otherDevice = await browser.newContext({
      baseURL: process.env.UI_ORIGIN,
      storageState: await page.context().storageState(),
    });
    const otherPage = await otherDevice.newPage();
    await otherPage.goto(`/journeys/${journeyId}`);
    await otherPage.getByLabel('Journey title', { exact: true }).fill('Changed on other device');
    await otherPage.getByRole('button', { name: 'Save journey details', exact: true }).click();
    await expect(otherPage.getByText('Journey details saved.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Apply future change', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('changed on another device');
    await expect(page.getByLabel('Practice 1', { exact: true })).toHaveValue(
      'Other-device preserved Kunjika',
    );
    const previewButton = page.getByRole('button', { name: 'Preview future changes', exact: true });
    await expect(previewButton).toBeEnabled();
    await expect(page.getByText(/Latest journey loaded/)).toBeVisible();

    await previewButton.click();
    await expect(page.getByRole('heading', { name: 'Review future changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Apply future change', exact: true }).click();
    await expect(page.getByText('Future schedule updated.', { exact: true })).toBeVisible();
    expect(operationIds).toHaveLength(4);
    expect(operationIds[3]).not.toBe(operationIds[2]);
  } finally {
    await otherDevice?.close();
    setUiClock(M1_NOW);
  }
});
