# SK-004 versioned future revisions preflight

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-fixtures`

Branch: `task/SK-001-fixtures`

Scope: read-only design against the approved D04/A26 behavior and current contracts, schedule generator, transactions and migrations. No production source, shared contract, migration, configuration or tracking file was changed.

## Current foundation

The existing model already has the most important history boundary:

- `practice_version` is immutable and keyed by practice plus schedule version, so an opened session can keep its original labels, kinds and targets.
- `session` stores resolved UTC bounds, practice date, ordinal, schedule version and `superseded_at`.
- Partial unique indexes on journey/date and journey/ordinal apply only while `superseded_at is null`, so tombstones can retain old IDs while replacement rows reuse their logical date/ordinal.
- `journey.active_schedule_version_id` is an owner-checked deferred FK.
- `withUser` supplies one RLS-protected transaction. `idempotent` serializes an owner/operation ID, hashes the request and stores its response in that same transaction. Completion already locks journey then session.

The current `generateSchedule(input, retained, now)` is sufficient for initial activation but not a revision boundary. It always selects from `input.startDate`; calendar mode has no effective-date floor, and occurrence mode can subtract retained rows but cannot begin replacement generation at an explicit effective practice date. Its `now` rule requires only one future occurrence, whereas every newly generated revision row must remain unopened.

## Shared contract additions

Keep `ScheduleInput.startDate` for activation, but do not let a revision request edit it. Add these strict shapes to the shared contracts and validation module:

```ts
type ScheduleRevisionSettings = Omit<ScheduleInput, 'startDate'>;

interface ScheduleRevisionCandidate {
  effectivePracticeDate: PracticeDate;
  practices: PracticeDefinition[];
  schedule: ScheduleRevisionSettings;
}

type ScheduleRevisionRequest =
  | {
      mode: 'preview';
      baseRevision: Revision;
      payload: ScheduleRevisionCandidate;
    }
  | ({ mode: 'apply' } & MutationEnvelope<{
      candidate: ScheduleRevisionCandidate;
      fingerprint: string;
    }>);

interface RetainedSessionPreview {
  id: Id;
  scheduleVersionId: Id;
  ordinal: number;
  practiceDate: PracticeDate;
  opensAt: IsoInstant;
  closesAt: IsoInstant;
  reason: 'opened' | 'before_effective';
}

interface RevisionTimestampChange {
  practiceDate: PracticeDate;
  previous: { id: Id; opensAt: IsoInstant; closesAt: IsoInstant } | null;
  proposed: PlannedOccurrence | null;
}

interface ScheduleRevisionPreview {
  currentRevision: Revision;
  currentScheduleVersionId: Id;
  originalStartDate: PracticeDate;
  effectivePracticeDate: PracticeDate;
  retained: RetainedSessionPreview[];
  supersededSessionIds: Id[];
  proposed: PlannedOccurrence[];
  timestampChanges: RevisionTimestampChange[];
  remainingAllowance: number;
  totalActive: number;
  warnings: string[];
  fingerprint: string;
}
```

Apply should return the new journey revision/version IDs, retained/superseded/created session IDs and the canonical authorized `JourneyView`. Preview produces no session IDs for proposed rows. Apply generates those IDs server-side.

Use the existing single `POST /api/journeys/:id/schedule-revisions` route with the `mode` discriminator from PROJECT_PLAN §2.3. Title and intention stay outside this payload as explicit metadata operations. Reminder preferences also stay outside; the revision transaction consumes the current preference revision when reminder jobs exist.

## Revision generation rules

Construct the candidate `ScheduleInput` on the server with `startDate = originalStartDate`. Obtain that value from schedule version 1, never from the request or mutable journey draft.

Classify every active, nonsuperseded session using one server clock sample:

- Retain when `opens_at <= now`, regardless of confirmation, values or whether the user visited it.
- Retain when `practice_date < effectivePracticeDate`, even if it remains unopened; the selected effective date deliberately leaves earlier rows on their old version.
- Replace only when `opens_at > now` and `practice_date >= effectivePracticeDate`.

For `durationMode = occurrences`, retained active rows count toward the requested lifetime total:

```text
remainingAllowance = durationValue - retained.length
```

Reject a negative result. Generate exactly that many dates using the new weekdays, beginning at `max(originalStartDate, effectivePracticeDate)`, excluding every retained practice date. Reject when launch bounds cannot produce the count.

For `durationMode = calendar_days`, preserve the original half-open span:

```text
[originalStartDate, originalStartDate + durationValue days)
```

Reject if any retained active row falls outside the shortened span; accepting it would silently violate the duration while removing it would violate history preservation. Within the span, generate new-weekday dates on or after the effective date and exclude retained dates. Calendar mode has no occurrence quota: `remainingAllowance` is the number of eligible calendar dates after filtering.

For both modes:

- Reject an effective date before the original start.
- Reject a revision with no replaceable or proposed future effect.
- Resolve proposed bounds with the current gap/fold rules and require every proposed `opensAt > now`; do not silently skip a newly generated row whose window already opened.
- Combine retained and proposed rows and run the existing nonoverlap check.
- Keep every retained ID, ordinal, schedule version, practice row and value unchanged.
- Assign proposed ordinals consecutively from `max(retained.ordinal) + 1`. Superseded tombstones may have the same ordinals because active uniqueness is partial.
- Build `timestampChanges` from the union of replaced and proposed practice dates, allowing added and removed dates as well as changed bounds.
- Reuse the existing cross-journey overlap query for a warning; overlap with another journey remains permitted.

The schedule module needs either a narrow `generateScheduleRevision` entry point or an optional generation floor supplied to the existing generator. Keep wall-time resolution and overlap logic shared. Do not copy schedule calculation into the service or UI.

## Fingerprint

Hash one normalized, server-built preview basis rather than client timestamps or the raw request:

```text
contract version
journey ID + base journey revision + current schedule-version ID
original start + effective practice date
candidate practices ordered by position
candidate weekdays in canonical sorted order
retained active session identity/date/ordinal/version/bounds
replaceable active session identity/date/ordinal/version/bounds
server-regenerated proposed occurrence date/ordinal/bounds/adjustment
```

Do not include the clock value itself. A clock advance that does not cross a session opening produces the same fingerprint; crossing an opening changes the retained/replaceable sets and makes apply return `409 PREVIEW_CHANGED`. Apply must parse the submitted candidate, rebuild the entire basis inside its transaction, and compare the submitted fingerprint. Never accept client-provided occurrence timestamps, ordinals or IDs.

Continue using `idempotent(client, owner, operationId, `schedule-revision:${journeyId}`, fullApplyRequest, operation)`. A retry with the same operation and body returns the stored result. Reusing the ID with another fingerprint/candidate remains `409 OPERATION_REUSED`.

## Apply transaction and lock order

Preview also runs inside `withUser`: take a short `FOR SHARE` lock on the active journey before reading its active version and sessions, then sample the clock and build the preview. Every journey/session mutation must continue to take the journey's conflicting row lock first. This makes the multi-query preview internally consistent without holding locks across user review; the fingerprint provides the later optimistic check.

Inside `withUser`, and inside the existing idempotency wrapper:

1. `SELECT journey ... FOR UPDATE`; return owner-private 404 when absent, then require active state and `baseRevision`.
2. Read schedule version 1 and the current immutable version while the journey lock protects its active pointer.
3. `SELECT` every nonsuperseded session for the journey `ORDER BY opens_at, id FOR UPDATE`. Completion follows journey-then-session order, so this ordering avoids an inverse-lock deadlock.
4. Only after those locks are acquired, sample the injected/server clock and classify retained versus replaceable rows. Regenerate the preview basis and require its fingerprint to match.
5. Insert the new schedule version and its practice versions.
6. Mark exactly the locked replaceable session IDs with one `superseded_at = now` update, guarded by `superseded_at is null AND opens_at > now`; require the returned row count/IDs to match. Any mismatch raises `409 SCHEDULE_BOUNDARY_CHANGED` and rolls back.
7. Cancel pending/leased-eligible reminder work for those old session/version IDs without deleting sent notification history. When reminder tables arrive, dispatch must also revalidate current schedule/preference/subscription generations immediately before sending.
8. Insert the new sessions and their zero-value `session_practice` rows. The partial unique indexes now enforce one active date and ordinal.
9. Update `journey.draft` with the normalized new practices/schedule while preserving title, intention and reminder preferences; set the new active schedule version and increment journey revision once.
10. Read the canonical result and insert the operation receipt. Commit all steps together.

If completion wins the journey lock, revision waits and then retains the now-open row. If revision linearizes first while the row is unopened, completion later sees the tombstone and returns the existing `SESSION_REPLACED` conflict. If the selected clock boundary changes during classification/update, the guarded count mismatch rolls the entire revision back. No schedule transaction should lock rows after performing inserts.

## Coordinator-owned migration changes

The current tombstone columns and two partial unique indexes already satisfy D04; retain them. Add only the missing durable version metadata:

```sql
alter table app.schedule_version
  add column version integer,
  add column effective_practice_date date;

-- Backfill the existing single activated version per journey as version 1,
-- with effective date from definition.schedule.startDate, then set NOT NULL.

alter table app.schedule_version
  add constraint schedule_version_number_positive check (version > 0),
  add constraint schedule_version_number_unique unique (journey_id, version);

create index session_active_open
  on app.session(journey_id, opens_at, id)
  where superseded_at is null;
```

Activation writes version 1 and its start date as the effective date. Revision writes `current version + 1` and the requested effective practice date. The initial version's validated `definition.schedule.startDate` is the immutable original start. Do not add a mutable client-writable `original_start_date` or hard-delete old versions.

`app_api` already has insert/select on schedule/practice/session rows and a narrow session `superseded_at` update grant. No schedule-version update/delete grant is needed. If reminder-job tables are not yet present, keep step 7 as an explicit integration seam and contract test per TASKS; do not invent a queue or placeholder rows.

## Required failure and race coverage

- Occurrence reduction below retained count and calendar reduction before a retained date return 422 with no writes.
- Effective date before original start, newly opened proposed row, impossible remaining count and overlap within the same journey return 422.
- A second device changes journey revision after preview: apply returns `REVISION_CONFLICT` with authorized current state.
- A session crosses opening between preview and apply: apply returns `PREVIEW_CHANGED`/boundary conflict; the session ID, ordinal, labels and values remain unchanged.
- Concurrent completion and revision serialize in journey-then-session order and produce one of the two valid outcomes described above.
- Same operation retry returns one logical revision; changed-body reuse returns `OPERATION_REUSED`.
- Inject a failure after superseding and after new-session insertion; both leave the old version pointer and every old active row unchanged.
- Historical/opened rows retain IDs, ordinals, UTC timestamps, schedule/practice versions, values and amendments. Only unopened eligible rows become tombstones.
- Active rows retain unique journey/date and journey/ordinal values; superseded duplicates remain queryable but stay excluded from metrics/calendar.
- Sent notification events remain linked and readable; pending obsolete work cannot dispatch after the active-version recheck.
