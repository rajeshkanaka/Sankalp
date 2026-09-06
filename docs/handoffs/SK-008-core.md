# SK-008 core implementation handoff

2026-09-06. Worker branch `task/SK-008-core`, worktree `/Users/rajesh/sankalpa-worktrees/SK-008-core`, base `b3e4a27`. Shared status remains in [TASKS](../TASKS.md). Core ownership is `src/offline/core/**`, focused offline tests, and this report. Coordinator owns actual app/SW/API integration and runtime.

## Frozen integration interface

`src/offline/core/index.ts` will export `createOfflineCore(options?)`, the same methods bound to a lazy default instance, all types from `types.ts`, and `OfflineError` with a safe `code`. The types are the concrete integration contract. Import only this entry point in UI; no server imports.

- After a verified identity, `bindAccount(accountId)` returns `{accountId,generation}`. A new account with pending old work quarantines it and throws `ACCOUNT_CHANGE_PENDING`; show generic recovery/discard options. Explicit `bindAccount(newId,{discardPrevious:true})` clears the previous private namespace. `getDeviceState()` exposes counts and a scope only when local data may be shown. It does not authenticate a browser cookie.
- `saveSnapshot(scope,{session,journeyTitle,reflection,preferences,lastSyncedAt})` stores explicit visited data. `read(scope,sessionId)` returns `snapshot` (canonical), `projectedSession`/`projectedReflection` (pending local feedback), `draft`, `draftRevision`, ordered operations and separate `heads.session`/`heads.reflection`. Never calculate canonical progress from the projection.
- `saveDraft(scope,sessionId,draft,expectedRevision)` preserves raw numeric/note input; returns the new draft revision. Null explicitly clears the draft. Compare-and-swap prevents stale tabs silently replacing text. UI keeps its in-memory text when any call fails.
- `enqueue(scope,{operationId,sessionId,scheduleVersionId,baseRevision,expectedLocalHead,intent})`: allocate one UUID per user action, preserve it on enqueue retries; use `heads.session` or `.reflection` and the matching canonical revision (reflection absence = 0). Intent kinds are practices/completion/completion_undo/reflection with the frozen domain payloads. A success means transaction commit completed, not server acknowledgment.
- `flush(scope,signal?)` is bounded, foreground, one Web Lock leader. UI schedules another foreground attempt at `retryAt`, and on online/focus/reopen/explicit Retry. `not_leader` also returns a retry time. No automatic background service. `subscribe` emits only invalidations; reread before rendering and clear React private state if the scope is invalid.
- Conflicts retain both versions. `refreshConflict` obtains an authorized comparison without changing queue payloads. `resolve` needs the exact reviewed stream operation IDs and draft revision, then either explicitly chooses server or submits one reviewed replacement intent/new UUID against the displayed current revision. Descendants in that stream are discarded only as part of that explicit reviewed choice; the other revision stream remains untouched. Session/version identity cannot change. Resolution also clears only the reviewed stream's raw draft fields.
- `clearAccount(scope,'synced'|'discard_confirmed')` invalidates every existing scope and purges private stores. Synced refuses outstanding drafts/operations. `setSharedDevice(scope,true,action)` performs the same pending-work gate and purge; every tab checks the durable preference before private writes. Disabling returns a fresh scope. Local clearing is never a claim of server logout.
- `getDeviceState/listSavedSessions` support the public offline shell. Feature failures reject with `OfflineError`; no in-memory persistence fallback. Limits: 500 pending operations, 50 unpinned saved sessions; pinned drafts/pending operations are not evicted. Over-30-day operations require review.

Read D15 and root D16. Base reflection validation is older than coordinator's verbatim Unicode fix; core consumes the shared validator and must be integrated onto that corrected source. No duplicate reflection normalization policy is introduced.

## Verification checkpoint

Types/API only at this checkpoint. Implementation, unit and real IndexedDB/browser checks: NOT RUN. No root database/environment/runtime was accessed. Next: implement storage, pure queue policy, fixed-route transport and replay, then run scoped static/unit checks and an isolated real-browser IndexedDB harness if available.

## Main-first resumption: verified core correctness checkpoint

2026-09-06. The coordinator consolidated PR #3 to main (`eac5cdc`), recorded assignments at `d7a1096`, and recovered this work into `rajesh_kanaka/offline-core` in the existing SK-008-core worktree. Historical branch `task/SK-008-core` remains preserved. Base `c4b0666` freezes ordered resolution replacements and comparison tokens; coordinator management-scope types were applied as `90997ec`. No root environment, database, runtime, main branch, PR, or remote push was touched by this worker.

The first resumption baseline `npx tsc --noEmit --incremental false` failed with twelve expected old-implementation/new-contract diagnostics. Five real-browser regressions then failed on the unfixed implementation: accepting an older canonical comparison, losing an independently acknowledged reflection, accepting an unseen refreshed comparison, failing to quarantine the actual ACCOUNT_CHANGED response, and purging during in-flight replay. These failures are superseded by the verified fixes below.

- Resolution checks the exact comparison token, ordered affected-stream IDs and raw-draft revision. A newer canonical revision in the reviewed stream requires fresh review. The other stream merges monotonically. Reviewed submissions validate and queue the entire ordered replacement sequence, preserve raw drafts and original performedAt values, enforce fresh IDs and the total queue limit, and advance successors only through actual predecessor acknowledgments.
- Account-change responses immediately quarantine, including comparison reads. Account switching first hides the old namespace, then obtains the old account's replay lock before a destructive discard; contention preserves pending work and returns SYNC_BUSY. Shared-device managementScope reveals only the active generation; private scope remains null and private reads/writes remain disabled.
- The standalone browser harness uses explicit Node imports/browser global declaration and its own Firefox MOZ_APP_DATA directory. An expected lock-contention callback rejection emitted a Firefox page error despite caller handling; returning a settled result from that callback and throwing outside the Web Lock boundary resolved the observed error. No page-error assertions were removed.

Actual checks after fixes: scoped Prettier, ESLint (zero warnings), full TypeScript no-emit, and six offline unit tests PASS. The isolated IndexedDB/Web Locks harness PASS in Chromium, WebKit and Firefox, including twelve named scenarios, actual document reload, two-page leadership and zero page errors. Transport remains explicitly synthetic; this is not app/auth/database/service-worker verification.

Exact next substep: add transaction-abort/quota/denied-storage, 500-operation ceiling, malformed-response and additional resolution-boundary tests; run all scoped gates and the full isolated three-engine harness again. Application integration, production build and M3 app UI tests remain coordinator-owned and NOT RUN by this worker. This checkpoint does not mark SK-008 DONE.

## Storage, capacity and transport verification completed

2026-09-06, 12:04 Asia/Kolkata. Production correctness checkpoint: `4d8f68c`. The subsequent change adds tests and safe harness reporting only; no production core behavior changed after that checkpoint.

The full isolated harness now executes seventeen named scenarios in each of Chromium153.0.8010.12, WebKit26.6 and Firefox155.0, including real document reload and two-page leadership. Every scenario passed, every browser reported zero page errors, and the command exited0. The full local unit suite passed118tests/10files; the six focused offline model tests also passed. Full TypeScript no-emit, scoped ESLint/Prettier and `git diff --check` passed.

New observed assertions cover quota and denied storage; aborted draft/enqueue/acknowledgment/resolution/purge transactions with rollback; exact retry after an accepted server effect whose local acknowledgment aborted;500pending operations and replacement accounting across both streams; empty/mixed/reused-ID/out-of-order/stale-draft resolution rejection; preserving a later acknowledged session while replacing reflections first→latest; retained unqueued raw input; shared-device management-only generations; malformed successful HTTP responses;429retry timing;401pause/recovery; and comparison-read ACCOUNT_CHANGED quarantine. Synthetic failure injection modifies browser APIs only within the isolated harness and restores them in finally blocks.

Reproduce from this worktree using Node24.20.0:

- `fnm exec --using 24.20.0 npx prettier --check src/offline/core tests/unit/offline-model.test.ts tests/offline-core`
- `fnm exec --using 24.20.0 npx eslint src/offline/core tests/unit/offline-model.test.ts tests/offline-core --max-warnings 0`
- `fnm exec --using 24.20.0 npx tsc --noEmit --incremental false`
- `fnm exec --using 24.20.0 npm run test:unit`
- `fnm exec --using 24.20.0 node tests/offline-core/run-browser.mjs`

The last command writes the ignored local `artifacts/offline-core/summary.json`: source commit/dirty marker, dates, full/focused scope, explicit synthetic-transport label, browser versions, static scenario result counts and page-error counts only. No raw private requests, response bodies, auth material or error messages enter that summary. A partial run is INCOMPLETE, never PASS. The completed run records source4d8f68c with dirty=true because the added tests/reporter were not yet committed; its production source is the reviewed checkpoint. The coordinator can retain that allowlisted summary alongside integrated M3 evidence.

All owned browser/server processes closed through finally. `.local/offline-core-browser/` and the private Firefox test directory remain ignored. No shared dependency/configuration, types, database migrations, root runtime, tracking file, remote branch or PR was changed in this verification slice.

Next owner/action: coordinator integrates the core correctness and follow-up verification commits, then verifies actual app/auth/database/service-worker offline reload/replay/conflict/account flows and cumulative regressions. The isolated harness intentionally does not claim that application integration or SK-008 is complete.

## Firefox flush failure regression

2026-09-06, 12:36 Asia/Kolkata. Base `4621edd`; active branch remains `rajesh_kanaka/offline-core`. The UI worker found an uncaught Firefox error during a handled transient storage failure. The earlier settled Web Lock callback fix covered exclusive account/resolution changes; replay's `flush` still returned a rejecting callback directly.

A new real-browser `flushStorageSetupFailure` scenario reproduced the failure before the fix: replacing `IDBDatabase.prototype.transaction` with a scoped synchronous `UnknownError` produced the expected `reason: storage` result, but Firefox emitted an uncaught page error and the harness failed its unchanged zero-page-error assertion. Chromium and WebKit passed that baseline. The injected browser method is always restored.

`flush` now settles the lock callback into a success/error outcome, then throws the error outside the lock to its existing error handler. A shared small helper also preserves the previous exclusive-lock behavior. Existing storage/account-change result codes and unknown-error propagation remain unchanged; no failed persistence is reported as an acknowledgment. The new scenario verifies no request was sent, the queued operation survived, and replay succeeds after storage recovers.

Actual verification after the fix:

- `OFFLINE_SCENARIOS=flushStorageSetupFailure fnm exec --using 24.20.0 node tests/offline-core/run-browser.mjs`: PASS in Chromium, WebKit and Firefox, including reload/multitab and zero page errors.
- `fnm exec --using 24.20.0 node tests/offline-core/run-browser.mjs`: all eighteen named scenarios PASS in each of Chromium 153.0.8010.12, WebKit 26.6 and Firefox 155.0; zero page errors; exit 0.
- `fnm exec --using 24.20.0 npm run test:unit`: 118 tests / 10 files PASS.
- Scoped ESLint, full TypeScript no-emit, scoped Prettier and `git diff --check`: PASS.

The browser evidence still uses real IndexedDB/Web Locks with a synthetic replay transport; integrated app verification remains coordinator-owned. Safe results are in ignored `artifacts/offline-core/summary.json`, recording base `4621edd` with dirty=true while this regression/fix was under test. No assertions were removed, no errors suppressed at the page boundary, no root runtime accessed, and all owned processes closed. The separate actual network-cutoff fixture and browser-emulation diagnosis are documented in [SK-008-network-testing](SK-008-network-testing.md).

Exact next action: coordinator/UI owner cherry-picks this focused core/regression/report commit, reruns the previously failing provider recovery scenario and the integrated M3 UI suite. This report does not mark the application task DONE.

## Verified redundant replay heads preserve later intentions

2026-09-06, 13:03 Asia/Kolkata. Production base `eb7ab42`; reminder preflight documentation separately committed at `f6c12d2`. Coordinator approved this bounded core fix after the UI worker identified a real-API mismatch in the synthetic transport.

Actual service inspection established that all four mutation kinds can return HTTP409 `NO_CHANGE` with `error.current`, after authentication, account/ownership, revision and target checks. The transaction rolls back and creates no operation receipt. Previously the core discarded that current value and permanently paused a reviewed ordered sequence such as true→false when the reviewed server state was already true. The first regression reproduced that exact blocking outcome before the fix; its assertion failed in Chromium against API-shaped synthetic responses passed through the real fetch transport.

The core now consumes a redundant head only when an actual409/NO_CHANGE response includes a structurally and semantically valid canonical record matching the account-scoped session/journey/version, attempted base revision, immutable session layout and exact attempted intent. Reflection equivalence includes text and ordered moods; completion requires matching performed time; undo requires the unconfirmed/null timestamp state. Missing, malformed, mismatched or older-than-local canonical responses remain reviewable conflicts.

The satisfied-head transaction preserves raw drafts and the other revision stream, removes only that verified head and releases its direct unattempted successor against the **same** canonical revision. It creates no server receipt, does not increment a revision and does not increase the actual-mutation acknowledgment count. Successors are sent normally. An aborted local removal rolls back the entire head/successor change and permits exact retry. No shared types, server APIs or database behavior changed.

New regression coverage uses real browser IndexedDB/Web Locks and the actual fetch adapter's error parsing with explicitly synthetic API-shaped responses. It is not an authenticated Next/PostgreSQL integration test. Five scenarios cover reviewed true→false plus an independent reflection/raw draft; identical reflection→latest; redundant confirm/undo in both directions; nineteen malformed/mismatched/stale response variants across session/reflection; and transaction rollback/retry. Every scenario asserts functional outcomes; the harness retains its zero-page-error requirement. The strict synthetic mode models NO_CHANGE without inventing a receipt; completion undo now reflects the real server's null recorded timestamp.

Actual commands/results:

- `OFFLINE_SCENARIOS=reviewedNoChange fnm exec --using 24.20.0 node tests/offline-core/run-browser.mjs`: observed RED before the fix, then PASS in all three engines.
- `OFFLINE_SCENARIOS=reviewedNoChange,noChangeReflection,noChangeCompletion,noChangeBoundaries,noChangeRollback fnm exec --using 24.20.0 node tests/offline-core/run-browser.mjs`: focused PASS in all three engines.
- `fnm exec --using 24.20.0 node tests/offline-core/run-browser.mjs`: final full23scenarios PASS in Chromium153.0.8010.12, WebKit26.6 and Firefox155.0, zero page errors, exit0.
- `fnm exec --using 24.20.0 npm run test:unit`:118tests/10files PASS.
- `fnm exec --using 24.20.0 npx eslint src/offline/core tests/offline-core --max-warnings 0`, full TypeScript no-emit, scoped Prettier and `git diff --check`: PASS.

The safe local summary is `artifacts/offline-core/summary.json`, final source marker `f6c12d2` with dirty=true because this tested implementation was awaiting its commit. All owned probe processes closed. No root services, private runtime/environment, remote push or shared tracking file was touched.

Exact next action: coordinator/UI owner integrates this core commit and runs the actual two-device UI/API case (queued10→30, other-device canonical10, preserved raw input and independent reflection). The real API must finish at revision2 with30, with no fabricated mutation for10. Actual app verification remains coordinator-owned and NOT RUN by this worker. SK-008 status remains exclusively in TASKS.

## Account binding generation guard: implementation checkpoint

2026-09-06. Coordinator contract `7c6ea14` was applied as `27d0cd5`. `getDeviceState` now returns the persisted binding generation even when no account is active or storage is quarantined. `bindAccount` validates an optional expected UUID and compares it atomically before any quarantine, generation change or purge. Its final transaction checks the same expected generation when no previous account was quarantined; account-switch transactions retain the existing check against the newly quarantined generation. Stale binding reports `ACCOUNT_CHANGED` without changing the current account's storage. Callers omitting the option retain their existing behavior.

Scoped Prettier, scoped ESLint, full `tsc --noEmit` and `git diff --check` passed on this implementation checkpoint. New binding-race browser regressions are being added next and are **NOT RUN at this checkpoint**. The coordinator requested this focused implementation commit early so the UI and safe online identity adapter can integrate it. This is not a claim of integrated task completion. Exact next action: prove stale A-after-B preserves B's canonical snapshot, queue and draft; prove stale generation after clear is rejected; exercise a clear between both binding transactions in all three actual browser engines.

### Account binding regression checkpoint

2026-09-06, 13:27 Asia/Kolkata; implementation commit `e50a68e`. `tests/offline-core/binding.ts` adds two actual-browser scenarios: `bindingGeneration` (18 assertions) covers initial/unbound, active, cleared, shared and quarantined tokens; malformed UUID rejection; stale A with explicit discard after B preserving B's full canonical snapshot/queue/raw draft; and fresh recovery. `bindingClearRace` (5 assertions) interposes only the ordering between both binding transactions, calls real `clearAccount` through a second core instance, and proves final binding cannot resurrect the cleared generation. Both still use actual IndexedDB/Web Locks. The scheduling hook is restored in `finally`.

Mutation checks temporarily removed each production guard independently and restored the exact committed source in `finally`. `bindingGeneration` failed without the first guard; `bindingClearRace` failed without the final guard. Both failures were the expected missing `ACCOUNT_CHANGED` rejection, not an unavailable browser or a compilation error.

Actual verification:

- `OFFLINE_SCENARIOS=bindingGeneration,bindingClearRace fnm exec --using 24.20.0 node tests/offline-core/run-browser.mjs`: PASS in all three engines, including reload/multitab and zero page errors.
- `fnm exec --using 24.20.0 node tests/offline-core/run-browser.mjs`: full25scenarios PASS in Chromium153.0.8010.12, WebKit26.6 and Firefox155.0; zero page errors, exit0.
- `fnm exec --using 24.20.0 npm run test:unit`:118tests/10files PASS. Scoped ESLint, full TypeScript no-emit, scoped Prettier and `git diff --check`: PASS.

The ignored safe summary `artifacts/offline-core/summary.json` records source `e50a68e` with dirty=true for the new tests. All owned browser/server processes closed; no root runtime, shared tracking or remote operation was used. Transport remains synthetic; actual application account verification/provider integration is coordinator-owned and is not claimed by these tests. Exact next action: integrate this test/report commit after `e50a68e`, then run the actual application's stale identity response and account-switch regressions. SK-008 is not marked DONE here.
