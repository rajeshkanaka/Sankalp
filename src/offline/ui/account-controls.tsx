'use client';

import { useState } from 'react';

import { clearAccount, setSharedDevice } from '../core';
import shared from '@/styles/sanctuary.module.css';
import styles from './offline.module.css';
import { useOfflineAccount } from './account-context';

type Choice = 'sign_out' | 'shared_device' | null;

export function OfflineAccountControls({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { scope, status, deviceState, frozen, refresh, flushNow, freeze, unfreeze } =
    useOfflineAccount();
  const [choice, setChoice] = useState<Choice>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pending = (deviceState?.pendingOperations ?? 0) + (deviceState?.pendingDrafts ?? 0);

  async function finishSignOut(action: 'synced' | 'discard_confirmed') {
    if (!scope) {
      await onSignOut();
      return;
    }
    await clearAccount(scope, action);
    await onSignOut();
  }

  async function signOut() {
    if (status !== 'ready' || !scope || pending === 0) {
      setWorking(true);
      setMessage(null);
      await freeze();
      try {
        await finishSignOut('synced');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Sign out could not finish.');
      } finally {
        setWorking(false);
      }
      return;
    }
    await freeze();
    setChoice('sign_out');
    setConfirmDiscard(false);
  }

  async function syncThenSignOut() {
    setWorking(true);
    setMessage('Syncing saved changes…');
    unfreeze();
    try {
      const result = await flushNow();
      if (result.pending || result.blocked || result.reason !== 'drained') {
        setMessage('Some local changes still need attention. You remain signed in.');
        setChoice(null);
        return;
      }
      await freeze();
      await finishSignOut('synced');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sync could not finish.');
      setChoice(null);
    } finally {
      setWorking(false);
    }
  }

  async function discardThenSignOut() {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      await finishSignOut('discard_confirmed');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign out could not finish.');
    } finally {
      setWorking(false);
    }
  }

  async function beginSharedDevice() {
    if (!scope) return;
    if (pending > 0) {
      await freeze();
      setChoice('shared_device');
      setConfirmDiscard(false);
      return;
    }
    setWorking(true);
    await freeze();
    try {
      await setSharedDevice(scope, true, 'synced');
      setMessage('Private local storage is now off on this shared device.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Shared-device mode could not be saved.');
      unfreeze();
    } finally {
      setWorking(false);
    }
  }

  async function syncThenShare() {
    if (!scope) return;
    setWorking(true);
    setMessage('Syncing saved changes…');
    unfreeze();
    try {
      const result = await flushNow();
      if (result.pending || result.blocked || result.reason !== 'drained') {
        setMessage('Some local changes still need attention. Shared-device mode was not enabled.');
        setChoice(null);
        return;
      }
      await freeze();
      await setSharedDevice(scope, true, 'synced');
      setChoice(null);
      setMessage('Private local storage is now off on this shared device.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Shared-device mode could not be saved.');
      setChoice(null);
      unfreeze();
    } finally {
      setWorking(false);
    }
  }

  async function discardThenShare() {
    if (!scope) return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      await setSharedDevice(scope, true, 'discard_confirmed');
      setChoice(null);
      setMessage('Private local storage is now off on this shared device.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Shared-device mode could not be saved.');
      unfreeze();
    } finally {
      setWorking(false);
    }
  }

  async function usePrivateStorage() {
    if (!scope) return;
    setWorking(true);
    setMessage(null);
    try {
      await setSharedDevice(scope, false);
      unfreeze();
      await refresh();
      setMessage('Private offline storage is enabled for this account on this device.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Private local storage could not be enabled.',
      );
    } finally {
      setWorking(false);
    }
  }

  function cancel() {
    setChoice(null);
    setConfirmDiscard(false);
    setMessage(null);
    unfreeze();
  }

  return (
    <section className={`${shared.panel} ${styles.accountControls}`} aria-label="Device privacy">
      <h2>Device privacy</h2>
      {status === 'ready' && deviceState && (
        <p className={shared.small}>
          {deviceState.pendingOperations} pending change(s) and {deviceState.pendingDrafts} local
          draft(s) on this device.
        </p>
      )}
      {deviceState?.sharedDevice ? (
        <>
          <p>Private offline storage is disabled on this shared device.</p>
          <button
            type="button"
            className={`${shared.button} ${shared.secondary}`}
            disabled={working}
            onClick={() => void usePrivateStorage()}
          >
            Use private local storage on this device
          </button>
        </>
      ) : (
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={working || status !== 'ready'}
          onClick={() => void beginSharedDevice()}
        >
          Mark this as a shared device
        </button>
      )}
      <button
        type="button"
        className={shared.textButton}
        disabled={working}
        onClick={() => void signOut()}
      >
        Sign out
      </button>

      {choice && (
        <div className={styles.accountChoice} role="alert">
          <h3>
            {choice === 'sign_out' ? 'Local changes need attention' : 'Clear private storage?'}
          </h3>
          <p>
            {deviceState?.pendingOperations ?? 0} pending change(s) and{' '}
            {deviceState?.pendingDrafts ?? 0} draft(s) would otherwise remain on this device.
          </p>
          <div className={shared.actions}>
            <button
              type="button"
              className={shared.button}
              disabled={working}
              onClick={() => void (choice === 'sign_out' ? syncThenSignOut() : syncThenShare())}
            >
              {choice === 'sign_out' ? 'Sync then sign out' : 'Sync then enable shared-device mode'}
            </button>
            <button
              type="button"
              className={`${shared.button} ${shared.secondary}`}
              disabled={working}
              onClick={cancel}
            >
              {choice === 'sign_out' ? 'Keep signed in' : 'Keep private local storage'}
            </button>
            <button
              type="button"
              className={`${shared.button} ${shared.secondary}`}
              disabled={working}
              onClick={() =>
                void (choice === 'sign_out' ? discardThenSignOut() : discardThenShare())
              }
            >
              {confirmDiscard
                ? choice === 'sign_out'
                  ? 'Confirm discard and sign out'
                  : 'Confirm discard and enable shared-device mode'
                : 'Discard local changes'}
            </button>
          </div>
          {confirmDiscard && (
            <p className={shared.quietNote}>
              Discarding local data cannot undo a request that already reached the server.
            </p>
          )}
        </div>
      )}
      {message && (
        <p className={styles.accountMessage} role="status">
          {message}
        </p>
      )}
      {frozen && !choice && working && <p role="status">Finishing this account action…</p>}
    </section>
  );
}
