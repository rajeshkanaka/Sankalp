# SK-003 recoverable setup drafts

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-003-drafts`

Branch: `task/SK-003-drafts`

Base: `a28810b`

## Implemented

- Added `updateJourneyDraft(userId, id, envelope)`. The mutation validates the normalized draft, uses the existing owner-scoped transaction and idempotency receipt, locks the journey row, rejects non-drafts, enforces the supplied revision, recalculates the schedule preview through the same helper as creation, and advances only the draft/title/intention/revision columns.
- Kept the 20-journey account limit on creation. Re-previewing an existing saved draft does not run the creation path or allocate another journey row.
- Added saved-draft setup state. `SetupForm` accepts `initialDraft?: JourneyRecord`, restores every editable field and practice ID, requires timezone confirmation again, and retains one server draft ID/revision across edit and re-preview cycles.
- Kept request attempts stable across uncertain failures. A retry reuses the exact operation ID, base revision, normalized payload and practice IDs; a successful edit clears the attempt and advances to the returned revision.
- Added guarded database coverage for twenty successive edits remaining one row, latest-preview activation, exact idempotent retry/body reuse, invalid-schedule rollback, foreign-owner privacy, active-draft rejection, stale revisions and concurrent edits. Added a real browser workflow for resume, timezone reconfirmation, interrupted PUT retry, stable practice IDs and activation of the final edit.

No draft deletion, archive or other lifecycle behavior was added; those remain SK-014 scope.

## Commits

- `835110c` — `SK-003: update recoverable journey drafts`
- `f4327bd` — `SK-003: resume one saved setup draft`
- `e32b4a5` — `SK-003: verify visible draft recovery`

## Verification

- Initial `fnm exec --using 24.20.0 npm run typecheck` — expected RED because the new integration test imported the missing `updateJourneyDraft` export.
- `fnm exec --using 24.20.0 npm run typecheck` — PASS.
- `fnm exec --using 24.20.0 npm run lint` — PASS, zero warnings.
- `fnm exec --using 24.20.0 npm run test:unit` — PASS, 7 files and 80 tests.
- `fnm exec --using 24.20.0 npm run build` — PASS.
- `git diff --check` — PASS.
- `npm run test:integration -- tests/integration/draft-recovery.test.ts` — NOT RUN; the coordinator owns the guarded root database/runtime.
- `npm run test:ui -- --grep @SK003` — NOT RUN; the coordinator owns the root production test server and the required route/page integration.

## Coordinator integration

1. Cherry-pick `835110c`, `f4327bd`, `e32b4a5` and the final handoff commit.
2. Add the coordinator-owned strict `PUT /api/journeys/:id/draft` route with `mutationEnvelopeSchema(journeyDraftSchema)` and call `updateJourneyDraft`.
3. Have `/setup?draft=<uuid>` load only an owned draft and pass it as `initialDraft`; return the same private 404 for foreign, missing and non-draft resume targets.
4. Show saved drafts on Journeys with a resume link so no persisted draft is hidden. Keep active journeys on their existing detail path.
5. Run the focused database and `@SK003` browser tests, then the full integration/UI and required verification gates. The browser test deliberately aborts one local draft PUT to prove exact retry recovery and does not log request bodies or authentication links.
