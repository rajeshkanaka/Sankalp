# SK-001 synthetic fixture handoff

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-fixtures`

Branch: `task/SK-001-fixtures`

Base: `acf32ba7c3f299b47420fe9c2fb7d54c50e3dff9`

Implementation commit: `ca328402427948f3251b8202aefb4ed93a0238f1`

Resource slot: none. This worker did not copy another worktree's runtime or start services.

## Delivered

- `scripts/seed.ts` implements `npm run demo:seed -- --profile M1 [--namespace demo|ui|integration]` using local Supabase Admin Auth and the local administrative Postgres connection.
- Demo users are exactly `maya@example.test` and `arun@example.test`; UI and integration identities are separately prefixed. Users have no seeded password and still authenticate through the real local email-link flow.
- Auth identities carry a versioned `app_metadata.sankalpa_fixture` marker. A reserved email with a missing or different marker stops the whole run before application-data reset.
- Before mutation, the seed requires `APP_ENV=local|ci`, matches both URLs to the current worktree's `.local/runtime.json` allocation, verifies the `postgres` database/role and exact M1 application schema, and exercises the Supabase Admin API.
- Immediately before reset, the seed compares the Admin API identities with `auth.users` IDs, exact emails and markers. Only those positively identified user IDs are passed to the reset transaction.
- The reset defers constraints, clears `journey.active_schedule_version_id`, deletes each selected synthetic profile with application-row cascades, and recreates one enabled blank profile per account. Other namespaces and auth users are retained.
- `.local/demo-clock.json` is written atomically with `2026-09-05T00:45:00Z`. Actual auth IDs are stored only in ignored, mode-0600 `.local/fixtures/M1-<namespace>.json` files. Console output contains synthetic counts only.
- `tests/fixtures/ids.ts` provides the canonical identities, namespaces, marker constants and M1 clock. `tests/fixtures/local.ts` exports strict argument and local-runtime guards for reuse by integration tests.

## TDD and verification evidence

1. RED: a temporary contract harness failed with `MODULE_NOT_FOUND` before `tests/fixtures/local.ts` existed.
2. GREEN: the harness passed argument allowlist and local URL/root/port guard assertions.
3. RED: the extended harness failed with `MODULE_NOT_FOUND` before `scripts/seed.ts` existed.
4. GREEN: marker and reserved-email assertions passed after the minimal seed module was added.
5. Boundary RED: reordered JSON marker keys returned false; structural marker validation replaced order-sensitive serialization comparison, then the harness passed.

| Command | Result |
|---|---|
| `fnm exec --using 24.20.0 npm ci` | PASS; 254 packages added, 255 audited, 0 vulnerabilities. Existing npm allow-scripts warnings for `esbuild` and `fsevents`. |
| `fnm exec --using 24.20.0 npx tsx /tmp/sankalpa-seed-guard.test.ts` | PASS; pure guard/marker contract assertions. Temporary harness is outside the repository. |
| `fnm exec --using 24.20.0 npx eslint scripts/seed.ts tests/fixtures/ids.ts tests/fixtures/local.ts --max-warnings 0` | PASS. |
| `fnm exec --using 24.20.0 npm run format:check` | PASS; all matched files use Prettier style. |
| `fnm exec --using 24.20.0 npm run lint` | PASS; zero warnings/errors. |
| `fnm exec --using 24.20.0 npm run typecheck` | PASS. |
| `fnm exec --using 24.20.0 npm run test:unit` | PASS; 3 files, 47 tests. |
| Production-mode guarded invocation | PASS by expected refusal before runtime access; no mutation. |
| Unknown-profile guarded invocation | PASS by expected refusal; no mutation. |
| Actual Supabase seed/reset | NOT RUN in this worktree by assignment. The root slot runtime belongs to `/Users/rajesh/sankalpa`; the worktree guard intentionally rejects copied runtime metadata. |

## Consumed and produced interfaces

Consumed: `.local/runtime.json` from `scripts/local.mjs`, `.env.local` keys `APP_ENV`, `SUPABASE_URL`, `LOCAL_ADMIN_DATABASE_URL` and `LOCAL_SUPABASE_SECRET_KEY`, the two SK-001 migrations, and Supabase JS 2.115.0 Admin Auth.

Produced: canonical fixture account specifications and a guarded-runtime loader under `tests/fixtures/`; ignored fixture identity files for later local integration/UI tests.

The pinned Supabase JS `AdminUserAttributes` type has no caller-supplied user ID. The seed therefore looks up or creates users by exact reserved email and records returned UUIDs only in the ignored identity file.

## Integration next step

Cherry-pick this commit into `/Users/rajesh/sankalpa`, then run the actual root-slot check:

```sh
npm run demo:seed -- --profile M1 --namespace demo
```

Verify `.local/demo-clock.json`, confirm two blank `app.profile` rows with no owned journey rows, then reuse `.local/fixtures/M1-demo.json` from the root worktree for Mailpit/UI login tests. Coordinator integration and runtime evidence determine SK-001 status.
