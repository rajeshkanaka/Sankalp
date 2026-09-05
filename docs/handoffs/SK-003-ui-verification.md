# SK-003 M2 UI verification correction

Owner: `/root/m1_domain`

Branch/worktree: `task/SK-003-ui-verification` at `/Users/rajesh/sankalpa-worktrees/SK-003-ui-verification`

Base: `6b1ad4ff8858a4e7ec5f0ca5b37036be1ec37065`

## Observed failure and correction

The integrated M2 Playwright run reached the 21-night preview successfully in Chromium, Firefox and WebKit. Each captured accessibility tree contained the correct server-derived dates, rendered consistently as `September 6, 2026 at 12:00 AM`, `September 26, 2026 at 12:00 AM`, `Sep 5, 2026` and `Sep 25, 2026`. The test expected day-first strings that the application's explicit English formatter does not produce in this runtime, so every browser stopped at the same locator before exercising the remainder of the workflow.

`tests/ui/m2-schedule.spec.ts` now asserts the complete observed en-US opening timestamps and stable practice dates. The later Monday/Thursday and Tuesday-only assertions likewise use exact complete values rather than partial day-first regular expressions.

Intended error assertions filter alerts by their unique message. This prevents Next's empty route-announcer alert from causing strict-locator collisions while retaining the exact recoverable-error assertions. Page errors now include a workflow phase and redact URLs using the established M1 pattern. A successful numeric completion saves `numeric-complete.png` in addition to `weekday-preview.png`.

No application source was changed because the captured pages showed correct schedule generation and presentation in all three engines.

## Verification

Using `fnm exec --using 24.20.0` and a temporary symlink to the integrated root `node_modules`:

- `npm run format:check` — PASS.
- `npm run lint` — PASS, zero warnings.
- `npm run typecheck` — PASS, Next route types generated and TypeScript emitted no errors.
- `npm run test:ui -- --grep @M2-schedule` — **NOT RUN** in this isolated worktree as assigned; it has no allocated `.env.local` or runtime.

## Integration action

Cherry-pick this focused commit into the coordinator branch, reset the synthetic UI namespace through the guarded fixture setup, then run:

```sh
fnm exec --using 24.20.0 npm run test:ui -- --grep @M2-schedule
```

Inspect all three browser outcomes and the real `weekday-preview.png` and `numeric-complete.png` files before changing SK-003 status. This correction does not claim the runtime browser gate passed.
