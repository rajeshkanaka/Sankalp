# SK-008 offline HTTP boundary handoff

Owner: `/root/m1_domain`

Branch/worktree: `task/SK-008-http` at `/Users/rajesh/sankalpa-worktrees/SK-008-http`

Base: `021b215059bd18f95433c69b6f846a3404df6187`

Implementation commits:

- `5777469` — `SK-008: verify offline HTTP account boundaries`
- `4f78319` — `SK-008: cover offline read account mismatch`
- `2fa69ee` — `SK-008: canonicalize replay response digests`

## Test coverage

`tests/ui/offline-http.spec.ts` is a browser-neutral HTTP boundary workflow. The coordinator's shared
Playwright configuration excludes it from WebKit/Firefox without creating skipped-result records. It
uses the guarded fixture and captured local-email sign-in helper with the paired
`ui-http-maya@example.test` and `ui-http-arun@example.test` accounts.

The test verifies:

- unauthenticated `GET /api/auth/session` returns a structured private `401 SIGN_IN_REQUIRED`;
- an authenticated identity response contains exactly `accountId` and the server clock, uses the
  expected UUID/instant formats and has private/no-store headers;
- an owner can read the canonical session with exactly the `SessionRecord` fields, while the other
  signed-in owner receives the same private `404 NOT_FOUND` boundary as an absent record;
- a browser signed into the other account and carrying the original account header receives
  `409 ACCOUNT_CHANGED` from both session and reflection reads before private content is returned;
- a browser signed into the other account cannot replay valid practice, completion or reflection
  envelopes carrying the original account header: every call returns `409 ACCOUNT_CHANGED` without
  a current object, and follow-up owner reads show that the session revision, values, completion and
  reflection remained unchanged;
- matching owner headers accept all three mutation streams. Exact retries reuse each original
  envelope and return the same response digest without serializing private bodies into an artifact;
- existing authenticated online mutations without `X-Sankalpa-Account` remain accepted through the
  real journey create and activation setup;
- a real future schedule revision tombstones the original unopened session. The owner session API
  returns that exact superseded snapshot for offline conflict review, while a mutation against it
  returns `409 SESSION_REPLACED` with a shape-checked current tombstone. A second read proves its
  revision and practice value did not change.

All successful and error responses checked by the test assert private cache headers. Identity,
session, reflection and structured error fields use explicit allowlists. The test creates only
synthetic records, takes no screenshots or traces, and does not print or persist authentication URLs,
cookies, reflection bodies or full private mutation responses.

## Coordinator-owned dependencies

This branch deliberately does not contain the coordinator's implementation and fixture changes.
Integrate the three test commits only after root includes:

- `GET /api/auth/session` returning `{ accountId, now }`;
- `GET /api/sessions/:id` returning an owner-scoped canonical `{ session, now }`, including an owned
  superseded snapshot for conflict review while leaving tombstone mutations rejected;
- `assertExpectedAccount` before rate-limit consumption, input parsing and mutation execution for all
  authenticated mutation routes;
- `offline-http.spec.ts` in the shared `tests/ui/test.ts` exclusion so it does not reset the ordinary
  `ui` namespace;
- `ui-http-arun@example.test` in the guarded sign-in rate-limit helper allowlist.

The coordinator confirmed the two shared fixture changes are prepared. They remain outside this
worker's permitted files.

## Read-only public shell review

At the coordinator's request, this worker separately inspected root's uncommitted
`src/service-worker/{policy,worker,register}.ts` and `scripts/build-offline.mjs` without editing them.
No independent blocking defect was found in the source-only boundary:

- cache selection requires an exact same-origin allowlisted path with no query or fragment;
- install fetches omit credentials and rejects redirects, unsuccessful responses, foreign origins
  and unexpected MIME types before caching;
- private/RSC/API/auth/export routes cannot enter the public-asset cache branch, and document fallback
  occurs only for explicit same-origin app paths after a network exception, never for an online HTTP
  error;
- updates do not call `skipWaiting`; activation deletes only older app-prefixed public caches, and the
  readiness probe reports public-cache presence without claiming that private IndexedDB is ready;
- the build uses the pinned Vite API, disables env-file loading and source maps, and rejects Next or
  server imports from the public bundle.

The expected coordinator integration remains unfinished: generate the shell before every clean Next
build, add the public shell entry, and give `/sw.js` plus `/offline/**` their static proxy exclusions,
CSP, MIME and worker-update cache headers. These are known integration steps, not new defects in the
source reviewed here. A useful narrow hardening is to apply `isPublicAssetResponse` to the network
fallback after an allowlisted cache miss, so a future proxy misroute cannot pass through a redirect or
wrong-MIME response; install-time cache integrity is already enforced.

## Verification

Commands use Node/npm through `fnm exec --using 24.20.0`.

- `npm ci` — PASS, 255 packages installed and audit reported 0 vulnerabilities; no manifest or lock
  file changed.
- `prettier --check tests/ui/offline-http.spec.ts` — PASS.
- `eslint tests/ui/offline-http.spec.ts --max-warnings 0` — PASS, zero warnings.
- `npm run typecheck` — PASS; route types generated and TypeScript emitted no errors against the
  committed base contracts.
- `git diff --check` and staged diff checks — PASS before commit.
- The first integrated root run reached the first practice idempotency assertion. The initial digest
  used ordinary `JSON.stringify`, so PostgreSQL JSONB object-key order caused a false mismatch.
  `2fa69ee` recursively sorts object keys while retaining array order and rejecting non-JSON values;
  response content remains strictly compared without writing the private body to an artifact.
- `npm run test:ui -- --grep "offline replay HTTP boundaries"` — **NOT RUN** in this worker as
  assigned. The worktree has no `.env.local`, allocated runtime/database, or the root's uncommitted
  routes/shared fixture changes.

## Integration action

Cherry-pick `5777469`, `4f78319` and `2fa69ee` after the coordinator-owned dependencies, run the
focused Chromium HTTP case on the guarded root runtime, then retain its safe summary result. No
response screenshot, raw trace or HTML report is required. Run the full M1-M3 regression separately
after the offline client/UI is integrated.

No production source, shared helper, fixture, configuration, runtime file, migration, dependency,
lockfile or tracking document changed. Runtime acceptance remains coordinator-owned, so this handoff
does not change SK-008 status.
