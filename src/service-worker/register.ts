/** Public asset readiness only. Private session storage has a separate durable gate. */
export async function ensurePublicShell(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !isSecureContext)
    return false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // Navigations already trigger the browser's worker update check. Reuse a
    // verified controller instead of registering again during every page change.
    if (navigator.serviceWorker.controller && (await hasReadyPublicShell())) return true;
    return await Promise.race([
      establishPublicShell(),
      new Promise<boolean>((resolve) => {
        deadline = setTimeout(() => resolve(false), 7000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(deadline);
  }
}

async function establishPublicShell(): Promise<boolean> {
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    if (!navigator.serviceWorker.controller) {
      const controlled = await new Promise<boolean>((resolve) => {
        const changed = () => {
          if (navigator.serviceWorker.controller) finish(true);
        };
        const timer = setTimeout(() => finish(false), 10000);
        const finish = (ready: boolean) => {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener('controllerchange', changed);
          resolve(ready);
        };
        navigator.serviceWorker.addEventListener('controllerchange', changed);
        changed();
      });
      if (!controlled) return false;
    }
    return await hasReadyPublicShell();
  } catch {
    return false;
  }
}

/** The cached shell checks its existing controller without requiring a network registration. */
export async function hasReadyPublicShell(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return false;
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 3000);
    channel.port1.onmessage = (event) =>
      finish(event.data?.type === 'PUBLIC_CACHE_READY' && event.data.ready === true);
    try {
      controller.postMessage({ type: 'PUBLIC_CACHE_READY' }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}
