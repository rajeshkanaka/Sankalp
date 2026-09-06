# SK-008 offline UI break checkpoint

Date: 2026-09-06 (Asia/Kolkata)

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-008-ui`

Branch: `task/SK-008-ui`

Base: `3cff091`

Status: **WIP checkpoint for the user-requested break. This is not a completed or verified implementation.**

## Saved work

The unintegrated UI slice currently defines these intended browser-neutral exports under `src/offline/ui/`:

- `OfflineAccountBoundary({ accountId, children })` and `useOfflineAccount()` for verified UUID binding, generic account-change quarantine, private-state withholding and online-only fallback state.
- `OfflineSession({ snapshot, now, demo, onCanonicalChange? })` for projected checklist values, raw numeric/reflection drafts, queued completion/correction/undo/reflection intents, foreground replay, pending/server-ack distinction and conflict choices.
- `OfflineSavedPage()` for device-scoped saved-session links after `getDeviceState()` supplies a valid scope; it never selects an account from a URL.
- `OfflineAccountControls({ onSignOut })` for pending counts, sync/cancel/confirmed-discard sign-out choices and shared-device controls.

The approved clock contract is `Snapshot.clock: { serverNow, capturedAt, simulated }`. The UI freezes `serverNow` in demo mode and otherwise advances it by elapsed device time from `capturedAt`. Core worker checkpoint `86769b5` contains this required type and runtime validation.

No Next imports, server imports, private response caches or authentication data were added to the offline UI. The source imports React, the external Temporal polyfill, pure domain status/contracts, shared CSS, and only the offline core entry point.

## Incomplete work and known risks

- `src/offline/ui/offline.module.css` has not been created. All current UI modules import it, so the slice cannot compile yet.
- Core implementation commit `86769b5` is not present on this branch. This base contains only the earlier frozen type file and no `src/offline/core/index.ts`, so the UI imports cannot resolve here.
- The core handoff marks conflict resolution incomplete: stale comparison/newer canonical regression and its fix remain before the UI conflict actions can be verified.
- The current UI code has received formatting only. Its state transitions, effect dependencies, account invalidation, draft CAS sequencing, sign-out freeze, shared-device transitions and exact resolution operation-ID set need source review against the finished core implementation.
- The `OfflineSession` adapter contract assumes the coordinator supplies a `Snapshot` whose clock exactly matches the verified `now` and `demo` props. Root integration must construct that snapshot once from the authorized server response and device capture time.
- No offline UI test was written. `tests/ui/offline.spec.ts` remains outstanding.
- Root-owned `ensurePublicShell(): Promise<boolean>`, service-worker shell/build, app hooks, API routes, provider mount, `SessionExperience` adapter and online fallback are not part of this branch.

## Checks and processes

- `/Users/rajesh/sankalpa/node_modules/.bin/prettier --write src/offline/ui` — PASS; seven current UI source files formatted.
- `git diff --check` — PASS before the handoff was added; rerun after staging.
- Format check, lint, typecheck, unit, integration, production build and Playwright — **NOT RUN** because the current branch intentionally lacks the core implementation/index and offline CSS at this break checkpoint.
- No service, database, browser or test process was started from this worktree. Existing Next/Playwright/Firefox processes shown by `ps` use `/Users/rajesh/sankalpa` and belong to the coordinator; this worker did not stop them.

## Exact next substep after resume

1. Reconcile the completed/fixed core commit that supersedes `86769b5` into this branch without changing core-owned files.
2. Read the final core resolution tests to freeze the exact `expectedOperationIds` set and shared-device scope transition.
3. Add `offline.module.css`, run typecheck/lint, and fix the current WIP source from observed diagnostics.
4. Review account invalidation and draft-write races, then add focused browser-neutral tests plus `tests/ui/offline.spec.ts` for network-off reload/reconnect, one server completion, conflict choices, account quarantine, storage failure and sign-out/shared-device recovery.
5. Hand the verified UI commits to the coordinator for `SessionExperience`, public-shell and production-build integration. Root alone runs the real M3 database/browser gates and records evidence.

## Resume checkpoint: coherent UI exports, 2026-09-06

New owner `/root/merge_review`, branch `rajesh_kanaka/offline-ui`, same worktree, recovered base148ca78. Core correctness4d8f68c is incorporated as50c34fb, with managementScope types677397d incorporated as3997c50. No shared source was independently edited.

The missing CSS is now present and uses the existing dark/brass tokens. Current UI adds account-ID keyed boundaries, cancellable identity reads, management-scope adoption for shared-device changes, and an editor checkpoint barrier before account actions. Failed local drafts remain in memory with explicit saved-versus-local comparison; queued conflict choices show the complete affected stream plus raw draft, carry the comparison token, and preserve all ordered replacement intents. Server practice summaries use server values. An absent server reflection is revision0; blocked queues are never labeled acknowledged. Sign-out errors unfreeze controls. Timing labels, custom moods/prompts, completion/undo and the Done link are retained.

Coordinator integration exports:

- `OfflineAccountBoundary({accountId,children,ensureOfflineReady?:()=>Promise<boolean>})`: omitted/false readiness selects `online_only`; pass the real public-shell readiness function. Account/generation invalidation hides children. Do not substitute mock readiness in the application.
- `useOfflineAccount().status`: coordinator's SessionExperience selects the existing online controls for `online_only`; the ready branch mounts `OfflineSession({snapshot,now,demo,onCanonicalChange?})`.
- `OfflineSavedPage({asStandalone?:boolean})`: defaulttrue supplies main for the public shell; passfalse inside the authenticated app's existing main.
- `OfflineAccountControls({onSignOut})`: owns device/sync/discard choices before invoking the coordinator's actual sign-out operation.

Actual local checks: scoped ESLint/Prettier and full `npm run typecheck` PASS after source changes. Initial lint found the misleading usePrivateStorage name and unused useMemo; both corrected. `next typegen` only generated ignored types; no app or database runtime was started. Functional browser checks, screenshots and actual application integration remain NOT RUN at this export checkpoint; the worker is preparing tests next. This checkpoint is not SK-008 completion.

## Recovery and browser checkpoint, 2026-09-06

Current owner remains `/root/merge_review`, branch `rajesh_kanaka/offline-ui`. Source after027c20b now provides immediate pending checkbox feedback without claiming persistence before IndexedDB success. Scope-bound invalidation cannot revoke an adopted shared-device generation. A temporary account-storage read failure withholds private UI, freezes actions and retains the mounted editor/input; Retry verification restores the same verified generation. A confirmed account change still removes the old private subtree. No coordinator status change is needed: ready stays ready during temporary withholding, and context.frozen is true.

Draft cleanup now uses the revision captured before enqueue, and checkbox intents never rewrite the whole raw draft. Failed CAS requires review. Canonical-change notification tracks the last notified server revision independently of subscription/flush order, including use-server resolution. Raw invalid numeric text survives reload. Sign-out always requires verified local clearing, even when initial storage failed and no scope was available. Edited completion-time input participates in the account checkpoint guard. Deferred read errors remain recoverable UI errors.

New browser-neutral harness: `tests/offline-ui/run-browser.mjs`, `harness.tsx`, `core-adapter.ts`. It runs the actual React UI, IndexedDB and Web Locks in isolated Chromium, WebKit and Firefox against an explicitly simulated backend/public-shell readiness callback. The harness-only adapter pauses after real enqueue to deliver a competing raw-draft update before UI cleanup; it is never imported into the application. Generated bundles and synthetic screenshots live under ignored `.local/offline-ui-browser` and `.local/offline-ui-evidence`. No application/DB runtime or root process was started by this worker.

Actual verification at this checkpoint:

- `fnm exec --using 24.20.0 npx eslint src/offline/ui tests/offline-ui tests/ui/offline.spec.ts` — PASS.
- `fnm exec --using 24.20.0 npm run typecheck` — PASS after the network-helper import and complete harness sources were added.
- `fnm exec --using 24.20.0 node tests/offline-ui/run-browser.mjs` — Chromium and WebKit PASS: failed-draft retention, storage-read withholding/recovery, exactly-once canonical notification, immediate checkbox, shared-device roundtrip, invalid numeric keyboard/reload, account quarantine, draft-cleanup CAS, complete ordered conflict replay and explicit discard. Firefox reaches the functional assertions but FAILS the no-pageerror gate during injected transaction-setup failure: core.flush's rejecting Web Locks callback reports an uncaught OfflineError. Core worker owns the fix; do not waive the assertion. Earlier harness plugin lacked enforce:pre and did not execute the intended race; that test setup was corrected before the reported passing CAS run.
- Actual app `tests/ui/offline.spec.ts` — NOT RUN by worker. Three cases cover real auth/DB offline reload/reconnect, injected quota recovery and real account switch. Network fixture4621edd was coordinator-approved and incorporated asd26089e; all browsers use actual origin connection cutoff, Chromium additionally uses browser offline. Reconnection uses a user reload, not a synthetic online event. Parent must run these against its integrated production build and proxy.
- Integration/unit/build/full regression/security review — NOT RUN by worker. Parent owns these gates and task status.

Exact coordinator next action: cherry-pick this scoped UI checkpoint, integrate the pending core.flush outcome fix, rebuild, run `fnm exec --using 24.20.0 node tests/offline-ui/run-browser.mjs`, then the configured actual-app Playwright selection `tests/ui/m1.spec.ts tests/ui/offline.spec.ts tests/ui/offline-fallback.spec.ts` followed by required M1–M3 regressions. Test-run environment/seed/runtime commands remain in PROJECT_PLAN and the coordinator checkpoint. SK-008 remains unverified until those actual integrated gates pass. Worker next substep: compact opt-in header controls and any concrete integrated-test fixes.

## Privacy controls and actual conflict test checkpoint, 2026-09-06

Scoped recovery commits21834ea andef7f33a correct status semantics for accessibility, refuse private-mode enablement while registered online editors have unstored input, and retain a frozen/hidden subtree if verification fails after a successful privacy mutation. Core commits ef6e85f andeb7ab42 were incorporated as e8448df and4edc11f after coordinator approval; this resolves the Firefox handled Web Locks rejection. The first direct eb7ab42 cherry-pick lacked its preceding test fixtures and conflicted; it was aborted with all UI WIP preserved, then both commits applied cleanly in order.

The UI now accepts `OfflineAccountControls({onSignOut, compact?:boolean})`, defaultfalse. Coordinator may passcompact in the top bar: Sign out stays visible, Device privacy expands options, and pending-input choices expand automatically. The narrow layout was exercised at320px and its actual synthetic screenshot reviewed; parent retains responsibility for the app-header screenshot.

The expanded isolated harness verifies13 named scenarios per browser, including dirty online-editor protection and recovery after a post-toggle storage read failure. Actual Chromium/WebKit/Firefox runs PASS all13 with zero page errors after core fix integration. The reporter now emits `artifacts/offline-ui/summary.json` with only source SHA/dirty flag, actual engine versions, fixed scenario outcomes and page-error counts. Backend and public-shell readiness are explicitly labeled simulated. No raw error text, authentication URL or private content enters this summary. Synthetic screenshots and detailed local output remain ignored under `.local/offline-ui-evidence`.

`tests/ui/offline.spec.ts` now adds a fourth, actual two-device-context conflict scenario. The second context saves10 minutes on the real server while the first retains revision0. The first queues10 then30 minutes during actual connection cutoff, adds raw invalid numeric text and a reflection, reconnects, verifies every compared change and current server value, captures a conflict screenshot, keeps the reviewed sequence and verifies30 minutes with raw draft/reflection preserved through reload. The first queued10 is already satisfied: this deliberately requires the core worker's pending NO_CHANGE handling fix and expects no fabricated revision for that satisfied head. The existing synthetic backend permits no-op writes; it does not establish this actual API edge case. This fourth actual-app case is NOT RUN by this worker, as are the other actual-app cases; coordinator must run them against its owned runtime after the core fix and retain both conflict/resolved screenshots. No task completion is claimed by these worker checkpoints.
