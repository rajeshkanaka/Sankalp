# Verified checkpoint before the user-requested break

2026-09-06 Asia/Kolkata; source d2b1d85521e22c50394104ce12908cffaaf418c0. The built application source matches this checkpoint; later changes only preserve evidence/handoffs. User explicitly requested pause and commit/push, with manual resumption in the morning.

`UI_RUN_ID=morning-checkpoint fnm exec --using 24.20.0 npm run test:ui`: **50/50 PASS**, 2.2 minutes, Chromium/WebKit/Firefox. [Safe actual summary](summary.json) retains test identity/duration/status without raw requests, auth links, cookies or private response bodies. HTTP-only cases run in Chromium by configuration, not skipped tests. Integrated static/unit follow-up18833: format/lint/typecheck and115 unit PASS. Verify97932:83 PostgreSQL integration cases, build and smoke PASS; rebuild99289 PASS after distinct React keys fixed duplicated landmarks. No modified database service followed that DB check. No full offline app claim: standalone SW/core/UI integration remains incomplete.

M3 workflow assertions include post-close practice edits, Recorded later versus Practiced late, undo with preserved immutable history, exact retries, Unicode reflection autosave/reload, lost-response retry, deliberate conflict recovery, private POST search, custom moods, 20,001-character draft preservation and axe checks. HTTP tests verify authenticated identity, owner-only reads, account-mismatch rejection before writes, stable receipts and tombstoned-session rejection. Earlier M1/M2 journeys, numeric targets, future revisions, calendar, draft recovery and responsive layouts all remain covered. Data are synthetic and failure transports are explicitly simulated in test names/code; underlying normal authentication/database saves are real local services.

Screenshots below are actual completed workflows; their scenario inputs and clocks are in tests/ui/corrections.spec.ts and journal.spec.ts. Coordinator inspected the Chromium images. Full-page fixed navigation is captured at the current scroll position.

- [Chromium correction history](chromium/completion-corrections.png)
- [Chromium journal](chromium/journal-saved.png)
- [WebKit correction history](webkit/completion-corrections.png)
- [WebKit journal](webkit/journal-saved.png)
- [Firefox correction history](firefox/completion-corrections.png)
- [Firefox journal](firefox/journal-saved.png)

Restart on this Mac uses slot1 atlocalhost3001, not the old3000: Node24.20.0, `npm run db:start`, `npm run db:status`, `npm run dev:demo -- --profile M3`. The existing M3 marked demo is preserved; reseed only deliberately with `npm run demo:seed -- --profile M3`. Local app/backend processes stopped for break; volumes/env retained privately. See PROJECT_PROGRESS and SK-008-break for exact next substep. Native B06 remains unverified; no user visual approval or deployment claimed.
