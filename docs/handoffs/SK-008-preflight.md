# SK-008 offline implementation preflight

Verified **2026-09-06, Asia/Kolkata** against commit `d202559`, branch `task/SK-008-preflight`, worktree `/Users/rajesh/sankalpa-worktrees/SK-008-preflight`. This is a read-only architecture investigation and proposed interface checkpoint, not implemented functionality or a task-status update. [TASKS](../TASKS.md#sk-008--offline-replay-without-silent-data-loss) remains authoritative.

## Recommendation and approved constraints

Keep the approved architecture: account-scoped IndexedDB through **idb 8.0.3**, a foreground replay coordinator, and one service worker that caches only a public shell and explicitly listed public assets. PostgreSQL remains canonical. The source requirements are [APP_SPECIFICATION §9/A06/A15/A16/A20](../APP_SPECIFICATION.md#9-offline-privacy-and-operational-behavior), [PROJECT_PLAN §2.3/§3/M3](../PROJECT_PLAN.md), and [DECISIONS D03/D05](../DECISIONS.md).

Required outcomes: checklist changes and reflection drafts survive an offline reload when storage works; two-checkbox confirmation takes three actions; pending count and last-sync time are explicit; completion is not presented as server-confirmed before acknowledgment; reminders may continue until sync. Replay is ordered per session, uses stable operation IDs, retains original schedule/session identity, and pauses conflicts without silently replacing local work. Queue age beyond 30 days requires review/resubmission. Shared-device mode disables private local persistence. Logout offers sync, cancel, or explicit discard before clearing data. Offline setup/account creation/audio and guaranteed Background Sync remain excluded.

## Existing integration points and gaps

| Inspected source at the base commit | Consequence for SK-008 |
|---|---|
| `src/app/layout.tsx:7`, `src/app/(private)/layout.tsx:6–13` force dynamic rendering and call server auth; AppShell receives email but no account ID | Add a coordinator-owned account boundary receiving the verified UUID. Private HTML/RSC cannot be the offline shell. |
| `src/server/auth/server.ts:8–20` uses private/no-store responses and HttpOnly cookies; `getApiUser` verifies through `getUser` | Do not store access/refresh tokens or add a browser Supabase session for replay. Add a same-origin, no-store identity endpoint. Local account IDs are cache partitions, never authorization. |
| `src/features/practice/practice-panel.tsx:51–59,89–204` retains drafts/retry envelopes only in React state; failed save blocks subsequent practices; confirmation depends on server targets | Replace the persistence adapter with durable enqueue/read state. Keep raw numeric drafts separate from validated mutations. Confirm against the local projected checklist, then enqueue behind its prerequisite saves; server validation remains unchanged. |
| `src/components/api.ts:16–58` preserves safe server error details but drops HTTP status/Retry-After and cannot accept an AbortSignal | Coordinator extends the transport result/error contract for replay classification, cancellation and capped retries. A lost/unreadable response can follow a committed write: retain and retry the exact envelope. |
| `src/server/sessions/service.ts:12–44`, `src/server/db/operations.ts` already enforce ownership, superseded session rejection, revisions and receipts | Reuse these services. Do not silently rewrite a queued operation's session ID, schedule version, performed time or attempted request body. |
| `src/components/app-shell.tsx:63–71` immediately posts sign-out and navigates; sign-out route only calls Supabase | Coordinator adds pending-work choices, cross-tab shutdown and durable purge before navigation. SK-010 later supplies actual device-registration revocation; it does not exist yet. |
| `src/proxy.ts:25–38,75` applies nonce CSP/auth refresh to paths other than a short asset exclusion list | Add explicit `worker-src 'self'`; give only generated public shell/SW paths static-safe headers and bypass auth refresh. Preserve private-page nonce CSP. |
| No `src/offline/`, `src/service-worker/`, public SW/shell or idb dependency exists; no reflection/correction/undo contracts exist at this base | These paths/interfaces below are proposed. SK-006/007 adapter integration is dependent work, not available functionality. |

## Minimal ownership and module boundaries

- **W-offline:** `src/offline/{contracts,store,queue,replay,account}.ts`, offline provider/status/conflict controls and their tests. Storage/queue modules import only browser APIs and pure domain contracts/validation; no Next/server imports. One browser-neutral practice editor receives data and command callbacks, reused by the online adapter and public offline entry rather than duplicating target rules.
- **Coordinator:** shared `src/domain` additions, `src/components/api.ts`, app/layout/session/auth hooks and read routes, dependency/lockfile, public asset/CSP/proxy headers, and `scripts/build-offline.mjs`/build integration. Add only the approved idb pin. The existing Vite 8.2.2 build API can bundle a small standalone React entry from `src/service-worker/shell/` to generated `public/offline/`; this is an asset-build step inside the existing Next deployment, not another app server or stack. Compile/build verification is still required. [Vite build API](https://vite.dev/guide/api-javascript.html#build)
- **Service-worker ownership:** coordinator serializes the generated `public/sw.js` build; SK-008 owns shell/fetch source initially, SK-010 later extends that same source with push/click handlers. No second registration, Workbox/Serwist dependency, background queue service or service-worker mutation replay is necessary for M3.

## Proposed contracts to freeze before implementation

Use existing `Id`, `IsoInstant`, `Revision`, `SessionRecord`, `MutationEnvelope` and validators. The following function names and fields are the proposed boundary, not existing exports.

```ts
type AccountScope = { accountId: Id; generation: Id };
type LocalState = 'queued' | 'sending' | 'conflict' | 'review_required';
type PracticePayload = { values: Record<Id, boolean | number> };
type CompletionPayload = { performedAt: IsoInstant };
type KnownIntent =
  | { kind: 'practices'; payload: PracticePayload }
  | { kind: 'completion'; payload: CompletionPayload };

type EnqueueInput = {
  operationId: Id; // allocated once for the user's action, reused if enqueue is retried
  sessionId: Id;
  scheduleVersionId: Id;
  baseRevision: Revision;
  expectedLocalHead: Id | null;
  intent: KnownIntent;
};

type QueueOperation = EnqueueInput & AccountScope & {
  sequence: number;
  createdAt: IsoInstant;
  state: LocalState;
  // Null until the preceding local operation is acknowledged. Once set, immutable.
  request: MutationEnvelope<PracticePayload | CompletionPayload> | null;
  attemptedAt: IsoInstant | null;
  retryAfter: IsoInstant | null;
  // Persist the authorized current server snapshot separately from the original intent.
  conflict: { code: string; current: SessionRecord | null } | null;
};

type SessionLocalView = {
  canonical: SessionRecord;
  lastSyncedAt: IsoInstant;
  numericDrafts: Record<Id, string>;
  operations: QueueOperation[];
};

declare function bindAccount(accountId: Id): Promise<AccountScope>;
declare function saveSnapshot(scope: AccountScope, session: SessionRecord, lastSyncedAt: IsoInstant): Promise<void>;
declare function saveDraft(scope: AccountScope, sessionId: Id, numericDrafts: Record<Id, string>): Promise<void>;
declare function enqueue(scope: AccountScope, input: EnqueueInput): Promise<QueueOperation>;
declare function read(scope: AccountScope, sessionId: Id): Promise<SessionLocalView | null>;
declare function flush(scope: AccountScope, signal: AbortSignal): Promise<{
  acknowledged: number;
  pending: number;
  blocked: number;
  reason: 'drained' | 'not_leader' | 'offline' | 'auth' | 'conflict' | 'storage';
}>;
declare function resolve(scope: AccountScope, operationId: Id, choice:
  | { kind: 'use_server' }
  | { kind: 'submit_reviewed'; intent: KnownIntent; currentRevision: Revision }
): Promise<void>;
declare function clearAccount(scope: AccountScope, action: 'discard_confirmed' | 'synced'): Promise<void>;
declare function subscribe(scope: AccountScope, changed: () => void): () => void;
```

Extend the discriminated union using **the SK-006/007 frozen payloads and validators** for undo/corrections/reflections; do not invent their JSON here. Freeze whether reflection revision is independent of session revision, its response snapshot and conflict response. All operations for one session run in sequence, but a reflection revision must never be substituted for a session revision. The adapter registry maps each kind to a fixed same-origin route/method, validator and response revision extractor; queue records cannot contain arbitrary URLs/headers.

Coordinator read/transport contracts:

- Proposed `GET /api/auth/session` → `{ accountId: Id, now: IsoInstant }`, server `getApiUser`, same private/no-store headers, no credentials in JSON. Verify identity when a tab opens/returns to foreground and immediately before a flush. Use `fetch(..., {credentials:'same-origin', cache:'no-store'})`; 401 pauses the existing account's queue without deleting drafts. Provide a separate same-account reauthentication path.
- Proposed `GET /api/sessions/:id` → `{ session: SessionRecord, now: IsoInstant }`, authorized read, including an owned tombstoned record for conflict recovery; missing/other-owner records give the same safe 404. Add the SK-007 reflection read separately once its contract is frozen. No broad export/offline data dump.
- Mutations keep existing JSON envelopes. Add `X-Sankalpa-Account: <expected UUID>` on replay; the coordinator compares it with the server-verified user and rejects mismatch **before mutation**, never sets RLS claims from it. This closes the identity-check/request race. Routes remain usable for existing online callers without that optional header until all adapters are integrated.
- Transport returns safe `code`, `status`, `current`, bounded `retryAfterSeconds`, plus network/invalid-response classification; supports `AbortSignal`. Do not log payloads, cookies, account email or request URLs containing auth material.

## Queue and multi-tab algorithm

Use one versioned database (`sankalpa-offline`, schema 1) with `meta`, `sessions`, `drafts` and `operations` stores. Every private key/index starts with account UUID; operations are unique by `[accountId, operationId]` and ordered by `[accountId, sessionId, sequence]`. Store only recently visited session snapshots and their needed journey display labels, not entire private HTML/API responses. Start with an LRU limit of 50 unpinned sessions; never evict a snapshot/draft referenced by pending work. Set a conservative 500-operation cap with a visible refusal to accept more durable edits; never silently drop the oldest work. These bounds are implementation assumptions, not changed product rules.

1. `bindAccount` checks a durable origin-wide active-account/generation marker before private data is displayed. A generation changes on purge/account transition; every storage write, reply application and broadcast handler verifies it so stale tabs cannot repopulate erased data. Metadata contains no token or email. `saveDraft` handles invalid/incomplete numeric text; `enqueue` accepts only validated values and atomically checks the caller's local head, stores intent and advances its sequence. A stale same-browser tab receives a local conflict preserving its text rather than silently appending over an unseen edit. A retried operation ID must match the existing intent.
2. Await IndexedDB transaction completion before saying “Saved on this device.” IDB transactions contain only IDB work; never await fetch/timers inside them. Catch denial/quota/termination/upgrade-blocking errors and retain visible in-memory input with a clear “not saved; reload may lose this entry” message. Close connections on version change, show a reload-required state and keep pending records through additive migrations. idb 8.0.3 supplies `openDB` upgrade/blocked/blocking/terminated callbacks and `tx.done`. [Pinned idb documentation](https://raw.githubusercontent.com/jakearchibald/idb/v8.0.3/README.md)
3. One tab acquires `navigator.locks.request('sankalpa-sync:'+accountId, {ifAvailable:true}, callback)` for a bounded flush. No `steal`, timer-only leadership flag or infinite lock hold. Read/claim in an IDB transaction; send outside it; apply acknowledgment and queue removal in another transaction. Other tabs wake on enqueue, online, focus/reopen or Retry, and receive ID-only invalidation notices over BroadcastChannel. A nonleader schedules a bounded foreground retry while work remains; do not lose a wakeup when an enqueue races the leader releasing its lock. No drafts/reflections in broadcasts. A crashed leader releases the lock; the successor replays an unresolved attempt with the same envelope. Web Locks supplies cross-context exclusion, not server exactly-once semantics. [Lock request](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request), [W3C lifetime/coordination](https://w3c.github.io/web-locks/#termination-of-locks), [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
4. Example from server revision 5: checkbox A, checkbox B, then confirmation are three persisted intents in one session stream. A's frozen wire request uses revision 5; after its canonical response, B's first wire request uses that returned revision; confirmation similarly follows B. Persist the complete envelope **before** its first network attempt. A crash before local acknowledgment resends that exact envelope. This propagation is allowed only from the stream's own successful predecessor, never an unrelated fresh server revision. Do not combine/rewrite attempted operations. Freeze the user's reported performed time at the confirmation action, not reconnect time.
5. Stop the affected session stream on 409, including `REVISION_CONFLICT`, `ALREADY_CONFIRMED`, `JOURNEY_INACTIVE` and `SESSION_REPLACED`; retain local intent/draft and authorized server snapshot separately. Later intents remain blocked, other sessions can progress. 404/deletion, validation failure and >30-day age also require review. Never move old practice values to newly generated IDs. Choosing server state explicitly discards the reviewed local branch; choosing reviewed local values creates a **new** operation ID against the displayed current revision, with descendants explicitly reviewed/recreated. A further conflict repeats the comparison.
6. Network failure, timeout, unreadable acknowledgment and safe retryable 5xx retain the same request. Respect 429 Retry-After; capped exponential retry (1, 2, 4, 8, 16, 30 seconds) while foreground, reset by explicit retry/reopen. 401 pauses all account replay. A timeout/abort is an uncertain outcome, not proof the server rolled back. On acknowledgment, canonical metrics use the server snapshot; local pending completion is labeled separately and cannot cancel reminders. `navigator.onLine` is a trigger/hint, never proof an API is reachable. [Network-state limits](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine)

Feature-detect IDB, service worker and Web Locks with actual harmless operations. If storage or locking is unavailable, expose online-only behavior and explain that offline edits cannot be promised to survive; never pretend an in-memory queue is durable. Lack of Background Sync is not a blocker: replay runs on reconnect/reopen. Private browsing/eviction cannot be made durable by idb; no encryption/recovery promise. [Storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), [Background Sync availability](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)

## Public shell, reload and cache security

Generate `public/offline/index.html`, content-hashed JS/CSS and `public/sw.js` from owned source. The offline HTML contains no user identity, tokens, serialized Next RSC data or account content; its first paint is a neutral loading/locked state. The entry reads the active account marker and authorized explicit snapshots, renders the shared practice controls and local pending status, and can replay after connectivity returns. On first offline visit without a prior authorized snapshot, show “Connect and open this practice first.” It must never infer an account from a journey UUID in a URL.

Cache names use a Sankalpa public-build prefix. The generated manifest lists **exact** shell/asset URLs. Fetch the manifest assets with credentials omitted; cache only same-origin GET responses for those URLs after checking success, expected content type and no redirect. Never cache private navigation HTML, `?_rsc`/RSC requests, APIs, auth callbacks, exports, arbitrary static-looking suffixes or cross-origin resources. Cache API does not honor HTTP no-store by itself; the allowlist is the security boundary. [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache)

For allowlisted app document paths (`/today`, session-detail routes and the local saved-session list), try network navigation without saving its response; on a genuine network failure return the public shell. Never substitute HTML into an RSC/API request or mask an online 401/404/5xx with cached account data. Use ordinary document navigation to cached pages while offline; existing Next Link soft navigation requests RSC and cannot invoke document fallback. The shell parses only known paths, no arbitrary return URL. Do not cache the token-bearing `/auth/confirm` path or its query under any condition.

Exclude only `/sw.js` and generated `/offline/` assets from proxy auth/nonce processing. Supply static CSP with external same-origin scripts/styles only, `worker-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`; retain private-page nonce policy. SW must have JavaScript MIME type, root scope and no-cache update headers. Register one worker; first-use readiness requires an active controller, all shell assets cached and a successful IDB write. Do not claim readiness merely from registration. On updates, allow the new worker to wait while old clients remain; avoid unconditional `skipWaiting` or deleting assets still used by old clients. Purge only owned public-cache versions, never other origin caches or pending IDB records. [Registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register), [worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src)

The pinned Next 16.3.4 bundled guide `node_modules/next/dist/docs/01-app/02-guides/offline-support.md` explicitly limits experimental `useOffline` to soft navigation/Server Actions and says full reload still needs a worker. It does not retry direct client fetches. Do not add that experimental flag or caching changes to solve this task. The installed CSP guide confirms nonce pages require dynamic rendering. [Next offline guide](https://nextjs.org/docs/app/guides/offline-support), [Next CSP guide](https://nextjs.org/docs/app/guides/content-security-policy)

## Logout, account changes and shared devices

Before logout, freeze new edits/replay and obtain the same account lock; count drafts and queued/uncertain requests. Offer **Sync then sign out**, **Keep signed in**, or **Discard local changes and sign out**. Await any in-flight result or retain its uncertainty; discarding cannot undo a server commit. On confirmed discard/successful sync, increment the durable generation and mark the account locked, clear its records atomically, broadcast invalidation, drop React state/object URLs, then complete server sign-out and navigate. If auth sign-out fails, keep the local lock and report it; retry does not restore discarded records. Do not report successful logout until the server has cleared its HttpOnly session.

For an unexpected new login in another tab, stop replay and lock old local records before showing any cached private content. If old pending work exists, show only a generic pending-work notice with **sign in to the original account to recover** or **explicitly discard and continue**; do not show the previous account's names/notes under the new identity. Quarantine is temporary handling of unsynced work, not indefinite multi-account storage. With no pending work, purge the previous namespace before binding the new account. Handle already open pages and `pageshow`/back-forward restoration, not just login form submission. Expired auth preserves same-account drafts but disables automatic replay until that account is verified again.

Shared-device mode is a device/origin preference, checked before any private IDB write in every tab. Enabling it uses the same sync/cancel/discard flow, clears snapshots/drafts/queue, and retains only the public shell and nonsensitive preference/lock marker. Leave ordinary online writes functional. An offline clear-device action can remove browser records, but cannot revoke the server HttpOnly session or future server-side push registrations without connectivity; label that distinction and keep the local view locked until sign-out/revocation is acknowledged. Do not claim offline server logout. SK-010 must connect the account-device registration removal hook; server deletion/revocation must not rely solely on browser `unsubscribe()`.

## Dependencies and verification gates

**Concrete dependency gaps:** SK-006/007 payloads/response revisions/conflicts are absent at `d202559`; their replay adapters must wait for the coordinator's contract checkpoint. The current `RequestError` and account boundary need coordinator extensions described above. No service-worker/browser runtime was allocated in this preflight, so compatibility behavior and all implementation tests remain **NOT RUN**. No provider account, external service or paid infrastructure is needed for local SK-008 work.

**Limits resolved without redesign:** “Cache recent data” means explicit IDB records, not cached authenticated responses (D03/§3). Offline display is access to previously authorized browser data on this device; it cannot verify revocation while disconnected. Browser eviction and unavailable storage are disclosed failures, not guarantees. The static public entry is required because the existing dynamic authenticated root cannot be replayed safely from Cache Storage. The full task remains gated by SK-006/007 and integrated tests; preflight does not mark it DONE.

Required new tests, using real auth/database and the planned M3 fixture added through the existing guarded fixture runtime:

1. Chromium/WebKit/Firefox: visit Morning grounding, await offline-ready, disconnect, check twice and confirm, reload the **actual session URL**, retain values/pending count and reminder caveat, reconnect, acknowledge in order, reload once more; one completion and amendment set in DB. Retain synthetic `offline-pending.png` and acknowledgment evidence.
2. Same-browser two pages: competing enqueue/head conflict, one flushing leader, close leader after request dispatch/before acknowledgment, successor replays exact envelope; never two confirmations. Separate authenticated browser contexts test genuine two-device server conflicts and preserve both note texts.
3. Expired auth and account-switch races before dispatch/during response; old tab, offline reload and browser Back never expose another account's saved text. Sign-out cancel preserves pending data; explicit discard clears all tabs and survives reload. Shared-device mode leaves no private stores populated.
4. Denied IDB/QuotaExceededError, failed transaction commit, blocked schema upgrade, unexpected storage termination and eviction: no false saved banner, usable in-memory drafts and recovery message. >30-day queue preserves original draft and requires deliberate new submission.
5. Superseded/deleted/archived session, changed target/version, another-device undo and reflection revision conflict: retain original IDs/time/text; never silently retarget or rebase. Test 429 and lost/unreadable response after actual server commit, then idempotent retry.
6. Inspect Cache Storage keys and bodies after sign-in, session/reflection use and logout; no account HTML/RSC/API/export/auth callback response or tokens. Test service-worker update with a pending queue, CSP under a production build, 320px keyboard/axe flows, and M1–M3 regressions. Retain only allowlisted screenshots/safe summaries; raw auth-bearing traces stay ignored.

Planned execution: `npm run test:integration -- tests/integration/offline-replay.test.ts`, `npm run test:ui -- --grep @M3-offline`, then `npm run verify` and cumulative UI. These scripts exist, but the named offline tests do not yet exist. Coordinator adds the shell build to production and local UI startup before executing them; a dev-only offline test is insufficient.

## Source verification and handoff evidence

All linked official/publisher sources were opened on **2026-09-06**. [idb v8.0.3 package metadata](https://raw.githubusercontent.com/jakearchibald/idb/v8.0.3/package.json) confirms version, TypeScript declarations, ESM/CJS exports and ISC license; it has no React peer requirement. Browser APIs are runtime capabilities, not proof this package combination has passed this app's tests. No claim of a formal idb LTS guarantee or actual device testing is made. [MDN Web Locks compatibility data](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/LockManager.json) and the linked browser documentation support choosing feature-detected Web Locks/BroadcastChannel for the maintained browser targets. Service workers require a secure context; localhost is supported for development. [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

Performed: repository/Git/instruction/source inspection, official documentation verification, report readback/link checks and `git diff --check`. Not performed: dependency installation, source/config edits, local runtime/DB writes, build, application tests, browser/GUI activity or provisioning. The only saved change is this report. Next action: coordinator reviews the proposed interfaces, freezes SK-006/007 payloads and the account/transport additions, then assigns the owned implementation scopes. Use Git history for this report's commit; no application completion or user approval is implied.
