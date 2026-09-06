# SK-008 existing-editor regression migration

## 2026-09-06 checkpoint

Owner: `/root/merge_review`; branch `rajesh_kanaka/offline-ui`; worktree `/Users/rajesh/sankalpa-worktrees/SK-008-ui`; base `3b0d495`. Coordinator owns integration, application runtime and shared tracking. This report covers only `tests/ui/journal.spec.ts` and `tests/ui/corrections.spec.ts`. The separate core worker owns the analogous M2 schedule migration.

The coordinator's actual production run `offline-release-candidate` at `389e493` failed old online-only selectors: journal expected `Could not connect` inside ReflectionEditor, while the actual unified editor showed the retained synthetic Unicode note/mood and `Saved.`; corrections expected `practice window has closed`, while the unified editor showed its closed-window instructions and real missed-history event. These are observed failures, not passing runs. The old page-scoped synthetic transport handlers also do not reliably intercept service-worker-owned requests.

All existing legacy error, retry, NO_CHANGE, chronology, note retention, request identity, validation and accessibility assertions are retained inside explicitly named online-only fallback describes using Playwright `serviceWorkers: 'block'`. The legacy journal's independently created context also blocks service workers. Their screenshots have distinct online-only filenames.

New primary tests use the actual unified editor and real authentication, API and persistence:

- Journal: Unicode and mood autosave without an explicit Save click; exact reload preservation; private POST search with no URL query; hostile markup remains plain text; optional prompts; a real conflict between independent IndexedDB contexts; both versions retained and displayed; refresh to a newly saved canonical version; keep the reviewed version, handling real NO_CHANGE without incrementing its revision; both contexts reload to the same note; oversized input retained and prevented from overwriting the server; real screenshots and axe.
- Corrections: closed-window history; saved checkbox/numeric targets; factual performed versus recorded time; real proxy disconnection while correcting; pending state and original acknowledged time through offline reload; reconnect/replay with exact canonical revision4; correction history in chronological order; cancel and confirm undo; revision5, retained values, unchanged history through reload, zero completion credit, screenshots and axe. Chromium additionally models browser offline; WebKit/Firefox exercise a real origin outage without claiming browser-offline simulation.

Observed worker verification:

- `fnm exec --using 24.20.0 npx prettier --check tests/ui/journal.spec.ts tests/ui/corrections.spec.ts` — PASS.
- `fnm exec --using 24.20.0 npx eslint tests/ui/journal.spec.ts tests/ui/corrections.spec.ts` — PASS.
- `fnm exec --using 24.20.0 npm run typecheck` — PASS.
- Actual application/DB/browser execution and new screenshots — NOT RUN by this worker; the coordinator exclusively owns that runtime. No application code, config, migrations, dependencies or root runtime were changed.

Next action: coordinator integrates this test-only checkpoint and runs `npm run test:ui -- --grep '@M3-journal|@M3-corrections'` with the allocated environment and a unique `UI_RUN_ID`, retaining the actual all-engine results and screenshots. Any newly exposed application defect must be diagnosed and fixed within assigned ownership; do not weaken assertions. This worker checkpoint does not make SK-008 DONE.

## Coordinator-run follow-up

The coordinator integrated af16adf as eeeec52 and ran the actual production migration suite. Its Chromium unified journal/corrections and fallback corrections passed. The legacy journal reached its final journal navigation after all earlier retry, immutable request, conflict and validation assertions, then hit its global60-second test deadline. The explicitly blocked service worker exercises the bounded readiness fallback at each fresh document; the accumulated cost exceeds60seconds. This follow-up sets only that legacy test's total budget to120seconds, matching the existing corrections budget. Individual10-second assertions and application readiness are unchanged. No application code or transport assertions were changed. Full browser execution remains coordinator-owned; rerun the focused suite after integration before claiming a pass.
