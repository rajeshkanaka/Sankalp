# SK-009 reminder preference UI verification handoff

## Break checkpoint — resume this entry first

The user requested an immediate break after the coordinator's API checkpoint `f405c1c`. Implementation stopped before any sign-out guard source or new regression was written.

- Current worker branch: `rajesh_kanaka/reminder-preferences-checkpoint`.
- Current worker worktree: `/Users/rajesh/sankalpa-worktrees/SK-009-preferences-checkpoint`.
- Source base: `f405c1c` (coordinator API/page/client checkpoint), which already contains the four preference tests integrated as `0a34cc2` from worker `e7da524`.
- Owned pending scope: `src/features/reminders/preferences-client.tsx`, `src/features/reminders/preferences/` if needed, `tests/ui/m4-reminder-preferences.spec.ts`, this report, and `tests/unit/reminder-preferences-model.test.ts` only if a meaningful new pure boundary test is needed. Shared tracking, routes and SQL remain coordinator-owned.
- This break commit changes only this report. No application/test source changed in the new worktree. The existing dependency symlink remains ignored/unstaged; no dependency was installed.
- No worker runtime, browser, database connection, app process or test fixture was started. No new check was run after the fresh worktree was created. Actual preference UI/API/axe/screenshots remain **NOT RUN** by this worker; retain the earlier static-only results below without promoting them.

Read-only review found a concrete data-preservation gap: `ReminderPreferencesClient` mounts the form without the account editor checkpoint lifecycle. The form owns raw input and retained request envelopes but never registers them or observes the provider's frozen state. Editing a reminder, then clicking **Sign out** or changing device privacy, lets shared controls see no unsaved editor and discard the form. An in-flight PUT is not awaited either. Coordinator assigned this fix and approved the narrow bridge below; it is **not implemented**.

Exact next substep: add an optional browser-neutral form lifecycle bridge `{ frozen, isFrozen, registerEditor }`, passed by the client wrapper from `useOfflineAccount`. Register a getter covering changed/invalid raw preferences, unresolved conflicts, retained uncertain attempts and pending saves, plus settlement of the active request. Block edits, submits and conflict choices synchronously while frozen. Check async continuations too; if a response arrives during an account action, preserve the exact envelope and raw values, explain that retry is needed to verify the save, and require the existing explicit account-control choice. Do not invent another discard flow or persist invalid raw data.

Then add real regressions for invalid/unsaved reminder → sign-out/cancel and pending save → account freeze → retained retry. A proposed deterministic pending-save test uses the existing guarded local test environment to hold a read lock only on the freshly API-created synthetic journey row, starts the real PUT, freezes through **Sign out**, releases the lock, and verifies the identical retry envelope and single revision. No route response mock is needed. This test has **not been written or executed**. Only the coordinator may run it in the assigned slot 2 runtime; never borrow root/slot 1 resources.

Other source-review findings were sent to the coordinator: the new page needs an h1 and CSS-module classes on its navigation links; the coordinator owns those fixes. Activation and schedule revision still need calls to refresh reminder jobs after new sessions are created; this remains a coordinator lifecycle integration gate. Authenticated RLS transactions, stale-base precedence before `NO_CHANGE`, normalized preference comparison and receipt envelopes otherwise matched the frozen contract by source inspection. SQL011 is under a different review owner; no duplicate SQL audit was performed here.

After resuming, first reconcile this branch with the coordinator's current accepted checkpoint and ownership, preserve all dirty work, implement the bounded bridge, run scoped static/model checks, and hand it back for actual slot 2 browser verification. No feature completion, screenshot, successful runtime test or remote push is claimed by this break checkpoint.

2026-09-06. Worker `/root/merge_review`; coordinator `/root`. Task status remains solely in [TASKS](../TASKS.md). This report checkpoints executable tests, not completed application verification.

## Ownership and checkpoint

- Branch: `rajesh_kanaka/reminder-ui-tests`.
- Worktree: `/Users/rajesh/sankalpa-worktrees/SK-009-ui-tests`.
- Base: `177ab8b0756ff7976897b53865b3315a713e988e` on the assigned M4 integration path. The coordinator is responsible for bringing accepted offline main changes into that integration.
- Owned changes: `tests/ui/m4-reminder-preferences.spec.ts` and this report only. No source, routes, shared tracking, configuration, dependency files or database changes.
- The dependency symlink `node_modules` points to the coordinator's existing SK-009 integration dependencies. It is untracked and deliberately unstaged. No packages were installed.
- No app, browser, database, mail service or worker process was started in this worktree. No root/slot 1 resources were borrowed.

## Test scope

Four real application workflows are tagged `@M4`, `@M4-preferences` and `@M4-reminders`, producing 12 cases with the repository's three browser projects:

1. Follow the actual journey's **Reminders** link. Confirm disabled/empty defaults, disabled unchanged Save, generic privacy, simulated transport and zero registered devices. Choose offsets 120/30/5/0 for a midnight Asia/Kolkata practice, choose quiet hours 23:50–00:10 and opt into detailed text. Verify the real PUT envelope and revision increment, read persisted preferences through GET, and compare exact UTC instants with complete displayed dates/timezone. Quiet hours suppress the 23:55/00:00 reminders without shifting them. Replay the actual captured envelope through the real API to check its receipt, then reload and verify persisted controls. Assert 320px reflow, 44px buttons and axe results; capture desktop/mobile screenshots.
2. Preserve typed `1e-`, 1441, duplicate offsets and invalid/equal quiet-hour values while showing focused, accessible validation. Invalid disabled preferences must also be rejected. Assert no PUT and unchanged canonical state throughout invalid attempts. Exercise the explicit 15-minute preset, maximum eight inputs and 1440-minute boundary; save corrected values and verify actual persistence. Capture the retained validation state.
3. Use two separate browser contexts with the same captured synthetic account to produce real stale-revision conflicts. Keep 30-minute local choices after the other context saves 15; require explicit review and a new operation ID against the current base before saving. Then test the other context's explicit **Use latest saved settings** choice, preserving its 5-minute input until that click and confirming the saved 30-minute value after reload. Capture comparison/resolution states.
4. Both contexts independently choose 10 minutes. After the first save, the stale second request must return `REVISION_CONFLICT` with authorized current settings. **Keep my choices** must recognize the identical accepted settings, disable Save and avoid another request/revision. Reload to confirm persistence. A separate direct API probe checks that a new same-value intent returns `NO_CHANGE` with current settings and does not increment the revision. Capture the resolved no-change state.

No response is mocked, fulfilled, aborted or replaced. The only request listeners observe real mutation envelopes in test memory. The receipt probe is explicitly an API replay; it does not claim to reproduce a failed browser response or notification delivery.

## Fixtures and runtime contract

The existing guarded `tests/ui/test.ts` auto fixture seeds profile M1 in namespace `ui` before each test. `capturedSignIn` uses only allocated `ui-maya@example.test` / `ui-arun@example.test` accounts and the actual local captured-email flow. Each test creates and activates its own synthetic journey through authenticated APIs; an M4 seed helper is not required for this file.

Each test sets the guarded UI clock to `2026-09-05T16:00:00Z` (21:30 Asia/Kolkata), creates two daily midnight sessions beginning 2026-09-06, and restores `2026-09-05T00:45:00Z` after the test, including failures. Browser contexts are closed in `finally`. The existing single-worker test configuration serializes the shared UI namespace and clock.

Coordinator prerequisites are the frozen [SK-009 contract](SK-009-contract.md), actual page `/journeys/:id/reminders`, its journey navigation link, and authenticated GET/PUT `/api/journeys/:id/reminders`. The tests require `ReminderPreferenceView`, mutation receipts, stale-base conflict precedence, no-change responses, no-store reads and truthful simulated/no-device state.

## Verification actually performed

Environment: macOS, Node `24.20.0`, npm `11.19.0`, repository-pinned dependencies.

- **PASS:** `fnm exec --using 24.20.0 node node_modules/eslint/bin/eslint.js tests/ui/m4-reminder-preferences.spec.ts --max-warnings 0`.
- **PASS:** `fnm exec --using 24.20.0 node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- **PASS:** `fnm exec --using 24.20.0 node node_modules/prettier/bin/prettier.cjs --check tests/ui/m4-reminder-preferences.spec.ts docs/handoffs/SK-009-preferences-ui-verification.md`.
- **PASS:** `git diff --check` and review of the two explicitly staged files.
- **PASS, discovery only:** pinned Playwright `test --list` with an ephemeral OS-temporary configuration naming this test file and Chromium/WebKit/Firefox, with no web server or global setup. It listed **12 tests in one file**. The temporary directory was removed. The repository configuration was deliberately not loaded because its module initialization requires a worktree runtime and writes a UI clock.
- **NOT RUN:** actual browser workflows, screenshots, axe, UI smoke, production build, database/API execution or notification delivery in this worker. Discovery/static passes do not imply any of those passed.

## Exact integration next step

After integrating this commit and the real routes into the coordinator's slot 2 checkout, use its recorded runtime/startup procedure and run:

```sh
fnm exec --using 24.20.0 npm run test:ui -- tests/ui/m4-reminder-preferences.spec.ts
```

Do not create a borrowed runtime in the test worker. Diagnose actual failures before changing assertions; no sleeps, retries, mock success responses or missing-device substitutions are built into these tests. Broader regression and task completion remain coordinator responsibilities.

Intended evidence directory after actual execution: `docs/evidence/M4/<UI_RUN_ID>/<browser>/`, with `reminder-midnight-preview.png`, `reminder-midnight-mobile.png`, `reminder-validation-retained.png`, `reminder-conflict-comparison.png`, `reminder-conflict-resolved.png` and `reminder-conflict-already-matches.png`. These screenshots do not exist from this worker's static preparation. Repository Playwright reporting should retain the actual run result separately. Actual push permission, installed-device delivery and network-failure retry UX remain outside this test assignment.
