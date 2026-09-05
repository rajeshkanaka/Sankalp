# SK-002 first CI run triage

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-fixtures`

Branch: `task/SK-001-fixtures`

Scope: read-only inspection of GitHub Actions run `33989840616`, commit `a87c90a1ba154370124aa83bd2dc0e01cb80739a`, and the pinned source/configuration. No application, test, workflow or configuration file was changed. Failed logs were captured in memory and sanitized for URL query strings, cookies, authorization values, tokens, keys and long credential-shaped values before selected lines were printed.

## Exact result

The single `verify` job failed only in the second full UI invocation:

| Step | Result |
|---|---|
| `npm ci`, workspace preparation, Supabase start/migration | PASS |
| Browser installation | PASS |
| `npm run verify` | PASS, including its Chromium smoke test and production build |
| `npm run test:ui` | FAIL: 1 failed, 27 passed in 37.6 seconds |
| Evidence upload and `npm run db:stop` | PASS |
| Dependency audit | SKIPPED because the preceding UI step failed |

The only failure was Chromium `tests/ui/http-boundaries.spec.ts:157`, `redirects the loopback alias to the configured local origin`. Playwright recorded that the request reached `127.0.0.1:3100/welcome`. With redirect following disabled, it received 200; the expected response was a 308 with `Location: http://localhost:3100/welcome`.

All other HTTP boundaries passed, including Origins, media type, malformed/oversize JSON, field validation, tampered authentication cookies, private-cache/CSP headers, and the real application-versus-provider rate test. Both M1 tests and all four usability tests passed in Chromium, WebKit and Firefox. This is isolated canonical-host behavior, not a browser-launch, Auth, Mailpit, database, build or general server-start failure.

## Diagnosis

The redirect branch determines incoming authority from `request.nextUrl.hostname`, `.port` and `.origin`. That is a framework-derived URL, not the raw HTTP authority. Next 16.3.4's production server constructs request metadata from its configured fetch hostname and listening port when those are present; this application starts Next with `--hostname 127.0.0.1`. The CI request proves that the external alias reached the server, but one of the `request.nextUrl` comparisons did not retain the distinction required by this redirect branch.

The raw `Host` header is the correct local transport boundary for this check. It is safe here because the redirect target is always the configured `APP_ORIGIN`, and the branch already runs only for GET/HEAD in `APP_ENV=local|ci`. The untrusted header selects only whether a redirect to that fixed origin occurs; it never supplies the destination.

## Minimal fix

In `src/proxy.ts`, replace the incoming `request.nextUrl` authority comparisons with narrowly parsed `request.headers.get('host')` data:

1. Read `Host`; if missing or invalid, skip local alias canonicalization.
2. Parse it as an HTTP authority. Accept only hostname `localhost` or `127.0.0.1`.
3. Require its effective port to equal the configured canonical origin's effective port.
4. If its normalized authority differs from the configured canonical authority, return the existing 308 to the configured origin while preserving only pathname and search.
5. Keep the current local/CI and GET/HEAD gates. Do not use `x-forwarded-host` for this local boundary and do not build the redirect target from either inbound header.

The existing absolute-alias Playwright request should remain. Add one assertion that a GET to the configured `localhost` origin returns 200 with redirect following disabled; this prevents a self-redirect loop. A focused helper test for malformed, missing, foreign, mismatched-port and IPv6 authorities is useful only if authority parsing is extracted; otherwise the two real HTTP requests cover the changed observable behavior without duplicating implementation details.

If the absolute alias still behaves differently after the code change, make the test transport deterministic by connecting to the configured origin while explicitly setting `Host: 127.0.0.1:3100`. Playwright's API request implementation permits request headers. The first choice remains the absolute alias because the CI report proves it connected successfully.

## Validation

Run the smallest affected check first:

```sh
npm run test:ui -- --project chromium --grep 'redirects the loopback alias'
```

Then run the full UI suite and the skipped audit:

```sh
npm run test:ui
npm audit --omit=dev && npm audit
```

The CI rerun must show the canonical 308 and 200 non-loop behavior, 28/28 UI tests passing, and the dependency-audit step executing. [Run 33989840616](https://github.com/rajeshkanaka/Sankalp/actions/runs/33989840616) remains the failure evidence.
