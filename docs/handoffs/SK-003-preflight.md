# SK-003 personalized setup preflight

Owner: `/root/m1_domain`

Audit mode: read-only production review; this report is the only changed file.

Reviewed the coordinator working tree at `/Users/rajesh/sankalpa` on 2026-09-06, including `contracts.ts`, validation/schedule/status, all 47 domain tests, journey/session services, setup and practice UI, SK-003, PROJECT_PLAN, D04 and APP_SPECIFICATION A01/A23–A27.

## What already supports SK-003

- `PracticeDefinition`, `SessionPractice` and `savePractices` already carry checkbox, repetition and minute values. Domain/API validation requires positive targets, persists zero as incomplete without Partial status, and the database constrains target/value kinds. `targetsMet` and `deriveStatus` already implement numeric target and D04 partial semantics.
- `ScheduleInput`, validation and generation already support occurrences versus calendar-day spans, arbitrary ISO weekdays, explicit IANA timezone, civil versus previous-evening attribution, 1–1,439 minute windows, local wall-clock close, nonoverlap, and the required gap/fold policy.
- Unit fixtures already prove A01, A13, A24, A25 and A27 schedule behavior: 21 attributed nights, 12 Monday/Thursday occurrences ending 15 October, four Tuesdays in 30 days, civil 06:00, New York gap to 03:00 and earlier fold selection.
- `createJourney` validates and previews with server time; activation reparses the stored draft, checks its fingerprint and regenerates the schedule. The approved D04 condition is “at least one session whose window has not opened,” which the domain enforces. It deliberately does not remove earlier occurrences when a schedule also has a future one.
- Setup already suggests the device timezone and requires explicit confirmation. Preview focus, edit/retry state and operation-ID reuse should be preserved.

## Exact missing behavior

### Setup UI

- `setup-form.tsx` models only `{key,label}`, emits every practice as `checkbox/target:null`, and tells users that counts/minutes come later. It needs a kind selector plus conditional positive integer target with repetitions max 1,000,000 and minutes max 1,439.
- It hard-codes `durationMode:'occurrences'`, all seven weekdays and `attribution:'civil'`. It needs an explicit duration-mode control, daily versus selected-weekday controls with at least one chosen day, and a date-attribution choice whose overnight wording makes clear that the scheduled opening occurs on the following civil date. Time must never infer attribution.
- The blank flow is currently correct and must remain the default. There is no explicit optional template action. The 21-night example should populate editable values only after a user action, keep reminders disabled, and reset timezone confirmation when it supplies Asia/Kolkata. It must create no shared/template records.
- Preview says “daily sessions” and always describes civil dates. It needs the actual recurrence/duration wording, each practice kind/target, first and final opening timestamps in the submitted journey timezone, practice-date range, attribution explanation, adjusted-window warnings, and reminder status. A01 should read first 6 September 00:00, final 26 September 00:00, calendar nights 5–25 September.
- The backend currently accepts a mixed past/future schedule because D04 requires one unopened window, rather than every occurrence being future. The UI should not label this “future-only” or silently filter dates. If product intent has changed to reject every already-opened occurrence, that is a coordinator-owned D04/domain change.

### Practice UI

- `practice-panel.tsx` narrows its mutation and local state to `Record<string,boolean>`, converts every loaded value through `value===true`, renders only checkboxes and disables non-checkbox rows. This loses numeric values in the client even though the service supports them.
- Numeric rows need an integer input or step control, visible current value and target/unit, independent save, retained local input on failure, and the existing operation-ID/base-revision retry behavior. Zero remains incomplete; positive below target is Partial with zero completion credit; target or higher permits the separate deliberate confirmation.
- Saving on every numeric keystroke would transmit empty/temporary invalid values. Use a small per-row form with an explicit Save action (or committed blur) while preserving immediate checkbox saves. Send only the changed practice ID so mixed checklists cannot overwrite untouched values.

### Server/preview data

- `SchedulePreview` contains only occurrences, total and free-text DST warnings. It has no reminder-time/skipped-reminder result. If SK-003 must show past offsets as skipped before SK-009, the coordinator should add a small typed preview field such as `{offsetMinutes,scheduledFor,status:'scheduled'|'skipped_past'}` and calculate it from the resolved opening instants and server `now`. Templates can carry disabled suggested offsets, but the UI must say reminders remain off.
- `createJourney` does not compare a proposed preview with the owner’s other nonsuperseded sessions. The coordinator should query interval intersections under the existing owner transaction/RLS and append a generic nonblocking warning. Different journeys may overlap; activation must remain allowed.
- The route response shape `{journey,preview,fingerprint}` is locally duplicated in the client. A shared exported `JourneyDraftPreview` type would prevent service/UI drift, especially if reminder preview fields are added. Existing practice and schedule input contracts otherwise need no expansion.

## Recommended isolated UI ownership

Give the UI worker these nonoverlapping files:

- `src/features/journeys/setup-form.tsx`: reduce to the route-compatible coordinator or compatibility export so `/setup` keeps its current import.
- `src/features/journeys/setup/types.ts`: form-only string state and conversion to `JourneyDraft`; no duplicated domain rules.
- `src/features/journeys/setup/templates.ts`: pure blank and explicitly selected editable example values.
- `src/features/journeys/setup/practice-editor.tsx`: ordered rows, kind, target, add/remove and accessible labels.
- `src/features/journeys/setup/schedule-editor.tsx`: duration mode/value, daily/selected weekdays, local time, window, timezone confirmation and attribution.
- `src/features/journeys/setup/schedule-review.tsx`: submitted server snapshot, actual first/last/practice dates and warnings.
- `src/features/practice/practice-value-input.tsx` and `src/features/practice/practice-panel.tsx`: discriminated checkbox/numeric controls and typed per-item saves.
- Feature-local CSS modules plus `tests/ui/m2-schedule.spec.ts`; avoid concurrent edits to shared `sanctuary.module.css`. Keep the existing M1 labels/selectors or update its test in the same UI branch.

The coordinator should own shared contract changes, overlap/reminder preview calculation, route/service integration, migrations, M2 fixture/seed changes and integration tests. Before UI implementation, freeze the draft-preview response and M2 fixture identities so the Playwright suite can consume them without worker changes to shared fixtures.

## Required UI and integration cases

- Blank custom A23: 40-day civil 06:00 prayer contains no example practices, midnight attribution or 22:00 reminder.
- Optional A01 template: explicit selection, editable fields, 21 sessions, correct opening and practice-date ranges, reminders visibly off.
- A24: repetitions/minutes selector, 20-minute target, Monday/Thursday, 12 occurrences, final 15 October; entering 5 saves Partial and cannot confirm, entering 20 can confirm once.
- A25: 30 calendar days, Tuesday only, denominator four; unchecked weekday set is blocked without losing input.
- A27: identical 00:00 time produces different practice dates only when previous-evening is explicitly chosen; a 06:00 civil journey stays on its own date.
- DST review: adjusted 03:00 gap and earlier 01:30 fold warning are visible, keyboard reachable and not color-only.
- Server 422 for zero occurrences, invalid/overlapping windows or no unopened window preserves all form entries; changed input receives a fresh creation operation ID, exact retry reuses the prior ID.
- Mixed checkbox/numeric session, zero and positive-below-target persistence, over-target acceptance, retry/conflict preservation, confirmation gating, reload, keyboard operation, 200% zoom and 320px reflow.

## Contract questions to settle before implementation

1. Does SK-003 add typed reminder preview results now, or only retain “Reminders off” until SK-009? The current task text requires skipped reminders, while its acceptance fixtures do not exercise them.
2. For a new journey containing both past and future occurrences, should the preview show/persist all generated sessions per approved D04, or has “future-only” become a stricter rule? Current approved behavior requires only one unopened session.
3. Should the optional template retain disabled offsets `[-120,-30,-5,0]` for preview, or leave offsets empty until SK-009? Either choice must keep `enabled:false` and must not imply delivery.
