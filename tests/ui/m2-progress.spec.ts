import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './test';
import type { JourneyDraft, JourneyView, SessionRecord } from '../../src/domain/contracts';
import { setUiClock } from './helpers/clock';
import { capturedSignIn } from './helpers/sign-in';

const M1_NOW = '2026-09-05T00:45:00Z';
const M2_NOW = '2026-09-11T22:31:00Z';

async function mutation<T>(
  page: Page,
  path: string,
  method: 'POST' | 'PUT',
  data: unknown,
): Promise<T> {
  const response = await page.request.fetch(path, {
    method,
    data,
    headers: {
      Origin: process.env.UI_ORIGIN!,
      ...(path === '/api/journeys' ? { 'Idempotency-Key': randomUUID() } : {}),
    },
  });
  expect(response.status(), `Synthetic progress mutation ${method} ${path.split('/').at(-1)}`).toBe(
    200,
  );
  return response.json() as Promise<T>;
}

async function createJourney(page: Page, title: string, attribution: 'civil' | 'previous_evening') {
  const draft: JourneyDraft = {
    title,
    intention: 'Synthetic progress verification.',
    practices: ['Puja', 'Quiet practice'].map((label, order) => ({
      id: randomUUID(),
      label,
      order,
      kind: 'checkbox',
      target: null,
    })),
    schedule: {
      startDate: '2026-09-05',
      durationMode: 'occurrences',
      durationValue: 21,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      localTime: attribution === 'previous_evening' ? '00:00' : '06:00',
      timeZone: 'Asia/Kolkata',
      attribution,
      windowMinutes: 240,
    },
    reminders: { enabled: false, offsets: [], quietHours: null, detailed: false },
  };
  const created = await mutation<{
    journey: { id: string; revision: number };
    fingerprint: string;
  }>(page, '/api/journeys', 'POST', draft);
  return mutation<JourneyView>(page, `/api/journeys/${created.journey.id}/activate`, 'POST', {
    operationId: randomUUID(),
    baseRevision: created.journey.revision,
    payload: { fingerprint: created.fingerprint },
  });
}

test.use({ timezoneId: 'America/New_York' });

test('@M2 @M2-progress calendar preserves overnight dates and shared totals, filters journeys, and persists streak choice', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  try {
    await capturedSignIn(
      page,
      info.project.name === 'chromium' ? 'ui-maya@example.test' : 'ui-arun@example.test',
    );
    setUiClock('2026-09-05T15:30:00Z');
    const overnight = await createJourney(
      page,
      `Calendar overnight ${info.project.name}`,
      'previous_evening',
    );
    for (const [index, session] of overnight.sessions.slice(0, 7).entries()) {
      const performedAt = new Date(Date.parse(session.opensAt) + 15 * 60_000).toISOString();
      setUiClock(performedAt);
      const saved = await mutation<{ session: SessionRecord }>(
        page,
        `/api/sessions/${session.id}/practices`,
        'PUT',
        {
          operationId: randomUUID(),
          baseRevision: session.revision,
          payload: {
            values: Object.fromEntries(session.practices.map((practice) => [practice.id, true])),
          },
        },
      );
      await mutation(page, `/api/sessions/${session.id}/completion`, 'POST', {
        operationId: randomUUID(),
        baseRevision: saved.session.revision,
        payload: { performedAt },
      });
      if (index === 0) {
        await page.goto(`/calendar?month=2026-09&journey=${overnight.journey.id}&mode=grid`);
        const firstCell = page.locator('td[data-date="2026-09-05"]');
        const secondCell = page.locator('td[data-date="2026-09-06"]');
        await expect(
          firstCell.getByRole('link', { name: /Calendar overnight.*Complete/ }),
        ).toHaveCount(1);
        await expect(
          secondCell.getByRole('link', { name: /Calendar overnight.*Upcoming/ }),
        ).toHaveCount(1);
        await expect(
          page
            .getByRole('region', { name: 'Selected sessions' })
            .getByText(/On this device:/)
            .first(),
        ).toBeVisible();
      }
    }
    setUiClock(M2_NOW);
    await page.goto(`/today?journey=${overnight.journey.id}`);
    await expect(
      page.getByRole('img', { name: '7 of 21 sessions completed, 33% complete', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('14 upcoming', { exact: true })).toBeVisible();
    await expect(page.getByText('Current streak', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Hide streaks', exact: true }).check();
    await expect(page.getByText('Current streak', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'Hide streaks', exact: true })).toBeChecked();
    await expect(page.getByText('Longest streak', { exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Hide streaks', exact: true }).uncheck();
    await expect(page.getByText('Current streak', { exact: true })).toBeVisible();
    await page.goto(`/journeys/${overnight.journey.id}`);
    await expect(
      page.getByRole('img', { name: '7 of 21 sessions completed, 33% complete', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Nights are shown on the date the evening begins/)).toBeVisible();
    await page.goto(`/calendar?month=2026-09&journey=${overnight.journey.id}&mode=grid`);
    await expect(
      page.getByText('7 of 21 sessions completed · 33% complete', { exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const evidence = resolve('docs/evidence/M2', process.env.UI_RUN_ID!, info.project.name);
    mkdirSync(evidence, { recursive: true });
    if (process.env.SANKALPA_MILESTONE_EVIDENCE === '1')
      await page.screenshot({ path: resolve(evidence, 'calendar-33-percent.png'), fullPage: true });

    const civil = await createJourney(page, `Calendar civil ${info.project.name}`, 'civil');
    await page.goto('/calendar?month=2026-09&mode=grid&date=2026-09-05');
    const selected = page.getByRole('region', { name: 'Selected sessions' });
    await expect(
      selected.getByRole('link').filter({ hasText: overnight.journey.title }),
    ).toHaveCount(1);
    await expect(selected.getByRole('link').filter({ hasText: civil.journey.title })).toHaveCount(
      1,
    );
    await page.getByLabel('Journey', { exact: true }).selectOption(civil.journey.id);
    await page.getByRole('radio', { name: 'Session list', exact: true }).check();
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Selected sessions' }).getByRole('link'),
    ).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Selected sessions' })).toContainText(
      civil.journey.title,
    );
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (process.env.SANKALPA_MILESTONE_EVIDENCE === '1')
      await page.screenshot({
        path: resolve(evidence, 'calendar-session-list-mobile.png'),
        fullPage: true,
      });
    await page.getByRole('link', { name: 'Next month', exact: true }).click();
    await expect(page).toHaveURL(/month=2026-10/);
    await expect(
      page.getByText('No sessions are scheduled for this selection.', { exact: true }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    setUiClock(M1_NOW);
  }
});
