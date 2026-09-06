# SK-009 pure reminder calculations

2026-09-06. Isolated preparation under D12; this report does not mark SK-009, M3 or M4 complete. [TASKS](../TASKS.md) remains the status authority. Owner: `/root/ci_triage`; branch: `rajesh_kanaka/reminder-domain`; worktree: `/Users/rajesh/sankalpa-worktrees/SK-009-domain`; accepted-main base: `544f3efd2169a1cdf485690408b8edd791cd2eda`. The coordinator supplied the frozen `docs/handoffs/SK-009-domain-contract.md` on the active integration checkout.

## Changes and integration contract

- [reminders.ts](../../src/domain/reminders.ts) exports `reminderPreferencesSchema`, `quietHoursContain`, `planSessionReminders`, `planSnooze` and their result types. It reuses `ReminderPreferences`, `IsoInstant` and the specified `SessionRecord` fields from the existing [domain contracts](../../src/domain/contracts.ts).
- The strict preference schema rejects unknown fields and coercion. Enabled reminders require one to eight unique integer offsets in −1440..0; disabled reminders preserve zero to eight valid suggestions. Quiet hours use distinct, padded minute bounds. Defaults remain the caller's responsibility.
- Calculations use elapsed minutes and canonical UTC instant output. Quiet-hour membership uses the actual instant in the saved session timezone, with an inclusive start and exclusive end, including midnight wrapping and both occurrences of a repeated DST time. Reminders are suppressed without moving their intended time. Expiry is the earlier of target plus five minutes and session closing.
- Session preview preserves every configured offset in chronological order, including suppressed entries. If several conditions apply, the reported reason has deterministic precedence: disabled, completed, superseded, past, then quiet hours. Snooze applies the same first three reasons, followed by not open, window closed, target at/after closing, then target quiet hours. It adds exactly ten elapsed minutes and requires the target strictly before closing.
- Inputs are not mutated. Invalid preference data, unparsable instants and nonpositive session windows throw instead of producing eligible plans. Session ownership and the canonical schedule/timezone remain caller preconditions.

These are pure calculations: no clock reads, sends, jobs, persistence or network access. The coordinator must adopt the exported schema in existing journey validation when reminder routes are integrated; that shared schema is unchanged here. Callers must enforce account/journey/device eligibility, preference and subscription generations, operation idempotency and transactional cancellation. An eligible snooze result requires the caller to atomically replace pending reminders in `[now, scheduledAt]`. No output claims notification acceptance, display or delivery.

## Verification and evidence

Run from this worktree using the already installed pinned dependencies. No install, environment access or service startup occurred.

| Command                                                                                              | Observed result on 2026-09-06                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `fnm exec --using 24.20.0 npx prettier --write src/domain/reminders.ts tests/unit/reminders.test.ts` | PASS; only the two owned source/test files formatted.        |
| `fnm exec --using 24.20.0 npm run test:unit -- tests/unit/reminders.test.ts`                         | PASS; 74 tests, one file, Vitest 5.0.0.                      |
| `fnm exec --using 24.20.0 npx eslint src/domain/reminders.ts tests/unit/reminders.test.ts`           | PASS; exit 0, no diagnostics.                                |
| `fnm exec --using 24.20.0 npm run typecheck`                                                         | PASS; Next route type generation and `tsc --noEmit`, exit 0. |
| `fnm exec --using 24.20.0 npm run test:unit`                                                         | PASS; 186 tests across ten files.                            |

The focused [test file](../../tests/unit/reminders.test.ts) retains deterministic assertions for A02 midnight reminder dates, sorted/nonmutating offsets, strict validation, disabled suggestions, exact-now suppression, completed/superseded sessions, quiet-hour boundaries, DST spring gaps and autumn folds, and snooze/expiry boundaries. These tests use the real Temporal implementation; no transport is mocked because no transport exists in this scope.

Production build, app smoke, database/API integration, browser UI, worker dispatch and device notification checks: **NOT RUN** in this preparation worktree. Integration and the relevant regression gates remain the coordinator's responsibility. No app or database process was started, so there is no worker runtime to restart or stop.

## Source verification

Verified 2026-09-06 against the existing exact package pins: `@js-temporal/polyfill` 0.5.1, Zod 4.5.4, Node 24.20.0, Vitest 5.0.0 and TypeScript 6.0.3. No version or lockfile changed.

- [Temporal Instant documentation](https://tc39.es/proposal-temporal/docs/instant.html): offset-bearing instant parsing, elapsed-time arithmetic and conversion to a specified timezone.
- [Temporal PlainTime documentation](https://tc39.es/proposal-temporal/docs/plaintime.html): comparison of local wall-clock times.
- [Zod API documentation](https://zod.dev/api?id=objects): strict objects and validation refinements.

The pinned libraries were exercised by the checks above; current documentation alone is not treated as test evidence.

## Checkpoint and exact next action

Stage and commit only `src/domain/reminders.ts`, `tests/unit/reminders.test.ts` and this report. The pre-existing local `node_modules` symlink appears untracked under the current main-based ignore rule and must remain unstaged. No other source or shared tracking files belong to this worker. No push is authorized for this worker branch; the coordinator manages its explicit remote destination.

Next: the coordinator reviews the three-file commit, integrates it into the appropriate reminder feature branch while preserving current offline work, and reruns unit/static checks on that integrated source. Add shared validation, real transactional reminder records and application wiring only under their separately assigned ownership and frozen contracts. Resume from this completed pure-calculation checkpoint, not by recreating these helpers or treating them as an operational reminder system.
