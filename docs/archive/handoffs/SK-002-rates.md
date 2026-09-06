# SK-002 rate-limit integration-test handoff

Owner: `/root/m1_domain`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-tests`

Branch: `task/SK-001-tests`

Worker starting commit: `d77207f04ad995d77038190fca3dc48913d61f00`

## Delivered

- `tests/integration/rate-limits.test.ts` covers the real `app.consume_rate_limit(scope,key_hash)` function and the server `consumeLimit` wrapper.
- The database assertions cover minute cap 1, hour cap 5, write cap 120, integer retry seconds, database-time rollover, isolation across scopes and keys, 121 concurrent writes with exactly 120 allowed, denied direct table access, `app_api` execute privilege, security-definer rejection for an administrative session, and the 1,000-row/two-hour cleanup boundary.
- The wrapper assertion verifies that the stored key is the SHA-256 HMAC of `APP_ORIGIN:identity` under `RATE_LIMIT_SECRET` without exposing either input, and that the second minute attempt throws the safe 429 `RATE_LIMITED` error.
- Every database key is a fresh random 64-character lowercase hexadecimal value. Cleanup deletes only the exact keys recorded by that test process. The suite creates no Auth users and sends no mail.
- `tests/integration/activation.test.ts` now verifies draft creation idempotence through the explicit third-argument operation ID, one persisted journey and receipt, 409 `OPERATION_REUSED` for the same ID with changed input, and 422 `INVALID_SCHEDULE` mapping for all-past and zero-occurrence schedules.

No production source, shared configuration, migrations, package/lock files, fixtures or shared tracking documents were changed.

## Verification

| Command | Result |
|---|---|
| `fnm exec --using 24.20.0 npm run format:check` | PASS; all matched files use Prettier formatting. |
| `fnm exec --using 24.20.0 npm run lint` | PASS; exit 0 with zero warnings. |
| `fnm exec --using 24.20.0 npm run typecheck` | PASS against temporary copies/symlinks of the coordinator's current `journeys/service.ts`, `errors.ts`, `rate-limit.ts` and `tests/fixtures`; all temporary production/fixture paths were restored or removed and are not committed. |
| `fnm exec --using 24.20.0 npm run test:unit` | PASS; 3 files and 47 tests. |
| Focused live integration suites | **NOT RUN** after these additions. The attempted guarded command stopped before service access with `Missing or invalid .local/runtime.json` and skipped all 14 assertions because this worker has no allocated local backend. Coordinator must run from the integrated root after migration 004 is applied. |

## Integration next step

Cherry-pick the implementation commit into the root containing migration 004, `src/server/rate-limit.ts`, the current journey/error services and `tests/fixtures/local.ts`. Run:

`fnm exec --using 24.20.0 npm run test:integration -- tests/integration/rate-limits.test.ts tests/integration/activation.test.ts`

The rate suite uses real database time, so it must not inherit a demonstration clock. Coordinator review and the live integrated run determine task status; this worker makes no DONE claim.
