import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bindAccount, getDeviceState, read, type LocalView } from '@/offline/core';
import {
  OfflineAccountBoundary,
  OfflineSavedPage,
  OfflineSession,
  useOfflineAccount,
} from '@/offline/ui';
import { hasReadyPublicShell } from '../register';
import '@/styles/globals.css';
import styles from '@/styles/sanctuary.module.css';
import './shell.css';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const sessionRoute = new RegExp(`^/journeys/(${uuid})/sessions/(${uuid})$`, 'i');
type Loaded = { accountId: string; view: LocalView | null };

function SavedSession({ view }: { view: LocalView }) {
  const { status } = useOfflineAccount();
  if (status !== 'ready')
    return (
      <main className="offline-shell">
        <h1>Offline practice is unavailable</h1>
        <p>Reconnect to verify your account or reopen a practice online.</p>
        <a href="/today">Reconnect to Sankalpa</a>
      </main>
    );
  const { snapshot } = view;
  return (
    <main className="offline-shell">
      <a href="/offline/saved">Practices saved on this device</a>
      <h1>{snapshot.journeyTitle}</h1>
      <p>
        {snapshot.session.practiceDate} · {snapshot.session.timeZone}
      </p>
      <p className={styles.quietNote}>
        Saved on this device. Server progress and reminders update only after synchronization.
      </p>
      {snapshot.clock.simulated && <p>Demo data · simulated clock</p>}
      <OfflineSession
        snapshot={snapshot}
        now={snapshot.clock.serverNow}
        demo={snapshot.clock.simulated}
      />
    </main>
  );
}

function PublicOfflineApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pending, setPending] = useState(true);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        // A fresh online document verifies the cookie before displaying cached private data.
        // Only an actual network failure falls back to the previously bound local account.
        if (navigator.onLine) {
          let response: Response | undefined;
          try {
            response = await fetch('/api/auth/session', {
              credentials: 'same-origin',
              cache: 'no-store',
              signal: AbortSignal.timeout(5000),
            });
          } catch (error) {
            if (
              !(error instanceof TypeError) &&
              !(
                error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)
              )
            )
              throw error;
          }
          if (response) {
            if (!response.ok) throw new Error('Account verification required.');
            const identity: unknown = await response.json();
            if (
              !identity ||
              typeof identity !== 'object' ||
              !('accountId' in identity) ||
              typeof identity.accountId !== 'string' ||
              !new RegExp(`^${uuid}$`, 'i').test(identity.accountId)
            )
              throw new Error('Account verification required.');
            await bindAccount(identity.accountId);
          }
        }
        const device = await getDeviceState();
        if (device.quarantined || device.sharedDevice || !device.scope) {
          if (current) setLocked(true);
          return;
        }
        const match =
          location.search || location.hash ? null : sessionRoute.exec(location.pathname);
        const view = match ? await read(device.scope, match[2]) : null;
        const verifiedView = view?.snapshot.session.journeyId === match?.[1] ? view : null;
        if (current) setLoaded({ accountId: device.scope.accountId, view: verifiedView });
      } catch {
        if (current) setLocked(true);
      } finally {
        if (current) setPending(false);
      }
    })();
    return () => {
      current = false;
    };
  }, []);
  if (pending)
    return (
      <main className="offline-shell">
        <h1>Sankalpa</h1>
        <p role="status">Checking saved practices…</p>
      </main>
    );
  if (locked || !loaded)
    return (
      <main className="offline-shell">
        <h1>Your private practice</h1>
        <p>No private session is available here. Reconnect and verify your account to continue.</p>
        <a href="/today">Reconnect to Sankalpa</a>
      </main>
    );
  return (
    <OfflineAccountBoundary accountId={loaded.accountId} ensureOfflineReady={hasReadyPublicShell}>
      {loaded.view ? <SavedSession view={loaded.view} /> : <OfflineSavedPage />}
    </OfflineAccountBoundary>
  );
}

const target = document.getElementById('root');
if (target) createRoot(target).render(<PublicOfflineApp />);
