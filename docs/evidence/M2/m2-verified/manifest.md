# M2 integrated browser evidence

Captured2026-09-06 Asia/Kolkata on macOS27, integrated source `a65b68fbefecc9aae2a28f905b6529a4e7ca47ce`. No application source changes during run; tracking-doc edits do not affect the build. Node24.20.0/npm11.19.0, PostgreSQL17.6 with migrations001–007. Migration008 exists as NOT APPLIED M3 preparation; SK-006 must integrate before it is applied. Playwright1.63.0: Chromium153.0.8010.12, WebKit26.6, Firefox155.

Commands: `fnm exec --using 24.20.0 npm run verify` (exit0: formatting, lint, types,81unit,56DB, production build, Chromium smoke); `UI_RUN_ID=m2-verified fnm exec --using 24.20.0 npm run test:ui` (exit0,43/43 HTTP/UI checks across all3 engines). Coordinator session78700. [Safe actual summary](summary.json) records per-test results and source revision; raw errors/steps/auth URLs/browser state are excluded.

Fixtures are marked synthetic Maya/Arun. Each UI workflow resets namespaceui to M1; separate ui-http is isolated. Domain clocks for exact scenario dates are explicit in tests/ui/m2-progress.spec.ts, m2-schedule.spec.ts, revisions.spec.ts and revision-conflicts.spec.ts; the demo clock is unaffected. Test entry http://localhost:3100/welcome was test-owned and stopped after the run. User demo restart: `npm run demo:seed -- --profile M2` then `npm run dev:demo -- --profile M2`, http://localhost:3000/welcome on this Mac. Actual local captured-email auth and database persistence were used; only error-transport cases are explicitly intercepted/simulated. No real notification delivery exists yet.

Visible/functional assertions cover custom weekdays/numeric targets, seven-of21/33percent calendar totals, overnight practice dates with secondary device timezone,320px list, persistent hide-streak preference, saved draft recovery/exact retry/activation, metadata edit failure recovery, retained historical practice labels after future changes, and opening-boundary/other-device conflicts requiring explicit fresh review. PostgreSQL tests additionally prove both lock winners and atomic rollback. Coordinator inspected calendar and mobile rendering.

Remaining gate: B06 native VoiceOver/authenticated manual checks remain NOT VERIFIED. Earlier public200percent reflow/keyboard passed; all native settings restored. User milestone visual approval is not inferred; D10 permits continuous implementation.

Screenshots are real successful synthetic workflows:

- [chromium/calendar-33-percent.png](chromium/calendar-33-percent.png)
- [chromium/calendar-session-list-mobile.png](chromium/calendar-session-list-mobile.png)
- [chromium/numeric-complete.png](chromium/numeric-complete.png)
- [chromium/revision-history.png](chromium/revision-history.png)
- [chromium/weekday-preview.png](chromium/weekday-preview.png)
- [firefox/calendar-33-percent.png](firefox/calendar-33-percent.png)
- [firefox/calendar-session-list-mobile.png](firefox/calendar-session-list-mobile.png)
- [firefox/numeric-complete.png](firefox/numeric-complete.png)
- [firefox/revision-history.png](firefox/revision-history.png)
- [firefox/weekday-preview.png](firefox/weekday-preview.png)
- [webkit/calendar-33-percent.png](webkit/calendar-33-percent.png)
- [webkit/calendar-session-list-mobile.png](webkit/calendar-session-list-mobile.png)
- [webkit/numeric-complete.png](webkit/numeric-complete.png)
- [webkit/revision-history.png](webkit/revision-history.png)
- [webkit/weekday-preview.png](webkit/weekday-preview.png)
