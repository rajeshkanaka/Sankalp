# M3 SK-006/SK-007/SK-008 contract preflight

Owner: `/root/bootstrap_audit`

Scope: read-only review of root through `3bc9932`, with proposals for the coordinator-owned M3 contract and migration checkpoint. No application source, shared contract, migration, configuration, runtime or database was changed.

## Findings that must shape the freeze

1. `deriveStatus(session, now)` is the correct live status source and must continue to drive metrics. It is not historical evidence. If an incomplete closed session is corrected before a closure event exists, deriving the event from its current values falsely rewrites the original missed/partial state.
2. The current session services sample `now` before acquiring row locks, and `lockSession` samples it again. Every M3 mutation should instead lock journey then session, take one server clock sample, create any due closure snapshot from the locked pre-mutation state, validate and mutate using that same sample.
3. Current `savePractices` accepts post-close writes at the service boundary. This can remain the basis for historical checklist correction only if closure capture happens first and the correction appends an event. The historical UI should submit a grouped value map rather than generating one event per checkbox where practical.
4. Current amendments lack a session revision, so equal fixture timestamps make their order ambiguous. Store the post-mutation session revision on each amendment and make `(session_id, session_revision)` unique.
5. Reflection revisions must be independent from session revisions. Checklist/completion conflicts and reflection conflicts are separate offline streams; changing a note must not make a completion stale.
6. `RequestError` currently drops HTTP status and `error.current`. M3 conflict comparison cannot work until the authorized current value is retained by the client error type. It must never be logged.
7. The generic operation receipt stores its response JSON. A reflection receipt must contain only a safe acknowledgement, never the 20,000-character reflection or moods. The request hash is sufficient for changed-body reuse detection.
8. Sending reflection text or mood filters as GET query parameters risks putting private terms in proxy/access logs. Prefer a same-origin JSON `POST /api/journal/query` and record this narrow privacy-driven route decision; keep `GET /api/journal` only if every deployed access log is proven to omit query strings.

## Minimal shared contract additions

```ts
export type PracticeValue = boolean | number;

export interface CompletionPayload {
  performedAt: IsoInstant;
}

export interface CompletionTiming {
  practiceTiming: 'on_schedule' | 'practiced_late' | null;
  recordedLater: boolean;
}

export type AmendmentKind =
  | 'values_saved'
  | 'confirmed'
  | 'completion_corrected'
  | 'completion_removed';

export interface SessionAmendment {
  id: Id;
  sessionId: Id;
  scheduleVersionId: Id;
  kind: AmendmentKind;
  sessionRevision: Revision; // post-mutation revision
  recordedAt: IsoInstant;
  detail: Record<string, unknown>; // server-built, never reflection text
}

export interface SessionMutationResult {
  session: SessionRecord;
  amendment: SessionAmendment;
  historyEvents: SessionHistoryEvent[]; // zero, closure, correction, or both
}

export type SessionHistoryEvent =
  | {
      id: Id;
      sessionId: Id;
      journeyId: Id;
      kind: 'session_closed';
      occurredAt: IsoInstant; // exactly session.closesAt
      recordedAt: IsoInstant; // server capture time
      sessionRevision: Revision;
      detail: { status: 'complete' | 'partial' | 'missed' };
    }
  | {
      id: Id;
      sessionId: Id;
      journeyId: Id;
      kind: 'session_corrected';
      occurredAt: IsoInstant; // server correction time
      recordedAt: IsoInstant;
      sessionRevision: Revision;
      amendmentId: Id;
      detail: {
        action: 'values_saved' | 'confirmed' | 'completion_corrected' | 'completion_removed';
        beforeStatus: SessionStatus;
        afterStatus: SessionStatus;
        beforeTiming: CompletionTiming;
        afterTiming: CompletionTiming;
      };
    };

export interface ReflectionRecord {
  sessionId: Id;
  journeyId: Id;
  scheduleVersionId: Id;
  text: string;
  moods: string[];
  revision: Revision;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}

export interface ReflectionPayload {
  text: string;       // trimmed edges, Unicode/internal whitespace preserved, <= 20,000 chars
  moods: string[];    // 0..5 unique trimmed tags, each 1..40 chars
}

export interface ReflectionMutationResult {
  sessionId: Id;
  revision: Revision;
  updatedAt: IsoInstant; // safe idempotency receipt; UI already owns its submitted draft
}

export interface JournalQuery {
  journeyId?: Id;
  from?: PracticeDate;
  to?: PracticeDate;
  mood?: string;
  text?: string;      // literal substring, trimmed, <= 200 chars
  cursor?: string;
  limit?: number;     // default 25, 1..100
}

export interface JournalEntry {
  sessionId: Id;
  journeyId: Id;
  journeyTitle: string;
  practiceDate: PracticeDate;
  status: SessionStatus;
  completionTiming: CompletionTiming;
  textPreview: string; // bounded to 280 characters; full text stays on session detail
  moods: string[];
  reflectionRevision: Revision;
  updatedAt: IsoInstant;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
```

Keep `MutationEnvelope<CompletionPayload>` for both first confirmation and correcting an already confirmed `performedAt`; the locked current state determines which amendment kind is written. A same-value new operation should return `409 NO_CHANGE`; an exact operation retry returns its receipt. `DELETE completion` needs only `MutationEnvelope<{}>`. Checklist payload remains a map and can carry multiple values atomically.

Define timing once in the domain:

- `on_schedule` when `opensAt <= performedAt < closesAt`.
- `practiced_late` when `performedAt >= closesAt`.
- `recordedLater` only when practice was on schedule and `recordedAt >= closesAt`; a practiced-late record should not also receive the “Recorded later” badge.

Reflection `PUT` uses `MutationEnvelope<ReflectionPayload>`. A missing reflection has revision zero; first insert requires `baseRevision: 0`. A conflict returns `409 REVISION_CONFLICT` with `current: ReflectionRecord | null`. Extend `RequestError` to retain `status` and `current: unknown`, while keeping both out of console/error reporting.

For optional prompts, freeze a profile preference as built-in identifiers rather than storing prompt prose in every reflection:

```ts
type ReflectionPromptId = 'noticed' | 'carry_tomorrow';
interface ReflectionPreferences { prompts: ReflectionPromptId[] }
```

An empty list disables prompts. This keeps prompts user-configurable without inventing a second journal model or duplicating content.

## Coordinator migration 008

Use one serialized `202609060008_m3_history_reflections.sql` so SK-006/007 do not race migration ownership.

### Amendments

- Extend the amendment kind CHECK with `completion_corrected` while retaining existing values for compatibility.
- Add `session_revision integer`. Backfill existing prelaunch rows with a per-session order, then set `NOT NULL`, require `session_revision > 0`, and add `unique(session_id, session_revision)`. New services insert the post-mutation revision.
- Add a composite unique key on amendment identity plus session/version/journey/owner so a linked event cannot reference another owner’s amendment.

### Immutable history events

Create `app.notification_event` now with only the M3 event kinds; SK-009 extends it for reminder/device events:

```sql
id uuid primary key,
owner_id uuid not null,
journey_id uuid not null,
session_id uuid not null,
schedule_version_id uuid not null,
amendment_id uuid,
kind text not null check (kind in ('session_closed','session_corrected')),
occurred_at timestamptz not null,
recorded_at timestamptz not null,
session_revision integer not null check (session_revision >= 0),
detail jsonb not null check (jsonb_typeof(detail) = 'object')
```

- Composite FK to the owned session with `ON DELETE CASCADE`; composite FK from `amendment_id` to the same owned session/amendment with cascading journey deletion behavior.
- Partial unique index on `(session_id)` for `kind='session_closed'`.
- Partial unique index on `(amendment_id)` where non-null.
- Index `(owner_id, recorded_at desc, id desc)` and `(session_id, occurred_at, id)`.
- Capture a closure row for all three terminal snapshots (`complete`, `partial`, `missed`) so later undo cannot create a false missed-at-close event. User notification/history lists hide the complete closure marker; incomplete markers produce the specified factual closure entries.
- `FORCE ROW LEVEL SECURITY`; owner policy using `auth.uid()`. Grant `SELECT, INSERT` only to `app_api`; no update/delete grant. Revoke all from `public`, `anon`, and `authenticated`. SK-009 later grants its worker only a fixed-search-path function, never table access.

### Reflections and moods

Create `app.reflection` with `session_id` as the primary key plus `schedule_version_id`, `journey_id`, `owner_id`, `text`, nonnegative `revision`, `created_at`, and `updated_at`. Add a unique key on `(session_id,schedule_version_id,journey_id,owner_id)` for the mood child, use the existing composite owned-session FK with `ON DELETE CASCADE`, require `length(text) <= 20000`, and require `updated_at >= created_at`.

Use `app.reflection_mood` rather than an unchecked text array:

```sql
session_id uuid,
schedule_version_id uuid,
journey_id uuid,
owner_id uuid,
position smallint check (position between 0 and 4),
label text check (length(label) between 1 and 40),
primary key(session_id, position),
unique(session_id, label),
composite foreign key (...) references app.reflection(...) on delete cascade
```

Force RLS and owner policies on both tables. Grant reflection `SELECT, INSERT, UPDATE(text,revision,updated_at)`; grant mood `SELECT, INSERT, DELETE` so a transaction can replace its bounded set. Do not grant either table to the future worker. Add reflection indexes `(owner_id, updated_at desc, session_id)` and `(owner_id, journey_id, session_id)`, plus mood `(owner_id, label, session_id)`.

Add `profile.reflection_prompts text[] not null default '{}'` with a CHECK that values are from the two identifiers and cardinality is at most two; grant only column update to `app_api`.

Do not add a text-search extension until measured against worst-case synthetic notes. The 20-journey cap applies only to active journeys, so archived reflection history is not hard-bounded; keyset output limits do not prevent the text predicate from scanning candidates. Treat a statement-timeout result as a recoverable bounded-search error. If measurement requires `pg_trgm`, have the migration owner verify the managed extension, record the decision, and keep its GIN index inside the private database.

## Session transaction rules

All value, completion, correction, undo, and reflection mutations use this order:

1. Acquire the existing idempotency advisory lock for `(owner, operationId)`.
2. Resolve the session under RLS, then lock its journey `FOR UPDATE`.
3. Lock the session `FOR UPDATE`; reject tombstones with `SESSION_REPLACED`, inactive journeys as specified, and stale revisions with authorized current data.
4. Sample `now` once after both row locks.
5. If `now >= closesAt`, ensure the immutable closure marker before changing values/confirmation. Insert with `ON CONFLICT DO NOTHING`, then read the winner.
6. Validate nested practice IDs against the locked session version, validate types/limits, and validate `opensAt <= performedAt <= now`. Closing is exclusive for on-schedule classification, not a maximum for a late report.
7. Apply values/completion state and increment the session revision once. One request produces one amendment carrying that post-mutation revision.
8. For a post-close change, insert one linked `session_corrected` event containing status/timing transitions but no practice labels, values, intention or reflection text.
9. Return the canonical record, amendment and any events; insert the safe operation receipt in the same transaction.

Confirmation behavior:

- Unconfirmed + all versioned targets met: set confirmed/performed/recorded and write `confirmed`.
- Confirmed + changed valid performed time: update performed/recorded and write `completion_corrected`.
- Confirmed + same performed time: `409 NO_CHANGE` unless it is the exact operation retry.
- Undo: set confirmation false and performed/recorded null, retain checklist values, write `completion_removed`, and never alter the closure snapshot.

Live status and metrics always recompute from current canonical session state. Closure and correction events explain chronology; they never drive current progress.

If a legacy session lacks a closure marker after post-close amendments, do not infer from current values. Reconstruct the at-close snapshot by replaying revision-ordered amendments with `recorded_at < closes_at`; treat `recorded_at = closes_at` as after closure. If the legacy evidence is insufficient, fail closed and surface an operational repair requirement instead of inventing “missed” or “partial.” With SK-006 active, every post-close mutation captures the marker first, so this path is migration/recovery-only.

## Journal and history reads

- Journal keyset order: `(practice_date DESC, session_id DESC)`. Cursor is validated base64url JSON containing exactly those fields. Query `limit + 1`; return no total count.
- Treat text search as a literal substring; escape `%`, `_`, and the escape character before `ILIKE`. Apply owner RLS first, then optional exact journey/date/mood filters. Return a 280-character preview, never 100 full 20,000-character notes.
- Full reflection is loaded only with its owner-authorized session detail. React renders text normally; no raw HTML path.
- Session/global history keyset order: `(recorded_at DESC, id DESC)`, maximum 100. Session detail may order ascending by `(occurred_at, closure-before-correction, id)` for narration.
- Hide `session_closed` markers whose captured status was complete from the notification list. Show missed/partial closure and every linked later correction. The original closure event remains unchanged after correction or undo.
- Empty reflection text and moods are permitted so clearing an existing note is representable. Empty rows may be omitted from the journal list while remaining available as revision state on the session.
- Return owner-private 404 for guessed session/journey IDs, 409 with authorized current resource for revisions, 422 for malformed filters/values, and no reflection/search terms in logs, event detail, amendments, operation receipts, metrics or push data.

## Offline replay contract needed by SK-008

Persist account-scoped records with this minimum shape:

```ts
interface OfflineMutation {
  operationId: Id;
  ownerId: Id;
  stream: `session:${Id}` | `reflection:${Id}`;
  targetId: Id;
  kind: 'practice_values' | 'completion' | 'completion_undo' | 'reflection';
  baseRevision: Revision;
  payload: unknown; // validated discriminated payload before enqueue and replay
  enqueuedAt: IsoInstant;
  dependsOn: Id | null;
  state: 'queued' | 'sending' | 'conflict' | 'review_required';
}
```

- Coalesce unsent checklist values for one session where safe. Completion depends on the checklist operation; after that operation succeeds, update the not-yet-sent dependent mutation to the returned revision. Never rebase the first operation over a server change.
- Reflection uses its own revision stream. A checklist conflict does not silently merge or overwrite a reflection, and vice versa.
- On 409, persist both the local payload and `error.current`, stop that stream, and require a deliberate keep-server or resubmit-local action. Never retarget a `SESSION_REPLACED` draft to a replacement session.
- On 401, pause all sending without deleting drafts. On 422, keep the rejected draft for editing. On transport uncertainty, retry the exact operation ID/body.
- At 30 days, mark `review_required`; preserve the original draft and require review/new operation ID. Client age is a recovery policy, not a trust boundary; server revision and ownership checks remain authoritative.
- Use one account-specific IndexedDB namespace or mandatory owner key prefix, coordinate a single flush leader across tabs, and close/switch the namespace before showing another account. Shared-device mode disables new private storage. Logout with pending work must offer sync, remain signed in, or explicit discard.
- Store no auth tokens, cookies, notification endpoints or server secrets in queue records. A local completion remains visibly “Saved on this device; reminders may continue until synced.”

## Required tests before assignment completion

- Exact opening/closing boundaries; late performed time; recorded-later versus practiced-late metrics and badges.
- Closure capture before the first post-close values save/confirmation; later correction and undo preserve the original event; complete-at-close then undo does not create a false missed event.
- Equal fixture timestamps still order amendments by session revision; exact retry creates one amendment/event; changed-body operation reuse fails.
- Rollback after value/session update leaves no amendment/event or partial state; concurrent correction/undo produces one winner and one recoverable conflict.
- Reflection 20,000/20,001 Unicode boundaries, five/six moods, duplicate trimmed moods, hostile HTML as text, no note in receipts/events/log capture, and owner-private query isolation.
- Journal literal `%`/`_` search, date/mood/journey intersection, stable cursor pages without duplicates, bounded previews and malformed cursor rejection.
- Offline ordered rebasing only along a local dependency chain, uncertain retry, 401 pause, 409 dual preservation, superseded-session stop, 30-day review, storage denial/quota, tab leadership, logout and account switch.
