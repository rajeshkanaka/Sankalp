'use client';

import { useState } from 'react';

import { bindAccount, clearAccount, getDeviceState, setSharedDevice } from '../core';
import shared from '@/styles/sanctuary.module.css';
import styles from './offline.module.css';
import { useOfflineAccount } from './account-context';

type Choice = 'sign_out' | 'shared_device' | null;

export function OfflineAccountControls({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const {
    accountId,
    scope,
    status,
    deviceState,
    frozen,
    adoptScope,
    flushNow,
    freeze,
    unfreeze,
    hasUnstoredInput,
  } = useOfflineAccount();
  const [choice, setChoice] = useState<Choice>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function finish(
    action: 'synced' | 'discard_confirmed',
    target: 'sign_out' | 'shared_device',
  ) {
    if (action === 'synced' && hasUnstoredInput())
      throw new Error(
        'Some input is not saved. Keep this page open and save or explicitly discard it.',
      );
    if (target === 'sign_out') {
      // Unreadable storage is not evidence that the device has no private data.
      const clearScope = scope ?? (await bindAccount(accountId));
      await clearAccount(clearScope, action);
      await onSignOut();
    } else {
      if (!scope)
        throw new Error('Reconnect to verify this account before changing device privacy.');
      const nextScope = await setSharedDevice(scope, true, action);
      await adoptScope(nextScope);
      setMessage('Private local storage is now off on this shared device.');
    }
  }

  async function begin(target: 'sign_out' | 'shared_device') {
    if (working) return;
    setWorking(true);
    setMessage(null);
    let needsChoice = false;
    try {
      await freeze();
      const latest = scope ? await getDeviceState() : null;
      if (
        (latest?.pendingOperations ?? 0) + (latest?.pendingDrafts ?? 0) > 0 ||
        hasUnstoredInput()
      ) {
        needsChoice = true;
        setChoice(target);
        setConfirmDiscard(false);
      } else await finish('synced', target);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'This account action could not finish. Your input remains here.',
      );
    } finally {
      if (!needsChoice) unfreeze();
      setWorking(false);
    }
  }
  async function syncThen(target: 'sign_out' | 'shared_device') {
    setWorking(true);
    setMessage('Syncing saved changes…');
    unfreeze();
    try {
      const result = await flushNow();
      await freeze();
      const latest = scope ? await getDeviceState() : null;
      if (
        hasUnstoredInput() ||
        latest?.pendingDrafts ||
        result.pending ||
        result.blocked ||
        result.reason !== 'drained'
      ) {
        setMessage(
          'Some local changes or drafts still need attention. You remain signed in; save or review them before trying again.',
        );
        return;
      }
      await finish('synced', target);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Sync could not finish. You remain signed in.',
      );
    } finally {
      setChoice(null);
      unfreeze();
      setWorking(false);
    }
  }
  async function discardThen(target: 'sign_out' | 'shared_device') {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      await freeze();
      await finish('discard_confirmed', target);
      setChoice(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This account action could not finish.');
    } finally {
      unfreeze();
      setWorking(false);
    }
  }
  const signOut = () => begin('sign_out');
  const beginSharedDevice = () => begin('shared_device');
  const syncThenSignOut = () => syncThen('sign_out');
  const syncThenShare = () => syncThen('shared_device');
  const discardThenSignOut = () => discardThen('sign_out');
  const discardThenShare = () => discardThen('shared_device');

  async function enablePrivateStorage() {
    if (!scope) {
      setMessage('Reconnect to verify this account before changing device privacy.');
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      await freeze();
      if (hasUnstoredInput())
        throw new Error(
          'Save or cancel your current input before enabling private local storage. Your input remains here.',
        );
      const nextScope = await setSharedDevice(scope, false);
      await adoptScope(nextScope);
      setMessage('Private offline storage is enabled for this account on this device.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Private local storage could not be enabled.',
      );
    } finally {
      unfreeze();
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
            onClick={() => void enablePrivateStorage()}
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
            {deviceState?.pendingDrafts ?? 0} draft(s) remain on this device. Input that could not
            be stored also needs an explicit choice.
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
