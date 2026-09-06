import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

import type {
  JourneyDraft,
  JourneyDraftPreview,
  JourneyView,
  MutationEnvelope,
  ReminderPreferences,
} from '../../src/domain/contracts';
import type { ReminderPreferenceView } from '../../src/domain/reminder-contracts';
import { capturedSignIn } from './helpers/sign-in';
import { setUiClock } from './helpers/clock';
import { expect, test } from './test';

const DEFAULT_CLOCK = '2026-09-05T00:45:00Z';
const PREVIEW_CLOCK = '2026-09-05T16:00:00Z'; // 21:30 in the journey's saved timezone.
const INITIAL: ReminderPreferences = {
  enabled: false,
  offsets: [],
  quietHours: null,
  detailed: false,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headers() {
  return { Origin: process.env.UI_ORIGIN!, 'Content-Type': 'application/json' };
}

async function createJourney(request: APIRequestContext): Promise<JourneyView> {
  const draft: JourneyDraft = {
    title: 'Synthetic midnight practice',
    intention: 'Choose personal reminder times and preserve privacy.',
    practices: [
      { id: randomUUID(), label: 'Quiet attention', order: 0, kind: 'checkbox', target: null },
    ],
    schedule: {
      startDate: '2026-09-06',
      durationMode: 'occurrences',
      durationValue: 2,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: '00:00',
      timeZone: 'Asia/Kolkata',
      attribution: 'civil',
      windowMinutes: 60,
    },
    reminders: INITIAL,
  };
  const createdResponse = await request.post('/api/journeys', {
    headers: { ...headers(), 'Idempotency-Key': randomUUID() },
    data: draft,
  });
  expect(createdResponse.status()).toBe(200);
  const created = (await createdResponse.json()) as JourneyDraftPreview;
  const activated = await request.post(`/api/journeys/${created.journey.id}/activate`, {
    headers: headers(),
    data: {
      operationId: randomUUID(),
      baseRevision: created.journey.revision,
      payload: { fingerprint: created.fingerprint },
    },
  });
  expect(activated.status()).toBe(200);
  return activated.json() as Promise<JourneyView>;
}

function preferencePath(id: string) {
  return `/api/journeys/${id}/reminders`;
}

function form(page: Page) {
  return page.getByRole('form', { name: 'Reminder preferences', exact: true });
}

function offset(page: Page, index = 1) {
  return form(page).getByRole('textbox', {
    name: `Reminder ${index}: minutes before practice`,
    exact: true,
  });
}

function saveButton(page: Page) {
  return form(page).getByRole('button', { name: 'Save reminder preferences', exact: true });
}

async function readSaved(page: Page, id: string): Promise<ReminderPreferenceView> {
  const response = await page.request.get(preferencePath(id));
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return response.json() as Promise<ReminderPreferenceView>;
}

function observeSaves(page: Page, id: string) {
  const attempts: MutationEnvelope<ReminderPreferences>[] = [];
  // Observation only: every save and conflict reaches the actual authenticated endpoint.
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === preferencePath(id))
      attempts.push(request.postDataJSON() as MutationEnvelope<ReminderPreferences>);
  });
  return attempts;
}

async function submit(page: Page, id: string, expectedStatus = 200) {
  const response = page.waitForResponse(
    (result) =>
      result.request().method() === 'PUT' && new URL(result.url()).pathname === preferencePath(id),
  );
  await saveButton(page).click();
  const result = await response;
  expect(result.status()).toBe(expectedStatus);
  if (expectedStatus === 200) {
    await expect(form(page).getByRole('status')).toHaveText('Reminder preferences saved.');
    await expect(saveButton(page)).toBeDisabled();
  }
  return result;
}

async function openPreferences(page: Page, id: string) {
  await page.goto(`/journeys/${id}/reminders`);
  await expect(form(page)).toBeVisible();
  await expect(
    form(page).getByRole('checkbox', { name: 'Enable reminders', exact: true }),
  ).toBeEnabled();
}

async function enableOne(page: Page, minutes: string) {
  await form(page).getByRole('checkbox', { name: 'Enable reminders', exact: true }).check();
  await form(page).getByRole('button', { name: 'Add reminder time', exact: true }).click();
  await offset(page).fill(minutes);
}

async function retainScreenshot(page: Page, info: TestInfo, name: string) {
  const directory = resolve('docs/evidence/M4', process.env.UI_RUN_ID!, info.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, name), fullPage: true });
}

async function expectValidation(page: Page, message: string) {
  await saveButton(page).click();
  const alert = form(page).getByRole('alert');
  await expect(alert).toContainText('Please check your reminder choices.');
  await expect(alert).toContainText(message);
  await expect(alert).toBeFocused();
}

test.describe('Real reminder preference persistence and concurrency', () => {
  test.beforeEach(() => setUiClock(PREVIEW_CLOCK));
  test.afterEach(() => setUiClock(DEFAULT_CLOCK));

  test('@M4 @M4-preferences @M4-reminders explicit midnight choices persist with quiet hours and mobile preview', async ({
    page,
  }, info) => {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    const journey = await createJourney(page.request);
    const id = journey.journey.id;
    const initial = await readSaved(page, id);
    expect(initial).toMatchObject({ preferences: INITIAL, activeDeviceCount: 0, simulated: true });
    const attempts = observeSaves(page, id);

    await page.goto(`/journeys/${id}`);
    await page.getByRole('link', { name: 'Reminders', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/journeys/${id}/reminders$`));
    await expect(
      form(page).getByRole('checkbox', { name: 'Enable reminders', exact: true }),
    ).not.toBeChecked();
    await expect(
      form(page).getByRole('checkbox', {
        name: 'Include practice details in notifications',
        exact: true,
      }),
    ).not.toBeChecked();
    await expect(form(page).getByRole('textbox', { name: /minutes before practice/ })).toHaveCount(
      0,
    );
    await expect(saveButton(page)).toBeDisabled();
    await expect(form(page).getByRole('status')).toHaveText(
      'These choices match the saved settings.',
    );
    const preview = page.getByRole('region', { name: 'Saved reminder preview', exact: true });
    await expect(preview).toContainText('Reminders are disabled in your saved settings.');
    await expect(preview).toContainText(
      'No registered devices. No device can receive these reminders.',
    );
    await expect(preview).toContainText(
      'Local demo: reminder delivery is simulated. No real device notification is sent.',
    );

    await enableOne(page, '120');
    for (const [index, value] of ['30', '5', '0'].entries()) {
      await form(page).getByRole('button', { name: 'Add reminder time', exact: true }).click();
      await offset(page, index + 2).fill(value);
    }
    await form(page).getByRole('checkbox', { name: 'Use quiet hours', exact: true }).check();
    await form(page)
      .getByRole('textbox', { name: 'Quiet hours start (HH:mm)', exact: true })
      .fill('23:50');
    await form(page)
      .getByRole('textbox', { name: 'Quiet hours end (HH:mm)', exact: true })
      .fill('00:10');
    await form(page)
      .getByRole('checkbox', { name: 'Include practice details in notifications', exact: true })
      .check();
    await expect(preview).toContainText('Reminders are disabled in your saved settings.');
    await expect(form(page).getByRole('status')).toHaveText(
      'Unsaved choices. The preview still shows saved settings.',
    );
    const expected: ReminderPreferences = {
      enabled: true,
      offsets: [-120, -30, -5, 0],
      quietHours: { start: '23:50', end: '00:10' },
      detailed: true,
    };
    const response = await submit(page, id);
    expect(await response.json()).toMatchObject({
      revision: initial.revision + 1,
      preferences: expected,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toEqual({
      operationId: expect.stringMatching(UUID),
      baseRevision: initial.revision,
      payload: expected,
    });
    const saved = await readSaved(page, id);
    expect(saved).toMatchObject({
      revision: initial.revision + 1,
      preferences: expected,
      activeDeviceCount: 0,
      simulated: true,
    });

    const expectedTimes = [
      {
        offset: -120,
        instant: '2026-09-05T16:30:00.000Z',
        date: 'September 5, 2026',
        time: '22:00:00',
        reason: null,
      },
      {
        offset: -30,
        instant: '2026-09-05T18:00:00.000Z',
        date: 'September 5, 2026',
        time: '23:30:00',
        reason: null,
      },
      {
        offset: -5,
        instant: '2026-09-05T18:25:00.000Z',
        date: 'September 5, 2026',
        time: '23:55:00',
        reason: 'quiet_hours',
      },
      {
        offset: 0,
        instant: '2026-09-05T18:30:00.000Z',
        date: 'September 6, 2026',
        time: '00:00:00',
        reason: 'quiet_hours',
      },
    ];
    for (const expectedTime of expectedTimes) {
      const item = saved.preview.find(
        (value) =>
          value.sessionId === journey.sessions[0]!.id &&
          value.offsetMinutes === expectedTime.offset,
      );
      expect(item).toBeDefined();
      expect(item!.practiceDate).toBe('2026-09-06');
      expect(item!.timeZone).toBe('Asia/Kolkata');
      expect(new Date(item!.scheduledAt).toISOString()).toBe(expectedTime.instant);
      expect(Date.parse(item!.expiresAt) - Date.parse(item!.scheduledAt)).toBe(5 * 60_000);
      expect(item!.suppressionReason).toBe(expectedTime.reason);
      const description = `${expectedTime.offset === 0 ? 'At practice time' : `${-expectedTime.offset} minutes before practice`} · Asia/Kolkata`;
      const row = preview
        .getByRole('listitem')
        .filter({
          has: page.getByRole('heading', { name: 'Practice date 2026-09-06', exact: true }),
        })
        .filter({ has: page.getByText(description, { exact: true }) });
      const displayedTime = row.locator('time').first();
      await expect(displayedTime).toContainText(expectedTime.date);
      await expect(displayedTime).toContainText(expectedTime.time);
      await expect(displayedTime).toContainText('GMT+05:30');
      expect(new Date((await displayedTime.getAttribute('datetime'))!).toISOString()).toBe(
        expectedTime.instant,
      );
      await expect(row).toContainText(
        expectedTime.reason === 'quiet_hours'
          ? 'Suppressed by quiet hours. This reminder is not moved to another time.'
          : 'Planned time only: no device is registered.',
      );
    }
    // Replaying the actual captured envelope verifies the receipt without manufacturing a UI failure.
    const replay = await page.request.put(preferencePath(id), {
      headers: headers(),
      data: attempts[0],
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({
      revision: initial.revision + 1,
      preferences: expected,
    });
    await retainScreenshot(page, info, 'reminder-midnight-preview.png');
    await page.reload();
    await expect(offset(page, 1)).toHaveValue('120');
    await expect(offset(page, 4)).toHaveValue('0');
    await expect(
      form(page).getByRole('checkbox', { name: 'Enable reminders', exact: true }),
    ).toBeChecked();
    await expect(
      form(page).getByRole('checkbox', {
        name: 'Include practice details in notifications',
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      form(page).getByRole('textbox', { name: 'Quiet hours start (HH:mm)', exact: true }),
    ).toHaveValue('23:50');
    await expect(
      form(page).getByRole('textbox', { name: 'Quiet hours end (HH:mm)', exact: true }),
    ).toHaveValue('00:10');
    await expect(saveButton(page)).toBeDisabled();
    expect((await readSaved(page, id)).revision).toBe(initial.revision + 1);

    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    for (const control of [
      saveButton(page),
      form(page).getByRole('button', { name: 'Add reminder time', exact: true }),
    ]) {
      const bounds = await control.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await retainScreenshot(page, info, 'reminder-midnight-mobile.png');
  });

  test('@M4 @M4-preferences @M4-reminders invalid raw input stays editable and never mutates saved preferences', async ({
    page,
  }, info) => {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    const journey = await createJourney(page.request);
    const id = journey.journey.id;
    const initial = await readSaved(page, id);
    await openPreferences(page, id);
    const attempts = observeSaves(page, id);
    const enabled = form(page).getByRole('checkbox', { name: 'Enable reminders', exact: true });
    await enabled.focus();
    await page.keyboard.press('Space');
    await expect(enabled).toBeChecked();
    await expectValidation(page, 'Add at least one reminder time before enabling reminders.');
    await form(page).getByRole('button', { name: 'Add reminder time', exact: true }).click();
    await offset(page).pressSequentially('1e-');
    await expectValidation(page, 'Reminder 1: enter a whole number from 0 to 1440 minutes.');
    await expect(offset(page)).toHaveValue('1e-');
    await expect(offset(page)).toHaveAttribute('aria-invalid', 'true');
    await offset(page).fill('1441');
    await enabled.uncheck();
    await expectValidation(page, 'Reminder 1: enter a whole number from 0 to 1440 minutes.');
    await expect(offset(page)).toHaveValue('1441');
    await enabled.check();
    await offset(page).fill('15');
    await expect(
      form(page).getByRole('button', { name: 'Add 15-minute reminder', exact: true }),
    ).toBeDisabled();
    await form(page).getByRole('button', { name: 'Add reminder time', exact: true }).click();
    await offset(page, 2).fill('15');
    await expectValidation(page, 'Choose a different time for each reminder.');
    await expect(offset(page, 2)).toHaveValue('15');
    await form(page).getByRole('button', { name: 'Remove reminder 2', exact: true }).click();
    await offset(page).fill('1440');
    await form(page).getByRole('checkbox', { name: 'Use quiet hours', exact: true }).check();
    const start = form(page).getByRole('textbox', {
      name: 'Quiet hours start (HH:mm)',
      exact: true,
    });
    const end = form(page).getByRole('textbox', { name: 'Quiet hours end (HH:mm)', exact: true });
    await expectValidation(page, 'Quiet hours start: use the 24-hour HH:mm format.');
    await start.fill('24:00');
    await end.fill('06:00');
    await expectValidation(page, 'Quiet hours start: use the 24-hour HH:mm format.');
    await expect(start).toHaveValue('24:00');
    await start.fill('06:00');
    await expectValidation(page, 'Quiet hours must start and end at different times.');
    expect(attempts).toHaveLength(0);
    expect(await readSaved(page, id)).toMatchObject({
      revision: initial.revision,
      preferences: INITIAL,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await retainScreenshot(page, info, 'reminder-validation-retained.png');

    await start.fill('23:00');
    await form(page).getByRole('button', { name: 'Add 15-minute reminder', exact: true }).click();
    await expect(offset(page, 2)).toHaveValue('15');
    for (let index = 3; index <= 8; index += 1) {
      await form(page).getByRole('button', { name: 'Add reminder time', exact: true }).click();
      await offset(page, index).fill(String(index));
    }
    await expect(form(page).getByRole('textbox', { name: /minutes before practice/ })).toHaveCount(
      8,
    );
    await expect(
      form(page).getByRole('button', { name: 'Add reminder time', exact: true }),
    ).toBeDisabled();
    await expect(
      form(page).getByRole('button', { name: 'Add 15-minute reminder', exact: true }),
    ).toBeDisabled();
    await submit(page, id);
    expect(attempts).toHaveLength(1);
    expect(await readSaved(page, id)).toMatchObject({
      revision: initial.revision + 1,
      preferences: {
        enabled: true,
        offsets: [-1440, -15, -3, -4, -5, -6, -7, -8],
        quietHours: { start: '23:00', end: '06:00' },
        detailed: false,
      },
    });
  });

  test('@M4 @M4-preferences @M4-reminders two contexts retain different choices until explicit conflict resolution', async ({
    page,
    browser,
  }, info) => {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    const journey = await createJourney(page.request);
    const id = journey.journey.id;
    const initial = await readSaved(page, id);
    const otherContext = await browser.newContext({
      baseURL: process.env.UI_ORIGIN,
      storageState: await page.context().storageState(),
    });
    try {
      const other = await otherContext.newPage();
      await openPreferences(page, id);
      await openPreferences(other, id);
      const attempts = observeSaves(page, id);
      const otherAttempts = observeSaves(other, id);
      await enableOne(page, '30');
      await enableOne(other, '15');
      await submit(other, id);
      const conflictResponse = await submit(page, id, 409);
      expect(await conflictResponse.json()).toMatchObject({
        error: {
          code: 'REVISION_CONFLICT',
          current: {
            revision: initial.revision + 1,
            preferences: { ...INITIAL, enabled: true, offsets: [-15] },
          },
        },
      });
      const comparison = form(page).getByRole('region', {
        name: 'Reminder settings conflict',
        exact: true,
      });
      await expect(comparison).toContainText('Minutes before practice: 15.');
      await expect(offset(page)).toHaveValue('30');
      await expect(saveButton(page)).toBeDisabled();
      await retainScreenshot(page, info, 'reminder-conflict-comparison.png');
      await comparison.getByRole('button', { name: 'Keep my choices', exact: true }).click();
      await expect(offset(page)).toHaveValue('30');
      await expect(saveButton(page)).toBeEnabled();
      expect((await readSaved(page, id)).preferences.offsets).toEqual([-15]);
      await submit(page, id);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.baseRevision).toBe(initial.revision);
      expect(attempts[1]).toMatchObject({
        operationId: expect.stringMatching(UUID),
        baseRevision: initial.revision + 1,
        payload: { ...INITIAL, enabled: true, offsets: [-30] },
      });
      expect(attempts[1]!.operationId).not.toBe(attempts[0]!.operationId);
      expect(await readSaved(page, id)).toMatchObject({
        revision: initial.revision + 2,
        preferences: { ...INITIAL, enabled: true, offsets: [-30] },
      });

      await offset(other).fill('5');
      const secondConflict = await submit(other, id, 409);
      expect(await secondConflict.json()).toMatchObject({
        error: {
          code: 'REVISION_CONFLICT',
          current: { revision: initial.revision + 2, preferences: { offsets: [-30] } },
        },
      });
      await expect(offset(other)).toHaveValue('5');
      const otherComparison = form(other).getByRole('region', {
        name: 'Reminder settings conflict',
        exact: true,
      });
      await expect(otherComparison).toContainText('Minutes before practice: 30.');
      await otherComparison
        .getByRole('button', { name: 'Use latest saved settings', exact: true })
        .click();
      await expect(offset(other)).toHaveValue('30');
      await expect(saveButton(other)).toBeDisabled();
      await expect(form(other).getByRole('status')).toHaveText(
        'Latest saved settings loaded. Your previous unsaved choices were discarded.',
      );
      expect(otherAttempts).toHaveLength(2);
      expect((await readSaved(other, id)).revision).toBe(initial.revision + 2);
      await other.reload();
      await expect(offset(other)).toHaveValue('30');
      await retainScreenshot(other, info, 'reminder-conflict-resolved.png');
    } finally {
      await otherContext.close();
    }
  });

  test('@M4 @M4-preferences @M4-reminders keeping identical remote choices needs no fake save or revision', async ({
    page,
    browser,
  }, info) => {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    const journey = await createJourney(page.request);
    const id = journey.journey.id;
    const initial = await readSaved(page, id);
    const otherContext = await browser.newContext({
      baseURL: process.env.UI_ORIGIN,
      storageState: await page.context().storageState(),
    });
    try {
      const other = await otherContext.newPage();
      await openPreferences(page, id);
      await openPreferences(other, id);
      const attempts = observeSaves(page, id);
      await enableOne(page, '10');
      await enableOne(other, '10');
      await submit(other, id);
      const conflict = await submit(page, id, 409);
      expect(await conflict.json()).toMatchObject({
        error: {
          code: 'REVISION_CONFLICT',
          current: {
            revision: initial.revision + 1,
            preferences: { ...INITIAL, enabled: true, offsets: [-10] },
          },
        },
      });
      const comparison = form(page).getByRole('region', {
        name: 'Reminder settings conflict',
        exact: true,
      });
      await expect(offset(page)).toHaveValue('10');
      await comparison.getByRole('button', { name: 'Keep my choices', exact: true }).click();
      await expect(comparison).toHaveCount(0);
      await expect(form(page).getByRole('status')).toHaveText(
        'These choices match the saved settings.',
      );
      await expect(saveButton(page)).toBeDisabled();
      expect(attempts).toHaveLength(1);
      expect(await readSaved(page, id)).toMatchObject({
        revision: initial.revision + 1,
        preferences: { ...INITIAL, enabled: true, offsets: [-10] },
      });
      await page.reload();
      await expect(offset(page)).toHaveValue('10');
      await expect(saveButton(page)).toBeDisabled();
      expect((await readSaved(page, id)).revision).toBe(initial.revision + 1);
      // The API independently rejects a new unchanged intent; the UI does not need to send it.
      const unchanged = await page.request.put(preferencePath(id), {
        headers: headers(),
        data: {
          operationId: randomUUID(),
          baseRevision: initial.revision + 1,
          payload: { ...INITIAL, enabled: true, offsets: [-10] },
        },
      });
      expect(unchanged.status()).toBe(409);
      expect(await unchanged.json()).toMatchObject({
        error: {
          code: 'NO_CHANGE',
          current: {
            revision: initial.revision + 1,
            preferences: { ...INITIAL, enabled: true, offsets: [-10] },
          },
        },
      });
      expect((await readSaved(page, id)).revision).toBe(initial.revision + 1);
      await retainScreenshot(page, info, 'reminder-conflict-already-matches.png');
    } finally {
      await otherContext.close();
    }
  });
});
