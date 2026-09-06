# Actual account-boundary regression

2026-09-06. `UI_RUN_ID=offline-account-boundary-green npm run test:ui -- tests/ui/offline-account-boundary.spec.ts` passed **6/6** in2.5minutes across Chromium, WebKit and Firefox. Real local SupabaseAuth/PostgreSQL slot1; synthetic accounts and fixed clock. Service workers are explicitly blocked in these online-boundary cases to make held JavaScript and logout requests observable; separate tests cover the installed worker and actual network cutoff.

Tested production build: e0f163a with coordinator working changes for real browser identity verification, public-shell verification, compact app header, verified-controller reuse and initial sign-in boundary wait. The subsequent ready-tab offline-focus helper refinement was not yet in this build; its cumulative regression remains required. Safe summary.json identifies the checkout SHA, not an assertion that it was clean.

Stale hydration: hold the original account's actual Next JavaScript, sign in as a second synthetic account, create its real practice/note, then release the first page. The first account's content stays hidden; the second account's binding/generation and exact server note remain unchanged, and the first account's endpoint returns404. This same test previously failed in Chromium against the pre-fix build, visibly showing the original synthetic private content.

Logout recovery: the first actual sign-out POST is held until durable local clearing and private editor removal, then receives an explicitly simulated503. The failure remains visible and retryable while real authentication still returns200. Retry reaches the actual sign-out service and finishes at welcome with401. Screenshots show the withheld-content and failed-signout states, not a fake completed logout.

No real personal content, credentials, cookies, authentication URLs or provider payloads are included. This focused result does not establish full milestone, native accessibility, phone or deployment completion.
