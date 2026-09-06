# Offline release candidate — 2026-09-06

Source: `389e493b9893198899d852e7d06baa8df8b906d2`; only native-review helper/document edits were dirty during these application checks. Node24.20.0, local synthetic slot1; real Auth/PostgreSQL/Next and browsers. No real reminder delivery.

- `npm run verify`: PASS — formatting, lint, types, 198unit/13files, 84database/10files, production public-shell/Next build, one actual Chromium smoke.
- Full `UI_RUN_ID=offline-release-candidate npm run test:ui`: **FAILED — 77 passed, 9 failed**, 10.9minutes. Safe individual outcomes: `ui-summary.json`. Correction/journal legacy editor expectations failed in all3engines; synthetic page-route failures failed in Chromium/WebKit numeric tests and WebKit draft recovery. Separate tests already prove current offline behavior; those successes do not waive these failures. Preserve old assertions in explicit online-only contexts and add current unified editor coverage before rerunning the full suite.
- `npm run test:offline-core`: PASS —25scenarios perengine, real IndexedDB/Web Locks/reloads with **simulated HTTP**, zero page errors. `core-harness-summary.json`.
- `npm run test:offline-ui`: PASS —24scenarios perengine, real React/browser/storage with **simulated backend and shell readiness**, zero page errors. `ui-harness-summary.json`.
- Both `npm audit --omit=dev` and `npm audit`:0vulnerabilities.

Browsers: Chromium153.0.8010.12, WebKit26.6, Firefox155.0. Screenshots are synthetic workflow evidence under this run's M1/M2/M3 directories; a screenshot does not establish that its entire test passed. All nine actual account-boundary cases passed, including a successfully processed logout whose response could not be read. Native VoiceOver review is a separate ongoing run, not part of these outcomes. Raw logs and auth-capable diagnostics remain ignored under artifacts/.

Companion focused `offline-candidate-functional` run passed12/12 acrossall3engines (actual disconnection/reload/replay, quota input retention, account switching and real two-device queue comparison). It ran against e713ee7, before the server Auth error-classification follow-up; current full run also passed those12cases. Task status remains in TASKS. This is a partial checkpoint, not M3 completion or accepted main.
