import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';

import type {
  JourneyDraft,
  JourneyDraftPreview,
  JourneyView,
  ReflectionRecord,
} from '../../src/domain/contracts';
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
  await expect(scope.getByRole('status').filter({ hasText: /^Saved\.$/ })).toBeVisible();
}

async function reflectionPage(context: BrowserContext, path: string) {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByRole('region', { name: 'Private reflection' })).toBeVisible();
  return page;
}

test.describe('online-only fallback: simulated lost response and conflict recovery', () => {
  test.use({ serviceWorkers: 'block' });

  test('@M3 @M3-journal private Unicode reflections autosave, search and resolve conflicts', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120000);
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
    let committedBody: unknown;
    let committedStatus = 0;
    await page.route(
      `**/api/sessions/${session.id}/reflection`,
      async (route) => {
        committedBody = route.request().postDataJSON();
        const upstream = await route.fetch();
        committedStatus = upstream.status();
        await route.abort('connectionfailed');
      },
      { times: 1 },
    );
    await note.fill(NOTE);
    await editor.getByLabel('Mood tag (optional)', { exact: true }).fill('शांत');
    await editor.getByRole('button', { name: 'Add mood', exact: true }).click();
    await editor.getByRole('button', { name: 'Save reflection', exact: true }).click();
    await expect(editor.getByRole('alert').filter({ hasText: 'Could not connect' })).toBeVisible();
    expect(committedStatus).toBe(200);
    await expect(note).toBeDisabled();
    await expect(
      editor.getByRole('button', { name: 'Save reflection', exact: true }),
    ).toBeDisabled();
    const retriedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/sessions/${session.id}/reflection`) &&
        response.request().method() === 'PUT',
    );
    await editor.getByRole('button', { name: 'Try saving again', exact: true }).click();
    const retried = await retriedResponse;
    expect(retried.ok()).toBe(true);
    expect(retried.request().postDataJSON()).toEqual(committedBody);
    expect(await retried.json()).toMatchObject({ sessionId: session.id, revision: 1 });
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
    await expect(
      page.getByRole('status').filter({ hasText: /^Prompt choices saved\.$/ }),
    ).toBeVisible();
    await page.goto(sessionPath);
    await expect(page.getByText('What did you notice?', { exact: true })).toBeVisible();

    const storageState = await page.context().storageState();
    const secondContext = await browser.newContext({
      baseURL: process.env.UI_ORIGIN,
      storageState,
      serviceWorkers: 'block',
    });
    try {
      const secondPage = await reflectionPage(secondContext, sessionPath);
      const firstEditor = page.getByRole('region', { name: 'Private reflection' });
      const secondEditor = secondPage.getByRole('region', { name: 'Private reflection' });
      await firstEditor.getByLabel('Your reflection', { exact: true }).fill('First device version');
      await secondEditor
        .getByLabel('Your reflection', { exact: true })
        .fill('Second device version');
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
        losingEditor.getByRole('region', { name: 'Your unsaved reflection', exact: true }),
      ).toContainText(losingText);
      await expect(
        losingEditor.getByRole('region', { name: 'Saved reflection', exact: true }),
      ).toBeVisible();
      const winningEditor = winningPage.getByRole('region', { name: 'Private reflection' });
      await winningEditor.getByLabel('Your reflection', { exact: true }).fill(losingText);
      await winningEditor.getByRole('button', { name: 'Save reflection', exact: true }).click();
      await expectSaved(winningEditor);
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
      await expect(winningPage.getByLabel('Your reflection', { exact: true })).toHaveValue(
        oversized,
      );
    } finally {
      await secondContext.close();
    }

    const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    await page.goto('/journal');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Your private journal', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Journal practice', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(evidence, 'journal-online-only-saved.png'),
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

async function savedReflection(page: Page, sessionId: string): Promise<ReflectionRecord> {
  const response = await page.request.get(`/api/sessions/${sessionId}/reflection`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<ReflectionRecord>;
}

test('@M3 @M3-journal unified editor autosaves Unicode and resolves an actual two-device reflection conflict', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  await capturedSignIn(
    page,
    info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
  );
  const journey = await createJourney(page.request);
  const session = journey.sessions[0]!;
  const sessionPath = `/journeys/${journey.journey.id}/sessions/${session.id}`;
  await page.goto(sessionPath);
  const editor = page.getByRole('region', { name: 'Private reflection', exact: true });
  const note = editor.getByLabel('Your reflection', { exact: true });
  await expect(editor.getByText(/Local drafts are not encrypted/)).toBeVisible();
  await note.fill(NOTE);
  await editor.getByLabel('Mood tag (optional)', { exact: true }).fill('शांत');
  await editor.getByRole('button', { name: 'Add mood', exact: true }).click();
  // Deliberately no Save click: this exercises the actual debounced autosave.
  await expectSaved(editor);
  const initial = await savedReflection(page, session.id);
  expect(initial).toMatchObject({ sessionId: session.id, text: NOTE, moods: ['शांत'] });
  expect(initial.revision).toBeGreaterThan(0);
  await page.reload();
  await expect(note).toHaveValue(NOTE);
  await expect(editor.getByRole('list', { name: 'Selected moods' })).toContainText('शांत');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);

  await page.getByRole('link', { name: 'Journal', exact: true }).click();
  await page.getByLabel('Reflection contains', { exact: true }).fill('quiet attention');
  const query = page.waitForRequest(
    (request) => request.url().endsWith('/api/journal/query') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const request = await query;
  expect(new URL(request.url()).search).toBe('');
  expect(request.postDataJSON()).toMatchObject({ text: 'quiet attention' });
  await expect(page.getByText(/Today I returned to quiet attention/)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByLabel('What did you notice?', { exact: true }).check();
  await page.getByRole('button', { name: 'Save prompt choices', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /^Prompt choices saved\.$/ }),
  ).toBeVisible();
  await page.goto(sessionPath);
  await expect(editor.getByRole('list', { name: 'Optional reflection prompts' })).toContainText(
    'What did you notice?',
  );

  // Copy authentication only. The second real browser context has its own IndexedDB.
  const secondContext = await browser.newContext({
    baseURL: process.env.UI_ORIGIN,
    storageState: await page.context().storageState(),
  });
  const evidence = resolve('docs/evidence/M3', process.env.UI_RUN_ID!, info.project.name);
  mkdirSync(evidence, { recursive: true });
  try {
    const secondPage = await reflectionPage(secondContext, sessionPath);
    const secondEditor = secondPage.getByRole('region', {
      name: 'Private reflection',
      exact: true,
    });
    await expect(secondEditor.getByText(/Local drafts are not encrypted/)).toBeVisible();
    const serverText = 'Synthetic second-device reflection. शांत।';
    const localText = '\n  Synthetic first-device reflection kept after review. ध्यान।\n';
    await secondEditor.getByLabel('Your reflection', { exact: true }).fill(serverText);
    await expectSaved(secondEditor);
    expect(await savedReflection(secondPage, session.id)).toMatchObject({
      text: serverText,
      moods: ['शांत'],
      revision: initial.revision + 1,
    });

    await note.fill(localText);
    const conflict = page
      .getByRole('alert')
      .filter({ hasText: 'This saved practice changed elsewhere' });
    await expect(conflict).toBeVisible();
    await expect(
      conflict.getByRole('region', { name: 'Your unsynced version', exact: true }),
    ).toContainText(localText.trim());
    await expect(
      conflict.getByRole('region', { name: 'Current saved version', exact: true }),
    ).toContainText(serverText);
    await expect(
      conflict.getByRole('list', { name: 'Changes in order', exact: true }).locator(':scope > li'),
    ).toHaveCount(1);
    await expect(note).toHaveValue(localText);
    await expect(secondEditor.getByLabel('Your reflection', { exact: true })).toHaveValue(
      serverText,
    );
    await page.screenshot({
      path: resolve(evidence, 'journal-unified-conflict.png'),
      fullPage: true,
    });

    // The other device independently saves the same text while the comparison is open.
    // Refresh and keep must handle the real API's NO_CHANGE without creating another revision.
    await secondEditor.getByLabel('Your reflection', { exact: true }).fill(localText);
    await expectSaved(secondEditor);
    const current = await savedReflection(secondPage, session.id);
    expect(current).toMatchObject({
      text: localText,
      moods: ['शांत'],
      revision: initial.revision + 2,
    });
    await conflict.getByRole('button', { name: 'Refresh saved version', exact: true }).click();
    await expect(
      conflict.getByRole('region', { name: 'Current saved version', exact: true }),
    ).toContainText(localText.trim());
    await conflict.getByRole('button', { name: 'Keep my reviewed version', exact: true }).click();
    await expect(conflict).toHaveCount(0);
    await expectSaved(editor);
    expect(await savedReflection(page, session.id)).toEqual(current);
    await page.reload();
    await expect(note).toHaveValue(localText);
    await secondPage.reload();
    await expect(secondEditor.getByLabel('Your reflection', { exact: true })).toHaveValue(
      localText,
    );

    const oversized = '🙏'.repeat(20_001);
    await note.fill(oversized);
    await expect(editor.getByRole('status')).toHaveText('Use no more than 20,000 characters.');
    await expect(
      editor.getByRole('button', { name: 'Save reflection', exact: true }),
    ).toBeDisabled();
    await expect(note).toHaveValue(oversized);
    expect(await savedReflection(page, session.id)).toEqual(current);
  } finally {
    await secondContext.close();
  }
  await page.getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your private journal', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Synthetic first-device reflection kept after review/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: resolve(evidence, 'journal-saved.png'), fullPage: true });
});
