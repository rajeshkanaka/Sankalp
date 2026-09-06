import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Route } from '@playwright/test';
import { expect, test } from './test';

import { setUiClock } from './helpers/clock';
import { capturedSignIn } from './helpers/sign-in';

const M1_NOW = '2026-09-05T00:45:00Z';
const M2_NOW = '2026-09-12T04:01:00+05:30';

test('@M2 @M2-revisions future changes preserve opened labels and metadata remains separate', async ({
  page,
}, info) => {
  setUiClock(M2_NOW);
  try {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    await page.goto('/setup');
    await page.getByRole('button', { name: 'Use 21-night example', exact: true }).click();
    await page.getByLabel('Start date', { exact: true }).fill('2026-09-05');
    await page.getByLabel('I confirm this practice timezone.').check();
    await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
    await page.getByRole('button', { name: 'Activate journey', exact: true }).click();
    await expect(page).toHaveURL(/\/today\?journey=/);
    const journeyId = new URL(page.url()).searchParams.get('journey');
    expect(journeyId).toMatch(/^[a-f0-9-]{36}$/);
    await page.goto(`/journeys/${journeyId}`);

    // Delay actual hydration while retaining the server-rendered journey page.
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    let heldScripts = 0;
    const holdScripts = async (route: Route) => {
      heldScripts += 1;
      await scriptsReady;
      await route.continue();
    };
    const nextScripts = /\/_next\/static\/.*\.js(?:\?.*)?$/;
    await page.route(nextScripts, holdScripts);
    try {
      await page.reload({ waitUntil: 'commit' });
      await expect.poll(() => heldScripts).toBeGreaterThan(0);
      await expect(page.getByLabel('Journey title', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Journey title', { exact: true })).toBeDisabled();
      await expect(page.getByLabel('Journey title', { exact: true })).not.toBeEditable();
      await expect(page.getByLabel('Personal intention', { exact: true })).toBeDisabled();
      await expect(page.getByLabel('Personal intention', { exact: true })).not.toBeEditable();
      await expect(
        page.getByRole('button', { name: 'Save journey details', exact: true }),
      ).toBeDisabled();
    } finally {
      releaseScripts();
      await page.unroute(nextScripts, holdScripts);
    }

    await page.getByLabel('Journey title', { exact: true }).fill('Revised night practice');
    await page.getByLabel('Personal intention', { exact: true }).fill('A clearer intention.');
    let attemptedMetadata: unknown;
    await page.route('**/api/journeys/*/metadata', async (route) => {
      attemptedMetadata = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'REVISION_CONFLICT',
            message: 'Review the latest journey before trying again.',
            correlationId: 'synthetic-m2-metadata-conflict',
          },
        }),
      });
    });
    await page.getByRole('button', { name: 'Save journey details', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Review the latest journey' }),
    ).toBeVisible();
    expect(attemptedMetadata).toMatchObject({
      payload: { title: 'Revised night practice', intention: 'A clearer intention.' },
    });
    await expect(page.getByLabel('Journey title', { exact: true })).toHaveValue(
      'Revised night practice',
    );
    await expect(page.getByLabel('Personal intention', { exact: true })).toHaveValue(
      'A clearer intention.',
    );
    await page.unroute('**/api/journeys/*/metadata');
    await page.getByRole('button', { name: 'Reload latest journey', exact: true }).click();
    await page.getByRole('button', { name: 'Save journey details', exact: true }).click();
    await expect(page.getByText('Journey details saved.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Revised night practice' })).toBeVisible();

    await page.getByLabel('Practice 1', { exact: true }).fill('Future Kunjika');
    await page.getByLabel('Change from practice date', { exact: true }).fill('2026-09-12');
    await page.getByLabel('Practice time', { exact: true }).fill('00:30');
    await page.getByRole('button', { name: 'Preview future changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review future changes' })).toBeVisible();
    await expect(page.getByText(/7 existing sessions will stay unchanged/)).toBeVisible();
    await expect(
      page.getByText(/14 unopened sessions will be replaced with 14 new sessions/),
    ).toBeVisible();
    await expect(page.getByText(/original start remains 2026-09-05/i)).toBeVisible();
    await page.getByRole('button', { name: 'Apply future change', exact: true }).click();
    await expect(page.getByText('Future schedule updated.', { exact: true })).toBeVisible();
    await expect(page.getByText('Current practices: Future Kunjika, Bhairav Stotra')).toBeVisible();

    await page.getByRole('link', { name: /^Night 1\s/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Kunjika', exact: true })).toBeVisible();
    await expect(page.getByText('Future Kunjika', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Your journey', exact: true }).click();
    await page.getByRole('link', { name: /^Night 8\s/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Future Kunjika', exact: true })).toBeVisible();

    const evidence = resolve('docs/evidence/M2', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, 'revision-history.png'), fullPage: true });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    setUiClock(M1_NOW);
  }
});
