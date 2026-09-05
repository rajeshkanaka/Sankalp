import { test, expect } from './test';
import type {
  JourneyDraftPreview,
  MutationEnvelope,
  JourneyDraft,
} from '../../src/domain/contracts';
import { capturedSignIn } from './helpers/sign-in';

async function completeSetup(page: import('@playwright/test').Page) {
  await page.getByLabel('Journey title', { exact: true }).fill('Saved draft');
  await page.getByLabel('Personal intention (optional)', { exact: true }).fill('Resume this later');
  await page.getByLabel('Practice 1', { exact: true }).fill('Quiet meditation');
  await page.getByLabel('Start date', { exact: true }).fill('2026-09-05');
  await page.getByLabel('Number of sessions', { exact: true }).fill('21');
  await page.getByLabel('Practice time', { exact: true }).fill('06:00');
  await page.getByLabel('Completion window (minutes)', { exact: true }).fill('60');
  await page.getByLabel('Practice timezone', { exact: true }).fill('Asia/Kolkata');
  await page.getByLabel('I confirm this practice timezone.').check();
}

test('@SK003 a saved draft resumes and every later preview updates the same journey', async ({
  page,
}, info) => {
  await capturedSignIn(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
  );
  await page.goto('/setup');
  await completeSetup(page);

  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/journeys') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
  const created = (await (await createdResponse).json()) as JourneyDraftPreview;
  await expect(page.getByRole('heading', { name: 'Review your journey' })).toBeVisible();

  await page.goto('/journeys');
  const resume = page.getByRole('link', { name: 'Resume draft', exact: true });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(page).toHaveURL(`/setup?draft=${created.journey.id}`);
  await expect(page.getByRole('heading', { name: 'Resume your draft', exact: true })).toBeVisible();
  await expect(page.getByLabel('Journey title', { exact: true })).toHaveValue('Saved draft');
  await expect(page.getByLabel('Personal intention (optional)', { exact: true })).toHaveValue(
    'Resume this later',
  );
  await expect(page.getByLabel('Practice 1', { exact: true })).toHaveValue('Quiet meditation');
  await expect(page.getByLabel('Practice timezone', { exact: true })).toHaveValue('Asia/Kolkata');
  await expect(page.getByLabel('I confirm this practice timezone.')).not.toBeChecked();

  await page.getByLabel('Journey title', { exact: true }).fill('Saved draft edited');
  await page.getByLabel('I confirm this practice timezone.').check();
  let interruptedBody: MutationEnvelope<JourneyDraft> | null = null;
  await page.route(
    `**/api/journeys/${created.journey.id}/draft`,
    async (route) => {
      interruptedBody = route.request().postDataJSON() as MutationEnvelope<JourneyDraft>;
      await route.abort('connectionfailed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Could not connect. Your entries are still here.',
  );
  await expect(page.getByLabel('Journey title', { exact: true })).toHaveValue('Saved draft edited');

  const updatedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/journeys/${created.journey.id}/draft`) &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
  const response = await updatedResponse;
  expect(response.ok()).toBe(true);
  const retryBody = response.request().postDataJSON() as MutationEnvelope<JourneyDraft>;
  expect(retryBody).toEqual(interruptedBody);
  const updated = (await response.json()) as JourneyDraftPreview;
  expect(updated.journey).toMatchObject({
    id: created.journey.id,
    revision: created.journey.revision + 1,
    title: 'Saved draft edited',
  });

  await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  await page.getByLabel('Personal intention (optional)', { exact: true }).fill('Final intention');
  const secondUpdateResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith(`/api/journeys/${created.journey.id}/draft`) &&
      candidate.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Preview journey', exact: true }).click();
  const secondResponse = await secondUpdateResponse;
  expect(secondResponse.ok()).toBe(true);
  const secondBody = secondResponse.request().postDataJSON() as MutationEnvelope<JourneyDraft>;
  expect(secondBody.operationId).not.toBe(retryBody.operationId);
  expect(secondBody.baseRevision).toBe(updated.journey.revision);
  expect(secondBody.payload.practices.map(({ id }) => id)).toEqual(
    retryBody.payload.practices.map(({ id }) => id),
  );
  const finalPreview = (await secondResponse.json()) as JourneyDraftPreview;
  expect(finalPreview.journey).toMatchObject({
    id: created.journey.id,
    revision: updated.journey.revision + 1,
    intention: 'Final intention',
  });

  await page.getByRole('button', { name: 'Activate journey', exact: true }).click();
  await expect(page).toHaveURL(`/today?journey=${created.journey.id}`);
  await page.goto('/journeys');
  await expect(page.getByRole('link', { name: 'Saved draft edited', exact: true })).toBeVisible();
  await expect(page.getByText('Final intention', { exact: true })).toBeVisible();
});
