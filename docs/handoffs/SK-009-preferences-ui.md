# SK-009 reminder preferences UI handoff

2026-09-06. Worker `/root/merge_review`; isolated worktree `/Users/rajesh/sankalpa-worktrees/SK-009-preferences`, branch `rajesh_kanaka/reminder-preferences`, assigned base `67c4704`. TASKS remains the status authority. This is component preparation, not integrated reminder completion or notification delivery.

## Owned changes

Only `src/features/reminders/preferences/` and this report. Export `ReminderPreferencesForm({ initial, onSave })` from that directory's `index.ts`, using the coordinator's frozen `ReminderPreferenceView` and `MutationEnvelope<ReminderPreferences>` contract. No API, database, service-worker, dependency, shared style or tracking changes.

The form starts from explicit saved preferences and never enables reminders, chooses an offset, requests permission or registers a device automatically. Users add/remove up to eight raw whole-minute text inputs, explicitly select the optional 15-minute preset, choose quiet hours and opt into detailed lock-screen text. The shared pure schema owns validation, including disabled-but-invalid choices. Text inputs preserve empty/intermediate invalid values; errors announce and focus a summary.

Each save retains an internally frozen operation/base/payload envelope and gives the wrapper a clone. An unchanged retry preserves exactly that request; any user edit or explicit conflict resolution clears it for a fresh operation. Duplicate submissions are synchronously guarded; pending controls are disabled. Failures keep raw input. A 409 authorized current view or newer same-journey props offers **Keep my choices** (retain raw values, explicitly adopt the latest base, require a subsequent save) and **Use latest saved settings** (explicitly replace local values). Foreign/malformed current views are not rendered. Successful responses are validated before a saved claim. Parent wrappers should throw the existing `RequestError` with `status: 409` and the authorized full `current` view for conflicts.

Server preview remains clearly separate from unsaved choices. It shows full local date/time, UTC offset and session timezone; both occurrences of a DST fold remain distinguishable. Invalid timezone/date formatting stays unavailable instead of silently displaying the Mac's timezone. Disabled/completed/replaced/past/quiet-hours reasons, limited preview coverage, simulated delivery, missing devices and non-guaranteed delivery are explicit. Fresh device counts at an unchanged reminder revision update the preview without replacing raw form input. Shared cards/form controls are reused; only local layout styles were added for narrow screens.

## Verification actually run

Node `24.20.0`, npm `11.19.0`, Darwin. Commands from this worktree, prefixed with `fnm exec --using 24.20.0`:

- `node node_modules/vitest/vitest.mjs run --project unit tests/unit/reminders.test.ts` — **PASS, 74 existing pure reminder cases** before editing.
- `node --import tsx --test src/features/reminders/preferences/model.test.ts` — **PASS, 6 focused tests**: blank/no-default settings; preserved invalid numeric text; duplicate/count/quiet-hour rules; immutable retry envelope despite caller/input mutation; foreign/malformed response rejection; date rollover and distinct DST-fold offsets.
- `node node_modules/eslint/bin/eslint.js src/features/reminders/preferences --max-warnings 0` — **PASS**.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false` — **PASS** across the checkout. Initial new-code TS2731 on Zod's potentially symbolic issue path was fixed using explicit `String`; rerun passed.
- `node node_modules/prettier/bin/prettier.cjs --check src/features/reminders/preferences` and `git diff --check` — **PASS**.

The six model tests use Node's built-in runner and are outside the existing `tests/unit` Vitest glob because this worker may edit only its feature directory. Coordinator must include the exact Node command in the integration/CI gate or relocate those tests within coordinator ownership. No new test dependency is needed.

**NOT RUN:** application baseline smoke, build, database/API or actual Playwright UI. This assignment explicitly prohibited app/runtime work; coordinator's root runtime remains untouched. No screenshots or actual persistence/delivery evidence are claimed. Cached `origin/main` tracking in this worker was older than the explicit coordinator contract; the worker did not replace shared progress with that snapshot.

## Exact integration next steps

1. Integrate the focused commit containing this report. Wire the coordinator-owned authenticated client wrapper to PUT `/api/journeys/:id/reminders`; keep the exact supplied envelope and map existing API errors without losing `current`/status. Remount on account change at the existing private boundary; form internally remounts for a changed journey ID.
2. Run the focused Node command above, normal static/build/database gates and actual `@M4-reminders` Playwright workflows once routes exist. Assert disabled defaults/no automatic permission, custom offsets 30/5/0, duplicate/empty/range errors, invalid quiet text retained, midnight quiet-hour suppression, full timezone preview, saved revision/reload, real server conflict with both explicit choices, and unchanged-request retry after clearly labeled failed/lost transport. Compare operation ID, base revision and payload exactly; newer edits must use a different ID.
3. Check 320px reflow, 200% zoom, keyboard/focus and axe on the actual app; retain real screenshots and safe functional evidence. Also refresh a same-revision view after device registration while a raw edit exists: count updates, input survives. Simulated jobs remain visibly simulated; no real device registration or push occurs in this component.

Only an unstaged `node_modules` symlink to `../SK-009-integration/node_modules` was created for tools; the current `node_modules/` ignore rule does not match that symlink. It is intentionally excluded from the commit. No owned processes were started and there is no runtime to restore from this worktree.
