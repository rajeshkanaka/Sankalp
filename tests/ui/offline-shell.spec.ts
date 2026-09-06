import { expect, test } from '@playwright/test';

test('@M3 @M3-offline public shell caches only public assets and withholds unsaved private data', async ({
  page,
  context,
  request,
}) => {
  const manifestResponse = await request.get('/offline/asset-manifest.json');
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()['set-cookie']).toBeUndefined();
  const manifest = (await manifestResponse.json()) as { assets: Array<{ path: string }> };
  const publicPaths = manifest.assets.map(({ path }) => path).sort();
  expect(publicPaths.length).toBeGreaterThan(1);
  expect(publicPaths).toContain('/offline/index.html');
  const shell = await request.get('/offline/index.html');
  expect(shell.status()).toBe(200);
  expect(shell.headers()['set-cookie']).toBeUndefined();
  expect(shell.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(shell.headers()['content-security-policy']).not.toContain('unsafe-inline');
  expect(await shell.text()).not.toContain('ui-arun');
  const worker = await request.get('/sw.js');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['cache-control']).toContain('no-store');
  expect(worker.headers()['set-cookie']).toBeUndefined();

  await page.goto('/welcome');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  const cachedPaths = () =>
    page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith('sankalpa-public-'));
      return (
        await Promise.all(
          names.map(async (name) =>
            (await (await caches.open(name)).keys()).map((entry) => new URL(entry.url).pathname),
          ),
        )
      )
        .flat()
        .sort();
    });
  await expect.poll(cachedPaths).toEqual(publicPaths);
  const privateRead = await page.request.get('/api/auth/session');
  expect(privateRead.status()).toBe(401);
  expect(privateRead.headers()['cache-control']).toContain('no-store');
  expect(await cachedPaths()).toEqual(publicPaths);

  await context.setOffline(true);
  await page.goto('/offline/saved');
  await expect(
    page.getByRole('heading', { name: 'Your private practice', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('No private session is available here.', { exact: false }),
  ).toBeVisible();
  expect(await cachedPaths()).toEqual(publicPaths);
  const privateFetch = await page.evaluate(async () => {
    try {
      await fetch('/api/auth/session');
      return 'unexpected_response';
    } catch {
      return 'network_unavailable';
    }
  });
  expect(privateFetch).toBe('network_unavailable');
  const rscFetch = await page.evaluate(async () => {
    try {
      await fetch('/today', { headers: { RSC: '1' } });
      return 'unexpected_response';
    } catch {
      return 'network_unavailable';
    }
  });
  expect(rscFetch).toBe('network_unavailable');
  await context.setOffline(false);
});
