# SK-004 transaction verification handoff

Date: 2026-09-06. Worker branch: `task/SK-004-transactions`; worktree: `/Users/rajesh/sankalpa-worktrees/SK-004-transactions`; base: `a28810b`. Task status remains exclusively in [TASKS](../TASKS.md).

## Changes

- Replaced the scheduling-dependent completion race with a deterministic completion-first case and added the reverse revision-first case. The tests hold the actual application transaction after its journey lock or supersede write, start the competing operation, and require PostgreSQL `pg_blocking_pids` to identify the winning connection before releasing it.
- Completion first preserves the confirmed original session and rejects the stale revision preview. Revision first preserves the old session's historical practice values, commits its tombstone and replacement, and rejects completion with `SESSION_REPLACED`. Each case checks that only the successful operation has a receipt.
- Added two failure-injection cases, immediately after the real supersede statement and immediately after the first real replacement-session insert. Each verifies the write occurred inside the transaction before throwing, then compares complete persisted journey, schedule, practice, session, value, amendment and receipt rows with the pre-operation snapshot. Retrying the same operation must succeed once and replay identically.
- Added a test-local connection-pool observer. It uses the existing guarded `app_api` connection and production `withUser` transaction wrapper; it does not replace SQL results, modify application code, introduce production fault flags, or install database objects. The original pool is restored and test connections close in `finally`; lock gates release even when assertions fail. Waits and statements have bounded timeouts.

The existing synthetic-account ownership markers, cleanup rules and clock file remain unchanged. Only the two owned integration-test files and this handoff are changed. No runtime was allocated, no environment file was copied, and no application or shared tracking files were edited.

## Verification actually performed

Commands ran in the worker worktree with the root's installed dependencies temporarily symlinked, without changing those dependencies:

```sh
fnm exec --using 24.20.0 npm exec -- prettier --check tests/integration/schedule-revisions.test.ts tests/integration/revision-test-helpers.ts
fnm exec --using 24.20.0 npm exec -- eslint tests/integration/schedule-revisions.test.ts tests/integration/revision-test-helpers.ts --max-warnings 0
fnm exec --using 24.20.0 npm run typecheck
git diff --check
```

Results: formatting, scoped lint, TypeScript and whitespace checks **PASS**. The temporary dependency symlink is removed before handoff. No worker processes need restarting.

Database integration, baseline app smoke, production build and browser checks: **NOT RUN** in this worker. The coordinator owns the only allocated database runtime and must execute the new tests after integration. These tests are verification code awaiting runtime confirmation, not evidence that the concurrency and rollback assertions have already passed.

## Exact next action

Review and integrate the focused `SK-004` commit containing this report, then run in the coordinator checkout with its existing guarded local environment:

```sh
fnm exec --using 24.20.0 npm run test:integration -- tests/integration/schedule-revisions.test.ts
```

Retain the actual test result in coordinator evidence, investigate any failure without weakening the lock or rollback assertions, and run the required integrated regression gates. The test-local observer deliberately recognizes the current SQL boundaries; a future service query change should update the corresponding observation point while retaining real lock/written-row proof.
