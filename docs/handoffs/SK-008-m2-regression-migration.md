# SK-008 M2 numeric workflow regression migration

2026-09-06, Asia/Kolkata. Worker branch `rajesh_kanaka/offline-core`, base `18cb549`. Assigned files only: `tests/ui/m2-schedule.spec.ts` and this report. Coordinator owns the integrated app/build/runtime, UI worker owns journal/correction regressions. [TASKS](../TASKS.md) remains the only task-status authority.

## Change

The existing personalized schedule/numeric test now lives in an explicitly named **Online-only fallback: personalized schedules and synthetic save retries** describe block with `serviceWorkers: 'block'`, following the integrated `revisions.spec.ts` pattern. It additionally asserts that the app displays its actual online-only fallback message before exercising the legacy editor. All original blank/custom/template/weekday/calendar-span previews, synthetic checkbox/numeric503 errors, preserved choices, retry gating, successful retries, below-target checks, completion, long-label/mobile layout and Axe assertions remain. `git diff -w` was inspected to verify that none of these assertions were removed or relaxed. Its two original response substitutions remain visibly described as synthetic test failures.

A separate primary test uses the default service-worker-enabled context and the actual unified offline session controls. It creates a two-session journey through the real setup UI, with20required minutes and a required closing-breath checkbox, at the existing deterministic M2 clock (`2026-09-12T04:01:00+05:30`). It verifies controller/public-cache readiness and enabled numeric input before cutting actual connections through the existing acknowledged `setUiNetworkDisconnected` helper. Chromium additionally uses Playwright offline emulation; WebKit/Firefox rely on the real test-server connection cutoff, not an assertion about `navigator.onLine`.

The planned workflow asserts:

1. Canonical session starts unconfirmed at revision0. Saving5minutes while disconnected produces a pending value but leaves completion disabled.
2. Invalid raw text `1e-` is retained with a visible whole-number validation error. A disconnected reload preserves both the raw text and the previously queued5minutes. Completing the checkbox preserves that raw text and still cannot enable completion.
3. Typing20 does not allow completion until the value is explicitly saved. Then completing the session creates four pending operations total:5minutes, checkbox,20minutes, confirmation. Another disconnected reload retains20, the checkbox and the pending completion, without claiming a canonical recording.
4. Reconnection/reload yields canonical revision4, exactly20minutes, checked closing breath, one confirmation and deterministic performed/recorded timestamps. History contains exactly three value-save facts and one completion fact. A further reload/GET preserves the exact canonical record and event counts; journey progress shows1of2complete and1upcoming.
5. Real screenshots are requested at the pending and replayed outcomes, followed by Axe and zero-page-error assertions. These screenshots have not been captured by this worker.

The primary workflow uses no response fulfillment, fake auth, direct IndexedDB mutation or simulated replay transport. It consumes real UI/HTTP/storage and the test-only connection-cutoff fixture when run by the coordinator.

## Verification and handoff

Source references were checked read-only against the coordinator's current `src/offline/ui/session.tsx`, `src/offline/ui/format.ts`, `src/features/practice/session-experience.tsx`, session GET/completion service and `tests/ui/offline.spec.ts`. Their current labels, revision increments, deterministic simulated clock and canonical-history refresh underpin the new assertions. This worker made no application changes and did not start a runtime, reset a database or use coordinator services.

Actual static checks:

- `fnm exec --using 24.20.0 npx eslint tests/ui/m2-schedule.spec.ts --max-warnings 0`: PASS.
- `fnm exec --using 24.20.0 npx tsc --noEmit`: PASS.
- Scoped Prettier and `git diff --check`: PASS.
- Whitespace-insensitive diff review: original scenario assertions preserved; the context and fallback readiness assertion are additive.

**UI execution: NOT RUN by this worker.** Exact next action: coordinator integrates this narrow commit and runs `fnm exec --using 24.20.0 npm run test:ui -- tests/ui/m2-schedule.spec.ts` against the current built app and its existing serialized proxy/clock/synthetic-data fixture. Expected six cases: two scenarios across Chromium, WebKit and Firefox. Existing M2 evidence names remain; new evidence paths are `docs/evidence/M2/<UI_RUN_ID>/<browser>/numeric-offline-pending.png` and `numeric-offline-complete.png`. Capture real outcomes before claiming PASS. Any behavioral failure requires diagnosis, not weakening the numeric, revision, history or raw-draft assertions.
