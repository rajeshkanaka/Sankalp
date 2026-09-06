# SK-002 auth verification failure classification

2026-09-06, Asia/Kolkata. Worker `rajesh_kanaka/offline-core`, base `f7a38ca`. Coordinator assigned only `src/server/auth/server.ts`, `tests/unit/auth-session-error.test.ts` and this handoff. This supporting regression does not change the authoritative status in [TASKS](../../TASKS.md).

## Finding and change

`getApiUser` previously translated every returned Supabase `getUser` error into401 `SIGN_IN_REQUIRED`. Network failures, provider5xx and rate limiting consequently looked identical to a missing session. A caller using401 as evidence of completed sign-out could incorrectly finish its recovery flow during an outage. Rejected SDK promises also escaped without consistent classification.

The helper now recognizes only the SDK's missing-session/invalid-JWT classes and documented invalid-session API codes as authoritative401 failures: `bad_jwt`, `session_not_found`, `session_expired`, `refresh_token_not_found`, `refresh_token_already_used`, `user_not_found`. An API code qualifies only with a4xx response excluding429. Unknown401/403 codes stay unavailable rather than claiming that the browser session ended. This is a conservative application policy; it does not grant access to any failed verification.

Retryable transport errors, rate limits,5xx, unknown/rejected errors, refresh-discard races, malformed token responses and malformed success results produce503 `AUTH_UNAVAILABLE` with a fixed safe retry message. Returned errors take precedence over an accompanying user. A successful result requires a nonempty string identity. No provider error details are returned, logged or stored. Cookie handling, verified `getUser` use, database ownership and private response headers remain unchanged.

`getPageUser` already redirects only application401 failures. The corrected classifier now makes that condition meaningful: unavailable verification reaches the existing page error handling without a welcome redirect. The coordinator owns actual route/browser recovery integration.

## Primary source verification

Verified against installed `@supabase/auth-js`2.115.0, re-exported by the pinned direct dependency `@supabase/supabase-js`2.115.0, on2026-09-06. No package was installed or changed.

- Installed `node_modules/@supabase/auth-js/src/lib/errors.ts`: `AuthSessionMissingError` has status400; `AuthInvalidJwtError` status400; `AuthRetryableFetchError` preserves its supplied status; `AuthUnknownError` wraps unknown failures. `AuthInvalidTokenResponseError` is500 and `AuthRefreshDiscardedError` is409. Public predicates/classes were verified from actual exports and exercised in tests. [Pinned upstream errors source](https://github.com/supabase/supabase-js/blob/v2.115.0/packages/core/auth-js/src/lib/errors.ts).
- Installed `src/lib/fetch.ts:79–145` maps non-response failures to retryable status0, infrastructure errors to retryable errors, malformed responses to unknown errors and `session_not_found` to the missing-session class. Installed `src/GoTrueClient.ts:3224–3273` returns recognized auth failures and rethrows unrecognized failures from `getUser`. These are SDK source paths beneath `node_modules/@supabase/auth-js`, not repository application files.
- [Official Supabase error guide](https://supabase.com/docs/guides/auth/debugging/error-codes) distinguishes429 limits/5xx service failures from invalid JWT/session/refresh-token/user codes and recommends code/name classification rather than matching message text. That guidance supports the narrow allowlist; unknown classifications fail closed with503.
- The pinned Next16.3.4 local guide `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` confirms redirect throws. The existing redirect remains in the catch branch, outside the guarded call, and is not swallowed by the new SDK catch.

## Actual verification and limitations

The unit suite mocks only SDK result/rejection, Next request-cookie/redirect boundaries and configuration lookup. It imports the actual pinned SDK error classes. It does not contact Supabase or simulate successful real sign-out.

- RED: `fnm exec --using 24.20.0 npm run test:unit -- tests/unit/auth-session-error.test.ts` against original helper:56failed/17passed. Failures included outage→401, page redirects on outages, rejected errors escaping and malformed identities resolving.
- GREEN: the same focused command:73passed. Covers returned and rejected known/unknown errors; missing/expired/invalid session preservation;429/5xx with even a misleading session code; error-plus-user rejection; safe error text; malformed results; and page redirect/non-redirect behavior.
- `fnm exec --using 24.20.0 npm run test:unit`:191tests/11files PASS.
- `fnm exec --using 24.20.0 npx eslint src/server/auth/server.ts tests/unit/auth-session-error.test.ts --max-warnings 0`, full `tsc --noEmit`, scoped Prettier and `git diff --check`: PASS.

No root runtime, real auth/DB service, environment secrets or remote operations were used. Actual HTTP/UI/provider outage and sign-out recovery checks are **NOT RUN by this worker**. Exact next action: coordinator integrates this narrow commit and runs the real app auth-boundary/sign-out recovery regressions and cumulative gates. No live session, token or draft was discarded in this task.
