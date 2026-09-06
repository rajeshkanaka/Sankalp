import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bindAccount, getDeviceState, read, type LocalView } from '@/offline/core';
import { readBrowserIdentity, type AccountVerification } from '@/offline/account-identity';
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

async function verifySavedBrowserAccount(accountId: string): Promise<AccountVerification> {
  const identity = await readBrowserIdentity();
  if (identity.kind === 'rejected') return 'unavailable';
  if (identity.kind === 'unauthenticated') return 'signed_out';
  if (identity.kind === 'verified' && identity.accountId !== accountId) return 'different_account';
  // Only this saved-shell path may resume an already bound account after transport loss.
  // It cannot switch accounts, revive a cleared generation or enable shared-device storage.
  try {
    const device = await getDeviceState();
    return !device.quarantined && !device.sharedDevice && device.scope?.accountId === accountId
      ? 'verified'
      : 'different_account';
  } catch {
    return 'unavailable';
  }
}

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
        const beforeVerification = await getDeviceState();
        const identity = await readBrowserIdentity();
        if (identity.kind === 'rejected' || identity.kind === 'unauthenticated')
          throw new Error('Account verification required.');
        if (identity.kind === 'verified')
          await bindAccount(identity.accountId, {
            expectedGeneration: beforeVerification.bindingGeneration,
          });
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
    <OfflineAccountBoundary
      accountId={loaded.accountId}
      ensureOfflineReady={hasReadyPublicShell}
      verifyAccount={verifySavedBrowserAccount}
    >
      {loaded.view ? <SavedSession view={loaded.view} /> : <OfflineSavedPage />}
    </OfflineAccountBoundary>
  );
}

const target = document.getElementById('root');
if (target) createRoot(target).render(<PublicOfflineApp />);
