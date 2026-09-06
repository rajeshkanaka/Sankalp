# Branches and worktrees

Coordinator-owned map, reconciled2026-09-06. Begin every resume with `origin/main:docs/PROJECT_PROGRESS.md` and SESSION_LOG. Read active feature reports only after that accepted checkpoint. TASKS owns status; this file records locations and Git disposition.

## Active integration and worker map

All paths below are absolute. Branches are preserved; no cleanup/history rewrite was performed. Commit values are checkpoints, not a promise that a running worker has stopped making owned changes.

| Purpose | Branch / checkpoint | Worktree and responsibility |
|---|---|---|
| Accepted application/context | `main` /23f15b2, PR5 | Fetch origin/main first. PR5 exact-head CI34025184143 passed; normal merge verified. |
| Presentation tooling / emergency checkpoint | `rajesh_kanaka/emergency-checkpoint`, base638be75 | `/Users/rajesh/sankalpa`; coordinator owns SK-020 README/setup tooling. Application features remain paused. See its handoff for the ignored isolated verification clone; this is the normal PR route for the saved emergency context and tooling. |
| Offline PR5 integration | `rajesh_kanaka/offline-recovery` /526e947 (merged) | `/Users/rajesh/sankalpa`; coordinator, slot1.98UI passed on5c8962f; ce56222 full verify passed; accepted by PR5. Root retains runnable3001 demo; no feature writes here. |
| M4 coordinator | `rajesh_kanaka/reminder-integration` /3be8815 | `/Users/rajesh/sankalpa-worktrees/SK-009-integration`; coordinator, slot2. Own SQL/API/config/integration. Main23f15b2 merged;010 applied;011 draft under review. Own SQL/API/config/shared tracking; unfinished source preserved. |
| Preferences UI | `rajesh_kanaka/reminder-preferences` /305a6bb | `/Users/rajesh/sankalpa-worktrees/SK-009-preferences`; /root/merge_review. UI integrated3aa243b/177ab8b; historical no runtime. |
| Preference database tests | `rajesh_kanaka/reminder-database-tests` /291f2ac | `/Users/rajesh/sankalpa-worktrees/SK-009-database-tests`; /root/branch_audit. Own specified test/handoff only; coordinator runs DB checks. |
| Guarded push adapter | `rajesh_kanaka/push-transport` /8158aaa | `/Users/rajesh/sankalpa-worktrees/SK-011-transport`; /root/ci_triage. Reviewed transport integratede296259; historical, no DB/real sends. |

## Current bounded continuation assignments

- /root/branch_audit: `rajesh_kanaka/reminder-schema-tests`, `/Users/rajesh/sankalpa-worktrees/SK-009-schema-tests`, base177ab8b; owns only schema integration test and task report. Coordinator executes slot2 database tests.
- /root/merge_review: `rajesh_kanaka/reminder-ui-tests`, `/Users/rajesh/sankalpa-worktrees/SK-009-ui-tests`, base177ab8b; owns only M4 preference UI tests/report. Actual server/DB use remains coordinator-owned.
- /root/ci_triage: `rajesh_kanaka/reminder-worker`, `/Users/rajesh/sankalpa-worktrees/SK-011-worker`, base32333fe; owns src/worker, specified unit tests/report under frozen SK-011-worker-contract. No borrowed runtime, env, dependency or SQL edits.

## Preserved recent checkpoints

| Branch / HEAD | Worktree | Disposition |
|---|---|---|
| `rajesh_kanaka/reminder-domain` /78da7ec | `/Users/rajesh/sankalpa-worktrees/SK-009-domain` | Pure calculations reviewed and integrated2b66431. Pushed recovery ref; no further work here. |
| `rajesh_kanaka/offline-core` /dda115a | `/Users/rajesh/sankalpa-worktrees/SK-008-core` | Core/auth fixes integrated into PR5; domain review integrated into M4 as4c121ec. |
| `rajesh_kanaka/offline-ui` /810fcbc | `/Users/rajesh/sankalpa-worktrees/SK-008-ui` | UI/fallback/diagnostics integrated into PR5. Do not carry its baseline-onlyf4a712f. |
| `rajesh_kanaka/online-checkpoints` /018d9fb | `/Users/rajesh/sankalpa-worktrees/SK-006-closure-review` | Authenticated native keyboard/zoom evidence integrated; VoiceOver NOT VERIFIED. Helper/settings restored. |
| `rajesh_kanaka/checkpoint-policy` /1d15d81 | `/Users/rajesh/sankalpa-worktrees/project-checkpoint` | PR4 merged544f3ef; historical. |
| `rajesh_kanaka/consolidate-main` /30f80ca | No worktree | PR3 merged eac5cdc; historical. |
| `rajesh_kanaka/closure-history-fix` /71c8bd8 | Directory reused by online checkpoints above | Reviewed history fix integrated before PR3; historical. |
| `implementation/sankalpa` /ef6e0a9 | No worktree | Preserved overnight source, including original offline WIP; do not resume its task status. |

## Historical branches: do not resume their task lists

All worker paths below are relative to `/Users/rajesh/sankalpa-worktrees/`. Every listed source patch was integrated into `ef6e0a9` by ancestry or patch-equivalent cherry-pick. Journal's two final report commits differ as patches, but its final report is byte-identical to integrated `3cff091`. These branches need no additional feature PR and are retained as history; no branch/worktree/data deletion was performed.

| Branch | HEAD | Worktree |
|---|---|---|
| `docs/app-brief-readme` | `5cd8128` | None |
| `task/SK-001-domain` | `486aa4d` | `SK-001-domain` |
| `task/SK-001-fixtures` | `da8a0b8` | `SK-001-fixtures` |
| `task/SK-001-tests` | `ecfcc37` | `SK-001-tests` |
| `task/SK-001-ui` | `960dcbe` | `SK-001-ui` |
| `task/SK-002-report-privacy` | `f0af4ba` | `SK-002-report-privacy` |
| `task/SK-002-usability` | `59cb1c6` | `SK-002-usability` |
| `task/SK-003-drafts` | `09dfaad` | `SK-003-drafts` |
| `task/SK-003-setup` | `ed7be7a` | `SK-003-setup` |
| `task/SK-003-tests` | `f01be95` | `SK-003-tests` |
| `task/SK-003-ui-verification` | `24a8809` | `SK-003-ui-verification` |
| `task/SK-004-conflicts` | `04d9601` | `SK-004-conflicts` |
| `task/SK-004-revisions` | `2cd4494` | `SK-004-revisions` |
| `task/SK-004-transactions` | `c1c8300` | `SK-004-transactions` |
| `task/SK-005-progress` | `cd0bb0d` | `SK-005-progress` |
| `task/SK-005-timing` | `0b0c1d4` | `SK-005-timing` |
| `task/SK-006-corrections` | `f19f637` | `SK-006-corrections` |
| `task/SK-007-boundaries` | `3774f2f` | `SK-007-boundaries` |
| `task/SK-007-journal` | `2245372` | `SK-007-journal` |
| `task/SK-008-http` | `037ab05` | `SK-008-http` |
| `task/SK-008-preflight` | `a619c55` | `SK-008-preflight` |

## Resource and preservation facts

- Root alone owns allocated slot 1: app 3001, UI 3101, API 54421, database 54422, captured mail 54424, explicitly loopback. Restart using PROJECT_PLAN §5 and PROJECT_PROGRESS. Workers never borrow its database/environment or ports.
- Original reconciliation found tracked trees clean. Current active workers may have owned changes and documented untracked dependency symlinks; inspect live Git and never stage those symlinks. M4 coordinator alone owns slot2 (3002/3102/API54521/DB54522/mail54524). Historical dependency directories are not unfinished source.
- Slot 0 and `artifacts/private-legacy-slot0-20260906/` remain stopped/preserved under D16. Do not reset or migrate that legacy data as part of resuming slot 1.
- Validation: `git worktree list --porcelain`, per-tree `git status --short`, `git branch -vv`, `git cherry implementation/sankalpa <branch>`, ancestry checks, and final journal handoff comparison. Fresh `git ls-remote` confirmed main, integration and all three SK-008 pushed checkpoints on 2026-09-06.
- Before every accepted PR, update this map for actual new assignments/checkpoints. Future sessions reconcile live Git with it; no assumption that a process or agent survived.

Coordinator checkpoint branch `rajesh_kanaka/checkpoint-policy` at `/Users/rajesh/sankalpa-worktrees/project-checkpoint` is historical after PR4 merged. No runtime or future work there. Every main update must use a PR; do not repeat the observed administrator bypass on d7a1096.


## Emergency pause pointers — 2026-09-06 15:52 IST

All agents stopped. Main23f15b2 contains accepted PR5, but new independent P1 review is unresolved. Root checkpoint branch is `rajesh_kanaka/emergency-checkpoint` in `/Users/rajesh/sankalpa`; it preserves the outside review and next corrective task. Resume that P1 before M4.

M4 current source/report4d9fd1d is saved on `rajesh_kanaka/reminder-integration`, SK-009-integration, slot2; migration011 applied and65/74 combined tests passed,9 failed. Read its emergency handoff before any migration; corrections must be012. Pending source refs: reminder-schema-testsa57388b (one extra timestamp regression), reminder-workerfd613d4 (worker code), reminder-preferences-checkpointe26bffe (report only; no bridge source yet). The latter worktree is `/Users/rajesh/sankalpa-worktrees/SK-009-preferences-checkpoint`. Previous preferencesUI/UI-test/transport/domain commits remain preserved. No worker has active ownership to continue during this break. Secrets, node_modules symlinks and private runtime data remain untracked/ignored.
