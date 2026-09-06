/// <reference lib="webworker" />
import {
  allowsOfflineNavigation,
  isPublicAssetResponse,
  publicAssetFor,
  type PublicAsset,
} from './policy';

declare const __PUBLIC_ASSETS__: PublicAsset[];
declare const __PUBLIC_VERSION__: string;

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const origin = worker.location.origin;
const cachePrefix = 'sankalpa-public-';
const cacheName = cachePrefix + __PUBLIC_VERSION__;
const shellPath = '/offline/index.html';

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const entries = await Promise.all(
        __PUBLIC_ASSETS__.map(async (asset) => {
          const response = await fetch(asset.path, {
            credentials: 'omit',
            cache: 'reload',
            redirect: 'error',
          });
          if (!isPublicAssetResponse(response, asset, origin))
            throw new Error('Public shell asset unavailable.');
          return { asset, response };
        }),
      );
      const cache = await caches.open(cacheName);
      await Promise.all(entries.map(({ asset, response }) => cache.put(asset.path, response)));
    })(),
  );
  // Updates wait for old clients to close; pending user work is never interrupted.
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
          .map((name) => caches.delete(name)),
      );
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('message', (event) => {
  if (event.data?.type !== 'PUBLIC_CACHE_READY' || !event.ports[0]) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      const entries = await Promise.all(__PUBLIC_ASSETS__.map((asset) => cache.match(asset.path)));
      event.ports[0].postMessage({
        type: 'PUBLIC_CACHE_READY',
        ready: entries.every(Boolean),
        version: __PUBLIC_VERSION__,
      });
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('rsc')) return;
  const asset = publicAssetFor(request.url, origin, __PUBLIC_ASSETS__);
  if (asset) {
    event.respondWith(
      (async () => {
        const cached = await (await caches.open(cacheName)).match(asset.path);
        if (cached) return cached;
        const response = await fetch(asset.path, {
          credentials: 'omit',
          cache: 'reload',
          redirect: 'error',
        });
        return isPublicAssetResponse(response, asset, origin) ? response : Response.error();
      })(),
    );
    return;
  }
  if (request.mode !== 'navigate' || !allowsOfflineNavigation(request.url, origin)) return;
  event.respondWith(
    (async () => {
      try {
        // Private responses, including online errors, are never saved or masked.
        return await fetch(request);
      } catch {
        const shell = await (await caches.open(cacheName)).match(shellPath);
        return shell ?? Response.error();
      }
    })(),
  );
});
