# Sankalpa — Implementation Plan

Status: planned, not implemented. Follow APP_SPECIFICATION.md for exact behavior.

## 1. Foundation and visual shell

Verify supported framework/runtime versions and establish a lockfile. Build responsive navigation, personalizable sanctuary theme tokens, accessible controls, and static Today/session/calendar/journal states. Use labeled sample data. Verify small-screen layout, keyboard access, contrast, and reduced motion.

Exit: the full reference journey can be navigated as a prototype, with no implication that sample check-ins or reminders are real.

## 2. Account, data, and schedule engine

Implement managed authentication, ownership policies, journey setup, versioned user-defined schedules, session generation, and shared metric functions. Add tests for the custom morning/weekday journeys, duration modes, future revisions, the 21-night example, midnight, deadline boundaries, and daylight-saving transitions.

Exit: authenticated users can create and retrieve their own correctly dated journey; cross-account reads and writes fail.

## 3. Tracking, calendar, and private journal

Implement per-practice records, atomic completion, undo/amendments, calendar, progress, streaks, reflection autosave, and revision conflicts. Add minimal offline storage/queue with visible pending state and account-switch cleanup.

Exit: completing and correcting a night updates all relevant views consistently; retries and offline replay cannot duplicate completion or lose conflicts.

## 4. Reminder service and history

Implement device permission flow, Web Push subscriptions, durable reminder jobs, worker leases, expiry/retries, cancellation, quiet hours, and history events. Use a fake transport for development. Validate on actual supported devices with explicit test notification actions before calling delivery functional.

Exit: the four reference reminders are scheduled correctly; missed events are recorded independently; history distinguishes push-service acceptance from user opening.

## 5. Audio and PDF

Select and document licensed sound/font assets. Add user-controlled audio and stop timers. Resolve PDF rendering approach with a Devanagari proof of concept; implement date/field selection, snapshot consistency, readable pagination, and private downloads.

Exit: a 21-night sample with long English and Devanagari reflections produces a readable PDF; muted/audio-error states do not interrupt tracking.

## 6. Release validation and operations

Run the complete A01–A27 acceptance matrix. Validate privacy, deletion, backups, scheduler outages, subscription failures, accessibility, and representative performance. Document actual device/browser results and unresolved platform restrictions. Configure hosting and production credentials only under authorized deployment scope.

Exit: required checks pass with recorded evidence, or limitations are explicitly accepted; reminder monitoring and restore/deletion procedures are documented.

## Deferred work

Native app/local reminders, public calendar integration, pause-and-extend journeys, chant libraries, email reminders, and interface translations remain separate future features. Preserve launch focus until real usage identifies a need.
