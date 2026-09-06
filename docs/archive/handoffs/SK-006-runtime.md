# SK-006 local schema checkpoint

Coordinator /root, 2026-09-06 Asia/Kolkata; integration branch implementation/sankalpa. No worker owns runtime resources.

Migration008 refused the original slot0 because six legacy amendments/two changed sessions belong to one account without the expected synthetic marker. Its address has the reserved test suffix, which is insufficient proof of ownership. No unmarked data was deleted or rewritten. The guarded M1 seed reset only exact marked demo/ui/ui-http fixtures (97 marked demo application rows removed); the remaining ambiguous records were preserved.

Stopped slot0 with `npm run db:stop`, which preserves its Docker volume. Moved its ignored `.local` directory and `.env.local` into ignored, mode0700 `artifacts/private-legacy-slot0-20260906/` (environment file0600). This archive contains sensitive runtime material; never stage/upload it or print its contents. Slot0 remains reserved in the Git-local resource registry. Reusing its history requires a separate audited migration; do not infer causal order or run destructive cleanup.

Allocated fresh slot1 with `npm run workspace:prepare -- --slot 1`; `npm run db:start` applied001–008 to the empty local database successfully and generated a new ignored environment. Actual safe status: project sankalpa-slot-1, app localhost3001, UI3101, DB54422, API54421, captured mail54424, ready=true. All published ports passed the existing explicit127.0.0.1 binding checks. No paid services/network exposure created. The old and new stacks have distinct volumes; slot0 is stopped.

The root working tree now owns slot1. Restart from root using `fnm use 24.20.0`, `npm run db:start`, `npm run db:status`, `npm run demo:seed -- --profile M2`, `npm run dev:demo -- --profile M2`; entry http://localhost:3001/welcome. M3 profile is implemented by coordinator seed changes but not verified at this checkpoint. Application services abe3610/06397e3 consume schema008; the prior code cannot write its revision-less amendments. Do not roll back only code against008.

To inspect the preserved slot0 in a later authorized recovery session, first stop the current owned app/backend, preserve the current slot1 ignored runtime/environment in a different private directory, and restore the exact archived slot0 runtime/environment to root before using local helpers. Never overwrite either runtime, reuse slot0 for a fresh DB, or attach its records to the new app without the audited upgrade. A backup existing on disk is not a tested restoration.

Verification: fresh migration001–008 PASS; safe status/binding checks PASS; M2 service-generated seed PASS; existing+new service DB suite58/60, with two test cases requiring correction (unchanged-zero semantics under D15 and race fixture's future performedAt). Focused reruns and UI integration follow. No M3 task completion is implied.


Later verified checkpoint before the user-requested break: M3 seed and dev launch PASS on slot1 (app3001). Integrated83 database cases and both history/journal workflows in all3 browser engines passed. Original slot0 remains untouched and stopped. Current restart uses `npm run demo:seed -- --profile M3` and `npm run dev:demo -- --profile M3`; the earlier M2/58-of60 text above is historical, with failures corrected and freshly verified. See PROJECT_PROGRESS for final integrated regression and branch checkpoint.
