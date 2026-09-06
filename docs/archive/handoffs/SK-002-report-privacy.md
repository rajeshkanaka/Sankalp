# SK-002 Playwright report privacy hardening

## Worker checkpoint

- Branch/worktree: `task/SK-002-report-privacy` at `/Users/rajesh/sankalpa-worktrees/SK-002-report-privacy`
- Base: `ab65874`
- Owned implementation: `scripts/safe-ui-reporter.ts`
- Owned regression test: `tests/unit/safe-ui-reporter.test.ts`
- Shared configuration and workflows were not changed.

## Behavior implemented

`SafeUiReporter` is a Playwright 1.63.0 custom reporter that writes only `artifacts/ui/summary.json`. Its output is constructed from an explicit allowlist:

- validated `GITHUB_SHA`, with actual `git rev-parse HEAD` as the fallback;
- an ISO UTC generation timestamp;
- aggregate run status (`PASSED`, `FAILED`, `TIMED_OUT`, `INTERRUPTED`, or `NOT_RUN`);
- relative source file, source line, project, static test title, and test-level actual status;
- every attempt's actual status, duration in milliseconds, and retry index.

Skipped attempts map to `NOT_RUN`. Tests with no results also have test-level `NOT_RUN` and an empty attempts list. A zero-test or entirely unrun Playwright invocation cannot be represented as aggregate `PASSED`. Failed, timed-out, and interrupted results remain explicit non-passing states, while retries are retained in execution order.

The reporter never reads or serializes test steps, annotations, errors, stdout/stderr, attachments, request or response objects, cookies, or URLs. An invalid/non-SHA `GITHUB_SHA` is rejected and cannot become a report field; failure to obtain an actual repository SHA uses a fixed error message without command output or environment values.

The regression fixture deliberately places a synthetic callback secret in every excluded Playwright field and checks both the exact serialized key allowlist and absence of the secret, callback URL, and excluded field names.

## Coordinator integration required

Replace the default HTML reporter with the list reporter plus `scripts/safe-ui-reporter.ts`. The safe summary replaces raw Playwright HTML/blob-style report generation; it is not merely an upload filter. CI should retain `artifacts/ui/summary.json` and specifically allowlisted workflow screenshots, and should stop generating or uploading raw reports, results, traces, and archives that can contain step metadata.

This worker did not inspect, copy, or modify the older ignored private report copies. The coordinator reported that the affected remote verification artifacts were removed after confirming the leak, and separately hardened callback helpers to avoid query serialization; those root changes are outside this commit.

## Verification

Red phase:

- `fnm exec --using 24.20.0 npm run test:unit -- tests/unit/safe-ui-reporter.test.ts` — failed because the reporter module did not exist.
- After the first green phase, a new unrun-status assertion failed because empty attempts lacked test-level status and an aggregate passing run could still describe zero executed tests. This demonstrated the missing boundary before it was implemented.

Final checks, all run with Node 24.20.0 through `fnm exec --using 24.20.0`:

- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed; Next route types generated and `tsc --noEmit` succeeded.
- `npm run test:unit` — passed: 5 files, 62 tests.

No Playwright browser run or shared-config integration was performed in this isolated worker because the coordinator owns those changes.
