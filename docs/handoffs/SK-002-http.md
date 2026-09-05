# SK-002 HTTP boundary test handoff

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-fixtures`

Branch: `task/SK-001-fixtures`

Base before this bounded assignment: `781d8af`

Implementation commit: `dbb129a7329bf546bf72b3f357a0cb8247b5cad1`

Resource slot: none. The worker did not start, stop or interact with the coordinator's production-build server or active browsers on port 3100.

## Delivered

- `tests/ui/http-boundaries.spec.ts` contains nine browser-neutral Playwright request tests, scoped to Chromium to avoid duplicate stateful email traffic across projects.
- The suite makes real requests to the production-build application selected by `UI_ORIGIN`; it does not import route handlers or mock application transport.
- Sign-in boundary coverage includes missing and foreign Origins, non-JSON content, malformed JSON with a safe structured correlation ID, a body over 128 KiB, and invalid-email field validation.
- Journey-write coverage verifies that both a missing cookie and a structurally valid but tampered Supabase SSR cookie return the same safe 401 boundary.
- Response coverage verifies private `no-store`/`no-cache` semantics, expiry/pragma headers, `no-referrer`, content sniffing/frame protection, matching script/style CSP nonces and a fresh nonce per request.
- The stateful test first calls `resetUiSignInLimits('ui-maya@example.test')`, sends one successful sign-in through the application, verifies a newly captured local Mailpit message, and asserts the immediate application retry returns 429 with a positive integer `Retry-After`.
- An immediate direct request to local `/auth/v1/otp` uses only the same seeded UI Maya account, `create_user: false`, and the allowlisted `${UI_ORIGIN}/auth/confirm` redirect. Its independent resend-frequency 429 is asserted without claiming that the application's five-per-hour policy applies to direct Supabase Auth.
- No response body, captured authentication link, cookie, token or key is logged or retained. The test sends at most one local captured email when the configured resend policy behaves as expected.

## Verification evidence

The root-only `tests/ui/helpers/rate-limits.ts` was copied into this worktree solely for static verification and removed immediately afterward. It is not present in the commit.

| Command | Result |
|---|---|
| `command -v npx` | PASS: `/opt/homebrew/bin/npx`. |
| `fnm exec --using 24.20.0 npx prettier --check tests/ui/http-boundaries.spec.ts` | PASS. |
| `fnm exec --using 24.20.0 npx eslint tests/ui/http-boundaries.spec.ts --max-warnings 0` | PASS with zero warnings/errors. |
| `fnm exec --using 24.20.0 npm run typecheck` | PASS with the temporary root helper present. |
| `fnm exec --using 24.20.0 npx playwright test tests/ui/http-boundaries.spec.ts --list` | PASS: nine tests collected. |
| Real port-3100 HTTP execution | NOT RUN by assignment because the coordinator's WebKit suite owned the live server/browser resource. |

## Consumed interfaces and integration

The test consumes the coordinator-owned `playwright.config.ts`, `tests/ui/helpers/rate-limits.ts`, local `.env.local` values, the root-slot runtime allocation, Mailpit search API, and current API error/security-header contracts. Cherry-pick the implementation commit after those shared changes are committed.

Run the real test only when the coordinator owns a fresh local Auth email quota and port 3100 is free:

```sh
npm run test:ui -- --project chromium --grep @SK-002
```

The focused run starts the production build through the existing Playwright `webServer` contract. Because it deliberately sends a real local magic-link request and proves the provider cooldown, sequence broader M1 email-link workflows before this focused boundary run or after the configured provider resend window. Coordinator integration and observed runtime evidence determine task status.
