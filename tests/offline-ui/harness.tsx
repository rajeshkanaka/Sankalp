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
let signOutFails = false;
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
  return (
    <>
      <p>Offline state: {status}</p>
      {status === 'ready' ? (
        <OfflineSession
          snapshot={snapshot}
          now={snapshot.clock.serverNow}
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
      <OfflineAccountBoundary accountId={accountId} ensureOfflineReady={async () => true}>
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
  canonicalChanges() {
    return canonicalChanges;
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
createRoot(document.getElementById('root')!).render(<App />);
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
      canonicalChanges(): number;
      failSignOut(value: boolean): void;
      switchAccount(): Promise<void>;
    };
  }
}
