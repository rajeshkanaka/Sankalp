# SK-006 closure history review

2026-09-06, Asia/Kolkata. Owner: `/root/merge_review`; branch `rajesh_kanaka/closure-history-fix`; worktree `/Users/rajesh/sankalpa-worktrees/SK-006-closure-review`; base `ef6e0a9`. Only the coordinator updates task status in TASKS.

## Finding and scoped change

A session page can open before its window closes, while another tab later creates its immutable closure event. Post-close mutations previously returned that event only when they created it. The original page merges mutation history into its existing React state, so its chronology omitted the closure until a full reload.

The minimal service change returns the existing closure alongside post-close corrections. Existing client event-ID deduplication prevents duplicate timeline entries; database insertion, identity, timestamps, access control and retry handling stay unchanged. No schema, shared interface or UI implementation change is required.

Tests-first commit `44bb465` adds:

- A real-service regression that reads before closure, creates the marker through another read, then checks save/confirm/remove responses retain that exact event. Exact retry and a single stored closure remain asserted.
- A real-browser regression with two tabs and the existing deterministic server clock. The original tab saves twice without navigation; its closure appears once and both corrections appear. Authentication and persistence use local services; no transport response is mocked. Screenshot output is planned at `docs/evidence/M3/<run-id>/<browser>/closure-other-tab.png`.

## Verification and handoff

Worker checks actually run: focused Prettier, ESLint with zero warnings, targeted strict TypeScript and `git diff --check` passed. TypeScript 6 initially rejected explicit file arguments with TS5112; rerunning with its required `--ignoreConfig` flag passed. The exact targeted command is:

```sh
fnm exec --using 24.20.0 npm exec -- tsc --ignoreConfig --noEmit --skipLibCheck --strict --module esnext --moduleResolution bundler --target es2022 --types node --esModuleInterop --resolveJsonModule tests/integration/completion-corrections.test.ts tests/ui/corrections.spec.ts
```

Database/UI runtime checks are **NOT RUN by this worker**. The coordinator ran the tests-first service regression before this fix and reported the expected red result: `closure-red.log`, exit 1, the line 178 assertion expected the existing closure and received an empty list (one failed test, four excluded by the name filter). This demonstrates the regression against the prior service; a green result is still required after integration. This worker owns no runtime, has no private environment, and must not consume the coordinator's database. The only untracked dependency is the permitted `node_modules` symlink to the root installation; never stage it.

Coordinator next: integrate the service fix, then run:

```sh
fnm exec --using 24.20.0 npm run test:integration -- tests/integration/completion-corrections.test.ts
fnm exec --using 24.20.0 npm run build
fnm exec --using 24.20.0 npm run test:ui -- --grep @M3-corrections
```

Retain actual results and screenshots before declaring this regression resolved. Existing B06 and unfinished SK-008 gates remain independent.


## Coordinator integrated verification

Integrated tests as1b33394 and fix asad78c5c on PR3. Actual pre-fix database test failed with expected closure array versus empty; actual Chromium two-tab UI failed at missing closing marker. Post-fix npm verify PASS112unit/84DB/build/smoke; full UI53/53PASS acrossChromium/WebKit/Firefox, including all3 two-tab regressions and axe. Real screenshots and safe summary: ../evidence/M3/main-consolidation/. No native B06 or offline integration pass is implied.
