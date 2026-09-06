# Main consolidation verification

2026-09-06, source ad78c5cbe22ee946e274b642a317a9561d5f0056; PR3. macOS27, Node24.20.0/npm11.19.0, PostgreSQL17.6 slot1, Playwright1.63.0 installed Chromium/WebKit/Firefox. Synthetic accounts and guarded clocks only; no external email/push/deployment.

- Fresh npm verify: formatting/lint/typecheck PASS;112unit PASS;84real database tests PASS; production build and real captured-mail sign-in/create/confirm/reload smoke PASS.
- Full npm run test:ui:53/53 PASS across all3 engines in2.3minutes. Safe summary.json records actual source, static case names, outcomes and timings; no raw URLs/cookies/authentication steps.
- Closure regression: database and Chromium UI both failed for the expected missing historical closing event before the fix. After returning an existing closure in mutation replies, database plus all3 actual two-tab flows pass. Closing event remains exactly once after repeated corrections, without reloading the original page. Coordinator inspected the real Chromium closure-other-tab screenshot.
- New screenshot closure-other-tab.png in each engine supplements assertions and axe. Other actual completed workflow screenshots under corresponding M1/M2/M3 main-consolidation directories retain cumulative regression evidence.
- UI cases whose titles explicitly state simulated transport mock recoverable response failures. Core login/persistence/journal/history/schedule and the new two-tab regression use real local auth/API/PostgreSQL. Offline core/public-shell behavior is not tested or claimed by this suite.

Ignored local logs: artifacts/consolidation-verify.log, consolidation-ui.log, closure-red.log and closure-ui-red.log. Required native VoiceOver/authenticated manual B06 remains unverified. Hosted PR CI is checked separately before merge and linked from PROJECT_PROGRESS; local results are not substituted for it.
