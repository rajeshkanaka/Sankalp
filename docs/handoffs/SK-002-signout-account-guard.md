# SK-002 expected-account sign-out guard

2026-09-06, Asia/Kolkata. Worker `rajesh_kanaka/offline-core`, base `1c5d754`. Assigned source: `src/app/api/auth/sign-out/route.ts`, `src/server/auth/server.ts`, new `tests/unit/sign-out.test.ts` and this report. Coordinator owns the rendered-account caller, browser race regression and integration. [TASKS](../TASKS.md) remains the sole task-status authority.

## Contract and change

The previous POST accepted `{}` and signed out whichever session the request cookies represented, with Supabase's default global scope. An older UI for accountA could therefore sign out accountB after a different tab changed the shared browser session before the POST.

`POST /api/auth/sign-out` now requires strict JSON `{ accountId: UUID }`. The endpoint creates one response-bound Supabase client, passes that same client into the existing `getApiUser` classifier, checks its freshly verified ID against the expected ID, then invokes `signOut({ scope: 'local' })` exactly once. `getApiUser()` without an argument retains its existing client creation and classification behavior for all other callers. Verification uses `getUser`, not an unverified cookie/session decode.

| Request/result                                              | Response               | Cookie/sign-out behavior                                                                             |
| ----------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Valid JSON with missing/invalid `accountId` or extra fields | 422 `VALIDATION`       | No client creation, verification or sign-out.                                                        |
| Verified ID differs from expected account                   | 409 `ACCOUNT_CHANGED`  | No sign-out; no staged cookie changes sent.                                                          |
| Actual missing/invalid session                              | 401 `SIGN_IN_REQUIRED` | Existing classifier retained; no sign-out or response cookie changes.                                |
| Provider/network/unknown verification failure               | 503 `AUTH_UNAVAILABLE` | No sign-out or response cookie changes.                                                              |
| Matching verified account, successful SDK sign-out          | 200 `{ok:true}`        | Local session scope; return the SDK's staged cookie expirations.                                     |
| Returned/thrown SDK sign-out failure                        | 503 `UNAVAILABLE`      | Keep existing sanitized API error handling; discard staged response cookies and never claim success. |

Coordinator explicitly confirmed that malformed/missing **account input in valid JSON** is422; existing transport boundaries stay unchanged: missing/unparseable body400, bounded-body overflow413, non-JSON content type415 and wrong origin403. The shared `readJson`, generic API helper and private cache headers were not changed.

Cookie writes remain staged on the success response. `handleApi` returns a separate private error response when validation, verification, account comparison or sign-out fails. This matters because the pinned SDK may request cookie cleanup during failed verification or failed sign-out. Those staged changes must not be accidentally forwarded with an error response.

## Pinned source and scope rationale

Verified2026-09-06 against installed `@supabase/auth-js`2.115.0 (exported by pinned `@supabase/supabase-js`2.115.0) and `@supabase/ssr`0.12.6; no dependencies changed.

- `node_modules/@supabase/auth-js/src/GoTrueClient.ts:4021–4109` documents the default global scope and implements explicit local scope. `GoTrueAdminApi.ts:142–159` passes the selected scope to `/logout?scope=...`; `src/lib/types.ts:1877–1887` defines `global | local | others`. Local means the current session, which fits a device sign-out action while preserving independent phone/desktop sessions. [Official sign-out API](https://supabase.com/docs/reference/javascript/auth-signout), [pinned client source](https://github.com/supabase/supabase-js/blob/v2.115.0/packages/core/auth-js/src/GoTrueClient.ts).
- The same `_signOut` implementation can remove its current local session even when returning a provider error. The route's existing success-only cookie return is therefore retained and tested explicitly. Installed `@supabase/ssr/src/createServerClient.ts:195–212` applies staged storage on `SIGNED_OUT`; no new cookie names or manual token clearing were added to production code.
- Error classification is the verified narrow policy in [SK-002-auth-recovery](SK-002-auth-recovery.md). Only the same-client input was added; no provider failure became an authoritative signed-out result.

**Limit:** the guard protects the account represented by this request's cookie snapshot. It does not make separate browser requests atomic, stop a newer sign-in from completing after this request began, or guarantee an older response cannot race newer cookies. Local scope is a session revocation request, not a promise that issued access tokens become instantly unusable; the SDK documents their remaining validity until expiry. Coordinator-owned browser/account-generation handling and actual race tests remain necessary. No broader cookie-race solution is claimed.

## Verification

New unit tests import the real route, auth classifier, JSON/origin/error helpers and `NextResponse` cookie handling. Only SDK calls/configuration/Next request-cookie access are mocked; route aliases resolve to the actual helpers through test-local module factories. No runtime server, database, real account or credentials were used.

- The first test-file draft had a missing closing brace; formatting caught it before any test ran. After fixing that test-only typo, RED against the original endpoint was9failed/8passed, including accepted empty account input and missing verification/local-scope behavior.
- `fnm exec --using 24.20.0 npm run test:unit -- tests/unit/sign-out.test.ts tests/unit/auth-session-error.test.ts`:90tests PASS (17new sign-out,73existing classification).
- `fnm exec --using 24.20.0 npm run test:unit`:208tests/12files PASS.
- Scoped ESLint/Prettier, full `tsc --noEmit` and `git diff --check`: PASS.

Assertions cover422 input validation, unchanged transport limits, staleA/currentB, missing/unavailable/rejected verification, one shared client and correct call order, local scope, expected synthetic cookie expirations without overwriting a theme cookie, withheld staged refresh/deletion cookies on every failure and sanitized failure logs. The successful SDK cookie callback is simulated; this is not evidence of a real provider session revocation or an integrated browser race.

Exact next action: coordinator integrates the source/test/report commit alongside the caller's mandatory rendered `accountId`, runs the real two-account sign-out race plus normal sign-out, then cumulative build/HTTP/UI gates. Those integrated checks are **NOT RUN by this worker**. No shared tracking, root runtime or remote operation was touched.
