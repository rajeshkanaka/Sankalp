# SK-008 online fallback lifecycle tests

Updated 2026-09-06, Asia/Kolkata. Worker `/root/ci_triage`; branch `rajesh_kanaka/online-checkpoints`; worktree `/Users/rajesh/sankalpa-worktrees/SK-006-closure-review`; base `1f98bb8`. The preceding `rajesh_kanaka/hydration-fix` branch remains preserved at `15bc8f0`. TASKS remains the only task-status authority.

## Scope and scenarios

Only `tests/ui/offline-fallback-lifecycle.spec.ts` and this report are owned here. No production code, existing test, fixture, shared configuration, dependency file or coordinator record is changed.

The new file adds two real-app scenarios, each selected by all three existing browser projects:

1. **Sign-out waits for an unresolved reflection write.** Create/activate a synthetic journey and save its numeric target through actual APIs. Hold the browser's real reflection PUT before transmission, start sign-out, and assert the account remains authenticated, no logout request has begun, the canonical reflection is still absent, and the UI says Saving rather than Saved. Release the write and require a real 200 acknowledgment. A second gate delays the real logout request so the authenticated read API can prove the exact whitespace/Unicode note, empty moods and revision 1 were persisted. Release logout and require the welcome page plus an unauthenticated 401. Require exactly one reflection write and one logout request.
2. **Canceling account actions preserves transient input.** Create and confirm a real synthetic practice through the APIs. Enter an unsubmitted mood with whitespace/Unicode, initiate sign-out, require disabled input and an explicit unsaved-choice prompt, cancel, and assert the exact input survives while no reflection was silently saved. Then edit the existing completion time, repeat sign-out/cancel, assert the exact time survives, and prove the canonical performed time and revision remain unchanged. Deliberately cancel the time correction and verify ordinary sign-out succeeds.

Only service-worker registration denial is simulated to select the online controls. The request gates add deterministic transport delays and ultimately continue the real reflection/logout endpoints; they do not fabricate server responses. The new file preserves the existing numeric/failed-reflection fallback test unchanged. Both gates release in `finally`, followed by Playwright's waiting route cleanup.

## Verification

Actual worker checks, with Node 24.20.0 and the existing dependency symlink:

```sh
fnm exec --using 24.20.0 npm exec -- prettier --check tests/ui/offline-fallback-lifecycle.spec.ts
fnm exec --using 24.20.0 npm exec -- eslint tests/ui/offline-fallback-lifecycle.spec.ts --max-warnings 0
fnm exec --using 24.20.0 npm run typecheck
git diff --check
```

All passed after applying Prettier to the initial new file. Type checking includes Next route type generation. No application runtime, database, environment file or browser was accessed by this worker. The two new UI scenarios and their screenshots are **NOT RUN / NOT CAPTURED** pending coordinator execution. Static success does not establish application acceptance or task completion.

## Integration and exact next action

Coordinator cherry-picks the focused commit, uses the current integrated production build and allocated synthetic runtime, and executes:

```sh
fnm exec --using 24.20.0 npm run test:ui -- tests/ui/offline-fallback.spec.ts tests/ui/offline-fallback-lifecycle.spec.ts
```

Expected: nine cases across Chromium, WebKit and Firefox, with real authentication, writes and reads. No test fixture/configuration change is required; the existing per-test synthetic reset applies to the new filename. Both scenarios explicitly restore the canonical M1 test clock before setup and use only synthetic accounts/data.

When actually run, the existing reporter retains the safe result summary. Screenshots are written through the existing convention to `docs/evidence/M3/<UI_RUN_ID>/<browser>/online-only-pending-signout.png` and `online-only-correction-draft-signout.png`. Review any failure without weakening acknowledgment ordering, canonical-data assertions or exact draft preservation. No evidence files have been invented or committed in this worker.

Last single PR4 snapshot while starting this assignment: [34017887283](https://github.com/rajeshkanaka/Sankalp/actions/runs/34017887283) remained IN_PROGRESS on `1d15d81`; no later result or merge is claimed here.
