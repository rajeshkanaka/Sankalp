# Sankalpa: shared engineering instructions

## Authority and navigation

The repository is the durable context for Codex, Claude Code, and other coding agents. Read this file directly; no plugin, personal memory, or vendor orchestration is required.

- [PROJECT_PROGRESS](docs/PROJECT_PROGRESS.md): current checkpoint, approval gate, ownership references, exact next action.
- [TASKS](docs/TASKS.md): **only authority for task status**, dependencies, owners and permitted changes.
- [PROJECT_PLAN](docs/PROJECT_PLAN.md): architecture, contracts, commands, demos, verification and integration procedure.
- [DECISIONS](docs/DECISIONS.md): selected stack, product clarifications, sources and approval/change history.
- [APP_SPECIFICATION](docs/APP_SPECIFICATION.md): product behavior and A01–A27 acceptance requirements.
- [SESSION_LOG](docs/SESSION_LOG.md): dated session evidence and handoffs. Task reports live at `docs/handoffs/<task-id>.md` once implementation starts.

Current user instructions take precedence. Preserve approved behavior when code disagrees with it. Do not silently redesign the stack or reduce launch scope. Stack changes require user approval recorded in DECISIONS. Until PROJECT_PROGRESS records plan approval, do planning work only. The user approved the full plan on 2026-09-06 and explicitly requested continuous implementation through completion, commits and pushes. Milestone review pauses are waived by D10; continue after technical gates pass, retaining demo evidence. Deployment remains bounded by supplied accounts, budget/domain details and real-device access; never invent those prerequisites.

## Engineering rules

- Use the selected stack and exact version policy in DECISIONS. One npm package and lockfile; simple modules; no agent runtime, extra queue, ORM or speculative service.
- Keep domain calculations pure; route handlers enforce authentication and validation; transactions enforce ownership, revisions and atomic changes. Never calculate authoritative progress separately in each screen.
- Preserve stable practice dates, historical schedule/practice snapshots, amendments and reminder truth. Examples are editable templates, never prescribed practices.
- Respect existing user changes and the repository LICENSE. No unrelated refactoring, generated noise or dependency churn. Never regenerate this file through a scaffold tool.
- Only the coordinator edits shared configuration, dependency/lock files, migrations and shared tracking documents. Workers request shared changes in their handoff. Serialize overlapping work.
- Never log or commit secrets, authentication links, push endpoints/keys, real reflections or personal test data. Use synthetic fixtures. No secrets in `NEXT_PUBLIC_*`; no private authenticated page/API caching.
- Do not weaken tests or access controls to pass a check. Validate external inputs and ownership of nested IDs. Preserve drafts and explain recoverable errors.
- Focused local implementation commits with task IDs are authorized **after plan approval**. Explicitly stage owned files. No remote pushes, PRs, shared-history rewrites, destructive cleanup, provisioning or deployment without explicit authorization. Real test email/push requires an authorized recipient/device and environment.

## Start/resume protocol

1. Read this file, PROJECT_PROGRESS, relevant TASKS/PROJECT_PLAN sections, applicable DECISIONS and the latest SESSION_LOG/task handoff.
2. Confirm `pwd`, OS/tool versions, branch, `git worktree list`, `git status --short`, staged/unstaged diffs and recent commits. Compare actual worktree paths with ownership assignments.
3. Reconcile the checkpoint with code and evidence. Do not assume the previous session ended cleanly or that its process still runs. Preserve all uncommitted work; investigate discrepancies before claiming completion.
4. Run available baseline smoke checks from PROJECT_PLAN §5. Before application scripts exist, use the documented documentation-only baseline and record app checks as **NOT RUN**. After implementation exists, start its local services and run `npm run test:smoke` before extending it. Missing tools or failed required checks are blockers, not passes.
5. Respect pending approvals and other owners. Resume the recorded unfinished substep; otherwise claim the next dependency-ready task within the approved milestone. Do not restart completed work unnecessarily.

## Work and checkpoint protocol

- One coordinator assigns one owner per active task, records branch/worktree/resource slots in TASKS, and establishes shared contracts before parallel work. Follow PROJECT_PLAN §7; sequential execution uses the same tasks.
- Checkpoint after a meaningful verified substep: update the task-specific report with changes, exact commands and actual results, evidence, failures, commit/base SHA, dirty files and the next substep. Workers do not change TASKS, PROJECT_PROGRESS, DECISIONS or SESSION_LOG.
- After each task, coordinator reviews and integrates its owned changes, reruns relevant integration/regression checks, then updates TASKS and the compact progress/session records. A successful worker check alone cannot make a task DONE.
- Keep integrated code and tracking aligned in focused commits containing the task ID. If interrupted between integration and tracking, record the mismatch and reconcile on resume. Update architecture/decisions only when their content changes.

## Verification and definition of done

Command definitions and availability are centralized in PROJECT_PLAN §5. Required implementation gates are formatting, lint, typecheck, unit, database/API integration, production build, Playwright UI checks and dependency security review. `next build` does not replace lint or typecheck. Each task lists its additional checks in TASKS.

DONE means acceptance passed, required tests actually ran successfully, changes were reviewed and integrated, regression evidence is retained, and the coordinator recorded the result. A blocked/unavailable test stays NOT RUN and prevents DONE for the affected task. Keep technical task completion separate from the user's milestone review in PROJECT_PROGRESS.

For every milestone, launch the actual integrated app, exercise the specified workflow with functional assertions, and capture real screenshots. Label simulated transport and unavailable features visibly. Present startup commands, reachable entry point, actual test outcomes and evidence; then continue under D10 after technical gates pass, retaining evidence for the user. Screenshots and user review do not replace tests. Never call a sandbox-only address accessible to the user.

## Before stopping or after interruption

- Record completed and unfinished substeps, dirty/staged paths, failures, blockers, ownership, branch/worktree, base/integration commits and the exact next action. Link evidence; do not invent files, tests, screenshots, commits or approval.
- Update task handoff, then have the coordinator update TASKS, PROJECT_PROGRESS and SESSION_LOG. Include restart/verification commands and any required seed profile. Stop owned processes if appropriate and record it; assume none survive.
- Recover unexpected interruptions from Git, saved task reports and fresh smoke checks. Never discard uncommitted work or promote an unverified task to DONE.
- Review the final diff for unrelated edits and sensitive data before committing. State what changed, checks actually run, limitations and pending approvals in the final handoff.
