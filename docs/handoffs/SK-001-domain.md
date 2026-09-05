# SK-001 domain handoff

Owner: `/root/m1_domain`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-domain`

Branch: `task/SK-001-domain`

Base: `2ee125168cb13c19c4f8295ae41d4a81fb760873`

Implementation commit: `f5c7eabdd02b428acc185df6c1f7eae59e822be7`

## Delivered

- `src/domain/validation.ts`: strict Zod draft, schedule, mutation-envelope, practice-value and completion schemas. D04/product limits, UUID IDs, trimmed Unicode text, unique practice IDs/orders/weekdays/offsets, typed targets and explicit-offset ISO completion times are enforced.
- `src/domain/schedule.ts`: pure calendar/occurrence recurrence with civil and previous-evening attribution, retained occurrence allowance/ordinals, first-valid gap resolution, earlier fold resolution, nominal wall-clock closing, elapsed-duration and nonoverlap checks, activation-time future-occurrence guard, and preview adjustment warnings.
- `src/domain/status.ts`: canonical target evaluation and upcoming/open/partial/complete/missed derivation using `[opensAt, closesAt)`.
- `src/domain/metrics.ts`: active-session counts, whole progress percent, closed-window on-schedule ratio, current/longest streak, ended and fully-completed flags. Superseded sessions are excluded; `performedAt` determines recorded-later versus practiced-late streak credit.
- Three focused unit suites cover 47 behaviors, including the A01/A24/A25/A27 fixtures and D04 edge cases requested by the coordinator.

No shared contracts, configuration, package/lock files, migrations or tracking documents were changed. No database or application runtime is required by this slice.

## TDD evidence

1. Initial RED: `fnm exec --using 24.20.0 npm run test:unit -- tests/unit/validation.test.ts tests/unit/schedule.test.ts tests/unit/metrics.test.ts` exited 1 because all three production modules were absent.
2. Boundary RED: the focused validation/schedule run exited 1 with exactly two expected failures: an empty values record was accepted and a retained matching date reduced the occurrence count.
3. GREEN after implementation: the final full unit run passed 3 files and 47 tests.

## Verification

| Command | Result |
|---|---|
| `fnm exec --using 24.20.0 npm ci` | PASS; 254 packages added, 255 audited, 0 vulnerabilities. npm reported unapproved install scripts for `esbuild`/`fsevents`; no package files changed. |
| `fnm exec --using 24.20.0 npm ls --depth=0` | PASS; all direct pins resolved, exit 0. |
| `fnm exec --using 24.20.0 npm run test:unit` | PASS; 3 files, 47 tests, exit 0. |
| `fnm exec --using 24.20.0 npm run typecheck` | PASS; exit 0. |
| `fnm exec --using 24.20.0 npx prettier --check <all owned source/test files>` | PASS; all matched files formatted, exit 0. |
| `fnm exec --using 24.20.0 npx eslint <all owned source/test files> --max-warnings 0` | PASS; exit 0. Next plugin printed its existing missing-pages informational message. |
| `fnm exec --using 24.20.0 npm run lint` | FAIL before linting: shared script names missing `scripts/` directory at base `2ee1251`. Coordinator-owned scaffold integration should supply it, then rerun the standard command. |
| `fnm exec --using 24.20.0 npm run format:check` | FAIL after checking owned paths: same missing shared `scripts/` glob. Targeted owned-file check above passed. |
| Database, integration, build and UI checks | NOT RUN; outside this pure-domain substep and shared scaffold/runtime ownership. Coordinator must run integrated gates. |

## Contract notes for integration

- Practice `order` accepts nonnegative integers and must be unique; the shared contract does not state whether presentation order starts at zero or one.
- `completionSchema` accepts an ISO datetime with `Z` or an explicit numeric offset and preserves the supplied string; the server/database boundary can normalize it to UTC.
- `fullyCompleted` is true when every nonsuperseded scheduled session is complete. `ended` remains the separate time-based flag that becomes true at the final close.
- When `now` is supplied, `generateSchedule`/`previewSchedule` require at least one occurrence with `opensAt > now`, following D04's “has not opened” wording.
- Retained occurrences preserve their objects and ordinals; occurrence-mode duration counts them toward the requested total. The coordinator remains responsible for locking/version rules around which rows qualify as retained.

## Integration next step

Cherry-pick the implementation and this handoff commit, rerun the standard commands after coordinator-owned `scripts/` and application files are present, then exercise service/database/UI behavior. Coordinator review and integrated evidence determine SK-001 status; this worker makes no DONE claim.
