# SK-004 metadata hydration recovery

Updated 2026-09-06, Asia/Kolkata. Worker `/root/ci_triage`; branch `rajesh_kanaka/hydration-fix`; worktree `/Users/rajesh/sankalpa-worktrees/SK-006-closure-review`; base `d7a1096`. This report is evidence and handoff only; TASKS remains the status authority.

## Observed failure

[CI 34016234742](https://github.com/rajeshkanaka/Sankalp/actions/runs/34016234742) on documentation-only PR4 passed `verify` but failed one of 53 UI cases. WebKit's metadata conflict test expected `Revised night practice`; the input retained its original `21-night Sankalpa` value after the simulated 409. The original expectation timed out after 10 seconds. The other 52 cases passed; audit was skipped after this failure.

[CI 34015719614](https://github.com/rajeshkanaka/Sankalp/actions/runs/34015719614) passed on the preceding PR3. Comparing `30f80ca` with `ac5f990` showed identical non-documentation source, tests and configuration. Metadata error handling does not reset either field. Enabled server-rendered controlled inputs accepting edits before hydration are the likely mechanism, inferred from the code and symptom; the original timing race has not been reproduced locally. Next.js documentation bundled with pinned 16.3.4 confirms Client Components initially have non-interactive server HTML. [Playwright's hydration guidance](https://playwright.dev/docs/navigations#hydration), verified 2026-09-06, describes lost input and recommends keeping controls disabled until hydration.

Private CI log: `/Users/rajesh/sankalpa/artifacts/private-ci-34016234742.log`, ignored, permission 0600; lines 83–116 contain the failure. No raw logs or authentication data are committed.

## Changes

- Metadata title/intention fieldset and save button stay disabled until the component's mount effect runs. Existing pending-write disabling, input state, conflict recovery and API semantics are retained.
- The existing real-app revision workflow now pauses Next.js script requests during a reload. If metadata is server-rendered, it asserts both fields cannot be edited and save is disabled. The coordinator's upcoming offline account boundary can instead withhold all private controls until identity is ready; in that case the test requires its explicit `Opening your private practice space…` message and the absence of both metadata fields and save. It then releases hydration, waits for all three controls to become enabled, and enters data. It also checks the submitted metadata payload contains both entered values. Existing conflict preservation, successful retry, historical schedule, screenshot and accessibility assertions remain unchanged. The original enabled server-rendered form still fails this regression; arbitrary missing content is not accepted.
- The script gate is released in `finally`; no arbitrary sleep, test retry, weaker expectation or alternate application implementation was added.

## Verification actually performed

On macOS, using Node 24.20.0 through `fnm` and the existing dependency symlink:

```sh
fnm exec --using 24.20.0 npm exec -- prettier --check src/features/journeys/revision/metadata-editor.tsx tests/ui/revisions.spec.ts
fnm exec --using 24.20.0 npm exec -- eslint src/features/journeys/revision/metadata-editor.tsx tests/ui/revisions.spec.ts --max-warnings 0
fnm exec --using 24.20.0 npm run typecheck
git diff --check
```

All four commands passed. `typecheck` generated local route types and completed TypeScript checking. Final diff review is limited to the two owned implementation/test files and this report.

Production build, baseline smoke, delayed-hydration regression, full UI, integration checks and screenshots: **NOT RUN in this worker**. No environment file or database was accessed and no application/browser process was started. Coordinator owns integrated runtime verification; this commit is not evidence of a fully verified fix or completed task.

## Exact next action

Coordinator cherry-picks the focused commit, rebuilds the production app, and runs the revised workflow against the allocated synthetic runtime:

```sh
fnm exec --using 24.20.0 npm run build
fnm exec --using 24.20.0 npm run test:ui -- tests/ui/revisions.spec.ts
```

Expected: all three browser projects pass, including the delayed-script assertions and unchanged metadata conflict/history behavior. Verify the delayed-hydration assertion fails against the old enabled form before claiming red/green regression evidence. Then run the required integrated regression and CI gates before merging. Retain the synthetic screenshots and safe UI summary through the existing evidence convention.

Only the owned files are committed. The existing untracked `node_modules` symlink is preserved and excluded from staging. No shared progress files, configuration, dependencies, offline code or unrelated source were changed.
