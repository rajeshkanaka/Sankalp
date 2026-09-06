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

type AccountStatus = 'loading' | 'ready' | 'online_only' | 'quarantined' | 'invalidated' | 'error';
interface EditorCheckpoint {
  settle(): Promise<void>;
  hasUnstoredInput(): boolean;
}
interface OfflineAccountContextValue {
  accountId: string;
  status: AccountStatus;
  scope: AccountScope | null;
  deviceState: DeviceState | null;
  frozen: boolean;
  message: string | null;
  refresh(): Promise<void>;
  adoptScope(scope: AccountScope): Promise<void>;
  flushNow(): Promise<FlushResult>;
  freeze(): Promise<void>;
  unfreeze(): void;
  isFrozen(): boolean;
  hasUnstoredInput(): boolean;
  registerEditor(editor: EditorCheckpoint): () => void;
  invalidate(expected?: AccountScope | null): void;
  onlineOnly(message: string): void;
}
const OfflineAccountContext = createContext<OfflineAccountContextValue | null>(null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sameScope = (a: AccountScope | null, b: AccountScope | null) =>
  Boolean(a && b && a.accountId === b.accountId && a.generation === b.generation);

export function useOfflineAccount(): OfflineAccountContextValue {
  const value = useContext(OfflineAccountContext);
  if (!value) throw new Error('Offline controls must be inside OfflineAccountBoundary.');
  return value;
}

/** Remount synchronously when the verified server identity changes. */
export function OfflineAccountBoundary(props: {
  accountId: string;
  children: ReactNode;
  ensureOfflineReady?: () => Promise<boolean>;
}) {
  return <AccountProvider key={props.accountId} {...props} />;
}

function AccountProvider({
  accountId,
  children,
  ensureOfflineReady,
}: {
  accountId: string;
  children: ReactNode;
  ensureOfflineReady?: () => Promise<boolean>;
}) {
  const [scope, setScope] = useState<AccountScope | null>(null);
  const scopeRef = useRef<AccountScope | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const deviceRef = useRef<DeviceState | null>(null);
  const [status, setStatus] = useState<AccountStatus>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const unverifiedRef = useRef(false);
  const frozenRef = useRef(false);
  const alive = useRef(true);
  const epoch = useRef(0);
  const readyRef = useRef(false);
  const readiness = useRef(ensureOfflineReady);
  readiness.current = ensureOfflineReady;
  const editors = useRef(new Set<EditorCheckpoint>());
  const flushController = useRef<AbortController | null>(null);
  const activeFlush = useRef<Promise<FlushResult> | null>(null);

  const dispose = useCallback(() => {
    alive.current = false;
    epoch.current++;
    flushController.current?.abort();
  }, []);
  useEffect(() => {
    alive.current = true;
    return dispose;
  }, [dispose]);
  const invalidate = useCallback((expected?: AccountScope | null) => {
    if (expected && !sameScope(scopeRef.current, expected)) return;
    epoch.current++;
    flushController.current?.abort();
    scopeRef.current = null;
    if (alive.current) {
      setScope(null);
      setStatus('invalidated');
      setMessage(null);
    }
  }, []);
  const onlineOnly = useCallback((reason: string) => {
    if (!alive.current) return;
    readyRef.current = false;
    setStatus('online_only');
    setMessage(reason);
  }, []);
  const applyDevice = useCallback((next: DeviceState, activeScope: AccountScope) => {
    unverifiedRef.current = false;
    setUnverified(false);
    scopeRef.current = activeScope;
    deviceRef.current = next;
    setScope(activeScope);
    setDeviceState(next);
    const available = readyRef.current && next.locksAvailable && !next.sharedDevice;
    setStatus(available ? 'ready' : 'online_only');
    setMessage(
      next.sharedDevice
        ? 'Private local storage is off on this shared device.'
        : available
          ? null
          : 'Offline saving is unavailable. You can continue using the online controls.',
    );
  }, []);
  const refresh = useCallback(async () => {
    const ticket = ++epoch.current;
    const current = scopeRef.current;
    try {
      const next = await getDeviceState();
      if (!alive.current || ticket !== epoch.current) return;
      deviceRef.current = next;
      setDeviceState(next);
      if (next.quarantined) {
        scopeRef.current = null;
        setScope(null);
        setStatus('quarantined');
        flushController.current?.abort();
        return;
      }
      if (
        !current ||
        current.accountId !== accountId ||
        !sameScope(next.managementScope, current)
      ) {
        invalidate(current);
        return;
      }
      applyDevice(next, current);
    } catch {
      if (alive.current && ticket === epoch.current) {
        unverifiedRef.current = true;
        setUnverified(true);
        flushController.current?.abort();
      }
    }
  }, [accountId, applyDevice, invalidate]);
  const adoptScope = useCallback(
    async (nextScope: AccountScope) => {
      scopeRef.current = nextScope;
      setScope(nextScope);
      unverifiedRef.current = true;
      setUnverified(true);
      const ticket = ++epoch.current;
      let next: DeviceState;
      try {
        next = await getDeviceState();
      } catch (error) {
        // The privacy mutation already succeeded; retain the editor while recovery verifies it.
        if (alive.current && ticket === epoch.current) flushController.current?.abort();
        throw error;
      }
      if (!alive.current || ticket !== epoch.current) return;
      if (
        nextScope.accountId !== accountId ||
        next.quarantined ||
        !sameScope(next.managementScope, nextScope)
      ) {
        invalidate();
        return;
      }
      applyDevice(next, nextScope);
    },
    [accountId, applyDevice, invalidate],
  );
  const establish = useCallback(
    async (discardPrevious = false) => {
      const ticket = ++epoch.current;
      if (!UUID.test(accountId)) {
        setStatus('error');
        return;
      }
      setStatus('loading');
      setMessage(null);
      try {
        const nextScope = await bindAccount(accountId, { discardPrevious });
        if (!alive.current || ticket !== epoch.current) return;
        const next = await getDeviceState();
        const publicReady = (await readiness.current?.().catch(() => false)) ?? false;
        if (!alive.current || ticket !== epoch.current) return;
        if (next.quarantined || !sameScope(next.managementScope, nextScope)) {
          invalidate();
          return;
        }
        readyRef.current = publicReady;
        applyDevice(next, nextScope);
      } catch (error) {
        if (!alive.current || ticket !== epoch.current) return;
        if (
          error instanceof OfflineError &&
          ['ACCOUNT_CHANGE_PENDING', 'ACCOUNT_CHANGED', 'SYNC_BUSY'].includes(error.code)
        ) {
          scopeRef.current = null;
          setScope(null);
          const next = await getDeviceState().catch(() => null);
          if (!alive.current || ticket !== epoch.current) return;
          deviceRef.current = next;
          setDeviceState(next);
          setStatus(next?.quarantined ? 'quarantined' : 'invalidated');
        } else
          onlineOnly(
            'Private local storage is unavailable. You can continue using the online controls.',
          );
      }
    },
    [accountId, applyDevice, invalidate, onlineOnly],
  );
  useEffect(() => {
    void establish();
  }, [establish]);
  useEffect(() => {
    if (!scope) return;
    const stop = subscribe(scope, () => {
      void refresh();
    });
    const check = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      stop();
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [refresh, scope]);
  const flushNow = useCallback(async (): Promise<FlushResult> => {
    const current = scopeRef.current;
    if (!current || frozenRef.current || unverifiedRef.current)
      return {
        acknowledged: 0,
        pending: deviceRef.current?.pendingOperations ?? 0,
        blocked: 0,
        reason: 'aborted',
        retryAt: null,
      };
    if (activeFlush.current) return activeFlush.current;
    const controller = new AbortController();
    flushController.current = controller;
    const work = flush(current, controller.signal)
      .then((result) => {
        if (result.reason === 'account_changed') invalidate(current);
        return result;
      })
      .finally(() => {
        if (flushController.current === controller) flushController.current = null;
        if (activeFlush.current === work) activeFlush.current = null;
      });
    activeFlush.current = work;
    return work;
  }, [invalidate]);
  const hasUnstoredInput = useCallback(
    () => [...editors.current].some((editor) => editor.hasUnstoredInput()),
    [],
  );
  const registerEditor = useCallback((editor: EditorCheckpoint) => {
    editors.current.add(editor);
    return () => {
      editors.current.delete(editor);
    };
  }, []);
  const freeze = useCallback(async () => {
    frozenRef.current = true;
    setFrozen(true);
    flushController.current?.abort();
    await activeFlush.current?.catch(() => undefined);
    await Promise.all([...editors.current].map((editor) => editor.settle()));
  }, []);
  const unfreeze = useCallback(() => {
    frozenRef.current = false;
    setFrozen(false);
  }, []);
  const isFrozen = useCallback(() => frozenRef.current || unverifiedRef.current, []);
  const value = useMemo(
    () => ({
      accountId,
      status,
      scope,
      deviceState,
      frozen: frozen || unverified,
      message,
      refresh,
      adoptScope,
      flushNow,
      freeze,
      unfreeze,
      isFrozen,
      hasUnstoredInput,
      registerEditor,
      invalidate,
      onlineOnly,
    }),
    [
      accountId,
      status,
      scope,
      deviceState,
      frozen,
      unverified,
      message,
      refresh,
      adoptScope,
      flushNow,
      freeze,
      unfreeze,
      isFrozen,
      hasUnstoredInput,
      registerEditor,
      invalidate,
      onlineOnly,
    ],
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
          <p>
            Sign in to the original account to recover them, or deliberately discard them before
            continuing.
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
  if (status === 'invalidated' || status === 'error')
    return (
      <main className={styles.boundary}>
        <section className={shared.panel} role="alert">
          <h1>Verify your account to continue</h1>
          <p>Private content is hidden because this account or device session changed.</p>
          <a className={shared.button} href="/today">
            Reconnect to Sankalpa
          </a>
        </section>
      </main>
    );
  if (scope && scope.accountId !== accountId) return null;
  return (
    <OfflineAccountContext.Provider value={value}>
      {message && (
        <div className={styles.notice} role="status">
          {message}
        </div>
      )}
      {unverified && (
        <section className={styles.notice} role="alert">
          <h1>Verify local storage to continue</h1>
          <p>
            Private content is temporarily hidden while this device cannot verify its saved account.
            Unsaved input remains in this page.
          </p>
          <button type="button" className={shared.button} onClick={() => void refresh()}>
            Retry verification
          </button>
        </section>
      )}
      <div hidden={unverified}>{children}</div>
    </OfflineAccountContext.Provider>
  );
}
