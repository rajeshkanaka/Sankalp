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
