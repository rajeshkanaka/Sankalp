# SK-005 completion timing labels

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-005-timing`

Branch: `task/SK-005-timing`

Base: `055e259`

## Implemented

- Corrected `deriveCompletionTiming` so `recordedLater` is true only when the reported performance is within the session window and the server recording time is at or after closing.
- A performance at the exact closing instant or later is `practiced_late` with `recordedLater: false`; it no longer receives both UI labels.
- A confirmed but impossible pre-opening performance returns no timing classification. Existing unconfirmed and unmet-target records continue to return no timing classification.
- Added millisecond boundary coverage immediately before, at and after closing, plus delayed and non-delayed in-window recording and pre-opening/unconfirmed cases.

## Commit

- `f54bb51` — `SK-005: separate late practice timing labels`

## Verification

- Focused unit test before implementation — expected RED: 2 failures for practiced-late double-labeling and pre-opening classification.
- `fnm exec --using 24.20.0 npx vitest run --project unit tests/unit/progress.test.ts` — PASS, 12 tests.
- `fnm exec --using 24.20.0 npm run format:check` — PASS.
- `fnm exec --using 24.20.0 npm run lint` — PASS, zero warnings.
- `fnm exec --using 24.20.0 npm run typecheck` — PASS.
- `fnm exec --using 24.20.0 npm run test:unit` — PASS, 7 files and 81 tests.
- `git diff --check` — PASS.

No database or runtime behavior changed. The coordinator should cherry-pick the implementation and handoff commits, then include the corrected unit suite in the integrated verification run.
