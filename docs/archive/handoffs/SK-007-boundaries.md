# SK-007 shared validation and database boundaries

Date: **2026-09-06**. Worker branch `task/SK-007-boundaries`, worktree `/Users/rajesh/sankalpa-worktrees/SK-007-boundaries`, base `a65b68f`. Task status belongs only to [TASKS](../../TASKS.md). This report and the two assigned test files are the only changes.

## Coverage

- `tests/unit/reflection-validation.test.ts`: 29 validation cases covering exact paragraphs/whitespace/plain HTML text; empty notes; 20,000/20,001 BMP and astral code points; invalid Unicode/NUL; five/six moods, duplicate-after-trim, 40/41-code-point labels; optional unique prompts; malformed UUID/date/range/limit/cursor/filter values and bounded multilingual search. Cursor tests cover the shared lexical schema; decoding cursor JSON and validating its contents belong to journal service tests.
- `tests/integration/reflection-boundaries.test.ts`: real `app_api` RLS reads and unauthorized changes; forged owner/composite session/version references; correction-event linkage to the exact amendment owner, session and revision; immutable amendment/event UPDATE and DELETE denial; reflection/revision uniqueness; SQL Unicode length/empty/paragraph/revision/timestamp checks; five mood positions, duplicate labels/positions, astral label limits and whitespace-only/padded labels. Expected-error operations always roll back, including an unexpected successful write, so one assertion cannot corrupt later evidence.
- Database fixture creation reuses the existing guarded environment, bounded synthetic-account discovery, exact ownership markers and create/activate services. Only its two uniquely named fixture accounts are removed; no DDL or migration is run. Reflection/history rows are deliberately inserted through `withUser` for schema verification without depending on the unfinished journal/correction services. Every owned practice-history fixture amendment has an explicit post-mutation revision.
- Logging coverage observes application console output around successful and rejected parameterized private SQL, and tests that `app_api` cannot read server files. Browser roles must lack SELECT grants on the new private tables. This does **not** claim an HTTP/proxy/provider access-log inspection; the coordinator still needs to verify journal POST routing and actual deployment logging.

## Findings sent to the coordinator

1. At `a65b68f`, `src/domain/validation.ts:133–142` trims reflection text. Leading/trailing paragraph whitespace is lost, and a raw over-limit padded note can become valid after trimming. The exact-text regression and raw 20,001-character test fail. Preserve note text verbatim; trim only mood/search fields.
2. The same schemas accept NUL and ill-formed UTF-16. NUL cannot be stored in PostgreSQL text; isolated surrogate input cannot round-trip unchanged through UTF-8. Reject these at validation instead of a generic database failure or replacement-character corruption.
3. Migration008's original `label=btrim(label)` trims spaces only, allowing tab-only/newline/NBSP/FEFF-padded labels contrary to the API normalization boundary. Match the JavaScript trim character set in the SQL check.

Coordinator accepted all three and has source/schema fixes in the integration checkout. This worker did not edit those files. Fresh reading of coordinator `src/server/sessions/locking.ts` confirms journey then session lock order and clock sampling after both locks. No additional high-confidence locking/schema defect was found in this bounded review. Service-level behavior and cursor decoding remain with their owners.

## Actual verification

Executed in this worker with a temporary symlink to the existing installed dependencies:

```sh
fnm exec --using 24.20.0 npm exec -- prettier --write tests/unit/reflection-validation.test.ts tests/integration/reflection-boundaries.test.ts
fnm exec --using 24.20.0 npm exec -- eslint tests/unit/reflection-validation.test.ts tests/integration/reflection-boundaries.test.ts --max-warnings 0
fnm exec --using 24.20.0 npm run typecheck
fnm exec --using 24.20.0 npm run test:unit -- tests/unit/reflection-validation.test.ts
git diff --check
```

Formatting, scoped lint, TypeScript and whitespace checks **PASS**. The baseline unit run is **22 PASSED / 7 FAILED**, reproducing the accepted note-trimming and invalid-Unicode defects in the old base. These are intentional regression expectations, not weakened or skipped checks. A green run against the coordinator fixes is **NOT RUN** here.

Database, application smoke, production build, UI and runtime access-log verification: **NOT RUN** in this worktree; no runtime/environment was allocated or copied. The coordinator reports migration008 applied only to a fresh guarded slot after preserving the original slot's unmarked history; this is coordinator evidence, not a worker-executed migration. Do not run this suite against a database lacking008 or bypass its legacy-history guard.

The temporary dependency symlink is removed before handoff; no owned processes survive. Review/integrate the focused test commit, then the coordinator runs:

```sh
fnm exec --using 24.20.0 npm run test:unit -- tests/unit/reflection-validation.test.ts
fnm exec --using 24.20.0 npm run test:integration -- tests/integration/reflection-boundaries.test.ts
```

Retain the actual integrated results and rerun required regression gates. Preserve the failed baseline as evidence that the seven tests detect the corrected defects; do not mark this task DONE from static checks.
