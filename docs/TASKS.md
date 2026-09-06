# Sankalpa authoritative task register

**This is the only source of task status.** Allowed statuses: `TODO`, `IN_PROGRESS`, `BLOCKED`, `IN_REVIEW`, `DONE`. The register records integrated technical completion; milestone/user approvals remain separate. Plan/milestone approvals and the compact checkpoint live in [PROJECT_PROGRESS](PROJECT_PROGRESS.md), not this status column. [PROJECT_PLAN](PROJECT_PLAN.md) supplies shared interfaces, command definitions, demo/evidence recipes and parallel rules; [DECISIONS](DECISIONS.md) supplies the fixed stack and boundaries.

## 1. Register and assignment rules

Owners below are responsible role slots, **not already-running agents**. Before IN_PROGRESS the coordinator replaces the slot with a named owner and records branch, worktree, base SHA and resource slot in its task report; only one active owner per task. `C` = coordinator, `W-<area>` = assigned worker or coordinator in sequential mode. Coordinator is accountable for all integration/migration/config work. Plan approval is recorded in D10. Milestone review dependencies below are waived as pauses by that decision; their technical gates remain prerequisites.

| ID | Milestone | Concrete outcome | Depends on | Responsible owner | Status | Evidence/report |
|---|---|---|---|---|---|---|
| SK-001 | M1 | Real local sign-in, create, confirm and reload workflow | Plan approval (recorded D10) | /root coordinator | DONE | `docs/handoffs/SK-001.md`; M1 evidence |
| SK-002 | M1 | Accessible, private and recoverable first workflow | SK-001 | /root coordinator | BLOCKED | `docs/handoffs/SK-002.md`; M1 evidence |
| SK-003 | M2 | Complete personalized schedule/target setup | SK-002 + M1 review; isolated preparation per D12 | /root coordinator | IN_REVIEW | `docs/handoffs/SK-003.md`; M2 evidence |
| SK-004 | M2 | Future revisions preserve original history | SK-003; integrated preparation per D12 | /root coordinator | IN_REVIEW | `docs/handoffs/SK-004.md`; M2 evidence |
| SK-005 | M2 | Consistent dashboard/calendar/list | SK-003; integrated preparation per D12 | /root coordinator | IN_REVIEW | `docs/handoffs/SK-005.md`; M2 evidence |
| SK-006 | M3 | Honest correction/undo and amendment history | SK-004, SK-005 + M2 review | /root coordinator | IN_REVIEW | `docs/handoffs/SK-006.md`; M3 evidence |
| SK-007 | M3 | Private reflections and journal search | SK-004, SK-005 + M2 review | /root coordinator | IN_REVIEW | `docs/handoffs/SK-007.md`; M3 evidence |
| SK-008 | M3 | Offline replay and recoverable conflicts | SK-006, SK-007 | C (assigned scopes below) | IN_PROGRESS | `docs/handoffs/SK-008.md`; M3 evidence |
| SK-009 | M4 | Versioned reminder controls and job contracts | SK-008 + M3 review | C | TODO | `docs/handoffs/SK-009.md`; M4 evidence |
| SK-010 | M4 | PWA install, permission and device controls | SK-009 | W-device | TODO | `docs/handoffs/SK-010.md`; M4 evidence |
| SK-011 | M4 | Resilient dispatch, snooze and honest history | SK-009 | W-reminders | TODO | `docs/handoffs/SK-011.md`; M4 evidence |
| SK-012 | M5 | Real multilingual PDF download | SK-010, SK-011 + M4 review | W-export | TODO | `docs/handoffs/SK-012.md`; M5 evidence |
| SK-013 | M5 | User-selected themes and original ambient audio | SK-010, SK-011 + M4 review | W-experience | TODO | `docs/handoffs/SK-013.md`; M5 evidence |
| SK-014 | M5 | Archive, deletion and private-storage controls | SK-012, SK-013 | W-privacy | TODO | `docs/handoffs/SK-014.md`; M5 evidence |
| SK-015 | M6 | Locally proven production image and recovery runbook | SK-014 + M5 review | C | TODO | `docs/handoffs/SK-015.md`; M6 evidence |
| SK-016 | M6 | Authorized HTTPS staging and real auth mail | SK-015; B01–B03 | C | BLOCKED | `docs/handoffs/SK-016.md`; M6 evidence |
| SK-017 | M6 | Actual iPhone/Android push and audio evidence | SK-016; B04 | W-device-validation | BLOCKED | `docs/handoffs/SK-017.md`; M6 evidence |
| SK-018 | M6 | Integrated release candidate passes all launch gates | SK-015, SK-016, SK-017 | C | TODO | `docs/handoffs/SK-018.md`; M6 evidence |
| SK-019 | M7 | Approved production canary and live handoff | SK-018 + M6 review; B05 | C | BLOCKED | `docs/handoffs/SK-019.md`; M7 evidence |

Evidence paths in this register are **planned**. Per-task report is created on claim; run evidence uses `docs/evidence/M<n>/<run-id>/` as defined in PROJECT_PLAN §4. Completion status is only the register cell above; task detail does not duplicate it. Every task must satisfy AGENTS' DONE gate, including integration and actual successful checks, not just its worker-local criteria.

Genuine external blockers (dependency waiting alone does not require BLOCKED):

| Blocker | Affected work | Required resolution |
|---|---|---|
| B01 | SK-016 | Deployment authorization is recorded in D10; still require actual itemized quote and budget cap; cloud accounts/credentials supplied through secure provider configuration. |
| B02 | SK-016 | Owned sending domain/DNS, verified Resend SMTP and explicit test-mail recipients; no real mail authorization assumed. |
| B03 | SK-016 | Verified provider retention/deletion/backup terms compatible with D08 and a disclosed actual policy; regional capacity and selected compute quote. |
| B04 | SK-017 | Access to a supported real iPhone Home Screen install and Android install, plus explicit consent to send test pushes to those devices. Browser emulation cannot resolve this. |
| B06 | SK-002 | VoiceOver announcements and authenticated manual checks remain unverified. Public native200% reflow/keyboard passed in SK-002-manual-retry; settings restored. Automated axe and browser checks do not close the remaining gate. |
| B05 | SK-019 | Deployment authorization is recorded in D10; still require verified release revision/domain/budget, production credentials and M6 technical gates. |

## 2. Execution and checkpoint sequence

Serial path: SK-001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014 → 015 → 016 → 017 → 018 → 019, with the milestone review gates in the register. Safe parallel pairs: (004,005), (006,007), (010,011), (012,013), **only after their prerequisites and shared interfaces are integrated**. Configuration, navigation/contracts and migrations remain serialized with C. A worker on a paired task must not modify the other task's module. C can perform every task sequentially without any vendor orchestration.

Every task follows this substep cycle: read contracts and baseline → add the specified failing behavioral test when practical → implement the smallest slice → run listed checks and inspect actual UI → persist evidence/handoff → coordinator integrates/reruns regression → update this register. Checkpoint after each meaningful slice; record the exact unfinished test/function/route/substep rather than “continue implementation.”

## 3. Executable task details

### SK-001 — First persisted practice workflow

**Outcome/owner/scope:** C delivers M1's exact custom daily-civil-checkbox workflow with real local managed auth/PostgreSQL and Playwright from the outset. Own initial `package.json`, lock/config/ignore/runtime files, `supabase/`, `scripts/`, `src/domain/`, `src/server/auth/`, `src/server/db/`, initial journey/session services, `src/app/` welcome/setup/today/practice routes, minimal shared controls and `tests/`. Establishing the scaffold belongs to this visible workflow, not a separate infrastructure milestone.

**Interfaces:** establish PROJECT_PLAN §2.2 types, request auth/transaction wrapper, API error/revision/idempotency contracts; creation/activation/checklist/confirmation routes from §2.3. Initial tables/roles: profile, journey, schedule/practice version, session/practice value, amendment and operation receipt. Include RLS/grants and composite ownership FKs now; later feature tables wait for their tasks.

**Ordered substeps:** (1) record branch/worktree/slot and verify pinned tool/CLI compatibility; create exact manifest/lock and safe local wrappers; (2) implement one real email-link welcome→Today route and captured-mail test; (3) implement daily civil schedule/preview/activation with two custom checkboxes; (4) save values/confirm atomically and reload; (5) add production-build Playwright smoke, safe screenshots and CI baseline; (6) document verified restart/stop commands and integrate.

**Exclusions:** no recurrence-mode UI beyond daily occurrences, numeric targets, reminders, offline, PDF, deployed services or real email. Explain unfinished features plainly; never replace the core save with an in-memory fake.

**Acceptance/verification:** run all §5 standard setup commands; `npm ls`, `npm run verify`, `npm run test:ui -- --grep @M1`, `npm audit --omit=dev`, `npm audit`. Expected: no peer/engine errors; real login/create/two checks/confirm/reload yields 1/21, 5%; repeated activation/completion returns same record, one-item completion rejected, cross-owner access fails. Record actual runtime DB major, browser revision and script exit codes. M1 screenshots and `SK-001.md` retain evidence. Missing tool capability blocks the task; app checks during this planning turn are NOT RUN.

### SK-002 — First workflow usability and isolation gate

**Outcome/owner/files:** W-foundation owns `src/components/`, `src/styles/`, `src/features/auth/`, related UI/error/accessibility tests. C integrates root navigation/auth-handler changes and any config fixes. Consume SK-001 service interfaces; produce reusable accessible form, error, pending and navigation components with clear prop contracts, without changing canonical data flow.

**Scope/substeps:** test invalid/expired/resend links and safe redirects; add 320px responsive Today/setup/checklist with theme baseline, keyboard/focus/live save announcements; verify role/isolation/CSRF/body limits and field validation; add retry loading/empty/failure states without losing values; execute the complete M1 demo on integrated code. Add request error wrappers/rate-limit primitives via C where needed. No broad decorative redesign, full sound/theme library or mock server data.

**Acceptance:** maximum three completion taps for two checkboxes; readable 16px body/44px primary targets; no unsolicited sound/permissions; auth refresh cannot cache private content; invalid nested IDs, expired session, missing origin on protected writes and direct unauthenticated database calls fail safely; Arun cannot read/write Maya records; denied network write preserves form values.

**Verification/evidence:** `npm run verify`; `npm run test:integration -- tests/integration/auth-boundaries.test.ts`; `npm run test:ui -- --grep @M1`. Expected all pass; manual keyboard/VoiceOver, 200% zoom, contrast and 320px findings recorded, not assumed. Store M1 screenshots, isolation output and `SK-002.md`; coordinator presents M1 and pauses for review.

### SK-003 — Full personalized schedule setup

**Outcome/owner/files:** W-schedule owns `src/domain/schedule.ts`, schedule-specific validation/contracts (C serializes shared file), `src/features/journeys/setup/`, unit schedule and setup UI tests. C owns migration changes and route integration. Consumes SK-001 drafts/preview/activation; expands `ScheduleInput` and practice discriminated values to all §2.2 fields.

**Scope/substeps:** write exact fixtures A01/A13/A23–A25/A27; implement calendar recurrence/duration and gap/fold resolver; add numeric practice targets/inputs and optional editable template; preview actual first/last times, reminders skipped, adjusted windows and overlapping-journey warning; activate using server regeneration and revision/fingerprint. Test limits and all-zero/positive partial semantics from D04. Preserve initial daily checkbox workflow.

**Exclusions:** no changing opened/history sessions, automatic schedule extension, multiple slots per journey or external reminder sends.

**Acceptance:** 21 overnight sessions resolve 6–26 September midnight with 5–25 practice dates; 12 Mon/Thu sessions starting 7 September end 15 October; Tuesday-only span generates four; morning civil prayer never inserts midnight defaults. New York 02:30 gap resolves exactly 03:00, fold selects earlier instant, invalid/overlapping bounds rejected. Numeric targets validate both API and DB.

**Verification/evidence:** `npm run test:unit -- tests/unit/schedule.test.ts`; `npm run test:integration -- tests/integration/activation.test.ts`; `npm run verify`; `npm run test:ui -- --grep @M2-schedule`. All required cases pass; save serialized schedule fixtures, timezone data/runtime versions, `weekday-preview.png` and `SK-003.md`. Freeze the expanded contracts before SK-004/005 delegation.

### SK-004 — Versioned future schedule edits

**Outcome/owner/files:** W-revisions owns `src/server/journeys/revisions.ts`, `src/features/journeys/revision/` and revision tests. C supplies ordered migration/index changes; worker cannot edit another task's dashboard files. Consume ScheduleInput/preview generator and session snapshots; produce preview/apply revision endpoint with fingerprint/current revision.

**Scope/substeps:** add active-row uniqueness/tombstones and future-edit locking through C; implement remaining allowance calculation for both duration modes; preview effective practice date/changed timestamps; apply one transaction that retains opened sessions and their labels/notes, supersedes unopened future rows and cancels obsolete reminder work; expose conflict/retry when another device changes the revision. Duration reductions cannot remove opened rows. Title/intention edits are explicit metadata operations; practice names are versioned.

**Exclusions:** no history rewriting, hard-deleting superseded rows linked to events, reminder resend or changes to status/metric UI.

**Acceptance:** A26 plus concurrent completion/revision at opening boundary, unchanged original start for calendar span, retained history counted toward occurrence total, unique nonsuperseded ordinals/dates and stable historical IDs. Stale preview returns 409; failed transaction leaves no partial new schedule. Historical sent events remain accessible.

**Verification/evidence:** `npm run test:integration -- tests/integration/schedule-revisions.test.ts`; `npm run verify`; `npm run test:ui -- --grep @M2-revisions`. Store before/after synthetic rows and race/rollback results, `revision-history.png`, `SK-004.md`. Reminder assertions are contract/job-cancellation tests until SK-009/011 integrates full jobs; rerun them then.

### SK-005 — Canonical dashboard, calendar and journey progress

**Outcome/owner/files:** W-progress owns `src/domain/status.ts`, `metrics.ts`, `src/features/progress/`, calendar/journey read views and tests; C integrates route/navigation modifications. Consume canonical SessionRecord and authorized bounded read services; produce `deriveStatus`, `computeMetrics` and shared view models used later by PDF. No separate metric caches or persistence writes.

**Scope/substeps:** prove complete/partial/missed/upcoming partition and open-window boundary behavior; implement exact counts/rounded progress, on-schedule ratio/current+longest streak/ended flags; build Today countdown/selector, calendar with accessible chronological list and journey details/timeline; preserve user choice to hide streaks. Device-local secondary time never changes practice date. Countdown does not repeatedly interrupt screen readers.

**Acceptance:** A03/A05/A07/A22, numeric partial has zero completion credit, unscheduled weekdays do not break consistency, future/open windows excluded from closed-session ratio, complete open session can extend streak; 20/21 ends without extra session. Stable selected journey while checklist open. Multiple-journey calendar distinguishes identities and supports date/journey filtering.

**Verification/evidence:** `npm run test:unit -- tests/unit/metrics.test.ts`; `npm run verify`; `npm run test:ui -- --grep @M2-progress`. Expected shared 7/21/33% and DST/device timezone fixtures agree; screenshots `calendar-33-percent.png`, Today and accessible list, `SK-005.md`. C reruns both parallel tasks together, completes M2 demo and pauses.

### SK-006 — Corrections, undo and honest chronology

**Outcome/owner/files:** W-practice owns `src/server/sessions/`, `src/features/practice/corrections/` and correction tests. C integrates amendment schema updates, a minimal closure/correction NotificationEvent schema and shared metrics integration. Consume session revision/mutation envelope/metrics; completion/undo endpoints return canonical updated record with amendment reference.

**Scope/substeps:** regress atomic confirm/double taps; add performed-at selection after closing with explicit in-window-recorded-later versus actual-late explanation; implement undo/correction with row locks, revision/hash idempotency and immutable non-note amendment metadata; recompute every view. Reject future performed time, pre-opening claims and unknown practice/version IDs. Create any missing closure event idempotently at session read/correction time (logical event timestamp equals closing); expose its timeline on the session screen and preserve it after corrections. SK-009/011 later add background sweeping/reminder history using this same schema/key.

**Exclusions:** no spiritual-validity judgments, automatic merge of conflicts, deleting chronology or re-enabling past reminders.

**Acceptance:** A04/A06/A08/A14; practiced-late counts toward recorded completion but not on-schedule streak; in-window later entry counts after sync; retry and race produce one logical change; all targets must still meet their saved version. Undo updates calendar and totals without duplicating events.

**Verification/evidence:** `npm run test:integration -- tests/integration/completion-corrections.test.ts`; `npm run verify`; `npm run test:ui -- --grep @M3-corrections`. All race/rollback/label assertions pass; save chronology diff, `recorded-later.png`, `SK-006.md` and exact correction payload contract for offline integration.

### SK-007 — Private reflections and journal

**Outcome/owner/files:** W-journal owns `src/server/journal/`, `src/features/journal/`, journal/reflection tests; C supplies table/RLS/index/route integration. Consume session identity and MutationEnvelope; one Reflection per session with text, optional mood tags and revision. `POST /api/journal/query` (D15) filters by journey/date/mood/text with bounded cursor pagination.

**Scope/substeps:** test one-row ownership/Unicode/20,000-char boundary; implement debounced autosave plus explicit Save and visible saved/pending/error states; allow missed/partial-session notes; add recoverable two-device conflict view preserving both texts; implement journal search/list/detail and configurable optional reflection prompts. No rich text/HTML/AI interpretation/public search service.

**Acceptance:** hostile HTML renders as text; 20,001 chars rejected without losing draft; exact English/Devanagari text survives save/reload; arbitrary custom mood validates; Arun cannot read/query Maya reflections; conflict comparison requires deliberate choice. Notes never appear in logs or metrics.

**Verification/evidence:** `npm run test:integration -- tests/integration/reflections.test.ts`; `npm run verify`; `npm run test:ui -- --grep @M3-journal`. Save synthetic Unicode fixtures, conflict output, `journal-saved.png`, `SK-007.md`; synchronize contract with SK-006 before offline work starts.

### SK-008 — Offline replay without silent data loss

**Active ownership (2026-09-06 resume):** coordinator owns reconciliation, main PR integration, app/API hooks, shared configuration and service-worker build. Core/UI worker source remains preserved but unassigned until main consolidation; current branches/worktrees and exact recovery pointers are authoritative in [BRANCHES](BRANCHES.md). The assigned SK-006 closure fix is limited to its service, correction regressions and task-specific report. No historical agent name implies active ownership. D12 permits preparation while B06 remains; D17 freezes the interfaces. Subsequent claims must update this paragraph and BRANCHES before implementation begins.

**Outcome/owner/files:** W-offline owns `src/offline/`, offline-specific feature controls and tests; C integrates app/session/signout hooks and script/SW build config. Consume SK-006/007 versioned mutations; provide enqueue/read/flush/resolve/clear-account interfaces and explicit pending state. Static service-worker shell source starts here; SK-010 adds push without changing private-data caching policy.

**Scope/substeps:** add account-scoped IndexedDB drafts/recent records/operation queue; test storage denial/quota/reload; retry on reconnect/reopen in per-session order; distinguish local feedback from server confirmation; preserve both drafts on 409, reject silent replay to superseded session; enforce 30-day replay-review policy. Disable private local storage when user chooses shared-device mode. On logout warn and allow sync, keep signed in/cancel, or explicitly discard; do not silently lose queued work.

**Exclusions:** no guaranteed Background Sync, offline audio, full offline account creation/setup, anonymous local store shared across users or encryption promise.

**Acceptance:** A06/A15/A16; disconnected completion survives reload, counts once after reconnect and displays reminders-may-continue caveat; expired auth pauses replay; two-device conflict retains both versions; account switch shows no previous private cached data; concurrent tabs coordinate queue ownership and retries remain idempotent.

**Verification/evidence:** `npm run test:integration -- tests/integration/offline-replay.test.ts`; `npm run verify`; `npm run test:ui -- --grep @M3-offline`. Real browser network-off/reload/reconnect assertions, `offline-pending.png`, `conflict-resolution.png` and `SK-008.md`. C runs M1–M3 regression and presents M3 review.

### SK-009 — Reminder preferences and durable job foundation

**Outcome/owner/files:** C owns `src/domain/reminders.ts`, `src/server/reminders/preferences.ts`, reminder setup UI, all new reminder/subscription/job migrations and extensions to SK-006’s basic event schema, worker-role grants/functions and shared contracts. Consume canonical session/revision/clock; produce versioned preferences, job identity, worker claim/revalidate/settle API and notification event/read schemas before parallel dispatch/UI work.

**Scope/substeps:** preview custom offsets/quiet hours/privacy and permission-independent settings; persist revisions; generate only future eligible jobs for active subscriptions; make cancellation/closure/snooze identities explicit; define restricted worker functions and lease tokens, indexes and transaction boundaries. Extend SK-006’s idempotent closure-event service with worker sweeping independent of push; use the same unique event key, never a second closure event. Use a simple local fixture to show job preparation; not device delivery.

**Acceptance:** A02/A07/A21; exact optional midnight offset dates; duplicate/out-of-range offsets rejected; reminders off until selected; one closure event; quiet hours across midnight suppress rather than shift; schedule/reminder/subscription revisions invalidate stale jobs. DB worker role cannot access reflections; account owner cannot forge a worker call.

**Verification/evidence:** `npm run test:unit -- tests/unit/reminders.test.ts`; `npm run test:integration -- tests/integration/reminder-jobs.test.ts`; `npm run verify`; `npm run test:ui -- --grep @M4-preferences`. Save job identity/privilege/transaction assertions, `reminder-preview.png`, `SK-009.md`. Freeze event/permission/transport interface and route ownership before SK-010/011.

### SK-010 — Installable PWA and device readiness

**Outcome/owner/files:** W-device owns `src/service-worker/` push/click handlers, manifest/install UI and `src/features/reminders/devices/`; C integrates service-worker generator, root manifest route and subscription/test endpoints. Consume SK-009 subscription/event contracts and SK-008 cache policy; produce safe session deep links, registration generation and explicit readiness states.

**Scope/substeps:** install manifest/icons/service worker with update handling; user-initiated permission request and iPhone Home Screen guidance; subscribe/unsubscribe only for this account; register validated device metadata; render denied/unsupported/stale/offline readiness; add explicit test action showing fake versus real configured transport; handle notificationclick and post authenticated deduplicated opened report after sign-in. No auth/session tokens in notification payload or URL.

**Acceptance:** A11/A16 and browser portion of A12; permission never requested on arrival, failure never blocks practice; notification always deep-links to canonical session current state; pending click report never crosses accounts; account signout unregisters binding independently of browser-wide permission. No fake claim of real closed-app delivery.

**Verification/evidence:** `npm run verify`; `npm run test:ui -- --grep @M4-device`. Test actual browser manifest/SW lifecycle/install/readiness, forged callback/session IDs and denied permission; store `device-readiness.png`, SW update evidence and `SK-010.md`. Real-phone display/audio results remain SK-017 and NOT RUN here.

### SK-011 — Resilient worker, snooze and truthful history

**Outcome/owner/files:** W-reminders owns `src/worker/`, `src/server/reminders/transport.ts`, `history.ts`, `src/features/reminders/history/`, snooze UI and worker/history tests. C integrates Node scripts/config and any SQL adjustments. Consume frozen SK-009 DB/transport/event contract and SK-010 click payload; produce real/fake Web Push adapters, worker process and paginated history.

**Scope/substeps:** implement bounded 30-second loop/leases/heartbeat/clean shutdown and test `worker:once`; guard endpoint DNS/HTTPS/SSRF/no-redirect at registration and send; revalidate immediately before sending; record accepted/failed/expired/suppressed/canceled/uncertain states and actual opened reports separately; implement bounded retries, invalid-subscription cleanup and ten-minute snooze replacement; render linked closure/correction events, safe previews and history filters. Keep runtime keys server-only.

**Acceptance:** A09–A11/A21/A26; worker crash recovers lease, stale lease cannot settle, backlog older than expiry never bursts, double poll cannot create jobs, completion/deletion cancels eligible sends, timeout uncertainty is honest. Private/IPv6/redirect/rebinding endpoints rejected. Generic payload default; reflections never included. History-read does not mark opened.

**Verification/evidence:** `npm run test:worker`; `npm run verify`; `npm run test:ui -- --grep @M4-history`. Run real DB + fake external transport failure matrix, cancellation race and unauthorized-role checks. Save sanitized worker outputs, `simulated-history.png`, `SK-011.md`; real adapter is implemented but external delivery NOT RUN until SK-017. C integrates SK-010/011, reruns schedule-revision/closure regression and presents M4 with simulation labeling.

### SK-012 — Downloadable multilingual PDF

**Outcome/owner/files:** W-export owns `src/server/exports/`, `src/features/exports/`, PDF templates/tests and font asset manifest entries; C integrates export route/dependency/container changes. Consume authorized snapshot and SK-005 metrics; produce private PDF bytes/download with explicit overall versus selected-range totals and `asOf` timestamp.

**Scope/substeps:** lock and document fonts/licenses; first prove English/Devanagari shaping with real Chromium; implement repeatable-read snapshot including optional notes/moods and export-time closing reflection; escape text, deny all network/JS, embed fonts locally, paginate headings/long paragraphs/page numbers; bound request/time/concurrency and always clean up. Add valid date/field selection, empty range and retry/busy states. Add the D02-pinned PDF.js dev extraction tooling through C; no production PDF-library alternatives.

**Acceptance:** A05/A14/A17; actual PDF file opens in macOS Preview, exact Unicode content survives extraction, 21 long notes readable, hostile markup inert, no fetch of user URLs, identical snapshot totals despite concurrent note edits, unauthorized export safe 404, no public permanent file. Reference ≤10s target measured with environment recorded; over-target release remains for SK-018 remediation.

**Verification/evidence:** `npm run test:integration -- tests/integration/export-snapshot.test.ts`; `npm run test:pdf`; `npm run verify`; `npm run test:ui -- --grep @M5-export`. Store synthetic `export.pdf`, extracted text/page images, reviewed page list, download screenshot and `SK-012.md`. A mocked PDF response cannot satisfy this task.

### SK-013 — Calm appearance and original ambient sound

**Outcome/owner/files:** W-experience owns `src/features/settings/appearance/`, `audio/`, theme tokens and `public/audio/`; C integrates settings route/preference changes. Consume profile preferences and session opening clock; output persistent user appearance/audio preferences, rights manifest entries and user-controlled player. Fonts/export rights entries are coordinated with SK-012, not overwritten.

**Scope/substeps:** finish Midnight/Dawn/Forest contrast-tested themes and motif-free option; create/obtain three original loops (rain/water/drone) with source/authorship/hash/license proof, plus silence; implement Play/Pause/volume/mute/15–30–60 minute stop/fade and stop-at-practice option; persist settings independently of practice timezone/tradition; add reduced motion and playback-error/unsupported states. No autoplay, sacred recording claims, audio download/offline guarantee or decorative motion beyond the specification.

**Acceptance:** A18/A19; silence on load and notification clicks; each selected track plays only after user action and can stop/mute; timer completes under clock test; interrupted/missing audio keeps check-in usable; all themes pass measured contrast and status labels; 320px/zoom works. Actual mobile background behavior is separately recorded by SK-017.

**Verification/evidence:** `npm run verify`; `npm run test:ui -- --grep @M5-experience`; manual listening/timer/keyboard/reduced-motion checks. Retain `docs/ASSETS.md` with exact file hashes/rights, contrast readings, `settings-theme.png`, `SK-013.md`. Missing rights or playable assets block completion, not an excuse to quietly remove launch sounds.

### SK-014 — Archive, deletion and privacy controls

**Outcome/owner/files:** W-privacy owns `src/server/privacy/`, lifecycle controls/settings privacy UI and privacy tests; C owns deletion/ledger migration and route/admin-client integration. Consume offline clear/queue-warning, reminder cancellation, export/auth APIs and authenticated profile preferences. Produce idempotent archive/journey-delete/account-delete operations plus status/retry UI.

**Scope/substeps:** archive retains history and cancels future jobs; confirm journey deletion removes owned notes/content/events; implement fresh reauth/explicit account confirmation, immediate disabled-account tombstone and pending-send cancellation before auth/primary cleanup; retry partial failures; write the independent D08 deletion ledger through a transactional outbox and verified S3 receipt (filesystem adapter explicitly simulated locally); keep disabled state and retry on failure before reporting deletion complete; enforce shared-device storage mode/logout cleanup and device revocation; publish accurate local-storage/privacy/push limitations without unverified provider guarantees.

**Acceptance:** A16/A20; stale auth cannot access tombstoned data, worker observes deletion before dispatch, another account remains untouched, primary cleanup meets ≤24h under tested retry workflow, no cached notes survive account switch, unsynced edits require explicit handling. Journey export remains optional before deletion. Provider backup erasure claim remains blocked by B03 until verified.

**Verification/evidence:** `npm run test:integration -- tests/integration/privacy-lifecycle.test.ts`; `npm run verify`; `npm run test:ui -- --grep @M5-privacy`. Test worker/deletion race, failed auth-admin delete retry, selective cascade, restore ledger replay and safe logs. Retain `archived-history.png`, synthetic deletion assertions and `SK-014.md`. C runs M1–M5 regression and presents actual PDF/audio/privacy demo.

### SK-015 — Production image and recovery proof locally

**Outcome/owner/files:** C owns `Dockerfile`, `.dockerignore`, `render.yaml`, health/logging/runtime/CI config and new `docs/OPERATIONS.md`; workers may review read-only. Consume built app/worker/export and D03/D07 roles/services; produce immutable image/runbook and local recovery evidence. No service provisioning or deployment in this task.

**Scope/substeps:** pin non-root Node Debian base digest and Chromium revision; build web/worker targets; validate sandbox/blocked render network and memory/time caps locally; expose safe health/worker heartbeat; configure graceful termination, redacted logs, bounded pools and manual-only deployment descriptor; document one-time migration and rollback commands; rehearse backup/restore and deletion replay in disposable local databases, expire old jobs before restart. Store only synthetic backups outside Git.

**Acceptance:** app and worker restart from built artifacts, no dependency on tsx source-watch at release, no secrets in image layers, no fake-clock production startup, PDF/check-in runs in container, prior compatible image survives migration expansion, restored deleted account remains inaccessible; recovery durations and data-loss window measured. Render-specific runtime proof remains SK-016.

**Verification/evidence:** `npm run verify`; `npm run test:worker`; `npm run test:pdf`; planned `npm run test:container` (owned here: Docker build/run/health and production-mode safety assertions); planned `npm run test:restore` (owned here: isolated synthetic backup/restore/deletion/expiry smoke). Store commands/image digest/version/restore logs and `SK-015.md`; new scripts must be documented in OPERATIONS and tested. Local success does not authorize cloud actions.

### SK-016 — Authorized staging and real email sign-in

**Outcome/owner/files:** C owns provider configuration and `docs/OPERATIONS.md` staging/evidence additions; no secret values committed. Consume SK-015 image/runbook; produce an actual authorized HTTPS staging URL, isolated Auth/DB, real SMTP and validated regional/retention configuration. Currently gated by B01–B03.

**Unblock/substeps:** prepare itemized quote/domain/retention evidence and concrete deployment revision; obtain missing explicit authorization; provision selected Singapore staging components/roles/secrets, verify database version/capacity; configure verified Resend domain/provider Auth quotas and approved mail recipients plus the private S3 ledger/scoped IAM/expiry; apply migrations once, deploy manual image, run production-mode health/export/auth/worker checks. Verify restricted Chromium works on selected Render plan; failure is a blocker, not silent sandbox removal.

**Exclusions:** production deployment, real private user data, unsolicited mail/push, changes to selected provider/region/retention without approval.

**Acceptance/verification:** owner can reach recorded URL from their browser; an authorized email-link actually arrives and signs in; invalid links/redirects/ownership/private caching behave correctly; real DB grants/TLS, retention disclosures, secret separation and worker availability verified. `STAGING_BASE_URL=<recorded-url> npm run test:staging`, `npm run test:pdf` in the production container and staged restore drill from OPERATIONS must pass. Save sanitized receipts/config evidence/domain verification/retention source references and `SK-016.md`; never tokens or auth links. No outcome marked PASSED until observed.

### SK-017 — Real phone notification and audio validation

**Outcome/owner/files:** W-device-validation owns `docs/evidence/M6/<run-id>/devices.md`, `SK-017.md` and test-only device scripts; runtime fixes are reassigned to their module owner by C. Consume actual staging/PWA/real push adapter; produce A12's physical-device evidence and actual audio capability matrix. B04 must be resolved first.

**Scope/substeps:** record hardware/OS/browser/install mode/permission/Focus/connectivity; register on iPhone Home Screen and Android installed app; close the phone app, then trigger that registered phone’s explicitly authorized test from another signed-in desktop session; observe OS display while the phone app is closed, tap and record matching session/click event; test opt-out/stale subscription/Focus/offline and generic privacy payload; try user-started audio/mute/timer/interruption/lock screen. Explicitly separate unsupported/background behavior from confirmed foreground capabilities.

**Acceptance:** A11/A12/A19; both real supported platforms display an authorized test push and open correct session, evidence distinguishes push acceptance/display/click; no note leakage. Denial/Focus/offline never says “delivered.” Browser emulators, fake receipts and provider HTTP 201 cannot pass A12. Missing device/capture capability keeps required case NOT RUN and task BLOCKED.

**Verification/evidence:** `STAGING_BASE_URL=<recorded-url> npm run test:staging` for browser regression plus the complete physical-device procedure above. Store sanitized actual screenshots/photos, transport receipt IDs without endpoints, click evidence and exact outcome per device; `SK-017.md` lists any failed attempts and recovery steps. C integrates runtime fixes and reruns their tests before accepting evidence.

### SK-018 — Integrated release candidate gate

**Outcome/owner/files:** C owns final evidence/OPERATIONS/CI gate corrections and focused fixes in explicitly reassigned modules. Consume all previous task reports; produce an A01–A27 verified release matrix and ready staging demo. Do not mark complete while SK-016/017 evidence is missing.

**Scope/substeps:** run full regression on one integrated revision; audit role/secrets/CSRF/SSRF/cache/rate-limit/log/retention boundaries; keyboard/VoiceOver/zoom/320px checks; measure Today/save/PDF and worker dispatch-lag targets; run staged outage/restore/previous-image rollback drills; inspect dependencies/assets/privacy copy and complete evidence matrix; remove/debug-disable test-only routes and ensure production guard rejects fake modes. Fix required performance failures with measured changes, no speculative redesign.

**Acceptance/verification:** `npm run verify`, full `npm run test:ui`, `npm run test:worker`, `npm run test:pdf`, `npm run test:performance`, `npm run test:container`, `npm run test:restore`, `npm audit --omit=dev`, `npm audit`, and authorized `npm run test:staging`. CI must execute applicable gates successfully; missing CI access remains a release blocker. Every A case has actual result/evidence; no skipped required cases or unresolved relevant high/critical vulnerability. Record environmental limits and explicit decisions on any proposed target change; never silently waive a requirement.

**Evidence/stop:** `docs/evidence/M6/<run-id>/release-matrix.md`, measured raw timings/device/restore/security results, `SK-018.md`; present working staging demo, exact startup/deployment revision and evidence, then pause for user M6 review and separate production approval.

### SK-019 — Authorized production launch and canary

**Outcome/owner/files:** C owns authorized production configuration, OPERATIONS and final evidence; no remote push/deployment until B05 explicitly resolves. Consume approved image/digest/migrations and M6 evidence; produce actual live URL and owner-reviewable canary outcome.

**Scope/substeps:** record production approval/environment/budget/revision; create isolated production secrets/Auth/DB and manual Render services following runbook; apply migrations once and deploy approved digest; run health/isolation/auth/create/complete/reload/PDF and explicitly authorized test push canary with real time; verify worker heartbeat/backlog; remove synthetic canary content via supported deletion; document recovery/contact/retention/version and actual restart commands. Never seed demo clock or point local reset helpers at production.

**Acceptance/verification:** `PRODUCTION_BASE_URL=<recorded-url> npm run test:canary` (script owned here, non-destructive except explicitly scoped canary data), actual HTTPS/health/worker checks, safe production-mode/ownership tests and authorized display confirmation. Failed health/migration/canary stops launch; rollback only compatible image/schema, preserving user data. Record actual outcomes and limits; no full destructive test suite on production.

**Evidence/stop:** image/commit/migration references, redacted operational checks, live workflow screenshot, reachable actual URL and `SK-019.md` under M7 evidence. C updates the register only after integrated deployed canary succeeds, presents live result and pauses for the user's launch review. No push, tag, PR or monitoring automation is implicitly authorized.

## 4. Requirement-to-task traceability

Original acceptance wording remains in APP_SPECIFICATION §10. This maps coverage, not outcomes; **all application acceptance tests are NOT RUN at planning completion**.

| Acceptance | Implement/verify tasks |
|---|---|
| A01 | SK-003, SK-018 |
| A02 | SK-003, SK-009, SK-011 |
| A03 | SK-003, SK-005, SK-006 |
| A04 | SK-001, SK-003, SK-006 |
| A05 | SK-005, SK-012, SK-018 |
| A06 | SK-001, SK-006, SK-008 |
| A07 | SK-005, SK-009, SK-011 |
| A08 | SK-006, SK-008 |
| A09 | SK-009, SK-011, SK-014 |
| A10 | SK-011, SK-015, SK-018 |
| A11 | SK-010, SK-011, SK-017 |
| A12 | SK-010 (browser only), SK-017 (required real devices) |
| A13 | SK-003, SK-005 |
| A14 | SK-006, SK-007, SK-012 |
| A15 | SK-008 |
| A16 | SK-002, SK-007, SK-008, SK-010, SK-014, SK-018 |
| A17 | SK-012, SK-018 |
| A18 | SK-002, SK-005, SK-013, SK-018 |
| A19 | SK-013, SK-017 |
| A20 | SK-008, SK-014, SK-015, SK-018 |
| A21 | SK-009, SK-011 |
| A22 | SK-005, SK-006 |
| A23 | SK-003 |
| A24 | SK-003 |
| A25 | SK-003 |
| A26 | SK-004, SK-009, SK-011 |
| A27 | SK-003, SK-005 |

Additional launch coverage: email-link states/privacy/rate limits (001/002/014/016/018); setup/multiple journeys/targets/limits (003/005); journal/mood/prompts/search (007); font/audio rights/themes (012/013); private cache/storage disabling/account switch (008/014); actual PDF/backup deletion retention/recovery (012/014–018); CI/versioned environment and durable handoffs (001/015/018 plus AGENTS on every task).
