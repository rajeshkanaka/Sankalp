import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Page, Request, Response } from '@playwright/test';

declare global {
  interface Window {
    __recordPublicWorkerDiagnostic?(event: unknown): Promise<void>;
  }
}

const MAX_EVENTS = 200;
const KINDS = new Set([
  'document',
  'register_called',
  'register_resolved',
  'register_rejected',
  'registration_seen',
  'update_found',
  'worker_observed',
  'worker_state',
  'controller_changed',
  'inspection_rejected',
]);
const STATES = new Set(['none', 'installing', 'installed', 'activating', 'activated', 'redundant']);
const ERRORS = new Set([
  'Error',
  'TypeError',
  'AbortError',
  'InvalidStateError',
  'NetworkError',
  'NotSupportedError',
  'SecurityError',
  'TimeoutError',
  'UnknownError',
]);

type Event = {
  elapsedMs: number;
  kind: string;
  resource?: string;
  state?: string;
  errorName?: string;
  status?: number;
};

/** Observe the real application lifecycle; never register, reload or repair it from the test. */
export async function observePublicServiceWorker(page: Page) {
  const origin = new URL(process.env.UI_ORIGIN!).origin;
  const started = Date.now();
  const events: Event[] = [];
  let truncated = false;
  let observing = true;
  const record = (event: Omit<Event, 'elapsedMs'>) => {
    if (!observing) return;
    if (events.length === MAX_EVENTS) {
      truncated = true;
      return;
    }
    events.push({ elapsedMs: Date.now() - started, ...event });
  };
  const resource = (raw: string) => {
    try {
      const url = new URL(raw);
      if (url.origin !== origin) return null;
      if (url.pathname === '/sw.js') return 'worker';
      if (url.pathname === '/offline/index.html') return 'shell';
      if (url.pathname === '/offline/asset-manifest.json') return 'manifest';
      if (url.pathname.startsWith('/offline/')) return 'public_asset';
    } catch {
      // Neither raw input nor parsing errors are retained.
    }
    return null;
  };
  const onResponse = (response: Response) => {
    const category = resource(response.url());
    if (category) record({ kind: 'response', resource: category, status: response.status() });
  };
  const onFailure = (request: Request) => {
    const category = resource(request.url());
    if (!category) return;
    const failure = request.failure()?.errorText ?? '';
    record({
      kind: 'request_failed',
      resource: category,
      errorName: /^(?:net::ERR_[A-Z_]+|NS_ERROR_[A-Z_]+)$/.test(failure) ? failure : 'OtherError',
    });
  };
  const context = page.context();
  context.on('response', onResponse);
  context.on('requestfailed', onFailure);
  // The binding accepts only enumerated event/state/error names; no page-supplied
  // message, URL, payload, cookie or arbitrary string reaches the evidence file.
  await page.exposeFunction('__recordPublicWorkerDiagnostic', (value: unknown) => {
    if (!value || typeof value !== 'object' || !('kind' in value)) return;
    if (typeof value.kind !== 'string' || !KINDS.has(value.kind)) return;
    const event: Omit<Event, 'elapsedMs'> = { kind: value.kind };
    if ('state' in value && typeof value.state === 'string' && STATES.has(value.state))
      event.state = value.state;
    if ('errorName' in value && typeof value.errorName === 'string')
      event.errorName = ERRORS.has(value.errorName) ? value.errorName : 'OtherError';
    record(event);
  });
  await page.addInitScript(() => {
    const container = navigator.serviceWorker;
    if (!container) return;
    const emit = (event: { kind: string; state?: string; errorName?: string }) => {
      void window.__recordPublicWorkerDiagnostic?.(event).catch(() => undefined);
    };
    const errorName = (error: unknown) => (error instanceof Error ? error.name : 'OtherError');
    const workers = new WeakSet<ServiceWorker>();
    const registrations = new WeakSet<ServiceWorkerRegistration>();
    const observeWorker = (worker: ServiceWorker | null) => {
      if (!worker || workers.has(worker)) return;
      workers.add(worker);
      emit({ kind: 'worker_observed', state: worker.state });
      worker.addEventListener('statechange', () =>
        emit({ kind: 'worker_state', state: worker.state }),
      );
    };
    const observeRegistration = (registration: ServiceWorkerRegistration | undefined) => {
      if (!registration || registrations.has(registration)) return;
      registrations.add(registration);
      emit({ kind: 'registration_seen' });
      observeWorker(registration.installing);
      observeWorker(registration.waiting);
      observeWorker(registration.active);
      registration.addEventListener('updatefound', () => {
        emit({ kind: 'update_found' });
        observeWorker(registration.installing);
      });
    };
    emit({ kind: 'document', state: container.controller?.state ?? 'none' });
    observeWorker(container.controller);
    container.addEventListener('controllerchange', () => {
      emit({ kind: 'controller_changed', state: container.controller?.state ?? 'none' });
      observeWorker(container.controller);
    });
    void container
      .getRegistration()
      .then(observeRegistration, (error: unknown) =>
        emit({ kind: 'inspection_rejected', errorName: errorName(error) }),
      );
    // Registration failures are otherwise swallowed by the application's bounded
    // fallback. Forward the real receiver, arguments, result and rejection intact.
    const register = container.register;
    container.register = function (...args: Parameters<ServiceWorkerContainer['register']>) {
      emit({ kind: 'register_called' });
      try {
        return register.apply(this, args).then(
          (registration) => {
            emit({ kind: 'register_resolved' });
            observeRegistration(registration);
            return registration;
          },
          (error: unknown) => {
            emit({ kind: 'register_rejected', errorName: errorName(error) });
            throw error;
          },
        );
      } catch (error) {
        emit({ kind: 'register_rejected', errorName: errorName(error) });
        throw error;
      }
    };
  });

  return {
    async save(file: string) {
      let manifestAssetCount: number | null = null;
      try {
        const manifest = JSON.parse(
          await readFile(resolve('public/offline/asset-manifest.json'), 'utf8'),
        ) as { assets?: unknown };
        if (Array.isArray(manifest.assets)) manifestAssetCount = manifest.assets.length;
      } catch {
        // The locally built public manifest is optional diagnostic evidence.
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const snapshot = await Promise.race([
        page
          .evaluate(async () => {
            const container = navigator.serviceWorker;
            const registrations = container ? await container.getRegistrations() : [];
            const names = (await caches.keys()).filter((name) =>
              name.startsWith('sankalpa-public-'),
            );
            let entryCount = 0;
            let unexpectedEntryCount = 0;
            for (const name of names.slice(0, 8)) {
              const entries = await (await caches.open(name)).keys();
              entryCount += entries.length;
              for (const entry of entries) {
                const target = new URL(entry.url);
                if (
                  target.origin !== location.origin ||
                  target.search ||
                  target.hash ||
                  !(
                    target.pathname === '/offline/index.html' ||
                    target.pathname.startsWith('/offline/assets/')
                  )
                )
                  unexpectedEntryCount++;
              }
            }
            const controller = container?.controller;
            const readyProbe = !controller
              ? 'no_controller'
              : await new Promise<string>((done) => {
                  const channel = new MessageChannel();
                  const finish = (result: string) => {
                    clearTimeout(timeout);
                    channel.port1.close();
                    done(result);
                  };
                  const timeout = setTimeout(() => finish('timeout'), 2000);
                  channel.port1.onmessage = (event) =>
                    finish(
                      event.data?.type === 'PUBLIC_CACHE_READY'
                        ? event.data.ready === true
                          ? 'ready'
                          : 'not_ready'
                        : 'invalid_reply',
                    );
                  try {
                    controller.postMessage({ type: 'PUBLIC_CACHE_READY' }, [channel.port2]);
                  } catch {
                    finish('post_failed');
                  }
                });
            return {
              controllerPresent: Boolean(controller),
              controllerState: controller?.state ?? 'none',
              readyProbe,
              registrations: registrations.slice(0, 8).map((registration) => ({
                rootScope: registration.scope === `${location.origin}/`,
                installing: registration.installing?.state ?? 'none',
                waiting: registration.waiting?.state ?? 'none',
                active: registration.active?.state ?? 'none',
              })),
              publicCacheCount: names.length,
              inspectedCacheCount: Math.min(8, names.length),
              publicCacheEntryCount: entryCount,
              unexpectedEntryCount,
            };
          })
          .catch(() => ({ inspection: 'unavailable' })),
        new Promise<{ inspection: string }>((done) => {
          timer = setTimeout(() => done({ inspection: 'timed_out' }), 5000);
        }),
      ]);
      clearTimeout(timer);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify(
          {
            label: 'READ_ONLY_PUBLIC_SERVICE_WORKER_DIAGNOSTIC',
            elapsedMs: Date.now() - started,
            manifestAssetCount,
            events,
            truncated,
            snapshot,
          },
          null,
          2,
        ) + '\n',
      );
    },
    stop() {
      observing = false;
      context.off('response', onResponse);
      context.off('requestfailed', onFailure);
    },
  };
}
