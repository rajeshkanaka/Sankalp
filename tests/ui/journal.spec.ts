import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';

import type { JourneyDraft, JourneyDraftPreview, JourneyView } from '../../src/domain/contracts';
import { test, expect } from './test';
import { capturedSignIn } from './helpers/sign-in';

const NOTE =
  '\n  <img src=x onerror=alert(1)> Today I returned to quiet attention. आज मन शांत है।\n';

function draft(): JourneyDraft {
  return {
    title: 'Journal practice',
    intention: 'Synthetic private reflection flow.',
    practices: [
      {
        id: randomUUID(),
        label: 'Quiet attention',
        order: 0,
        kind: 'checkbox',
        target: null,
      },
    ],
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 3,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '06:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  };
}

async function postJson(request: APIRequestContext, path: string, data: unknown) {
  return request.post(path, {
    headers: { Origin: process.env.UI_ORIGIN!, 'Content-Type': 'application/json' },
    data,
  });
}

async function createJourney(request: APIRequestContext): Promise<JourneyView> {
  const operationId = randomUUID();
  const createdResponse = await request.post('/api/journeys', {
    headers: {
      Origin: process.env.UI_ORIGIN!,
      'Content-Type': 'application/json',
      'Idempotency-Key': operationId,
    },
    data: draft(),
  });
  expect(createdResponse.ok()).toBe(true);
  const created = (await createdResponse.json()) as JourneyDraftPreview;
  const activatedResponse = await postJson(
    request,
    `/api/journeys/${created.journey.id}/activate`,
    {
      operationId: randomUUID(),
      baseRevision: created.journey.revision,
      payload: { fingerprint: created.fingerprint },
    },
  );
  expect(activatedResponse.ok()).toBe(true);
  return activatedResponse.json() as Promise<JourneyView>;
}

async function expectSaved(scope: Page | Locator) {
  await expect(scope.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
}

async function reflectionPage(context: BrowserContext, path: string) {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByRole('region', { name: 'Private reflection' })).toBeVisible();
  return page;
}

test('@M3 @M3-journal private Unicode reflections autosave, search and resolve conflicts', async ({
  page,
  browser,
}, info) => {
  await capturedSignIn(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
  );
  const journey = await createJourney(page.request);
  const session = journey.sessions[0]!;
  const sessionPath = `/journeys/${journey.journey.id}/sessions/${session.id}`;
  await page.goto(sessionPath);

  const editor = page.getByRole('region', { name: 'Private reflection' });
  const note = editor.getByLabel('Your reflection', { exact: true });
  await note.fill(NOTE);
  await editor.getByLabel('Mood tag (optional)', { exact: true }).fill('शांत');
  await editor.getByRole('button', { name: 'Add mood', exact: true }).click();
  await expectSaved(editor);
  await expect(note).toHaveValue(NOTE);
  await page.reload();
  await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(NOTE);

  await page.goto('/journal');
  await page.getByLabel('Reflection contains', { exact: true }).fill('quiet attention');
  const queryRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/journal/query') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const request = await queryRequest;
  expect(new URL(request.url()).search).toBe('');
  expect(request.postDataJSON()).toMatchObject({ text: 'quiet attention' });
  await expect(page.getByText(/Today I returned to quiet attention/)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);

  await page.getByLabel('What did you notice?', { exact: true }).check();
  await page.getByRole('button', { name: 'Save prompt choices', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Prompt choices saved.' })).toBeVisible();
  await page.goto(sessionPath);
  await expect(page.getByText('What did you notice?', { exact: true })).toBeVisible();

  const storageState = await page.context().storageState();
  const secondContext = await browser.newContext({
    baseURL: process.env.UI_ORIGIN,
    storageState,
  });
  try {
    const secondPage = await reflectionPage(secondContext, sessionPath);
    const firstEditor = page.getByRole('region', { name: 'Private reflection' });
    const secondEditor = secondPage.getByRole('region', { name: 'Private reflection' });
    await firstEditor.getByLabel('Your reflection', { exact: true }).fill('First device version');
    await secondEditor.getByLabel('Your reflection', { exact: true }).fill('Second device version');
    await Promise.all([
      firstEditor.getByRole('button', { name: 'Save reflection', exact: true }).click(),
      secondEditor.getByRole('button', { name: 'Save reflection', exact: true }).click(),
    ]);
    const firstConflict = firstEditor
      .getByRole('alert')
      .filter({ hasText: 'Another device saved' });
    const secondConflict = secondEditor
      .getByRole('alert')
      .filter({ hasText: 'Another device saved' });
    await expect
      .poll(async () => (await firstConflict.count()) + (await secondConflict.count()))
      .toBe(1);
    const losingEditor = (await firstConflict.count()) ? firstEditor : secondEditor;
    const winningPage = losingEditor === firstEditor ? secondPage : page;
    const losingText = await losingEditor
      .getByLabel('Your reflection', { exact: true })
      .inputValue();
    await expect(
      losingEditor.getByRole('alert').filter({ hasText: 'Another device saved' }),
    ).toBeVisible();
    await expect(
      losingEditor.getByRole('region', { name: 'Your unsaved reflection' }),
    ).toContainText(losingText);
    await expect(losingEditor.getByRole('region', { name: 'Saved reflection' })).toBeVisible();
    await losingEditor.getByRole('button', { name: 'Keep my version', exact: true }).click();
    await expectSaved(losingEditor);
    await winningPage.reload();
    await expect(winningPage.getByLabel('Your reflection', { exact: true })).toHaveValue(
      losingText,
    );

    const oversized = '🙏'.repeat(20_001);
    await winningPage.getByLabel('Your reflection', { exact: true }).fill(oversized);
    await expect(
      winningPage.getByRole('status').filter({ hasText: 'Use no more than 20,000 characters.' }),
    ).toBeVisible();
    await expect(
      winningPage.getByRole('button', { name: 'Save reflection', exact: true }),
    ).toBeDisabled();
    await expect(winningPage.getByLabel('Your reflection', { exact: true })).toHaveValue(oversized);
  } finally {
    await secondContext.close();
  }

  const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
  mkdirSync(evidence, { recursive: true });
  await page.goto('/journal');
  await page.screenshot({ path: resolve(evidence, 'journal-saved.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
