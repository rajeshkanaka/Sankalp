# SK-001 integration-test handoff

Owner: `/root/m1_domain`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-tests`

Branch: `task/SK-001-tests`

Base: `acf32ba132cf7aeab7f3e6c31aacbd437ab508a7`

Implementation commit: `3c0d81b307e08c6ef1b570c8eac2c81a8be86bae`

## Delivered

- `tests/integration/activation.test.ts` exercises the real journey and session services against local Supabase. It covers exactly 21 persisted sessions, activation and confirmation idempotence, stale preview rollback, nested unknown-practice rollback, incomplete-target rejection, stale-revision conflict, persisted practice values and one-of-21 metrics.
- `tests/integration/auth-boundaries.test.ts` exercises cross-owner 404 behavior and RLS invisibility, composite owner/parent foreign keys, transaction-local claim cleanup on pooled connections, the shared request lock versus an exclusive account lock, restricted `app_api` role attributes and grants, practice-kind referential integrity, fail-closed administrative `DATABASE_URL` handling and complete Auth-user deletion cascades.
- The fixtures use only the exact synthetic addresses `integration-maya-activation@example.test`, `integration-maya-boundaries@example.test`, `integration-arun-boundaries@example.test` and `integration-delete-cascade@example.test`. Users are created through the local Supabase admin API with email already confirmed, so no email is sent. Each suite removes only its exact user IDs and its ignored local clock file.

No production source, shared configuration, migrations, package/lock files or shared tracking documents were changed.

## Defect found and resolved during integration

The first live database run passed 11 of 12 assertions but Supabase Auth admin deletion returned HTTP 500. The Auth service log identified SQLSTATE `23503`: deleting a user cascaded through `practice_version`, while `session_practice_practice_id_schedule_version_id_journey_i_fkey` still blocked deletion. The worker reported this immediately without editing the coordinator-owned migration.

The coordinator added and applied `supabase/migrations/202609060003_practice_deletion_cascade.sql`, recreating the composite practice foreign keys with `ON DELETE CASCADE`. The final suite includes a named regression that creates a real synthetic Auth user, activates a 21-session journey, deletes the user through the Supabase admin API, and verifies zero remaining rows in `auth.users`, `app.profile` and `app.journey`. That regression and suite cleanup now pass.

One test assertion was also corrected during development: table-level `UPDATE` is expected to be false when PostgreSQL grants only selected columns. The final grant check separately asserts allowed mutable columns and denied owner/kind columns.

## Verification

All commands used Node.js 24.20.0 through `fnm exec --using 24.20.0`.

| Command | Result |
|---|---|
| `npm ci` | PASS; 254 packages installed and 0 vulnerabilities reported; package and lock files unchanged. |
| `npm run format:check` | PASS; all matched files use Prettier formatting. |
| `npm run lint` | PASS; exit 0 with zero warnings. |
| `npm run typecheck` | PASS; exit 0. |
| `npm run test:unit` | PASS; 3 files and 47 tests. |
| `npm run test:integration -- tests/integration/auth-boundaries.test.ts tests/integration/activation.test.ts` | PASS against local Supabase slot 0 after migration 003; 2 files and 13 tests in 1.39 seconds. |
| `git diff --check` | PASS; no whitespace errors. |

The integration script reports that this worktree has no `.env.local`; the tests intentionally load `/Users/rajesh/sankalpa/.env.local` only when the required process environment is absent and never print its values. Each suite supplies its own ignored deterministic clock under `.local/`. A running local slot-0 Supabase database with the root migrations is therefore required to repeat the database checks.

## Integration next step

Cherry-pick the test and handoff commits, then rerun the focused integration command from the integrated root. Coordinator review, migration integration and retained regression evidence determine SK-001 status; this worker makes no DONE claim.
