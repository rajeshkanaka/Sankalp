# SK-009 reminder schema integrity tests

2026-09-06, Asia/Kolkata. Worker `/root/branch_audit`; worktree `/Users/rajesh/sankalpa-worktrees/SK-009-schema-tests`; branch `rajesh_kanaka/reminder-schema-tests`; base `177ab8b` containing coordinator migration010 commit `90f4617`. Owned files are [the schema test](../../tests/integration/reminder-schema.test.ts) and this report only. [TASKS](../TASKS.md) remains authoritative. No application task is marked complete here.

The coordinator reported migration010 applied in its own slot2. This worker inspected its committed source and wrote **67 real PostgreSQL test cases**, but has no assigned runtime and did not execute their database actions. Initial checkpoint `274a621` contained 66 cases. The coordinator's attempted run stopped during fixture setup: the retained legacy `notification_event_check1` rejected worker event kinds. No test-body result was obtained from that attempt. The coordinator's migration011 source, inspected before application, repairs this by dropping that old kind guard while preserving the stronger replacement context guard, and restoring `recorded_at >= occurred_at` under the explicit name `notification_event_recorded_order`. The added 67th case rejects a record timestamp one millisecond before occurrence and positively accepts equality.

Coverage includes nullable explicit-test context versus required ordinary-job context; composite owner/session/version/device integrity; offset and request deduplication across devices/generations; temporal and dispatch-state constraints; one active endpoint binding with retained revoked history; event-to-job context consistency; one terminal outcome per attempt; dispatch attempt zero rejection; unchanged closure uniqueness; and read-receipt ownership/deduplication. Positive cases accompany rejection probes.

Security cases use the real restricted `withUser` connection for owner visibility, forbidden sensitive subscription columns, worker-event forgery, direct job/subscription/heartbeat writes and owner-role switching. They query effective PostgreSQL table/column privileges for `app_worker`, required role attributes/membership, object ownership and FORCE RLS. These are **catalog privilege checks, not proof of a worker login or worker functions**. Those runtime functions and credentials are outside migration010 and remain a separate NOT RUN gate.

The NOLOGIN owner probe deliberately uses a guarded administrative transaction with `SET LOCAL ROLE app_reminder_owner`, checks `current_user` and `session_user`, then proves canonical row locking works while even same-value updates and reflection reads are denied. It also tests immutable event/read grants with a successful append control. This is an actual PostgreSQL role-context test once executed, not an emulated `session_user` or claim of worker authentication.

Fixture safety follows the existing integration contract: guard the worktree/loopback/restricted URLs before any connection or mutation; create only two suite-specific `example.test` accounts with exact existing markers; bounded auth lookup and marker re-verification before cleanup; three synthetic journeys created through existing services; synthetic unusable `.invalid` subscription material, with no transport call. Schema fixture inserts use the guarded administrator because lifecycle functions are not yet available. Every subsequent administrative probe rolls back; rejected statements use savepoints so failed assertions cannot leave mutations committed. Teardown removes only the exact owned accounts, closes pools and restores the mode0600 suite clock setting. No broad reset or runtime borrowing is included.

## Verification performed in this worker

| Command                                                                                                                          | Result                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `fnm exec --using 24.20.0 npx prettier --check tests/integration/reminder-schema.test.ts docs/handoffs/SK-009-schema-tests.md`   | PASS.                                                                                                            |
| `fnm exec --using 24.20.0 npx eslint tests/integration/reminder-schema.test.ts --max-warnings 0`                                 | PASS.                                                                                                            |
| `fnm exec --using 24.20.0 npx tsc --noEmit --incremental false`                                                                  | PASS, full current worktree source.                                                                              |
| `fnm exec --using 24.20.0 npx vitest run --project integration tests/integration/reminder-schema.test.ts --testNamePattern '^$'` | Collection completed; **67 tests skipped**, zero test bodies or database hooks executed. This is not a SQL pass. |
| `git diff --cached --check`                                                                                                      | PASS at commit.                                                                                                  |
| All 67 PostgreSQL cases; actual worker login/functions; application smoke/build/UI                                               | **NOT RUN** by this worker.                                                                                      |

An initial `vitest list --json` used static discovery and misidentified the old `testJob` fixture helper as tests without expanding parameterized cases. The helper is now `explicitTestJob`; all-filtered runtime collection establishes the case count. Never report the static list as executed tests.

## Exact next action

Coordinator reviews/integrates this narrow test commit, ensures its reviewed migration011 repair is applied, then runs in its own guarded checkout:

```sh
fnm exec --using 24.20.0 npm run test:integration -- tests/integration/reminder-schema.test.ts
```

Record actual67-case results in the integration handoff. If a grant or invariant fails, preserve the assertion and repair the production boundary; do not treat administrative probes as worker runtime evidence. Migration011 lifecycle/claim/revalidate/settle tests and real worker-login verification remain additional work.

Only these two owned files are committed. The authorized dependency symlink to the existing M4 installation remains untracked. No SQL/shared files, dependency manifests, existing worktrees, services, databases, remote branches or runtime secrets were changed or accessed by this worker.
