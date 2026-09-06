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
  clearAccount,
  flush,
  getDeviceState,
  subscribe,
  type AccountScope,
  type AccountVerification,
  type ClearAction,
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
  verifyAndBindAccount(discardPrevious?: boolean): Promise<AccountScope>;
  signOut(action: ClearAction, onSignOut: () => Promise<void>): Promise<void>;
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
  verifyAccount: (accountId: string, allowOffline?: boolean) => Promise<AccountVerification>;
  ensureOfflineReady?: () => Promise<boolean>;
}) {
  return <AccountProvider key={props.accountId} {...props} />;
}

function AccountProvider({
  accountId,
  children,
  verifyAccount,
  ensureOfflineReady,
}: {
  accountId: string;
  children: ReactNode;
  verifyAccount: (accountId: string, allowOffline?: boolean) => Promise<AccountVerification>;
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
  const identityPending = useRef(false);
  const identityCheckSequence = useRef(0);
  const frozenRef = useRef(false);
  const alive = useRef(true);
  const epoch = useRef(0);
  const readyRef = useRef(false);
  const readiness = useRef(ensureOfflineReady);
  readiness.current = ensureOfflineReady;
  const verification = useRef(verifyAccount);
  verification.current = verifyAccount;
  const [logout, setLogout] = useState<'idle' | 'clearing' | 'pending' | 'failed' | 'done'>('idle');
  const logoutCallback = useRef<(() => Promise<void>) | null>(null);
  const logoutInFlight = useRef(false);
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
    if (!identityPending.current) {
      unverifiedRef.current = false;
      setUnverified(false);
    }
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
  const verifyAndBindAccount = useCallback(
    async (discardPrevious = false): Promise<AccountScope> => {
      // Capture both guards before the network wait; cancelled verification cannot bind later.
      const ticket = epoch.current;
      const before = await getDeviceState().catch(() => null);
      const verified = await verification.current(accountId).catch(() => 'unavailable' as const);
      if (!alive.current || ticket !== epoch.current)
        throw new OfflineError('ACCOUNT_CHANGED', 'This account verification was cancelled.');
      if (verified !== 'verified') {
        invalidate();
        throw new OfflineError('ACCOUNT_VERIFICATION_FAILED', 'Verify your account to continue.');
      }
      if (!before)
        throw new OfflineError(
          'STORAGE_UNAVAILABLE',
          'Local account storage could not be verified.',
        );
      try {
        return await bindAccount(accountId, {
          discardPrevious,
          expectedGeneration: before.bindingGeneration,
        });
      } catch (error) {
        if (
          alive.current &&
          ticket === epoch.current &&
          error instanceof OfflineError &&
          error.code === 'ACCOUNT_CHANGED'
        )
          invalidate();
        throw error;
      }
    },
    [accountId, invalidate],
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
      let bound = false;
      try {
        const nextScope = await verifyAndBindAccount(discardPrevious);
        bound = true;
        if (!alive.current || ticket !== epoch.current) return;
        const publicReady = (await readiness.current?.().catch(() => false)) ?? false;
        if (!alive.current || ticket !== epoch.current) return;
        const next = await getDeviceState();
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
        } else if (
          bound ||
          (error instanceof OfflineError && error.code === 'ACCOUNT_VERIFICATION_FAILED')
        )
          invalidate();
        else
          onlineOnly(
            'Private local storage is unavailable. You can continue using the online controls.',
          );
      }
    },
    [accountId, applyDevice, invalidate, onlineOnly, verifyAndBindAccount],
  );
  useEffect(() => {
    void establish();
  }, [establish]);
  useEffect(() => {
    if (!scope) return;
    const stop = subscribe(scope, () => {
      void refresh();
    });
    // Reconcile a change that occurred between the last startup read and subscribing.
    void refresh();
    return stop;
  }, [refresh, scope]);
  const checkVisibleAccount = useCallback(async () => {
    const sequence = ++identityCheckSequence.current;
    identityPending.current = true;
    unverifiedRef.current = true;
    setUnverified(true);
    flushController.current?.abort();
    const allowOffline = Boolean(scopeRef.current && readyRef.current);
    const verified = await verification
      .current(accountId, allowOffline)
      .catch(() => 'unavailable' as const);
    if (!alive.current || sequence !== identityCheckSequence.current) return;
    identityPending.current = verified === 'unavailable';
    if (verified === 'unavailable') return;
    if (verified !== 'verified') {
      invalidate();
      return;
    }
    if (scopeRef.current) await refresh();
    else {
      // Online-only mode can have no readable local scope, but still requires fresh identity.
      unverifiedRef.current = false;
      setUnverified(false);
    }
  }, [accountId, invalidate, refresh]);
  const cancelIdentityChecks = useCallback(() => {
    identityCheckSequence.current++;
    identityPending.current = false;
  }, []);
  useEffect(() => {
    const checkVisible = () => {
      if (document.visibilityState === 'visible') void checkVisibleAccount();
    };
    window.addEventListener('pageshow', checkVisible);
    window.addEventListener('focus', checkVisible);
    document.addEventListener('visibilitychange', checkVisible);
    return () => {
      cancelIdentityChecks();
      window.removeEventListener('pageshow', checkVisible);
      window.removeEventListener('focus', checkVisible);
      document.removeEventListener('visibilitychange', checkVisible);
    };
  }, [cancelIdentityChecks, checkVisibleAccount]);
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
  const finishRemoteSignOut = useCallback(async () => {
    if (!logoutCallback.current || logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLogout('pending');
    try {
      const verified = await verification.current(accountId).catch(() => 'unavailable' as const);
      if (verified === 'signed_out') {
        if (alive.current) setLogout('done');
        return;
      }
      if (verified !== 'verified') throw new OfflineError('ACCOUNT_VERIFICATION_FAILED');
      await logoutCallback.current();
      if (alive.current) setLogout('done');
    } catch {
      if (alive.current) setLogout('failed');
    } finally {
      logoutInFlight.current = false;
    }
  }, [accountId]);
  const signOut = useCallback(
    async (action: ClearAction, onSignOut: () => Promise<void>) => {
      if (logoutInFlight.current) return;
      await freeze();
      if (action === 'synced' && hasUnstoredInput())
        throw new OfflineError('UNSTORED_INPUT', 'Save your current input before signing out.');
      logoutCallback.current = onSignOut;
      setLogout('clearing');
      try {
        const verifiedScope = await verifyAndBindAccount();
        await clearAccount(verifiedScope, action);
      } catch (error) {
        if (alive.current) setLogout('idle');
        throw error;
      }
      // Local purge may invalidate/unmount the caller. Its remote action stays owned here.
      epoch.current++;
      scopeRef.current = null;
      setScope(null);
      setStatus('invalidated');
      await finishRemoteSignOut();
    },
    [finishRemoteSignOut, freeze, hasUnstoredInput, verifyAndBindAccount],
  );
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
      verifyAndBindAccount,
      signOut,
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
      verifyAndBindAccount,
      signOut,
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

  if (logout === 'pending' || logout === 'failed' || logout === 'done')
    return (
      <main className={styles.boundary}>
        <section className={shared.panel} role={logout === 'failed' ? 'alert' : 'status'}>
          <h1>
            {logout === 'failed'
              ? 'Sign-out did not finish'
              : logout === 'done'
                ? 'Signed out'
                : 'Finishing sign out…'}
          </h1>
          {logout === 'failed' ? (
            <>
              <p>
                Local private data has been cleared. The server has not confirmed sign-out. Retry to
                finish signing out.
              </p>
              <button
                type="button"
                className={shared.button}
                onClick={() => void finishRemoteSignOut()}
              >
                Retry sign out
              </button>
            </>
          ) : (
            <p>
              {logout === 'done'
                ? 'The server confirmed sign-out.'
                : 'Local private data is cleared. Waiting for the server to confirm sign-out.'}
            </p>
          )}
          <a className={`${shared.button} ${shared.secondary}`} href="/welcome">
            Return to sign in
          </a>
        </section>
      </main>
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
            Private content is temporarily hidden while your account or local storage cannot be
            verified. Unsaved input remains in this page.
          </p>
          <button
            type="button"
            className={shared.button}
            onClick={() => void checkVisibleAccount()}
          >
            Retry verification
          </button>
        </section>
      )}
      {logout === 'clearing' && (
        <p role="status">Verifying and clearing local data before sign out…</p>
      )}
      <div hidden={unverified || logout === 'clearing'}>{children}</div>
    </OfflineAccountContext.Provider>
  );
}
