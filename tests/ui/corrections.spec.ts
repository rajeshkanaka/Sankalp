import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';

import type { JourneyDraft, JourneyView, SessionMutationResult } from '../../src/domain/contracts';
import { expect, test } from './test';
import { setUiClock } from './helpers/clock';
import { capturedSignIn } from './helpers/sign-in';

const M1_NOW = '2026-09-05T00:45:00Z';
const BEFORE_OPEN = '2026-09-05T00:00:00Z';
const AFTER_CLOSE = '2026-09-05T02:00:00Z';
const CHECKBOX_ID = 'a7000000-0000-4000-8000-000000000001';
const NUMERIC_ID = 'a7000000-0000-4000-8000-000000000002';

async function mutate<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(path, {
    data,
    headers: {
      Origin: process.env.UI_ORIGIN!,
      ...(path === '/api/journeys' ? { 'Idempotency-Key': randomUUID() } : {}),
    },
  });
  expect(response.status(), `Synthetic correction setup POST ${path.split('/').at(-1)}`).toBe(200);
  return response.json() as Promise<T>;
}

async function createJourney(page: Page, title: string) {
  const draft: JourneyDraft = {
    title,
    intention: 'Synthetic correction history verification.',
    practices: [
      { id: CHECKBOX_ID, label: 'Opening prayer', order: 0, kind: 'checkbox', target: null },
      { id: NUMERIC_ID, label: 'Mantra count', order: 1, kind: 'repetitions', target: 3 },
    ],
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 2,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  };
  const created = await mutate<{
    journey: { id: string; revision: number };
    fingerprint: string;
  }>(page, '/api/journeys', draft);
  return mutate<JourneyView>(page, `/api/journeys/${created.journey.id}/activate`, {
    operationId: randomUUID(),
    baseRevision: created.journey.revision,
    payload: { fingerprint: created.fingerprint },
  });
}

function noChange(route: Route, message: string, current: unknown) {
  return route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'NO_CHANGE', message, correlationId: 'synthetic-no-change', current },
    }),
  });
}

test('@M3 @M3-corrections preserves factual chronology through correction and undo', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  setUiClock(BEFORE_OPEN);
  try {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    const activated = await createJourney(page, `Correction history ${info.project.name}`);
    const original = activated.sessions[0];
    setUiClock(AFTER_CLOSE);
    await page.goto(`/journeys/${activated.journey.id}/sessions/${original.id}`);

    await expect(page.getByText(/practice window has closed/i)).toBeVisible();
    const checkbox = page.getByRole('checkbox', { name: 'Opening prayer', exact: true });
    const numeric = page.getByLabel('Mantra count', { exact: true });
    const saveNumeric = page.getByRole('button', {
      name: 'Save value for Mantra count',
      exact: true,
    });
    await expect(checkbox).toBeEnabled();
    await expect(numeric).toBeEnabled();

    const acknowledgedNumeric = {
      ...original,
      practices: original.practices.map((practice) =>
        practice.id === NUMERIC_ID ? { ...practice, value: 1 } : practice,
      ),
    };
    await page.route(
      `**/api/sessions/${original.id}/practices`,
      (route) => noChange(route, 'These practice values are already saved.', acknowledgedNumeric),
      { times: 1 },
    );
    await numeric.fill('1');
    await saveNumeric.click();
    await expect(page.getByRole('status')).toContainText('This value is already saved.');
    await expect(
      page.getByRole('alert').filter({ hasText: 'These practice values are already saved.' }),
    ).toHaveCount(0);
    await expect(numeric).toHaveValue('1');
    await expect(saveNumeric).toBeDisabled();

    await numeric.fill('3');
    await saveNumeric.click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await checkbox.check();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    const actualTime = page.getByLabel('Actual practice time in Asia/Kolkata', { exact: true });
    await actualTime.fill('2026-09-05T06:15');
    const completionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/sessions/${original.id}/completion`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
    );
    await page.getByRole('button', { name: 'Record historical completion', exact: true }).click();
    const completed = (await completionResponsePromise).json() as Promise<SessionMutationResult>;
    await expect(page.getByText('Recorded later.', { exact: true })).toBeVisible();
    await expect(
      page.getByText('The practice window closed with no saved progress.'),
    ).toBeVisible();
    await expect(page.getByText('An in-window practice was recorded later.')).toBeVisible();

    await page.getByRole('button', { name: 'Correct practice time', exact: true }).click();
    await actualTime.fill('2026-09-05T07:15');
    const correctionOperationIds: string[] = [];
    page.on('request', (request) => {
      if (
        request.url().endsWith(`/api/sessions/${original.id}/completion`) &&
        request.method() === 'POST'
      ) {
        const body = request.postDataJSON() as { operationId?: unknown } | null;
        if (typeof body?.operationId === 'string') correctionOperationIds.push(body.operationId);
      }
    });
    await page.route(
      `**/api/sessions/${original.id}/completion`,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'TEMPORARY_TEST_FAILURE',
              message: 'Temporary correction failure. The original record remains.',
              correlationId: 'synthetic-correction-retry',
            },
          }),
        }),
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Save corrected practice time', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Temporary correction failure' }),
    ).toBeVisible();
    await expect(actualTime).toHaveValue('2026-09-05T07:15');

    const correctionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/sessions/${original.id}/completion`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
    );
    await page.getByRole('button', { name: 'Save corrected practice time', exact: true }).click();
    const corrected = (await correctionResponsePromise).json() as Promise<SessionMutationResult>;
    expect(correctionOperationIds).toHaveLength(2);
    expect(correctionOperationIds[1]).toBe(correctionOperationIds[0]);
    await expect(page.getByText('Practiced late.', { exact: true })).toBeVisible();
    await expect(page.getByText('A late practice was recorded.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Correct practice time', exact: true }).click();
    await actualTime.fill('2026-09-05T07:30');
    const correctedResult = await corrected;
    const acknowledgedTime = {
      ...correctedResult.session,
      performedAt: '2026-09-05T02:00:00Z',
    };
    await page.route(
      `**/api/sessions/${original.id}/completion`,
      (route) => noChange(route, 'This practice time is already recorded.', acknowledgedTime),
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Save corrected practice time', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('This practice time is already recorded.');
    await expect(
      page.getByRole('alert').filter({ hasText: 'This practice time is already recorded.' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel time correction' })).toBeEnabled();

    await page.reload();
    await page.getByRole('button', { name: 'Remove completion', exact: true }).click();
    await expect(page.getByText(/Saved practice values and history will remain/)).toBeVisible();
    await page.getByRole('button', { name: 'Keep completion', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Confirm remove completion', exact: true }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Remove completion', exact: true }).click();
    const completedResult = await completed;
    const acknowledgedRemoval = {
      ...completedResult.session,
      revision: correctedResult.session.revision,
      practices: correctedResult.session.practices,
      confirmed: false,
      performedAt: null,
      recordedAt: null,
    };
    await page.route(
      `**/api/sessions/${original.id}/completion`,
      (route) => noChange(route, 'This session is not recorded as complete.', acknowledgedRemoval),
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Confirm remove completion', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('The completion is already removed.');
    await expect(
      page.getByRole('alert').filter({ hasText: 'This session is not recorded as complete.' }),
    ).toHaveCount(0);
    await expect(checkbox).toBeChecked();
    await expect(numeric).toHaveValue('3');
    await expect(numeric).toBeEnabled();

    await page.reload();
    await page.getByRole('button', { name: 'Remove completion', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm remove completion', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(
      'Completion removed. Your saved practice values remain.',
    );
    await expect(checkbox).toBeChecked();
    await expect(numeric).toHaveValue('3');
    await expect(
      page.getByRole('button', { name: 'Record historical completion', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText('Completion removed; saved practice values kept.', { exact: true }),
    ).toBeVisible();

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({
      path: resolve(evidence, 'completion-corrections.png'),
      fullPage: true,
    });
    expect(pageErrors).toEqual([]);
  } finally {
    setUiClock(M1_NOW);
  }
});
