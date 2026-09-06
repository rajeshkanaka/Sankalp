# M1 foundation verification

Verified 2026-09-06, Asia/Kolkata. App build corresponds to source `7ba9c4e3da083a78f6d9b24e2573dd5e08256b38`. At test launch HEAD was4085e61 plus the `next.config.mjs` patch subsequently committed as7ba9c4e; patch SHA256 `5379f68b090d0c5300493457426f34fc434f04f91dbd47772005cf54678ba3d8`. M2 fixture preparation is a later substep and is not represented by these screenshots.

Actual commands and outcomes:

| Check | Observed result |
|---|---|
| `fnm exec --using 24.20.0 npm run verify` | PASS: format, lint, types, 58 unit tests,23 then-current DB integration tests, production build and Chromium smoke. |
| `npm run test:integration -- tests/integration/activation.test.ts` after SK003 cases | PASS: 18 cases, including 11 additional personalized schedule/target cases. |
| `UI_RUN_ID=foundation-final fnm exec --using 24.20.0 npm run test:ui` | PASS: 28 tests,0 skipped, 33.6 seconds. Includes 10 real HTTP boundary checks and 6 UI checks per engine. |
| `npm ls --depth=0`; `npm audit`; `npm audit --omit=dev` | PASS, no peer error and 0 reported vulnerabilities. |
| Local stack restart and migration005 | PASS; preserved existing DB; actual API54321/DB54322/Mailpit54324 publications all127.0.0.1. |
| Manual visual reflow/VoiceOver announcements | NOT RUN to completion; see [manual report](../../../handoffs/SK-002-manual.md). Settings restored. |
| GitHub CI33989840616 | Core verify and27/28 UI passed; alias redirect failed. Fixed in7ba9c4e; [retry33990840939](https://github.com/rajeshkanaka/Sankalp/actions/runs/33990840939) passed verify, fullUI and both audits on that revision. |

Environment: macOS 27.0, Node 24.20.0/npm 11.19.0, PostgreSQL 17.6 (local image 17.6.1.165), ICU 78.3/tzdata 2026c, Playwright 1.63.0; actual launched Chromium 153.0.8010.12 (revision1243), WebKit 26.6 (2359), Firefox 155.0 (1543). Firefox uses private per-worktree MOZ_APP_DATA.

App under test: production build at http://localhost:3100; process exits after suite. UI namespaces `ui` and `ui-http` are independent of demo data. Logical practice clock2026-09-05T00:45:00Z (06:15Asia/Kolkata); Auth and security counters use real time. Sign-in uses actual local captured email and Supabase Auth, followed by real PostgreSQL saves; no external email or push is sent.

Demonstrated: create Morning practice with two required checkboxes, preview 21 daily civil sessions, activate, record both, explicitly confirm, use Back/reload, observe 1/21 and 5%. One checkbox cannot confirm. Desktop/320px functional assertions and axe pass. Four usability cases per engine deliberately simulate transport failures; those cases are labeled in tests and do not claim real external integration.

Screenshots below are actual app captures containing synthetic data. Test-only auth URLs/cookies/traces are not retained. The ignored HTML report is `artifacts/ui/report`; later runs replace it. This manifest preserves the observed result; CI artifacts separately retain reports 14 days.

| Screenshot | SHA256 |
|---|---|
| `chromium/completed-mobile.png` | `49dfe3939e8d8b10a1b0d74d5e8c5b03d3b4cd1c426890e8403580282b5aa373` |
| `chromium/completed-today.png` | `05dfc02ec5d53592676a876e9d1993636a1a96efc8fd6134e2492c364d7db42c` |
| `chromium/create-preview.png` | `290efd4859df677dadaa67e951410a74f689711af8c1c8635c410db16d14a9e8` |
| `firefox/completed-mobile.png` | `fefdc36dafb2f8d01d874589dc3ac6e2b6945afde727fbb84b0f5e060ec618e7` |
| `firefox/completed-today.png` | `cd7b9b6edf3100fe7e79aeb46dc7f21ad7dd8e17194984e789361938c329a9fb` |
| `firefox/create-preview.png` | `be8e05976613b32591b4fc7cda6396dff5157673cb5f6e01392a06379e27316f` |
| `webkit/completed-mobile.png` | `657bdd5908e7aa403548f346e05309b8778b3b22e1564b0da9b15381824d088d` |
| `webkit/completed-today.png` | `b3a9b9360096b8dc86d51578f977b7d0d19177b3df46ccac3d96668218ad79b0` |
| `webkit/create-preview.png` | `8f801367086b996dfdd95b71e060e6f66f4ae468a4f463e20c0d3d35c328ad89` |

Restart instructions: PROJECT_PLAN §5 and SK-001 handoff. Milestone visual pause waived by D10; this record is not a user visual approval or proof of the still-pending manual accessibility gate.
