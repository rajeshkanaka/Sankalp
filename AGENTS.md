# Sankalpa: shared engineering instructions

## Authority and navigation

The repository is the durable context for Codex, Claude Code, and other coding agents. Read this file directly; no plugin, personal memory, or vendor orchestration is required.

- [PROJECT_PROGRESS](docs/PROJECT_PROGRESS.md): current checkpoint, approval gate, ownership references, exact next action.
- [TASKS](docs/TASKS.md): **only authority for task status**, dependencies, owners and permitted changes.
- [PROJECT_PLAN](docs/PROJECT_PLAN.md): architecture, contracts, commands, demos, verification and integration procedure.
- [DECISIONS](docs/DECISIONS.md): selected stack, product clarifications, sources and approval/change history.
- [APP_SPECIFICATION](docs/APP_SPECIFICATION.md): product behavior and A01–A27 acceptance requirements.
- [SESSION_LOG](docs/SESSION_LOG.md): dated session evidence and handoffs. Task reports use exactly one `docs/handoffs/SK-NNN.md` per task, edited in place; no topic/substep reports.
- [BRANCHES](docs/BRANCHES.md): current integration route, worker worktrees and preserved historical checkpoints. **Start from `origin/main`'s progress and TASKS status table**, then follow its explicit active-branch handoff; a worker's older tracking files never override main.

Current user instructions take precedence. Preserve approved behavior when code disagrees with it. D21 records the user-approved launch reduction and overrides older scope. Do not restore deferred work or expand the stack without approval. Stack changes require user approval recorded in DECISIONS. D10 retains original plan approval. D21 limits launch scope and requires stopping after the trimming PR for user review; respect the current checkpoint and latest user instruction before further implementation. Deployment remains bounded by supplied accounts, budget/domain details and real-device access; never invent those prerequisites.

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

1. Read ONLY PROJECT_PROGRESS.md, the TASKS.md status table, and the current task's single handoff. PROJECT_PLAN.md, APP_SPECIFICATION.md and DECISIONS.md are lookup-on-demand for a concrete current question, never read-on-boot. Do not bulk-read docs/, archives, SESSION_LOG or legacy topic reports.
2. Confirm `pwd`, OS/tool versions, branch, `git worktree list`, `git status --short`, staged/unstaged diffs and recent commits. Compare actual worktree paths with ownership assignments.
3. Reconcile the checkpoint with code and evidence. Do not assume the previous session ended cleanly or that its process still runs. Preserve all uncommitted work; investigate discrepancies before claiming completion.
4. Do not read PROJECT_PLAN to start; commands are already in package.json and the current task. Use the smallest relevant installed check before extending code; run `npm run test:smoke` when changing the first workflow. Documentation-only edits need link/size/diff checks, not app startup or browser runs. Missing tools or failed required checks are blockers, not passes.
5. Respect pending approvals and other owners. Resume the recorded unfinished substep; otherwise claim the next dependency-ready task within the approved milestone. Do not restart completed work unnecessarily.

## Work and checkpoint protocol

- One coordinator assigns one owner per active task, records branch/worktree/resource slots in TASKS, and establishes shared contracts before parallel work. Follow PROJECT_PLAN §7; sequential execution uses the same tasks.
- Use one `docs/handoffs/SK-NNN.md` per task, edited in place; never create SK-NNN-topic side files. Checkpoint entries are at most five factual lines, no prose. Do not create a handoff per substep: update the task-specific report with changes, exact commands and actual results, evidence, failures, commit/base SHA, dirty files and the next substep. Workers do not change TASKS, PROJECT_PROGRESS, DECISIONS or SESSION_LOG.
- After each task, coordinator reviews and integrates its owned changes, reruns relevant integration/regression checks, then updates TASKS and the compact progress/session records. A successful worker check alone cannot make a task DONE.
- D18: use short feature branches from current main and reviewed PRs back to main. Commit/push/PR/merge are authorized by the user's resume request. Main owns the accepted code and coordinator records; worker branches retain unfinished source and task reports. Merge runnable, tested increments with explicit limitations; merge is not launch approval or a reason to mark blocked tasks DONE. Keep branch pointers and exact next action in the same PR as accepted changes. All main updates, including tracking-only checkpoints, use PRs under D18 and the repository rules; never use administrator bypass.
- Keep integrated code and tracking aligned in focused commits containing the task ID. If interrupted between integration and tracking, record the mismatch and reconcile on resume. Update architecture/decisions only when their content changes.

## Verification and definition of done

Use package.json and the current task for commands; consult PROJECT_PLAN only when a specific unresolved contract requires it. Required implementation gates are formatting, lint, typecheck, unit, database/API integration, production build, Playwright UI checks and dependency security review. `next build` does not replace lint or typecheck. Each task lists its additional checks in TASKS.

DONE means acceptance passed, required tests actually ran successfully, changes were reviewed and integrated, regression evidence is retained, and the coordinator recorded the result. A blocked/unavailable test stays NOT RUN and prevents DONE for the affected task. Keep technical task completion separate from the user's milestone review in PROJECT_PROGRESS. Development uses Chromium only. Full three-browser checks run only as the final PR merge gate. Screenshots only at milestone end with `SANKALPA_MILESTONE_EVIDENCE=1`; no intermediate evidence manifests or unnecessary downloads. Retain compact test results/CI logs.

For every milestone, launch the actual integrated app, exercise the specified workflow with functional assertions, and capture real screenshots. Label simulated transport and unavailable features visibly. Present startup commands, reachable entry point, actual test outcomes and evidence; then continue under D10 after technical gates pass, retaining evidence for the user. Screenshots and user review do not replace tests. Never call a sandbox-only address accessible to the user.

Size limits: SESSION_LOG <8 KB (newest three entries), TASKS <15 KB, PROJECT_PROGRESS <4 KB. Archive older detail with a one-line pointer; never read archives on startup. Do not repeat broad tests for unchanged code or download unused browsers/artifacts.

## Before stopping or after interruption

- Record completed and unfinished substeps, dirty/staged paths, failures, blockers, ownership, branch/worktree, base/integration commits and the exact next action. Link evidence; do not invent files, tests, screenshots, commits or approval.
- Update task handoff, then have the coordinator update TASKS, PROJECT_PROGRESS and SESSION_LOG. Include restart/verification commands and any required seed profile. Stop owned processes if appropriate and record it; assume none survive.
- Recover unexpected interruptions from Git, saved task reports and fresh smoke checks. Never discard uncommitted work or promote an unverified task to DONE.
- Review the final diff for unrelated edits and sensitive data before committing. State what changed, checks actually run, limitations and pending approvals in the final handoff.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
