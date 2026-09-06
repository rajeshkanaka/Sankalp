# SK-009 reminder integration contract

Coordinator checkpoint, 2026-09-06. Isolated preparation under D12 while PR5 completes its regression gate. Accepted baseline is main544f3ef; no reminder milestone completion is claimed. TASKS is the status authority. Coordinator worktree `/Users/rajesh/sankalpa-worktrees/SK-009-integration`, branch `rajesh_kanaka/reminder-integration`, begins with reviewed domain commits2b66431/4c121ec. Offline PR5 source will be merged from accepted main before integrated app testing.

## Shared product contract

Current preferences remain solely `app.journey.draft.reminders`; historical schedule definitions remain immutable snapshots. A dedicated `journey.reminder_revision` versions reminder mutations. Successful preference changes increment both reminder_revision and the ordinary journey revision, preserving existing draft/metadata concurrency guards. Do not add a second independently mutable preference store.

The already implemented `reminderPreferencesSchema`, `planSessionReminders`, `planSnooze` and `quietHoursContain` own pure TypeScript validation/calculation. All offsets are unique integers from−1440 through0; enabling requires1–8. Quiet hours are nullable strict HH:mm with unequal bounds, measured in each session's historical timezone. They suppress at the intended instant without shifting. Past offsets are skipped; no catch-up burst. Delivery is explicitly simulated for local/CI M4. No wake-up alarm or actual display guarantee.

## Preferences UI assignment

Coordinator owns new `src/domain/reminder-contracts.ts`, routes/services/SQL, navigation/config/dependencies and shared tracking. The assigned UI worker owns only `src/features/reminders/preferences/` and `docs/handoffs/SK-009-preferences-ui.md`; no API, database, runtime, service-worker, dependency or shared-file edits. Each worker uses its separate named branch/worktree and never reverts others.

`ReminderPreferenceView` is `{ journeyId: Id; journeyTitle: string; revision: number; preferences: ReminderPreferences; preview: ReminderPreviewItem[]; activeDeviceCount: number; simulated: boolean }`. `ReminderPreviewItem` is `{ sessionId: Id; practiceDate: string; timeZone: string; offsetMinutes: number; scheduledAt: string; expiresAt: string; suppressionReason: null | 'disabled' | 'completed' | 'superseded' | 'past' | 'quiet_hours' }`. Preview is server-generated, limited to the next eight non-superseded sessions plus the most recently opened session; total coverage wording must not imply every session is listed.

Export `ReminderPreferencesForm({ initial, onSave })`, with `initial: ReminderPreferenceView` and `onSave(input: MutationEnvelope<ReminderPreferences>): Promise<ReminderPreferenceView>`. The coordinator's client wrapper performs PUT `/api/journeys/:id/reminders` with existing authenticated API conventions. baseRevision is reminder revision, and operationId is stable across retries of the exact unchanged input. New edits require a new operation ID. 409 response uses the existing ApiError shape and authorized current ReminderPreferenceView; keep local edits and offer explicit latest-values review/reload, never overwrite them silently.

Form: explicit Enable reminders control; add/remove up to eight minute-before inputs, zero means at practice time; optional15-minute preset is a user click only; optional quiet-hours pair; explicit detailed notification opt-in with lock-screen privacy explanation. No prescribed practice or time. Save validates through the shared schema, preserves input after failure and disables duplicate submission. Render server preview with full date/time in its timezone, skipped/suppressed reasons and incomplete/disabled/device-unregistered states. Permission request/device registration is a different component, not automatic in this form. Show simulated transport labeling when indicated; zero registered devices means no device can receive alerts. Fields use current form/card styles, accessible names and status/error announcements, primary controls44px and320px reflow.

UI acceptance: toggling disabled/empty/duplicate/range/quiet-hour errors is clear; successful save updates revision and preview; failed save preserves local text and retry identity; conflict preserves edited values until explicit choice. Static verification in the isolated worktree, integrated actual Playwright under @M4-reminders after coordinator routes exist. No mocked result may be presented as actual server persistence.

## Remaining coordinator contract checkpoint

Subscription/job/worker SQL and transport signatures are under independent read-only review. SK-010 and SK-011 runtime assignments wait until those exact interfaces are committed. Planned slot2 resources are not running yet; keep root slot1 and its in-progress UI tests untouched. Do not infer operational readiness from the pure domain or UI preparation.
