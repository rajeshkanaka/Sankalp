'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  OfflineError,
  bindAccount,
  flush,
  getDeviceState,
  subscribe,
  type AccountScope,
  type DeviceState,
  type FlushResult,
} from '../core';
import shared from '@/styles/sanctuary.module.css';
import styles from './offline.module.css';

type AccountStatus = 'loading' | 'ready' | 'online_only' | 'quarantined' | 'error';

interface OfflineAccountContextValue {
  accountId: string;
  status: AccountStatus;
  scope: AccountScope | null;
  deviceState: DeviceState | null;
  frozen: boolean;
  message: string | null;
  refresh(): Promise<void>;
  flushNow(): Promise<FlushResult>;
  freeze(): Promise<void>;
  unfreeze(): void;
}

const OfflineAccountContext = createContext<OfflineAccountContextValue | null>(null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeMessage(error: unknown): string {
  if (!(error instanceof OfflineError))
    return 'Offline saving is unavailable. Online changes can still be saved.';
  switch (error.code) {
    case 'STORAGE_FULL':
      return 'This device has no room for another offline change. Keep this page open and use the online controls.';
    case 'STORAGE_BLOCKED':
      return 'Close older Sankalpa tabs and reload before using offline saving.';
    case 'STORAGE_RELOAD_REQUIRED':
      return 'Reload this page before using offline saving again.';
    case 'SHARED_DEVICE':
      return 'Private local storage is off because this is marked as a shared device.';
    default:
      return 'Offline saving is unavailable. Online changes can still be saved.';
  }
}

export function useOfflineAccount(): OfflineAccountContextValue {
  const value = useContext(OfflineAccountContext);
  if (!value) throw new Error('Offline controls must be inside OfflineAccountBoundary.');
  return value;
}

export function OfflineAccountBoundary({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const validAccount = UUID.test(accountId);
  const [scope, setScope] = useState<AccountScope | null>(null);
  const scopeRef = useRef<AccountScope | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [status, setStatus] = useState<AccountStatus>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);
  const flushController = useRef<AbortController | null>(null);
  const activeFlush = useRef<Promise<FlushResult> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getDeviceState();
      setDeviceState(next);
      if (next.quarantined) {
        scopeRef.current = null;
        setScope(null);
        setStatus('quarantined');
        setMessage(null);
        return;
      }
      const currentScope = scopeRef.current;
      if (
        currentScope &&
        (!next.scope ||
          next.scope.accountId !== currentScope.accountId ||
          next.scope.generation !== currentScope.generation)
      ) {
        scopeRef.current = null;
        setScope(null);
        setStatus(next.sharedDevice ? 'online_only' : 'loading');
      }
      setStatus(next.sharedDevice ? 'online_only' : 'ready');
      setMessage(
        next.sharedDevice
          ? 'Private local storage is off because this is marked as a shared device.'
          : null,
      );
    } catch (error) {
      scopeRef.current = null;
      setScope(null);
      setDeviceState(null);
      setStatus('online_only');
      setMessage(safeMessage(error));
    }
  }, []);

  const establish = useCallback(
    async (discardPrevious = false) => {
      if (!validAccount) {
        setStatus('error');
        setMessage('This signed-in account could not be verified. Please sign in again.');
        return;
      }
      setStatus('loading');
      setMessage(null);
      try {
        const nextScope = await bindAccount(accountId, { discardPrevious });
        scopeRef.current = nextScope;
        setScope(nextScope);
        const next = await getDeviceState();
        setDeviceState(next);
        setStatus(next.sharedDevice ? 'online_only' : 'ready');
        setMessage(
          next.sharedDevice
            ? 'Private local storage is off because this is marked as a shared device.'
            : null,
        );
      } catch (error) {
        if (error instanceof OfflineError && error.code === 'ACCOUNT_CHANGE_PENDING') {
          const next = await getDeviceState().catch(() => null);
          scopeRef.current = null;
          setScope(null);
          setDeviceState(next);
          setStatus('quarantined');
          setMessage(null);
          return;
        }
        scopeRef.current = null;
        setScope(null);
        setDeviceState(null);
        setStatus('online_only');
        setMessage(safeMessage(error));
      }
    },
    [accountId, validAccount],
  );

  useEffect(() => {
    void establish();
  }, [establish]);

  useEffect(() => {
    if (!scope) return;
    const stop = subscribe(scope, () => void refresh());
    const check = () => void refresh();
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      stop();
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [refresh, scope]);

  const flushNow = useCallback(async () => {
    const currentScope = scopeRef.current;
    if (!currentScope || frozenRef.current)
      return {
        acknowledged: 0,
        pending: deviceState?.pendingOperations ?? 0,
        blocked: 0,
        reason: 'aborted',
        retryAt: null,
      };
    if (activeFlush.current) return activeFlush.current;
    const controller = new AbortController();
    flushController.current = controller;
    const work = flush(currentScope, controller.signal).finally(() => {
      if (flushController.current === controller) flushController.current = null;
      if (activeFlush.current === work) activeFlush.current = null;
    });
    activeFlush.current = work;
    return work;
  }, [deviceState?.pendingOperations]);

  const freeze = useCallback(async () => {
    frozenRef.current = true;
    setFrozen(true);
    flushController.current?.abort();
    await activeFlush.current?.catch(() => undefined);
  }, []);

  const unfreeze = useCallback(() => {
    frozenRef.current = false;
    setFrozen(false);
  }, []);

  const value = useMemo<OfflineAccountContextValue>(
    () => ({
      accountId,
      status,
      scope,
      deviceState,
      frozen,
      message,
      refresh,
      flushNow,
      freeze,
      unfreeze,
    }),
    [accountId, deviceState, flushNow, freeze, frozen, message, refresh, scope, status, unfreeze],
  );

  if (status === 'loading')
    return (
      <main className={styles.boundary} aria-busy="true">
        <p role="status">Opening your private practice space…</p>
      </main>
    );

  if (status === 'quarantined')
    return (
      <main className={styles.boundary}>
        <section className={shared.panel} aria-labelledby="account-change-title">
          <h1 id="account-change-title">Local changes belong to another account</h1>
          <p>
            This device has {deviceState?.pendingOperations ?? 0} pending change(s) and{' '}
            {deviceState?.pendingDrafts ?? 0} draft(s). Their private contents stay hidden.
          </p>
          <p className={shared.quietNote}>
            Sign in to the original account to recover them, or deliberately discard them before
            continuing with this account.
          </p>
          <div className={shared.actions}>
            <a className={shared.button} href="/welcome">
              Sign in to the original account
            </a>
            <button
              type="button"
              className={`${shared.button} ${shared.secondary}`}
              onClick={() => void establish(true)}
            >
              Discard previous local changes and continue
            </button>
          </div>
        </section>
      </main>
    );

  if (status === 'error')
    return (
      <main className={styles.boundary}>
        <section className={shared.panel} role="alert">
          <h1>Account verification failed</h1>
          <p>{message}</p>
          <a className={shared.button} href="/welcome">
            Sign in again
          </a>
        </section>
      </main>
    );

  return (
    <OfflineAccountContext.Provider key={scope?.generation ?? 'online-only'} value={value}>
      {message && (
        <aside className={styles.notice} role="status">
          {message} Offline drafts and queued changes are unavailable in this mode.
        </aside>
      )}
      {children}
    </OfflineAccountContext.Provider>
  );
}
