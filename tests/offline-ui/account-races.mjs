/* global window */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Real React/IndexedDB; identity, public-shell readiness and logout callbacks are simulated gates.
export async function runAccountRaces(browser, url, errors, passed) {
  async function scenario(query, run) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${url}/?${query}`);
      await run(page);
    } finally {
      await context.close();
    }
  }
  for (const verification of [true, false]) {
    await scenario('holdVerify', async (page) => {
      await expect
        .poll(() => page.evaluate(() => window.offlineUiHarness.verificationCalls()))
        .toBeGreaterThan(0);
      await page.evaluate(async (verified) => {
        const h = window.offlineUiHarness;
        const scope = await h.core.bindAccount(h.other);
        await h.core.saveSnapshot(scope, {
          ...h.snapshot,
          journeyTitle: 'Synthetic other-account saved practice',
        });
        h.releaseVerification(verified);
      }, verification);
      await expect(
        page.getByRole('heading', { name: 'Verify your account to continue', exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Your reflection', { exact: true })).toHaveCount(0);
      const retained = await page.evaluate(async () => {
        const h = window.offlineUiHarness;
        const device = await h.core.getDeviceState();
        const view = await h.core.read(device.scope, h.snapshot.session.id);
        return {
          account: device.scope.accountId,
          title: view.snapshot.journeyTitle,
          expected: h.other,
        };
      });
      assert.equal(retained.account, retained.expected);
      assert.equal(retained.title, 'Synthetic other-account saved practice');
    });
    passed(
      verification ? 'verified-response-binding-CAS-race' : 'stale-account-verification-denial',
    );
  }
  for (const action of ['switch', 'clear']) {
    await scenario('holdReady', async (page) => {
      await expect
        .poll(() => page.evaluate(() => window.offlineUiHarness.readinessCalls()))
        .toBeGreaterThan(0);
      await page.evaluate(async (action) => {
        const h = window.offlineUiHarness;
        if (action === 'switch') {
          const scope = await h.core.bindAccount(h.other);
          await h.core.saveSnapshot(scope, {
            ...h.snapshot,
            journeyTitle: 'Synthetic readiness-race saved practice',
          });
        } else {
          const device = await h.core.getDeviceState();
          await h.core.clearAccount(device.scope, 'synced');
        }
        h.releaseReadiness(true);
      }, action);
      await expect(
        page.getByRole('heading', { name: 'Verify your account to continue', exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Your reflection', { exact: true })).toHaveCount(0);
      const state = await page.evaluate(async () => {
        const h = window.offlineUiHarness;
        const device = await h.core.getDeviceState();
        return { account: device.scope?.accountId ?? null, other: h.other };
      });
      assert.equal(state.account, action === 'switch' ? state.other : null);
    });
    passed(
      action === 'switch' ? 'readiness-account-change-race' : 'readiness-clear-does-not-resurrect',
    );
  }
  await scenario('denyReads&holdVerify', async (page) => {
    await expect
      .poll(() => page.evaluate(() => window.offlineUiHarness.verificationCalls()))
      .toBeGreaterThan(0);
    await page.evaluate(() => window.offlineUiHarness.releaseVerification(false));
    await expect(
      page.getByRole('heading', { name: 'Verify your account to continue', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Synthetic online input', { exact: true })).toHaveCount(0);
  });
  passed('storage-failure-still-requires-identity');
  await scenario('denyReads', async (page) => {
    await expect(page.getByText('Offline state: online_only', { exact: true })).toBeVisible();
    await page
      .getByLabel('Synthetic online input', { exact: true })
      .fill('Synthetic original-account online input');
    await page.evaluate(() => {
      window.offlineUiHarness.verification(false);
      window.dispatchEvent(new window.Event('focus'));
    });
    await expect(
      page.getByRole('heading', { name: 'Verify your account to continue', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Synthetic online input', { exact: true })).toHaveCount(0);
  });
  passed('scope-less-online-mode-rechecks-identity');
  await scenario('noNetwork', async (page) => {
    await expect(
      page.getByRole('heading', { name: 'Verify your account to continue', exact: true }),
    ).toBeVisible();
    assert.equal(await page.evaluate(() => window.offlineUiHarness.offlineVerificationCalls()), 0);
    assert.equal(
      await page.evaluate(
        async () => (await window.offlineUiHarness.core.getDeviceState()).managementScope,
      ),
      null,
    );
  });
  passed('initial-private-bind-requires-live-verification');
  await scenario('', async (page) => {
    await expect(page.getByLabel('Your reflection', { exact: true })).toBeEnabled();
    await page.route('**/api/**', (route) => route.abort());
    await page
      .getByLabel('Your reflection', { exact: true })
      .fill('Synthetic offline input survives returning to tab');
    await expect(
      page.getByRole('region', { name: 'Private reflection' }).getByRole('status'),
    ).toContainText('Saved on this device');
    await page.evaluate(() => {
      const h = window.offlineUiHarness;
      h.networkAvailable(false);
      window.dispatchEvent(new window.Event('focus'));
    });
    await expect(page.getByLabel('Your reflection', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Your reflection', { exact: true })).toHaveValue(
      'Synthetic offline input survives returning to tab',
    );
    await expect
      .poll(() => page.evaluate(() => window.offlineUiHarness.offlineVerificationCalls()))
      .toBeGreaterThan(0);
  });
  passed('verified-local-offline-focus-preserves-input');
  await scenario('', async (page) => {
    const note = page.getByLabel('Your reflection', { exact: true });
    await expect(note).toBeEnabled();
    await page.evaluate(() => window.offlineUiHarness.denyDrafts(true));
    await note.fill('Synthetic unsaved input retained while identity is unavailable');
    await expect(
      page.getByRole('heading', { name: 'Your draft has not been saved', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.offlineUiHarness.verification('unavailable');
      window.dispatchEvent(new window.Event('focus'));
    });
    await expect(
      page.getByRole('heading', { name: 'Verify local storage to continue', exact: true }),
    ).toBeVisible();
    await expect(note).toBeHidden();
    await expect(note).toHaveValue(
      'Synthetic unsaved input retained while identity is unavailable',
    );
    await page.evaluate(async () => {
      const h = window.offlineUiHarness;
      const device = await h.core.getDeviceState();
      await h.core.saveSnapshot(device.scope, h.snapshot);
    });
    await expect(note).toBeHidden();
    await page.evaluate(() => window.offlineUiHarness.verification('verified'));
    await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
    await expect(note).toBeVisible();
    await expect(note).toHaveValue(
      'Synthetic unsaved input retained while identity is unavailable',
    );
  });
  passed('unavailable-identity-preserves-only-in-memory-input');
  for (const recovery of ['verified', 'signed_out']) {
    await scenario('', async (page) => {
      await expect(page.getByLabel('Your reflection', { exact: true })).toBeEnabled();
      await page.evaluate(async () => {
        const h = window.offlineUiHarness;
        await window.fetch('/synthetic/reset', {
          method: 'POST',
          body: JSON.stringify(h.snapshot.session),
        });
      });
      await page
        .getByLabel('Your reflection', { exact: true })
        .fill('Synthetic saved note before logout');
      await expect(
        page.getByRole('region', { name: 'Private reflection' }).getByRole('status'),
      ).toHaveText('Saved.');
      await page.evaluate(() => {
        const h = window.offlineUiHarness;
        h.failSignOut(true);
        h.holdSignOut();
      });
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Finishing sign out…', exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Your reflection', { exact: true })).toHaveCount(0);
      assert.deepEqual(
        await page.evaluate(async () => {
          const h = window.offlineUiHarness;
          const device = await h.core.getDeviceState();
          return [
            device.managementScope,
            device.pendingOperations,
            device.pendingDrafts,
            h.signOutCalls(),
          ];
        }),
        [null, 0, 0, 1],
      );
      await page.evaluate(() => window.offlineUiHarness.releaseSignOut());
      await expect(
        page.getByRole('heading', { name: 'Sign-out did not finish', exact: true }),
      ).toBeVisible();
      await expect(page).not.toHaveTitle('Synthetic signed out');
      await page.evaluate((recovery) => {
        window.offlineUiHarness.failSignOut(false);
        window.offlineUiHarness.verification(recovery);
      }, recovery);
      await page.getByRole('button', { name: 'Retry sign out', exact: true }).click();
      if (recovery === 'verified') await expect(page).toHaveTitle('Synthetic signed out');
      await expect(page.getByRole('heading', { name: 'Signed out', exact: true })).toBeVisible();
      await expect(page.getByLabel('Your reflection', { exact: true })).toHaveCount(0);
      assert.deepEqual(
        await page.evaluate(async () => {
          const h = window.offlineUiHarness;
          return [(await h.core.getDeviceState()).managementScope, h.signOutCalls()];
        }),
        [null, recovery === 'verified' ? 2 : 1],
      );
    });
    passed(
      recovery === 'verified'
        ? 'logout-failure-retains-retry-after-local-purge'
        : 'authoritative-signed-out-retry-needs-no-post',
    );
  }
}
