# SK-008 account-boundary regressions

Updated 2026-09-06, Asia/Kolkata. Worker `/root/ci_triage`; branch `rajesh_kanaka/online-checkpoints`; worktree `/Users/rajesh/sankalpa-worktrees/SK-006-closure-review`. Test-authoring base `b8c8d04`; integrated source reviewed at coordinator `bfa6dc2`. TASKS remains the only task-status authority.

## Owned scope and observed source failures

This worker owns only the new `tests/ui/offline-account-boundary.spec.ts` and this handoff. No production code, root runtime, shared fixture/configuration, dependencies or coordinator tracking is modified.

The preceding read-only review found three source paths requiring regression coverage:

1. Mounting an old authenticated SSR document could call `bindAccount` with its stale account prop after another account signed in, rebind the earlier identity and reveal its private content.
2. Account establishment read device metadata before waiting for public-shell readiness, then could apply that stale metadata after another tab changed account/generation while no subscription was active.
3. Successful local purge invalidated/unmounted the account controls before remote logout completed. A later remote failure updated the unmounted component instead of leaving visible failure/retry controls.

These are source findings, not worker-observed runtime reproductions. The UI owner implements the provider/controls changes and the deterministic isolated readiness race. The coordinator owns actual integrated RED/GREEN runs.

## Actual-app scenarios

The new file selects all three existing browser projects, with service workers explicitly blocked for these online account-boundary checks. The separate offline suite tests installed workers and public caching. Authentication, journey activation, canonical reflection writes/reads and successful logout use the actual app and local services. Only hydration transport delay, one explicit synthetic 503, and one unreadable logout response body are injected in their respective scenarios.

- **Stale private hydration after real account switch.** Sign in as synthetic Maya, activate a journey and persist a whitespace/Unicode reflection through real APIs. Load its private page, then hold actual Next script requests during a new authenticated document reload. Require the real 200 document to withhold private controls. Sign in as synthetic Arun in another page of the same browser context, create/load his real practice and record only the actual browser account/generation metadata. Release Maya's delayed scripts. Require the stale page's verification boundary, no old private title/editor, the actual API identity still Arun, Arun's account/generation unchanged and his exact reflection still visible and persisted at revision 1. The old reflection endpoint must return 404 to Arun. Both pages use real cookies; no authentication response is fabricated.
- **Remote logout failure after local purge.** Persist a real synthetic note, hold the first logout POST, and require the private subtree to disappear with `Finishing sign out…` while local account metadata is cleared. Before releasing the request, verify server authentication remains active. Return one labeled synthetic 503, require `Sign-out did not finish`, the explicit server-not-confirmed explanation and enabled `Retry sign out`, and verify private content remains hidden while the unchanged canonical note is still authenticated/readable through the API. The retry reaches the actual logout endpoint, requires exactly two attempts overall, `/welcome` and a final 401.
- **Successful real logout with an unreadable response body.** Hold logout until private content is removed and local account metadata is cleared; verify authentication and the exact canonical note/revision still exist before the network request executes. Then use `route.fetch()` for the actual POST, require its real 200 and `{ ok: true }`, and fulfill that actual response with only its body replaced by incomplete JSON. Preserve its real headers, including `Set-Cookie`, in memory; adjust content length for the replacement body. Require the initial failure heading, a real authentication 401 and no private editor. Retry must recognize `Signed out` / `The server confirmed sign-out.` without another logout POST, retain private withholding and 401, and offer a working `Return to sign in` link. This injects response corruption only; it does not fabricate authentication, clear browser cookies manually, or claim to simulate a dropped response header.

Expected copy was supplied by the UI owner before test finalization. This file does not weaken privacy assertions to accommodate the previous behavior. Route gates release in `finally`; waiting route cleanup drains in-flight handlers. Native IndexedDB inspection reads only account/generation metadata, never private records, and refuses to create a missing database.

## Readiness-race boundary

A real-worker readiness hold would compete with the application's bounded 3-second/7-second readiness timers and the time taken by a second real sign-in. Making that hold deterministic would require an additional timer or worker-message simulation. Per the coordinator's assignment, the UI owner's isolated provider harness owns this precise generation-change-during-readiness case. This new actual-app file does not claim actual-service-worker coverage of that race.

## Verification and integration

Actual worker commands all passed using Node 24.20.0 and the existing ignored dependency symlink:

```sh
fnm exec --using 24.20.0 npm exec -- prettier --check tests/ui/offline-account-boundary.spec.ts
fnm exec --using 24.20.0 npm exec -- eslint tests/ui/offline-account-boundary.spec.ts --max-warnings 0
fnm exec --using 24.20.0 npm run typecheck
git diff --check
```

Prettier was applied once before these checks. Full type checking includes Next route generation. Actual app tests and new screenshots are **NOT RUN / NOT CAPTURED** by this worker. No root app, environment, database or browser has been accessed.

Coordinator integrates the focused tests commit and the matching provider/controls implementation, then executes with the allocated synthetic runtime and current production build:

```sh
fnm exec --using 24.20.0 npm run test:ui -- tests/ui/offline-account-boundary.spec.ts
```

Expected: nine cases across Chromium, WebKit and Firefox. Retain actual RED/GREEN outcomes; static success alone does not make SK-008 complete. Screenshots use `docs/evidence/M3/<UI_RUN_ID>/<browser>/stale-account-hydration-withheld.png`, `failed-signout-private-content-withheld.png` and `unreadable-signout-response-recovered.png`, with the existing safe summary reporter. No evidence files have been invented or committed here.

## Follow-up: unreadable logout response, 2026-09-06

Authoring base `dce3db1`; source review included coordinator `57d1dbc` and UI provider change `dd20cbc`. A successful server logout can clear cookies while an unreadable response makes `requestJson` fail. The previous boolean account verifier treated the subsequent authoritative 401 like other rejection, so retry could never recognize the completed sign-out. The coordinator/UI owner supplies the explicit account-verification result and recovery behavior; this worker adds only the regression above and preserves both existing cases.

The response modification follows official [Playwright `route.fetch()` and `route.fulfill()` documentation](https://playwright.dev/docs/api/class-route#route-fetch), verified 2026-09-06. The real response's header object stays in memory; assertions print only status, synthetic response data and a boolean header-presence check. The actual post-recovery 401 is required to demonstrate cookie clearing. If the integrated browser run does not produce that 401, this case fails and the response transport must be investigated; no successful authentication transition is presumed from source or static checks.

The first static type check found an inferred response-header object without a string index signature. An explicit `Record<string, string>` annotation corrected that test-only typing issue. Targeted Prettier, ESLint, full type checking and diff checks passed after that correction. Actual runtime of this added scenario and its screenshot remain **NOT RUN / NOT CAPTURED** by this worker. Root services, database and browser were not accessed.

Exact next action: coordinator integrates this tests-only follow-up with the enum-based recovery, runs all nine cases plus the isolated readiness regression and relevant existing account/fallback workflows, and retains actual results. Run the unreadable-response case against the prior boolean verifier for RED evidence where practical.
