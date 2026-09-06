# Branches and worktrees

Coordinator-owned map, reconciled 2026-09-06. **Begin every resume with `origin/main:docs/PROJECT_PROGRESS.md` and `origin/main:docs/SESSION_LOG.md`.** Follow their active feature/report pointers after reading the accepted baseline. TASKS alone records task status; this map records Git disposition, not completion.

## Current integration route

The first application [PR3](https://github.com/rajeshkanaka/Sankalp/pull/3), merged to main as **eac5cdc** on2026-09-06, used `rajesh_kanaka/consolidate-main`, based on the verified `implementation/sankalpa` checkpoint `ef6e0a9`. It brings tested sign-in, personalized schedules, progress, correction history, journal and HTTP account guards to main. Seven inactive offline source/test files are intentionally excluded and remain recoverable at `ef6e0a9`. No unfinished core/UI work is included. D18 governs later PRs.

After consolidation, the coordinator uses `rajesh_kanaka/offline-recovery` from merged main at `/Users/rajesh/sankalpa` (slot 1) for integrated SK-008 work. The feature and both main-based worker branches now exist from PR3/eac5cdc. The assignments below are current; only the coordinator changes shared tracking/configuration.

| Purpose | Branch / saved HEAD | Location and next action |
|---|---|---|
| Accepted source of context | `main` / inspect fetched HEAD | Start here; use `git show origin/main:docs/PROJECT_PROGRESS.md` without switching dirty worktrees. |
| Active coordinator feature | `rajesh_kanaka/offline-recovery` / integrated core/provider checkpoint `e0f163a` | Root `/Users/rajesh/sankalpa`, slot1; /root owns shared contract, app/API/build/SW and integrated regression. Read its SK-008 handoff for newer verified wrapper/test checkpoints. |
| Accepted checkpoint/hydration PR | `rajesh_kanaka/checkpoint-policy` / `1d15d81` | `../sankalpa-worktrees/project-checkpoint`; historical PR4 head, merged to main as `544f3ef` after CI34017887283 passed. |
| Account-boundary review/regressions | `rajesh_kanaka/online-checkpoints` / `15acb23` | `../sankalpa-worktrees/SK-006-closure-review`; /root/ci_triage owns only assigned tests/review reports. Fallback testb8c8d04 and actual boundary test15acb23 are integrated in root. No database/runtime. Previous closure/hydration refs remain preserved. |
| Accepted consolidation | `rajesh_kanaka/consolidate-main` / `30f80ca` | Historical PR3 head; merged eac5cdc. No future work here. |
| Preserved overnight checkpoint | `implementation/sankalpa` / `ef6e0a9` | Historical branch, no future integration here. Retains all prepared SW sources. |
| Closure-history review fix | `rajesh_kanaka/closure-history-fix` / `71c8bd8` | Historical source ref; its old worktree directory now hosts online checkpoint regressions above. Integrated as ad78c5c after tests1b33394; coordinator full verification and53UI passed. Historical after PR3 merges. |
| Active offline core | `rajesh_kanaka/offline-core` / verified binding regression `f7a38ca` | `../sankalpa-worktrees/SK-008-core`; /root/branch_audit owns core implementation/tests/handoff, now integrated for coordinator validation. No database; own random-loopback browser harness. Saved WIP source remains task/SK-008-core86769b5. |
| Active offline UI | `rajesh_kanaka/offline-ui` / provider recovery `dd20cbc` | `../sankalpa-worktrees/SK-008-ui`; /root/merge_review owns offline UI/CSS/UI regressions/handoff. Completing final focus/readiness/verification race tests; no database/runtime. Saved WIP source remains task/SK-008-ui3d54c3b. |

Original worker branches remain preserved without active worktrees; current workers reuse the existing directories on the new names above. New branches use `rajesh_kanaka/`. Keep the original WIP commits reachable. To resume on a fresh main-based worker, carry only its owned source/test/handoff commits; never overwrite coordinator tracking with an old branch's PROJECT_PROGRESS/TASKS/SESSION_LOG. Shared core contract changes must be reconciled by the coordinator first.

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
- The audit found all tracked trees clean. SK-008-core has only the documented untracked `node_modules` dependency symlink; never stage it. Historical dependency directories are not unfinished source.
- Slot 0 and `artifacts/private-legacy-slot0-20260906/` remain stopped/preserved under D16. Do not reset or migrate that legacy data as part of resuming slot 1.
- Validation: `git worktree list --porcelain`, per-tree `git status --short`, `git branch -vv`, `git cherry implementation/sankalpa <branch>`, ancestry checks, and final journal handoff comparison. Fresh `git ls-remote` confirmed main, integration and all three SK-008 pushed checkpoints on 2026-09-06.
- Before every accepted PR, update this map for actual new assignments/checkpoints. Future sessions reconcile live Git with it; no assumption that a process or agent survived.

Coordinator checkpoint branch `rajesh_kanaka/checkpoint-policy` at `/Users/rajesh/sankalpa-worktrees/project-checkpoint` is historical after PR4 merged. No runtime or future work there. Every main update must use a PR; do not repeat the observed administrator bypass on d7a1096.
