# SK-002 usability substep handoff

Date: 2026-09-06. Owner: `/root/platform_verification`. Coordinator owns SK-002 status and integration. Worktree `/Users/rajesh/sankalpa-worktrees/SK-002-usability`, branch `task/SK-002-usability`, base `acf32ba`.

## Changes and evidence

- Changed the top bar from a generic div to the page's header landmark. Coordinator's actual Chromium M1 flow reached saved 1/21 completion and then reported axe `region` violations on top-bar text. This is the targeted fix for that observed failure.
- Made the skip-link destination programmatically focusable; added mobile scroll clearance above the fixed bottom navigation so native focus scrolling can expose controls.
- Retained server validation fields in `RequestError` and displayed useful field-level guidance instead of claiming nonexistent highlights. Sign-in marks a server-invalid email and associates its error summary with the input; editing clears obsolete validation errors.
- Added a `SIGN_IN_REQUIRED` new-tab recovery link. The original unsaved form stays open while the user restores authentication. No automatic navigation or draft discard.
- Cleared old success state when a resend begins; a failed resend no longer simultaneously claims that the current request succeeded. An invalid-link banner clears after a successful new request.
- Added coordinator-reserved `tests/ui/usability.spec.ts`: 320px keyboard/reflow and network failure, server validation recovery, failed resend, and expired-session recovery. HTTP responses are explicitly mocked for UI testing; none is proof of real Auth, email delivery or authorization enforcement.

Actual screenshot inspected: `/Users/rajesh/sankalpa/artifacts/ui/results/m1--smoke-M1-custom-journe-e5a2a--through-real-email-sign-in-chromium/test-failed-1.png`. It shows the real synthetic completed Today workflow, coherent desktop layout and readable hierarchy. Its failure is the landmark audit reported above; this worker did not execute that browser run. No screenshot was copied or edited, and no visual mock was created.

## Checks

- `fnm exec --using 24.20.0 npm ci`: PASS, zero audit vulnerabilities; existing esbuild/fsevents allowScripts warnings noted without changing package policy.
- Scoped ESLint on components/auth and the new test: PASS.
- `npm run typecheck` under Node 24.20.0: PASS.
- Scoped Prettier check and `git diff --check`: PASS.
- New Playwright tests and post-fix axe audit: NOT RUN in this worktree. Coordinator's live port 3100 was deliberately not disturbed; its test configuration is not part of this worker base. No private services, separate test app or external messages were started.
- VoiceOver, real keyboard traversal, rendered 320px reflow and 200% zoom: NOT RUN by this worker; the new automated cases cover some browser behavior once executed, not manual screen-reader conformance.

## Integration and exact next step

1. Integrate this commit and rebuild the actual app. Parent already owns/fixed `/welcome`'s local-mail environment comparison from `test` to actual `ci`; keep that correction.
2. Run `npm run test:ui -- --grep @M1` with coordinator's isolated synthetic fixture/config. The new tests use only intercepted sign-in POST responses and ordinary welcome-page requests; no fixture reset or database writes.
3. Confirm the observed top-bar axe violations are gone, retain real desktop/320px screenshot evidence, and check the skip link focuses `#main-content` after real sign-in. If new browser failures emerge, record and fix their concrete causes before task completion.
4. Restart local services only through the coordinator's verified integration commands; no worker process is expected to remain running.

Scope stayed within components, styles, auth feature, this report and the explicitly reserved test file. No auth/server/schema/configuration/tracking changes or security relaxations.
