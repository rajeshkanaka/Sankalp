# SK-009 reminder preference database test handoff

2026-09-06, Asia/Kolkata. Owner `/root/branch_audit`; worktree `/Users/rajesh/sankalpa-worktrees/SK-009-database-tests`; branch `rajesh_kanaka/reminder-database-tests`; base `b81788576a04b502738b70bf0ee9f29add87be20`. This assignment covers only [the integration test](../../tests/integration/reminder-preferences.test.ts) and this report. The coordinator owns migrations, services, shared records and runtime execution. [TASKS](../TASKS.md) remains authoritative; this report does not mark application work complete.

## Source and coverage

Inspected migration `202609060009_reminder_preferences.sql` at the base commit, the shared reminder and journey Zod schemas, existing guarded synthetic auth helpers, and actual journey draft/metadata/activation/future-revision services. Current preferences remain exclusively `journey.draft.reminders`; the migration derives `journey.reminder_revision`. No future jobs or worker functions are assumed by these tests.

The file contains **87 JSON validation cases**, each with assertions for the two public Zod schemas and for the real SQL validation function. Cases cover required/exact keys, booleans without coercion, offset array/type/integer/uniqueness/range/count rules, enabled-with-empty rejection, disabled suggestions, strict quiet-hour object and minute strings, wraparound and unequal bounds, whitespace/newline/Unicode-digit rejection. Expectations come from the frozen strict contract, not from treating either validator as the oracle.

Fourteen further PostgreSQL tests cover SQL NULL returning `false`; PostgreSQL 17 major and restricted function/column privileges; initial zero and exactly one reminder revision per actual change; equal JSON rewrites; required journey revision advancement; direct application and administrative trigger guards; nonzero initial revision rejection; full rollback of prior preference/metadata writes after JSON null, missing reminders or SQL null; existing idempotent whole-draft retries; actual metadata and future-schedule services preserving current reminders and historical snapshots; two concurrent CAS writers; and owner isolation with a positive second-owner control.

The database suite calls `loadGuardedIntegrationRuntime()` before connections or fixture writes. It uses its own Maya/Arun `example.test` identities and exact existing synthetic markers, bounded auth lookup, re-verification before cleanup, and a mode0600 suite clock. The administrative connection is confined to one explicit trigger constraint probe against the exact owned journey and always rolls back. Other data work uses restricted `withUser`. Cleanup closes the application pool and restores the previous clock setting, including after test failure. No broad database reset is included.

## Actual verification

Node **24.20.0**, macOS. No database/runtime was assigned to this worker; none was started, connected to or reset. The coordinator's slot2 and root services were not accessed. Only an untracked local `node_modules` symlink to the already installed coordinator M4 dependency directory was created, as authorized; it is not part of the commit.

| Command in this worktree                                                                                                                         | Observed result                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `fnm exec --using 24.20.0 npx prettier --write tests/integration/reminder-preferences.test.ts`                                                   | PASS after correcting the first draft's missing `flatMap` closing parenthesis.                           |
| `fnm exec --using 24.20.0 npx eslint tests/integration/reminder-preferences.test.ts --max-warnings 0`                                            | PASS.                                                                                                    |
| `fnm exec --using 24.20.0 npx tsc --noEmit --incremental false`                                                                                  | PASS, full current worktree TypeScript source.                                                           |
| `fnm exec --using 24.20.0 npx vitest run --project integration tests/integration/reminder-preferences.test.ts --testNamePattern 'JSON boundary'` | **87 PASS**, 101 database cases filtered out; database hooks were not run. This is schema-only evidence. |
| `fnm exec --using 24.20.0 npx prettier --check tests/integration/reminder-preferences.test.ts docs/handoffs/SK-009-preferences-database.md`      | PASS at handoff.                                                                                         |
| `git diff --cached --check`                                                                                                                      | PASS at handoff.                                                                                         |
| Full `tests/integration/reminder-preferences.test.ts` execution                                                                                  | **NOT RUN: 101 PostgreSQL cases require the coordinator's guarded runtime.**                             |
| Application smoke/build/UI, dispatch, jobs or real devices                                                                                       | **NOT RUN in this bounded test-source assignment.**                                                      |

The initial syntax error prevented collection; it was a test-authoring failure, not an application regression. Subsequent schema collection/execution, lint and types all passed. No SQL pass is inferred from parsing or static review.

## Coordinator next action

Review and integrate this test-only commit, then run in the coordinator's own guarded checkout with migration009 applied:

```sh
fnm exec --using 24.20.0 npm run test:integration -- tests/integration/reminder-preferences.test.ts
```

Expected discovery at this checkpoint: **188 tests total** (87 schema cases plus 101 PostgreSQL cases). Record actual SQL outcomes and any fixes in the coordinator handoff. Keep a genuine SQL/Zod disagreement or failed constraint assertion as a failure; do not weaken expectations to match implementation. Existing job/worker/snooze/device tests remain separate future contracts.

At handoff, the only tracked additions are this report and its test file; the dependency symlink remains untracked and must not be staged. No push, application change, SQL change, shared tracking update, service or fixture mutation was performed by this worker.
