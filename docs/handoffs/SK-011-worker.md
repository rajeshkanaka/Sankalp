# SK-011 bounded worker handoff

2026-09-06. Worker owner: `ci_triage`; coordinator owns SQL, runtime configuration, dependencies, tracking and integration. Task status remains authoritative in [TASKS](../TASKS.md). This report covers an isolated worker slice, not completion of SK-011.

## Checkpoint and ownership

- Worktree: `/Users/rajesh/sankalpa-worktrees/SK-011-worker`.
- Branch: `rajesh_kanaka/reminder-worker`.
- Frozen base: `32333fecef44c83f3feef73f1cf885f5cc2aa79c`.
- Implementation checkpoint is the focused `SK-011: implement bounded reminder worker and safe database adapter` commit containing this report. Resolve its SHA with `git log -1 --format=%H -- docs/handoffs/SK-011-worker.md`; coordinator records the integrated SHA.
- Owned source: `src/worker/{store,validation,runner,loop}.ts`; owned tests: `tests/unit/worker-{store,runner,loop}.test.ts`; this handoff. No shared source/configuration, migration, tracking, dependency or runtime files changed.
- `node_modules` is an intentionally untracked local symlink to existing pinned dependencies in `SK-009-integration`; never stage it. No installation, app launch, database connection, browser action, provider send or deployment occurred in this slice.

## Implemented interface and behavior

The [frozen contract](SK-011-worker-contract.md) and `src/server/reminders/worker-contracts.ts` remain the interface authority. All worker relative imports use `.js`; there are no Next or environment imports.

- `createPostgresWorkerStore(connectionString, optionalPoolFactory)` supplies the six parameterized SQL operations plus `close()`. The pool has five connections, 5-second connection acquisition, 10-second statement timeout and 30-second idle timeout. Each checkout starts a short transaction, validates `current_user = session_user = app_worker`, no superuser/BYPASSRLS/memberships, invokes one narrow function, commits/rolls back and releases. No transaction or connection spans transport. SQL errors are replaced with fixed safe errors; asynchronous pool errors log only `worker_database_pool_error`.
- `runOnce({store, transport, now, simulated, signal?})` claims up to four jobs at a time, processes at most fifty jobs, and waits for every settlement before the next claim. Prepared identities, lease tokens, mode, expiry and structured outcomes are checked. Claiming an expired/recovery row is allowed: SQL may finalize it and return `ready: false`, which sends nothing. An aborted/expired prepared attempt settles a truthful no-send result. Missing/mismatched preparation sends nothing; an exception after transport invocation settles uncertainty. Invalid transport data or mode leaves lease recovery to SQL and cannot become a fabricated receipt.
- A closure sweep runs independently after dispatch failures: at most fifty candidate sessions, four concurrent closure calls, preserving SQL's one immutable closure stream. Heartbeat follows successful bounded database work. Abort stops new work while existing send/settlement work drains.
- Returned counts contain numbers only. `accepted`, terminal/transient failure and uncertainty counts mean successfully settled outcomes; `sent` means transport invocation. A rejected/failed settlement increments operational failures, never a durable accepted count. Provider acceptance is not evidence of phone display.
- Notification payloads contain only the frozen allowlisted fields. Generic text is the default; a nonnull SQL-supplied opt-in title is bounded using JSON escaping and Unicode code points so the full UTF-8 payload stays at most 3072 bytes. Test notifications use null journey/session IDs. SHA-256-derived 32-character base64url tags are stable per session/device generation (per job for test notifications). Endpoints, keys, intentions, reflections and authentication URLs are excluded from payloads and aggregate reporting.
- `runWorkerLoop(options)` waits thirty seconds after each completed tick, without overlaps, then closes the pool on shutdown. `runWorkerCli(args, options, optionalSignalSource)` accepts only no arguments or one `--once`, handles SIGINT/SIGTERM by aborting and draining, and removes its listeners. One-shot operational failures return 1; invalid arguments return 2; ordinary successfully recorded provider failures do not become operational failures.

Coordinator integration: supply the guarded mode/clock/connection configuration and selected transport. The simulated adapter must receive the same domain clock (`{now: () => Date.parse(now())}`), particularly for the historical M4 fixture. Add the actual worker build/entrypoint/scripts in the coordinator scope; no runnable CLI startup script is claimed here. The frozen base's shared `worker-contracts.ts` import still omits `.js`; coordinator already owns its NodeNext correction. SQL claim must commit its job locks before preparation takes parent locks; recovery history belongs in parent-locked preparation, not claim.

## Verification actually performed

Environment verified: Darwin; Node **24.20.0**, npm **11.19.0**, existing pinned dependency symlink. Default shell Node was 26.5.1, so every npm check below explicitly used `fnm exec --using 24.20.0`.

| Command                                                                                                                                         | Observed result                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `fnm exec --using 24.20.0 npm run test:unit` before implementation                                                                              | PASS: 407 tests, 13 files.                         |
| `fnm exec --using 24.20.0 npm run test:unit -- tests/unit/worker-runner.test.ts tests/unit/worker-store.test.ts tests/unit/worker-loop.test.ts` | PASS: 82 tests, 3 files.                           |
| `fnm exec --using 24.20.0 npm run test:unit` after implementation                                                                               | PASS: 489 tests, 16 files.                         |
| `fnm exec --using 24.20.0 npm run typecheck`                                                                                                    | PASS: route type generation and `tsc --noEmit`.    |
| `fnm exec --using 24.20.0 npm run lint`                                                                                                         | PASS: full configured lint, zero warnings.         |
| `fnm exec --using 24.20.0 npm run format:check`                                                                                                 | PASS: full configured code/test/script formatting. |

Evidence is the committed executable regression tests and this observed-results ledger; no raw database/authentication logs were captured. Unit fixtures inject stores, pools, signals and transports; these are explicitly simulated. One test exercises the selected simulated transport itself with format-valid synthetic key bytes and a historical clock; it makes no external request. Full unit coverage also includes the existing transport tests, including their bounded loopback TLS fixtures; that is not live-provider evidence.

Useful failed attempts retained:

1. Initial focused run had one test-fixture failure: the exact-lease-expiry stub returned the same job again because its original queue remained populated. The repeated-claim safety check correctly rejected it. The fixture now returns an empty subsequent batch; production safeguards were retained.
2. Initial test doubles widened discriminants and had unused parameters. Type/lint checks caught these; explicit literal/function types fixed them. No runtime contract changed.
3. The selected simulated-adapter regression first exposed placeholder keys that correctly produced `invalid_input`; format-valid synthetic bytes now isolate the intended case. It then failed because worker validation required integer `retryAfterMs`, while the frozen type and transport permit numeric values. Validation now preserves bounded finite fractional advice. The same test passes with `0.5`, and no transport behavior was changed.

## Remaining work and exact next action

Independent review and coordinator integration are still required. **NOT RUN here:** actual restricted-role SQL calls, migration application, worker lease/restart/closure races against PostgreSQL, final NodeNext worker build and entrypoint, actual app/API/UI checks, hosted CI, live Web Push or device receipt. Unit success does not complete these gates.

Break checkpoint: coordinator requested an immediate pause after this local commit. Coordinator reports M4 integration is paused for a separate PR5 P1 fix; migration011 was applied in its slot, but SQL auth-schema USAGE and a test SET ROLE restriction need the planned coordinator-owned migration012/test correction. Those results were not independently executed in this worker. Resume from accepted main's progress and the coordinator's newer integration handoff before acting on this branch.

Next after the pause: coordinator reviews and cherry-picks the focused worker commit, finishes the SQL/runtime correction and guarded build configuration, runs the real slot2 SQL/worker tests including competing workers and cancellation/recovery, then app regression gates. Preserve the original main/feature tracking authority; this worker's older progress files do not supersede accepted main. No process from this worker needs restarting or stopping.
