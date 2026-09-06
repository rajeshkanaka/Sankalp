# SK-004 stale preview conflict recovery

Owner: `/root/m1_domain`

Branch/worktree: `task/SK-004-conflicts` at `/Users/rajesh/sankalpa-worktrees/SK-004-conflicts`

Base: `a28810b`

Implementation commit:

- `cf57874` — `SK-004: recover stale revision previews`

## Implemented

- `RevisionEditor` now treats `PREVIEW_CHANGED` and `REVISION_CONFLICT` as stale review state. It removes the stale preview, fingerprint and apply operation ID while preserving the user's local schedule and practice edits.
- An opening-boundary change returns to the preserved form and tells the user to request another preview. The next successful preview comes from the server and receives a fresh apply operation ID; no rewritten schedule is applied automatically.
- An external revision change refreshes the canonical journey while retaining the local draft. Preview remains unavailable until the refreshed server props carry a different revision. The user then explicitly requests and reviews a new server preview before applying. A retry control repeats the non-destructive refresh if it does not complete.
- The client does not cast or consume the unvalidated `RequestError.current` value. It obtains the authoritative revision through the refreshed journey and the authoritative fingerprint through a new preview response.
- The new `@M2-revisions` browser case uses the shared guarded `./test` fixture and real application APIs. It crosses an exact session opening boundary, verifies local edits survive `PREVIEW_CHANGED`, and confirms the renewed apply has a different operation ID. It then clones authentication into a second browser context, changes metadata through the real UI/API, verifies the first context recovers from `REVISION_CONFLICT`, and again requires a fresh preview and operation ID.

`MetadataEditor` was not changed. Its existing explicit reload action retains its title/intention state, and the schedule-preview defect was isolated to `RevisionEditor`.

## Verification

All executed commands used Node 24.20.0 through `fnm exec --using 24.20.0` and the coordinator's installed dependency tree through a temporary worktree symlink, which was removed before commit.

- `npx prettier --check src/features/journeys/revision/revision-editor.tsx tests/ui/revision-conflicts.spec.ts` — PASS.
- `npx eslint src/features/journeys/revision/revision-editor.tsx tests/ui/revision-conflicts.spec.ts --max-warnings 0` — PASS, zero warnings.
- `npm run typecheck` — PASS; Next route generation and TypeScript completed without errors.
- `npm run test:unit` — PASS, 7 files / 80 tests.
- `git diff --check` and `git diff --cached --check` — PASS before the implementation commit.
- `npm run test:ui -- --grep "stale schedule previews"` — **NOT RUN** in this worktree, as assigned. It has no allocated runtime or database; the coordinator must run the real browser case after integration.

## Coordinator integration

Cherry-pick `cf57874`, run the focused browser case against the integrated allocated runtime, and verify it in all configured browser projects. The test resets the shared synthetic UI data once, performs one captured-email sign-in, uses a second context copied from that authenticated storage state, and restores the M1 clock in `finally`.

No shared contracts, routes, migrations, configuration, dependencies, existing revision tests or tracking files changed. No contract question remains. Runtime conflict recovery remains unverified until the coordinator's browser run passes, so this handoff does not change SK-004 status.
