import React from 'react';
import { createRoot } from 'react-dom/client';
import * as core from '../../src/offline/core';
import {
  OfflineAccountBoundary,
  OfflineAccountControls,
  OfflineSession,
  useOfflineAccount,
} from '../../src/offline/ui';
import { ACCOUNT, OTHER, snapshot } from '../offline-core/fixtures';
import '../../src/styles/globals.css';

let denyDrafts = false;
let denyReads = new URLSearchParams(location.search).has('denyReads');
const originalTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
  if (denyReads) throw new DOMException('Synthetic storage read failure', 'UnknownError');
  return originalTransaction.apply(this, args);
};
let canonicalChanges = 0;
let nextDraft: core.RawDraft | null = null;
const originalPut = IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
  if (denyDrafts && this.name === 'drafts')
    throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
  return originalPut.apply(this, args);
};
let switchAccount: (accountId: string) => void = () => undefined;
let refreshSnapshotProps: (snapshot: core.Snapshot) => void = () => undefined;
let signOutFails = false;
let verificationResult: core.AccountVerification = 'verified';
let verificationCalls = 0;
let offlineVerificationCalls = 0;
let simulatedNetworkAvailable = !new URLSearchParams(location.search).has('noNetwork');
let readinessCalls = 0;
let signOutCalls = 0;
let releaseVerification: ((value: boolean) => void) | undefined;
let releaseReadiness: ((value: boolean) => void) | undefined;
let releaseSignOut: (() => void) | undefined;
let verificationGate = new URLSearchParams(location.search).has('holdVerify')
  ? new Promise<boolean>((resolve) => {
      releaseVerification = resolve;
    })
  : null;
let readinessGate = new URLSearchParams(location.search).has('holdReady')
  ? new Promise<boolean>((resolve) => {
      releaseReadiness = resolve;
    })
  : null;
let signOutGate: Promise<void> | null = null;
async function verifySyntheticAccount(_accountId: string, allowOffline = false) {
  verificationCalls++;
  if (allowOffline) offlineVerificationCalls++;
  if (!simulatedNetworkAvailable) return allowOffline ? 'verified' : 'unavailable';
  return verificationGate
    ? (await verificationGate)
      ? 'verified'
      : 'different_account'
    : verificationResult;
}
async function prepareSyntheticShell() {
  readinessCalls++;
  return readinessGate ? readinessGate : true;
}
let denyAfterPrivacyMutation = false;
function OnlineInput() {
  const { frozen, registerEditor } = useOfflineAccount();
  const [value, setValue] = React.useState('');
  const valueRef = React.useRef(value);
  valueRef.current = value;
  React.useEffect(
    () =>
      registerEditor({
        settle: async () => undefined,
        hasUnstoredInput: () => valueRef.current !== '',
      }),
    [registerEditor],
  );
  return (
    <label>
      Synthetic online input
      <input value={value} disabled={frozen} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}
function Content() {
  const { status } = useOfflineAccount();
  const [serverSnapshot, setServerSnapshot] = React.useState(snapshot);
  refreshSnapshotProps = setServerSnapshot;
  return (
    <>
      <p>Offline state: {status}</p>
      {status === 'ready' ? (
        <OfflineSession
          snapshot={serverSnapshot}
          now={serverSnapshot.clock.serverNow}
          demo
          onCanonicalChange={() => {
            canonicalChanges++;
          }}
        />
      ) : (
        <>
          <p>Online fallback remains available.</p>
          <OnlineInput />
        </>
      )}
      <OfflineAccountControls
        compact={new URLSearchParams(location.search).has('compact')}
        onSignOut={async () => {
          signOutCalls++;
          await signOutGate;
          if (signOutFails) throw new Error('Synthetic sign-out failure; try again.');
          document.title = 'Synthetic signed out';
        }}
      />
    </>
  );
}
function App() {
  const [accountId, setAccountId] = React.useState(ACCOUNT);
  switchAccount = setAccountId;
  return (
    <div style={{ maxWidth: 900, margin: '24px auto' }}>
      <h1>Synthetic offline UI harness</h1>
      <p>Actual React and browser storage; simulated backend and public-shell readiness.</p>
      <OfflineAccountBoundary
        accountId={accountId}
        verifyAccount={verifySyntheticAccount}
        ensureOfflineReady={prepareSyntheticShell}
      >
        <Content />
      </OfflineAccountBoundary>
    </div>
  );
}
window.offlineUiHarness = {
  core,
  snapshot,
  account: ACCOUNT,
  other: OTHER,
  denyDrafts(value: boolean) {
    denyDrafts = value;
  },
  denyReads(value: boolean) {
    denyReads = value;
  },
  denyAfterPrivacyMutation() {
    denyAfterPrivacyMutation = true;
  },
  afterPrivacyMutation() {
    if (!denyAfterPrivacyMutation) return;
    denyAfterPrivacyMutation = false;
    denyReads = true;
  },
  replaceDraftAfterEnqueue(draft: core.RawDraft) {
    nextDraft = draft;
  },
  async afterEnqueue() {
    if (!nextDraft) return;
    const replacement = nextDraft;
    nextDraft = null;
    const device = await core.getDeviceState();
    if (!device.scope) throw new Error('Harness account unavailable');
    const current = await core.read(device.scope, snapshot.session.id);
    await core.saveDraft(device.scope, snapshot.session.id, replacement, current!.draftRevision);
    // Let the same-origin invalidation deliver the other tab's revision before cleanup.
    await new Promise((done) => setTimeout(done, 50));
  },
  async refreshCanonicalProps(prompts: core.Snapshot['preferences']['prompts']) {
    const device = await core.getDeviceState();
    if (!device.scope) throw new Error('Harness account unavailable');
    const current = await core.read(device.scope, snapshot.session.id);
    if (!current) throw new Error('Harness session unavailable');
    // Simulated server-prop delivery after the actual local acknowledgment.
    // Prompt rendering identifies when the editor applied this new snapshot.
    refreshSnapshotProps({ ...current.snapshot, preferences: { prompts } });
  },
  canonicalChanges() {
    return canonicalChanges;
  },
  verificationCalls() {
    return verificationCalls;
  },
  offlineVerificationCalls() {
    return offlineVerificationCalls;
  },
  networkAvailable(value: boolean) {
    simulatedNetworkAvailable = value;
  },
  readinessCalls() {
    return readinessCalls;
  },
  signOutCalls() {
    return signOutCalls;
  },
  verification(value: boolean | core.AccountVerification) {
    verificationResult =
      typeof value === 'boolean' ? (value ? 'verified' : 'different_account') : value;
  },
  releaseVerification(value: boolean) {
    verificationGate = null;
    verificationResult = value ? 'verified' : 'different_account';
    releaseVerification?.(value);
  },
  releaseReadiness(value: boolean) {
    readinessGate = null;
    releaseReadiness?.(value);
  },
  holdSignOut() {
    signOutGate = new Promise((resolve) => {
      releaseSignOut = resolve;
    });
  },
  releaseSignOut() {
    signOutGate = null;
    releaseSignOut?.();
  },
  failSignOut(value: boolean) {
    signOutFails = value;
  },
  async switchAccount() {
    await fetch('/synthetic/account', {
      method: 'POST',
      body: JSON.stringify({ accountId: OTHER }),
    });
    switchAccount(OTHER);
  },
};
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
declare global {
  interface Window {
    offlineUiHarness: {
      core: typeof core;
      snapshot: typeof snapshot;
      account: string;
      other: string;
      denyDrafts(value: boolean): void;
      denyReads(value: boolean): void;
      denyAfterPrivacyMutation(): void;
      afterPrivacyMutation(): void;
      replaceDraftAfterEnqueue(draft: core.RawDraft): void;
      afterEnqueue(): Promise<void>;
      refreshCanonicalProps(prompts: core.Snapshot['preferences']['prompts']): Promise<void>;
      canonicalChanges(): number;
      verificationCalls(): number;
      offlineVerificationCalls(): number;
      networkAvailable(value: boolean): void;
      readinessCalls(): number;
      signOutCalls(): number;
      verification(value: boolean | core.AccountVerification): void;
      releaseVerification(value: boolean): void;
      releaseReadiness(value: boolean): void;
      holdSignOut(): void;
      releaseSignOut(): void;
      failSignOut(value: boolean): void;
      switchAccount(): Promise<void>;
    };
  }
}
