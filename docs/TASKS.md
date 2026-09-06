# Sankalpa authoritative task register

**Only source of task status.** Statuses: TODO, IN_PROGRESS, BLOCKED, IN_REVIEW, DONE, DEFERRED.
D21 in [DECISIONS](DECISIONS.md#d21--budget-survival-scope-and-working-limits-2026-09-06) overrides older scope, dependencies, testing and deployment instructions. Launch is M1–M4, with reduced closeout tasks below. DEFERRED work requires a new user request; keep existing code.

## 1. Status table — startup reading ends after this table

One owner per active task. Coordinator owns shared config, dependencies, migrations and tracking.

| ID | Milestone | Concrete outcome | Depends on | Responsible owner | Status | Evidence/report |
|---|---|---|---|---|---|---|
| SK-001 | M1 | Real local sign-in, create, confirm and reload workflow | Plan approval (recorded D10) | C | DONE | `docs/handoffs/SK-001.md`; M1 evidence |
| SK-002 | M1 | Accessible, private and recoverable first workflow | SK-001 | C | BLOCKED | `docs/handoffs/SK-002.md`; M1 evidence |
| SK-003 | M2 | Complete personalized schedule/target setup | SK-002 + M1 review; isolated preparation per D12 | C | IN_REVIEW | `docs/handoffs/SK-003.md`; M2 evidence |
| SK-004 | M2 | Future revisions preserve original history | SK-003; integrated preparation per D12 | C | IN_REVIEW | `docs/handoffs/SK-004.md`; M2 evidence |
| SK-005 | M2 | Consistent dashboard/calendar/list | SK-003; integrated preparation per D12 | C | IN_REVIEW | `docs/handoffs/SK-005.md`; M2 evidence |
| SK-005-P2 | M2 correction | Calendar filter form accepts its empty optional fields | Observed during SK-020; after urgent SK-008-P1 on resume | C | TODO | `docs/handoffs/SK-020.md`; real Chromium reproduction |
| SK-006 | M3 | Honest correction/undo and amendment history | SK-004, SK-005 + M2 review | C | IN_REVIEW | `docs/handoffs/SK-006.md`; M3 evidence |
| SK-007 | M3 | Private reflections and journal search | SK-004, SK-005 + M2 review | C | IN_REVIEW | `docs/handoffs/SK-007.md`; M3 evidence |
| SK-008 | M3 | Offline replay and recoverable conflicts | SK-006, SK-007 | C | IN_REVIEW | `docs/handoffs/SK-008.md`; M3 evidence |
| SK-008-P1 | M3 correction | Restore validated query-bearing offline navigation | Independent review, urgent before M4 | C | IN_REVIEW | Unit regression + actual Chromium offline Done/calendar passed; new PR pending |
| SK-009 | M4 | Versioned reminder controls and job contracts | SK-008 + M3 review; isolated preparation per D12 | C | IN_PROGRESS | `docs/handoffs/SK-009.md`; M4 evidence |
| SK-010 | M4 | PWA install, permission and device controls | SK-009 | W-device | TODO | `docs/handoffs/SK-010.md`; M4 evidence |
| SK-011 | M4 | Resilient dispatch, snooze and honest history | SK-009; isolated transport preparation under D12 | C | IN_PROGRESS | `docs/handoffs/SK-011.md`; M4 evidence |
| SK-012 | Outside launch | Real multilingual PDF download | Future user approval | W-export | DEFERRED | D21; archived detail |
| SK-013 | Outside launch | Themes only; all audio and rights-manifest work dropped | Future user approval | W-experience | DEFERRED | D21; archived detail |
| SK-014 | M4 closeout | Account deletion and journey archive only | SK-008, SK-009, SK-011 | W-privacy | TODO | `docs/handoffs/SK-014.md`; M5 evidence |
| SK-015 | Outside launch | Locally proven production image and recovery runbook | Future user approval | C | DEFERRED | D21; archived detail |
| SK-016 | Outside launch | Authorized HTTPS staging and real auth mail | Future user approval | C | DEFERRED | D21; archived detail |
| SK-017 | M4 closeout | PWA install and one Samsung S25 Ultra push test | SK-010, SK-011; B04 | W-device-validation | BLOCKED | Single SK-017 report; no photos or device matrix |
| SK-018 | Checklist | 15-line completion checklist | M1–M4, SK-014, SK-017 | C | TODO | 15 checkboxes below; no new milestone |
| SK-019 | Outside launch | Approved production canary and live handoff | Future user approval | C | DEFERRED | D21; archived detail |
| SK-020 | Local presentation tooling | One-command database-backed demo and polished README | Accepted main `23f15b2`; user-requested follow-up during pause | C | DONE | `docs/handoffs/SK-020.md`; PR6/main `ff6a479`; `docs/evidence/demo-launcher/` |

## 2. Execution and verification

After user review of the trimming PR: SK-005-P2 → reconcile M1–M3 review items → SK-009 → SK-010/SK-011 → SK-014/SK-017 → SK-018 checklist. Dependencies waiting for another task stay TODO; external missing capabilities stay BLOCKED. Nothing depends on deferred work. Themes are deferred; no audio work remains.

Only SK-010/SK-011 and later SK-014/SK-017 can run in parallel after interfaces are integrated. Each worker uses its own branch/worktree and runtime slot; no overlapping writes. Coordinator integrates and verifies before DONE. Sequential work uses the same order. Preserve all unrelated work and existing access controls.

Use installed tools; no speculative installs/downloads. Start with the relevant existing test. Development: `npm run test:ui -- --grep <task-tag>` (Chromium default), focused unit/integration scripts. Build when application bundling changes; do not repeat app suites for archival or prose edits. Ready-to-merge PR CI runs existing lint/types/unit/DB/build gates and all three browser projects once on the final source. Retain console/CI results; screenshots only with `SANKALPA_MILESTONE_EVIDENCE=1` at a milestone end. No intermediate evidence manifests.

A task becomes DONE only after its criteria pass, required checks actually run, review/integration completes and its register row records the result. NOT RUN is never PASSED. Each task uses only `docs/handoffs/SK-NNN.md`, edited in place; each checkpoint is at most five factual lines. No topic/substep handoff files.

## 3. Executable task details

SK-001–SK-007 detail blocks and prior expanded procedures: [docs/archive/](archive/TASK_DETAILS.md). Their status rows above remain authoritative; inspect archived detail only for a task being changed.

### SK-005-P2 — Empty calendar filters
Coordinator owns calendar query normalization and its focused unit/UI regression. Treat genuinely empty optional date/journey filters as absent; reject malformed values. Do not change schedule/progress calculations. Verify actual filter form submission in Chromium, including All journeys and blank date, then owner isolation; record in existing SK-005 report.

### SK-008 — Offline replay; P1 navigation correction
Owner: coordinator; files `src/offline/**`, service-worker public shell/policy and offline tests. Interfaces: existing account-scoped enqueue/read/flush/conflict/clear and versioned session/reflection writes. Preserve replay-once, storage/identity boundaries, drafts, revisions, queue conflict handling and strict public asset caching. No changes to offline product scope.
P1 owns only navigation policy plus unit/UI regressions: valid Today journey and calendar filters reach the saved shell offline; unknown/auth/duplicate/malformed parameters and invalid session UUIDs are refused. Private responses never enter Cache Storage. Verified commands: `npm run test:unit -- tests/unit/offline-cache-policy.test.ts`, `npm run build:offline`, `npm run test:ui -- --grep @P1`. Expected: functional offline Done → saved session and calendar pass; strict asset tests pass. Other independent review findings remain separate, unverified work in existing SK-008 report/review.

### SK-009 — Reminder controls and durable jobs
Coordinator owns `src/domain/reminders.ts`, `src/server/reminders/preferences.ts`, setup controls, shared contracts and migrations; consume canonical versioned session/clock, publish preference/job/subscription/worker-lease contracts before dependent tasks. Preview/persist custom offsets, quiet hours and privacy; generate eligible future jobs; define cancel/close/snooze identity and restricted claim/revalidate/settle functions. Exclude real delivery here.
Acceptance: reminders opt-in, valid distinct offsets, quiet hours suppress, version changes invalidate stale jobs, one closure event, worker cannot read reflections and owners cannot forge worker calls. Verify `npm run test:unit -- tests/unit/reminders.test.ts`, `npm run test:integration -- tests/integration/reminder-jobs.test.ts`, actual Chromium `--grep @M4-preferences`; missing planned paths/scripts stay NOT RUN until added. Expected real persisted preview/settings and privilege/cancellation tests pass. One report: SK-009.md; milestone-only reminder-preview screenshot.

### SK-010 — PWA and subscription readiness
Owner W-device; `src/service-worker/` push/click behavior, manifest/icons/install UI, `src/features/reminders/devices/**`; coordinator owns endpoints/config. Consume SK-009 registration/events and SK-008 cache policy. User-initiated install/permission, owner-bound subscription and unsubscribe, denied/offline/stale states, generic payload, authenticated deduplicated opened event. No iPhone guide, audio or formal device matrix work.
Acceptance: practice works when permission denied; no unsolicited prompt, credential payload or cross-account click; deep link reaches current canonical session. Verify Chromium manifest/SW/readiness and ownership tests, `npm run test:ui -- --grep @M4-device`. Planned paths/tests must be created in this task. Report SK-010.md; physical confirmation belongs only to SK-017.

### SK-011 — Dispatch, snooze and honest history
Owner W-reminders; `src/worker/**`, reminder transport/history modules, snooze/history UI and tests; coordinator owns shared SQL/config. Consume SK-009 leases/jobs and SK-010 click contract. Preserve bounded dispatch, lease recovery, immediate pre-send revalidation, expired-job suppression, endpoint HTTPS/DNS/SSRF restrictions, safe retries, ten-minute snooze and honest accepted/uncertain/failed/opened states. Keep secrets server-only and reflections out of payloads.
Acceptance: stale leases cannot settle, double poll cannot duplicate jobs, completion/deletion cancel sends, uncertain timeout is not delivery. Verify planned `npm run test:worker`, real DB lease/cancel/role tests and Chromium `--grep @M4-history`. Fake transport must be labeled. Report SK-011.md; one M4 screenshot set. Hosted execution must fit D21 Vercel/hosted-Postgres target; the old permanent 30-second container process is not a deployed capability. Verify a compatible timely trigger and price before provisioning; missing trigger is B01.

### SK-012 / SK-013 / SK-015 / SK-016 / SK-019 — Deferred
Retain rows/code/history; no PDF, audio/rights manifest, production image/recovery runbook, separate staging, canary or rollback-rehearsal work. SK-013 future scope is themes only. Historical detail is archived. No launch task depends on these rows.

### SK-014 — Account deletion and journey archive only
Owner W-privacy; account/journey server services, archive/delete endpoints and confirmation UI/tests; coordinator owns any new migration. Consume ownership/versioned session and reminder cancellation contracts. Archive hides an active journey without rewriting history; account deletion removes account-owned records and cancels jobs/subscriptions. Preserve existing offline account invalidation and security controls; add no shared-device storage controls or expanded privacy platform.
Acceptance: owner-only, explicit confirmation, archived history readable by owner, deleted account inaccessible with no future reminder send. Verify focused integration ownership/cascade/cancellation cases and real Chromium archive/delete workflow (synthetic account only). Use existing test scripts; create only task-specific tests. Report SK-014.md; no new deployment/backup work.

### SK-017 — Samsung S25 Ultra only
Owner W-device-validation after SK-010/011; use user's Samsung S25 Ultra and approved HTTPS app/device/recipient. Install PWA, request permission deliberately, send one authorized test, observe displayed notification and tap correct session. Record actual install/display/tap result in SK-017.md; no photos, iPhone, audio, matrix or broad Focus/background campaign. A provider acceptance response alone does not prove phone display. Missing usable HTTPS origin/push credentials/device session remains B04; no paid provisioning inferred. Repeat only a failed test after its fix.

### SK-018 — 15-line checklist (not a milestone)
- [ ] M1 sign-in/create/check/confirm/reload works.
- [ ] Personalized schedules and targets work.
- [ ] Schedule versioning and amendment history are preserved.
- [ ] Timezone and DST cases pass existing checks.
- [ ] Dashboard and calendar reflect canonical progress.
- [ ] Corrections and private reflections persist.
- [ ] Offline Done navigation works.
- [ ] Offline queue survives reload and replays once.
- [ ] Conflicts and account isolation preserve private drafts.
- [ ] Reminder preferences persist and invalidate stale jobs.
- [ ] Dispatch/snooze/history distinguish acceptance from display.
- [ ] Account deletion and journey archive pass.
- [ ] Samsung PWA install and one real push test recorded.
- [ ] Final PR has passing relevant and three-browser checks.
- [ ] Vercel + hosted Postgres configuration and actual URL verified before calling deployment complete.

## 4. Blockers and preserved work

B01: hosted credentials, minimum-cost authorization and a verified timely reminder trigger compatible with Vercel + hosted Postgres; no always-running container assumption. B02: authorized real-email provider/sender configuration when enabling real mail. B03: disclose actual hosted provider retention; no new recovery runbook. B04: Samsung test prerequisites in SK-017. B06: previously blocked VoiceOver speech verification is unchanged; keyboard/200% and automated accessibility results are preserved. Staging/canary/iPhone blockers are superseded by D21.

Paused M4: branch `rajesh_kanaka/reminder-integration`, worktree `/Users/rajesh/sankalpa-worktrees/SK-009-integration`, commit `4d9fd1d`, slot 2. Migration 011 applied; SQL 65 passed / 9 failed; next correction must be migration 012. Pending refs: schema `a57388b`, worker `fd613d4`, preferences `e26bffe`. No active worker; coordinator must reassign before changes. [BRANCHES](BRANCHES.md) is an on-demand location index. On actual M4 resume, consolidate required legacy topic reports into the single SK-009/SK-011 file; no new topic files.

### SK-020 — Local presentation tooling
Integrated via PR6 `ff6a479`: `./setup.sh` starts preserved local DB/Auth/inbox and app; [DEMO](DEMO.md) is the runnable walkthrough. Existing SK-020.md and demo-launcher evidence retain acceptance. No new work assigned.
