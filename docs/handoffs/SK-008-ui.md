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
