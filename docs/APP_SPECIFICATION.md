# Sankalpa — Full Application Specification

Version 1.1 · 5 September 2026 · Status: ready for implementation planning

## 1. Purpose and product promise

Sankalpa is a private online companion for a spiritual commitment: decide what to practice, arrive at the intended time, record completion, see the journey unfold, and preserve daily reflections.

The experience should resemble a quiet personal sacred space. Spiritual character must come from considered typography, warm light, restrained sacred motifs, meaningful language, and optional sound—not visual clutter or competitive habit mechanics. The app records what the practitioner reports; it does not judge spiritual merit or decide whether a vow remains religiously valid.

Optional example template: “For 21 nights, I intend to recite Kunjika and Bhairav Stotra at midnight. Remind me from 10 PM, let me mark each practice complete, and help me reflect afterward.” Names and wording are user editable; no particular text, recension, chant count, or ritual method is presumed.

### Success criteria

- A user can create this exact journey in a short guided setup.
- Each user defines their own required practices; all required items must meet their chosen targets before a session becomes complete.
- For the two-item example, completion requires at most three taps from an open session: two practice checks and confirmation. Other checklists scale to the user’s selected practices.
- Midnight never creates a duplicate session or assigns completion to the wrong night.
- Home, calendar, journey details, and PDF use the same completion records and totals.
- The user can understand reminder permission, sending failures, and unavailable delivery evidence.
- Reflections remain private and can be exported with readable multilingual text.
- The interface feels peaceful, works on a small phone, and remains usable with sound and motion disabled.

## 2. Audience, scope, and assumptions

Primary audience: an individual maintaining a time-bound spiritual practice at home. Launch supports private accounts, multiple saved journeys, and one or more active journeys; no public profiles or sharing feed.

The following settings belong only to the optional midnight example template. A new custom journey starts without prescribed stotras, duration, or time; timezone is suggested from the device and explicitly confirmed:

| Setting | Default |
|---|---|
| Journey name | 21-night Sankalpa |
| Practices | Kunjika; Bhairav Stotra |
| Duration | 21 consecutive scheduled nights |
| Practice timezone | Asia/Kolkata, confirmed by the user |
| Schedule | Every night, midnight following the selected evening date |
| Completion window | Midnight to 04:00 in the journey timezone |
| Reminder preview | 22:00, 23:30, 23:55 on the evening date; 00:00 the next date |
| Reminders | Off until the user enables them and grants permission |
| Audio | Off until the user presses Play |
| Notes | Optional, private |
| Missed-session policy | Preserve the fixed 21-night schedule; never restart automatically |

### Personalization is the foundation

Every account owns independent journeys, practices, schedules, reminders, notes, and theme choices. No stotra, deity, duration, timezone, practice time, or alert sequence is hard-coded. Users may begin with a blank journey or copy an editable example template. Templates never create shared records or transmit preferences between users.

| User choice | Launch behavior |
|---|---|
| Spiritual intention | Free-text title/intention; no required deity or tradition field |
| Practice content | Any custom name or list, including stotra, japa, meditation, prayer, or reading |
| Completion target | Simple done/not-done, repetitions, or minutes; self-reported without mandatory timers |
| Duration | A fixed calendar-day span OR a fixed number of scheduled occurrences |
| Recurrence | Every day or selected weekdays |
| Time | Any user-selected local time, with an explicit timezone |
| Date meaning | Civil date by default; optional previous-evening attribution for overnight practice |
| Allowed window | User-selected opening time and positive completion duration, previewed with actual dates |
| Reminders | None, or custom advance offsets including the scheduled start; no universal 10 PM alerts |
| Experience | Chosen theme, motif visibility, optional soundscape, volume, and reflection prompts |

A journey has one recurring session time at launch. Multiple practices performed together share its checklist. For independent morning and evening practice schedules, create separate journeys; multiple daily slots inside one journey are deferred. This limitation must be clear during setup.

Duration rules: calendar-span mode includes matching recurrence dates from start through start + N − 1 days; occurrence-count mode generates exactly N matching dates and calculates the end date. Reject a calendar span containing no occurrences. Progress denominator is generated sessions, not elapsed days. Weekdays refer to the chosen practice date; unscheduled dates neither count as missed nor break consistency. Overlapping schedules in different journeys are allowed, with a preview warning rather than forced merging.

Minutes/repetitions require a positive target. A checkbox has a boolean value. All required targets must be met before confirming the session. Exceeding a target does not create extra completion credit. Snapshot practice definitions by schedule version so a later renamed stotra cannot rewrite past records.

### Launch scope

Account and preferences; fully personalized journey setup; session checklist; progress; calendar and accessible list; configurable push reminders; notification history; daily reflections; PDF summary; optional soundscapes; mobile installation guidance; offline check-ins with explicit sync state; journey archive and account deletion.

### Later scope

Native mobile app, device-local scheduled reminders, calendar subscription/export, pause-and-extend schedules, chant counters, user audio uploads, verified text libraries, multilingual interface, and opt-in email reminders.

### Excluded

Social rankings, streak competitions, paid spiritual services, automatic religious advice, AI interpretation of private reflections, guaranteed exact-time alarms, health claims, and compulsory location or microphone access. No sacred text or recording is distributed without a verified source and appropriate rights.

## 3. Information architecture and navigation

Mobile bottom navigation: Today, Journey, Calendar, Journal. A bell in the header opens reminder history; a profile control opens settings. Desktop uses a narrow left rail and the same destinations. Sound controls remain accessible during practice without covering the primary action.

Suggested routes:

| Route | Purpose |
|---|---|
| `/welcome` | Explain the product and sign in |
| `/setup` | Create the first journey |
| `/today` | Current or upcoming session and journey progress |
| `/journeys` | Active and archived journeys |
| `/journeys/:id` | Intention, progress, schedule, session list, export |
| `/journeys/:id/sessions/:sessionId` | Checklist and reflection for one scheduled night |
| `/calendar` | Month view and chronological list |
| `/journal` | Search/filter private reflections |
| `/notifications` | Reminder history and missed-session events |
| `/settings` | Timezone, privacy, audio, appearance, devices, account |

Every private route requires authentication and ownership checks. Links from notifications open the precise session after sign-in if necessary.

## 4. Core user journeys and screens

### 4.1 Welcome and onboarding

Show a restrained light motif, the phrase “A quiet space for your daily practice,” and a clear start button. Explain private storage in ordinary language. Use managed email-link sign-in; provide expiry, resend, and invalid-link states. Do not request notifications or play audio on arrival.

Setup steps:

1. Write a title and optional personal intention.
2. Add any ordered practices with custom names: stotra, mantra/japa, meditation, prayer, reading, or another personal practice. Choose a checkbox, count target, or minutes target. Template values are suggestions only.
3. Choose start date, duration mode, recurrence (daily or selected weekdays), practice time, timezone, allowed completion window, and calendar-date attribution. Preview generated sessions before activation.
4. Preview all reminder times; choose a preset or edit individual times, then enable reminders through an explicit action.
5. Choose appearance and optional soundscape, with a user-initiated preview.
6. Review a plain-language summary including first and last actual practice timestamps. Activate the journey.

For a start date of 5 September 2026 and 21 nights, show: “First practice: 6 September at 00:00. Final practice: 26 September at 00:00. Calendar nights: 5–25 September.”

Reject zero/negative duration, empty practice lists, invalid windows, duplicate reminder offsets, and reminder times beyond the session deadline. Allow 1–365 calendar days or scheduled occurrences, and 1–20 practices per journey as launch product limits. If some reminder times have already passed, show that those reminders will be skipped; do not send a burst of historical alerts.

### 4.2 Today — the personal practice space

Main elements, in order:

- Quiet greeting and selected journey title.
- “Session 7 of 21” plus the practice date and actual time; use “Night” only for an explicitly chosen overnight journey.
- Circular journey progress with a text equivalent, such as “6 of 21 complete · 29%.”
- Upcoming countdown or current session status.
- One primary action: “Open practice,” “Continue practice,” or “View reflection.”
- Small calendar strip and a compact reflection preview when present.
- Reminder readiness: enabled, permission needed, unavailable, or device not registered.

If several journeys are active, use a clear selector and small upcoming-session list. Never silently switch the journey while a checklist is open.

Empty state invites a new journey. Loading uses stable placeholders. Offline state shows cached information with a “Last synced” time. On failure, retain visible saved information and offer retry.

### 4.3 Practice session

Show the intention, actual date/time, session label, and the user-defined practice checklist. Optional counts use plain numeric inputs or step controls; a timer is optional and never determines whether the practice happened.

Before the window opens, offer preparation and audio, with the completion action disabled and a clear opening time. During the window, each item may be saved independently. “Complete this session” requires all required items to meet their targets. A deliberate confirmation stores the complete session atomically and opens an optional reflection prompt.

After completion, display a soft static glow or a brief reduced-motion-aware transition: “Your practice is recorded.” Offer “Add reflection” and “Done.” No fireworks, urgent share prompt, or spiritual reward claim.

The user may undo or correct an entry. Keep an edit history and recompute totals. A correction must never regenerate reminders whose send times are already past.

### 4.4 Journey details

Show intention, schedule, practices, complete/partial/missed totals, completion percentage, current and longest consistency streak, and a chronological timeline. Explain that the streak measures records, not devotion. Let the user hide streaks.

Editing a title, intention, reminder preference, or appearance is allowed. Users can change practices, recurrence, time, window, or timezone for future unopened sessions through a preview showing the effective practice date and revised schedule. Create a schedule version, preserve all opened/historical sessions and their original practice definitions, and atomically replace future reminder jobs. Started sessions cannot be removed by a schedule edit. Duration changes likewise apply only to the future; reject removal of opened sessions. Archiving cancels future reminders without deleting history.

When the final window closes, the journey is “Ended” even if some sessions remain incomplete. “Fully completed” applies only when all scheduled sessions are recorded complete. Historical corrections can update this result. Never add extra nights or restart the vow automatically.

### 4.5 Calendar

Month grid uses each journey’s chosen practice-date convention. Default is the civil date of the scheduled start. For an explicit overnight journey, show “Nights are shown on the date the evening begins.” Cell states use an icon and text/accessibility label as well as color: upcoming, open, complete, partial, missed. A separate badge marks late practice or later-entered records.

Selecting a cell opens its session, actual timestamp, checklist, reflection, and related reminder events. Show multiple journeys as separate labeled entries. Include Today, month navigation, journey filter, and a list alternative for screen readers and narrow screens.

Do not render an unstarted future session as missed. Offline status should identify an unconfirmed local change instead of pretending the server has accepted it.

### 4.6 Journal and reflection editor

One reflection per scheduled session, editable later, with optional free text and optional simple mood tags: peaceful, focused, distracted, grateful, tired, or user-defined. Optional prompts: “What did you notice?” and “What would you like to carry into tomorrow?”

Allow notes even on partial or missed nights. No minimum length. Plain text with paragraphs is sufficient for launch; maximum 20,000 characters per reflection. Autosave after a short idle period and on blur; show “Saving,” “Saved,” “Saved on this device,” or “Couldn’t save.” Closing or navigating with an unsaved edit must not silently lose it.

Journal supports journey/date filtering and private text search. Search only the authenticated user’s data; do not index notes in a public search service. Conflicting edits from two devices require a comparison/recovery view rather than silent overwrite.

### 4.7 PDF export

Export from Journey or Journal. Choose journey, date range, and whether to include intention, statistics, practice checklist, timestamps, reflections, and mood tags. All sharing is a separate user action after download.

PDF structure: restrained cover with title and period; schedule/timezone and statistics; chronological daily entries including partial/missed dates; optional closing reflection; generation date and page numbers. Blank reflections say “No reflection recorded” when that night is included. Export records exactly as written; do not generate invented summaries or spiritual interpretations.

Use a light, ink-friendly design independent of the dark app theme. Render Devanagari and English correctly, embed licensed fonts, preserve paragraphs, wrap long words/URLs, and avoid splitting headings from their content. Escape all user text before HTML/PDF rendering. No network access to user-provided URLs during rendering.

Launch should generate the download on demand, with no permanent public file URL. Show preparation, success, empty-selection, and retry states. Use a snapshot so displayed totals agree with the included records even if another device makes a concurrent edit. Proposed filename: `Sankalpa_2026-09-05_to_2026-09-25.pdf`.

## 5. Midnight, time, and completion rules

### 5.1 One scheduled occurrence, one session

Each session has a stable ID, ordinal occurrence, user-defined `practice_date`, journey timezone, UTC opening timestamp, and UTC closing timestamp. Calendar identity never comes from the device’s current date or the time a button was clicked.

For the reference schedule:

| Event | Asia/Kolkata local timestamp |
|---|---|
| Night 1 calendar identity | 5 September 2026 |
| First preparation reminder | 5 September, 22:00 |
| Practice opens | 6 September, 00:00 |
| Practice window closes | 6 September, 04:00 |
| Night 2 calendar identity | 6 September 2026 |
| Night 2 practice opens | 7 September, 00:00 |

Every completion interval includes opening and excludes closing. In the midnight example this is `[00:00, 04:00)`. During 22:00–23:59 the dashboard previews the coming midnight session. During 00:00–03:59 it keeps the prior evening’s session active. At 04:00 it closes that session and shows the next scheduled practice, while keeping the previous session easily accessible.

By default, any time—including 00:00 or 06:00—belongs to its civil date. Only an explicitly selected overnight mode places the scheduled start on the day after its practice date. Never infer overnight mode from an early-morning time. For example, morning prayer on 5 September at 06:00 belongs to 5 September; the optional midnight template explicitly associates 6 September at 00:00 with the night of 5 September. Store the resolved timestamps when generating the schedule; display them during review. Windows must be positive, shorter than 24 hours, and must not overlap the next session.

Future revision rules: keep the original start date for calendar-span duration and count all retained historical sessions toward occurrence-count duration. Regenerate unopened sessions from the selected effective practice date using the remaining allowance, retain stable IDs for historical sessions, and cancel superseded unopened sessions/jobs transactionally. Canceled superseded sessions are excluded from progress and calendars. A scheduled reminder already sent remains in history even if its future session is replaced. Reject revisions that cannot produce the requested remaining count within launch limits. Calendar and weekday labels always follow the practice-date convention selected for that schedule version.

### 5.2 Status model

- Upcoming: opening has not arrived.
- Open: within the window, with no completed practice item.
- Partial: at least one required item completed but the full checklist has not been confirmed; show whether the window is still open or closed.
- Complete: full checklist confirmed, with reported practice time and recorded time retained.
- Missed: window closed without any required item complete.

Derive time-based status from the stored timestamps and item records, not from whether a background status job happened to run. Finishing only Kunjika leaves the night partial and does not increment completed-night progress.

### 5.3 Historical entries and late practice

After the window, “Update this night” asks for the actual practice time and separates “I practiced during the window but am logging now” from “I practiced later.” Store `performed_at`, server `recorded_at`, and an amendment marker. The record is a user report, not externally verified attendance.

A fully completed late practice counts toward recorded completion but carries a “Practiced late” badge and does not count toward the on-schedule streak. An in-window practice entered later counts toward the streak after sync, labeled “Recorded later.” Preserve prior missed/partial events in history and add the correction; do not erase the chronology.

### 5.4 Metrics

- Progress = complete sessions / scheduled sessions × 100, rounded to a whole percentage for display; retain exact counts. Example: 7/21 = 33%.
- Partial sessions do not fractionally count toward the progress ring.
- On-schedule consistency = fully completed in-window sessions / sessions whose windows have closed. Exclude future and still-open sessions from both sides; show an em dash when the denominator is zero.
- Current streak = consecutive on-schedule complete sessions ending with the latest eligible session. An open uncompleted session does not break a streak until its deadline. A completed open session can extend it.
- Longest streak = longest sequence of on-schedule complete sessions across the journey.
- Closed partial or missed sessions break the streak. Historical corrections recompute it.

### 5.5 Timezones and clock changes

Journey timezone remains fixed when the user travels unless they explicitly revise the future schedule. Show a secondary device-local time if different. Use IANA timezone identifiers and a timezone-aware implementation; adding 24 hours in UTC is not a general calendar recurrence algorithm.

For supported daylight-saving zones, resolve a nonexistent scheduled local time to the first valid instant after the gap; resolve a repeated time to its first occurrence. Show adjusted sessions in setup review. Apply the same policy to window bounds and verify positive, nonoverlapping windows. Reminder offsets use elapsed minutes before the resolved opening instant. Tests must include both clock-change directions even though Asia/Kolkata currently has no such transition.

## 6. Reminders and notification history

### 6.1 Schedule and control

Store user-selected reminder offsets relative to session opening. Offer 15 minutes before as an optional simple preset; the midnight example offers −120, −30, −5, and 0 minutes. No preset is activated without user choice. The setup preview should make the frequency explicit. Reminder preferences are per journey; notification permission and subscriptions are per device.

Messages interpolate the actual user-selected time and remaining interval; they must never hard-code midnight. Example messages for the optional midnight template, using a privacy-preserving default:

- 22:00: “Your practice is scheduled for midnight. Take a moment to prepare.”
- 23:30: “Your practice begins in 30 minutes.”
- 23:55: “Your practice begins in 5 minutes.”
- 00:00: “It is time for your practice.”

Specific practice names may appear only if the user opts into detailed lock-screen messages. Reflections never appear in push payloads.

No repeated escalation after the scheduled start by default. “Remind me in 10 minutes” is available in-app; it replaces other pending reminders within that ten-minute interval and cannot schedule beyond the deadline. Completion, ending a journey, disabling reminders, or deleting an account cancels pending sends. Check current state again immediately before dispatch. A notification already handed to the device may still appear; opening it should show the actual completed state.

Optional quiet hours are off by default for this midnight use case. If enabled and overlapping, quiet hours win: suppress the affected reminders and show that conflict in settings and preview. Do not shift them into an unrelated time or treat silence as a delivery failure.

### 6.2 Delivery design

Use a server-side scheduler and durable database jobs; never rely on an open browser tab or long JavaScript timer. A worker checks due jobs at least every minute, claims each with a lease, revalidates session/preferences, and sends through Web Push. Production deployment must support that scheduler frequency.

Retry transient errors up to three attempts within five minutes of the intended reminder time. Stop at the session deadline, completion, cancellation, or expiry. After an outage, mark older reminders expired rather than sending a backlog. Remove invalid/expired subscriptions after terminal provider responses and prompt the user to register that device again.

Unique job key: session + schedule revision + reminder offset + device subscription. Application retries must not create extra jobs. Network uncertainty can still produce duplicate external delivery; use a stable notification tag per session/device to reduce duplicates and do not promise exactly-once delivery.

Operational target: under normal service conditions, 95% of reminder dispatch attempts start within 60 seconds of their intended time. This measures server dispatch, not phone display. Track lateness, retry counts, and invalid subscriptions without storing notes or spiritual intentions in operational logs.

### 6.3 Honest notification history

History includes timestamp, scheduled timestamp, associated night, type, device, safe message preview, status, and available failure reason. Filters: all, reminders, missed/partial sessions, errors. “Read in the history page” is distinct from “opened from a notification.”

Supported transport states: scheduled, processing, accepted by push service, failed, expired, suppressed, canceled, and opened. An accepted push request does not prove display, delivery, or reading; show “Sent to push service; display not confirmed.” Only show opened if an actual notification-click event is received. Do not infer dismissal or “ignored” status.

When a window closes incomplete, add one idempotent “No completion recorded” or “Partially recorded” event, independent of reminder success. The missed-session event belongs in the history without forcing another overnight alert. Later corrections append a linked update. History is paginated and retained while the account exists in launch; deleting a journey removes its content-bearing history and reminders.

### 6.4 Platform constraints and fallback experience

Web Push can notify while the app is not open, using a supported browser and service worker [S1]. Apple documents push for Home Screen web apps on supported iOS/iPadOS versions; onboarding must detect the environment and guide installation where required [S2, S3]. Permission requests must follow an explicit user action.

HTTPS, permission, a valid subscription, connectivity, and platform behavior affect notifications. Focus/Do Not Disturb and OS controls may suppress or delay them. In-app history remains available when permission is denied, but it is not a background alarm. Offer a test notification and clear troubleshooting without claiming success merely because sending succeeded. A user who requires a dependable audible wake-up should also set a device alarm; a native app with local scheduling is a later product option requiring its own platform verification.

## 7. Spiritual visual and audio design

### Visual direction: Personal Sanctuary

Offer Midnight Sanctuary (deep indigo), Dawn (warm cream and muted saffron), and Forest (soft green and neutral stone). Appearance is chosen per user, independent of practice time or deity. The default preview uses a deep indigo canvas, warm parchment text, muted brass details, and small amber illumination around the current practice. A sparse line mandala or lamp-like light motif can frame progress; keep the checklist and dates immediately readable. Avoid arbitrary sacred diagrams or deity images used as decoration. Provide a simple motif-free option.

Proposed design tokens, to be contrast-tested during implementation:

| Role | Color |
|---|---|
| Midnight canvas | `#111322` |
| Raised surface | `#1C2033` |
| Main text | `#F5EEDF` |
| Secondary text | `#BFC0CE` |
| Brass accent | `#D5B475` |
| Completed accent | `#98BEAC` |
| Partial accent | `#D6AD73` |
| Missed accent | `#BD9AA0` |
| Light-mode canvas | `#F6F0E5` |
| Light-mode text | `#292635` |

Use an elegant readable serif for headings and a clean sans serif for controls. Proposed families: Noto Serif, Noto Sans, and Noto Sans Devanagari where needed; confirm licenses and self-host chosen subsets. Body text at least 16 px, comfortable line height, and no decorative font for timestamps or controls.

Spacing follows a small consistent scale; generous breathing room around the intention. Rounded cards are restrained. Progress appears as a ring and explicit count, with a journey trail sized to the generated session count on the details screen. Use grouped/scrollable segments for long journeys; 21 points apply only to the example.

Animation is brief and optional: subtle completion illumination and gentle screen transitions. No continuous pulsing, strobing, or simulated ritual activity. Respect reduced motion. Sound and animation are independent controls.

### Soundscapes

Launch library: soft rain, flowing water, and a gentle ambient drone, plus silence. Use licensed or original audio with source/rights metadata. Do not label generic ambient sound as an authentic sacred recording.

Controls: Play/Pause, track, volume, mute, and optional stop after 15/30/60 minutes. Default volume is low. Only start on user interaction; browsers restrict autoplay [S4]. Loop smoothly, use a short fade when changing tracks, and stop when the user requests it. Playback failure must not block check-in. Do not promise uninterrupted background or lock-screen playback across mobile browsers; treat that as a device test outcome.

Never start audio from a push notification. Avoid competing sounds during chanting; offer “Stop sound when practice begins.” Download/offline audio is deferred; the app should show when the chosen sound requires connectivity.

### Accessibility and content tone

Target WCAG 2.2 AA: test contrast, keyboard navigation, focus visibility, screen-reader labels, zoom/reflow, and target sizing [S5]. Use at least 44×44 CSS-pixel primary touch targets as a product standard. Status must never rely on color, sound, or animation alone. Announce saved completion and errors without repeatedly announcing countdown seconds.

Use warm, factual language: “No completion recorded for this night” and “You can update this entry.” Avoid “You failed,” guilt-based reminders, claims of divine approval, or a presumption that missed nights invalidate a tradition. Users define their practice and any religious rules with their own guidance.

## 8. Technical architecture

### Proposed implementation

Mobile-first TypeScript web app using React/Next.js, a standards-based PWA manifest and service worker, managed authentication, PostgreSQL, and a separately runnable reminder worker. Supabase is a candidate for managed authentication/database; select hosting after confirming worker/scheduler support, backup policy, regional availability, and cost. These are architecture proposals, not installed or version-verified dependencies.

Use one codebase and shared domain functions for schedule generation, progress calculations, and validation. Keep reminder dispatch outside request-bound page execution. A database job table is enough for launch; a separate queue service is unnecessary until measured scale justifies it.

Browser → authenticated application API → PostgreSQL.

Scheduled worker → due reminder jobs → Web Push service → device service worker → session deep link.

PDF renderer → authorized snapshot of journey/reflections → private download.

Prefer browser-local PDF generation if the selected library handles required scripts, layout, and accessibility. Otherwise use a restricted authenticated server renderer with ephemeral storage; record the choice before building the export milestone. The user-facing requirement is a downloadable PDF, not merely an instruction to print a page.

### Data model

| Entity | Essential fields and invariants |
|---|---|
| Profile | auth user ID, display name optional, default timezone, locale, theme, audio preferences |
| Journey | owner ID, title, intention, start practice date, duration mode/value, state, active schedule version, created/ended timestamps |
| ScheduleVersion | journey ID, effective practice date, timezone, local time/window, recurrence weekdays, date-attribution mode, revision; preserve historical versions |
| Practice | journey/schedule-version IDs, custom label, kind, target value/unit (checkbox, repetitions, minutes), display order; at least one required practice |
| Session | journey ID, schedule-version ID, ordinal, practice date, opening/closing UTC, confirmed completion, performed_at, recorded_at, revision; unique journey + ordinal and journey + practice date |
| SessionPractice | session ID, practice-version ID, recorded value/unit, updated_at; unique session + practice-version; practice must belong to the session’s journey and schedule version |
| Reflection | session ID, owner ID, text, mood tags, revision, timestamps; unique session; owner derived from authenticated journey |
| ReminderPreference | journey ID, enabled, offsets, quiet hours, privacy choice, revision |
| PushSubscription | owner ID, endpoint/key material, device label, enabled, last result; endpoint uniqueness; protect as sensitive delivery data |
| ReminderJob | session ID, subscription ID, offset, revision, scheduled_at, expiry, state, attempts, lease; unique deduplication key |
| NotificationEvent | owner/session/job IDs as relevant, event type, state, timestamps, safe details; immutable event entries |
| SessionAmendment | session ID, actor ID, change type, prior/new status metadata, timestamp; do not duplicate reflection text |
| Soundscape | title, asset path, duration, attribution/license, version |

All ownership relations are checked server-side and in database policies where available. Enforce foreign keys and count constraints. Derive totals from canonical session data; cached summaries must be invalidated transactionally or regenerated.

### API contract outline

Use authenticated, same-origin routes. Never trust an owner ID from the client. Use consistent validation errors and avoid exposing whether another user’s record exists.

| Operation | Contract |
|---|---|
| Create journey | `POST /api/journeys`; validates and returns schedule preview/draft |
| Activate journey | `POST /api/journeys/:id/activate`; atomically persists sessions and applicable reminder jobs; idempotency key |
| Get progress/sessions | `GET /api/journeys/:id`; supports bounded session/date queries |
| Save checklist | `PUT /api/sessions/:id/practices`; revision checked; cannot edit a different journey’s practice |
| Confirm/correct completion | `POST /api/sessions/:id/completion`; atomic validation, idempotency key, performed time, cancellation of pending reminders |
| Undo completion | `DELETE /api/sessions/:id/completion`; revision checked and amendment recorded |
| Save reflection | `PUT /api/sessions/:id/reflection`; revision checked; return conflict without dropping either draft |
| Revise future schedule | `POST /api/journeys/:id/schedule-revisions`; preview required, optimistic revision check, preserve opened sessions and their practices, regenerate only future sessions/jobs atomically |
| Change reminders | `PUT /api/journeys/:id/reminders`; increment revision, cancel obsolete jobs, generate future ones |
| Register/remove device | `POST` / `DELETE /api/push-subscriptions`; user-bound validation |
| Read history | `GET /api/notifications`; cursor pagination and filters |
| Export | authorized snapshot endpoint, or `POST /api/exports` if server rendered; validate dates and selected fields |
| Archive/delete journey | explicit operations; archive retains records, delete removes associated content |
| Delete account | reauthentication and clear confirmation; revoke subscriptions and remove owned data |

Return 401 for unauthenticated calls, 404 for missing/inaccessible objects, 409 for version conflicts, 422 for validation errors, and 429 for rate limits. Include a safe correlation ID for unexpected errors, without logging reflection bodies.

## 9. Offline, privacy, and operational behavior

Cache the application shell and minimal authorized recent-session data. Use IndexedDB for queued checklist changes and drafts, with a visible pending count. Browser-local data is not promised to be encrypted or recoverable after browser storage is cleared. Provide an option to disable local private-data storage on shared devices.

Queue mutations with a client-generated idempotency key and base revision. Retry on reconnect and on reopening the app; do not rely solely on background sync support. Replaying completion cannot increase totals twice. Two-device checklist/reflection conflicts require a recoverable resolution state. Local completion before sync cannot cancel a server reminder yet; show “Saved on this device; reminders may continue until synced.” Server records the sync time separately from the reported practice time.

Logout clears private local caches, drafts, and queued mutations after warning about unsynced edits; it must never leak a previous account’s cached records to the next login. Push permission is browser-level, so unregister the account’s subscription independently.

Private spiritual notes are sensitive. Require TLS, managed secure sessions, per-user access policies, least-privilege worker credentials, escaped text rendering, and request validation. No public object storage for exports and no notes in analytics, error reports, or push payloads. Do not claim end-to-end encryption unless separately designed and verified.

For subscription registration, validate HTTPS push endpoints and reject local/private network targets; dispatch must defend against SSRF and redirect abuse. Keep push keys and administrative credentials server-side. Apply rate limits to sign-in, device registration, test notification, export, and write endpoints.

Account deletion immediately revokes access and pending sends, removes primary owned data within 24 hours, and expires backup copies within a proposed maximum of 30 days. Choose infrastructure that can meet this policy and disclose actual retention before launch. Restore procedures must honor deletion records. Retain only minimal operational metadata where needed, with a documented retention period. Provide export before deletion without making it mandatory.

No advertising or third-party behavioral analytics in launch. Operational metrics cover availability, scheduler lag, error counts, and job processing. Suggested launch targets: usable Today screen within 2.5 seconds on a representative mid-range phone connection; completion feedback within 200 ms locally; 21-night PDF within 10 seconds in the tested reference environment. These are targets to measure, not completed benchmarks.

## 10. Acceptance and release checklist

| ID | Scenario and expected result |
|---|---|
| A01 | Create the reference journey starting 5 September: exactly 21 sessions; first opens 6 September 00:00 and last 26 September 00:00 in Asia/Kolkata. |
| A02 | First-night reminders resolve to 5 September 22:00, 23:30, 23:55 and 6 September 00:00. |
| A03 | At 00:15 on 6 September, completing the session changes the 5 September calendar cell only. |
| A04 | Completing only one practice yields partial status and zero additional complete nights. |
| A05 | Seven complete nights out of 21 show 7/21 and 33% on every screen and export. |
| A06 | Double taps, request retries, and offline replay create one completion and one set of amendments. |
| A07 | At exactly 04:00, empty sessions become missed and incomplete checklists remain partial; each produces one closure event. |
| A08 | An in-window practice recorded later and an out-of-window practice receive different labels and streak treatment. |
| A09 | Completion cancels future pending reminders; a worker/completion race is revalidated and any already-dispatched message opens the completed state. |
| A10 | Restarting the worker and retrying failed requests do not regenerate jobs; reminders older than their expiry are not sent. |
| A11 | Denied permission, unsupported environment, stale subscription, offline device, and Focus mode do not yield false “delivered” claims. |
| A12 | A real supported iPhone Home Screen installation and Android installation receive a test push while the app is closed, subject to device settings; document actual devices and versions. |
| A13 | Changing the device timezone leaves session identity unchanged; spring/fall clock transitions resolve once with a valid window. |
| A14 | Calendar, list, journal, and PDF agree after undo, late entry, and historical correction. |
| A15 | Offline edits survive a reload where storage is available, show pending status, sync once, and expose conflicts without silent loss. |
| A16 | One user cannot query, mutate, export, or subscribe to another user’s journey, including guessed IDs and altered nested IDs. |
| A17 | PDF handles English/Devanagari, 21 long reflections, empty dates, page breaks, and hostile HTML text; the download opens in common PDF viewers. |
| A18 | Keyboard and screen-reader users can create and complete a journey; contrast, zoom, reduced motion, and 320 px width are checked. |
| A19 | Sound stays off until Play; mute, timer, missing audio, and interrupted playback leave the tracker usable. |
| A20 | Archiving stops reminders and retains history; deletion removes owned content and subscriptions; logout clears private caches safely. |
| A21 | Quiet hours suppress conflicting reminders with a visible reason; snooze stays within the deadline and does not create overlapping alerts. |
| A22 | At journey end, 20/21 is “Ended · 20 recorded complete”; 21/21 is “Fully completed”; no automatic extra night is added. |

Additional personalization acceptance cases:

| ID | Scenario and expected result |
|---|---|
| A23 | A user creates a custom 40-day prayer at 06:00: no Kunjika/Bhairav items, midnight behavior, or 22:00 reminders are inserted. |
| A24 | Another user creates 12 Monday/Thursday meditation occurrences at 18:30: exactly 12 sessions, with a 20-minute self-reported target and a preview of the calculated end date. |
| A25 | A third user selects 30 calendar days and Tuesdays only: only Tuesdays in that span contribute to the denominator; all other dates are unscheduled. |
| A26 | Changing future practice names/time preserves past notes, timestamps, and checklist labels; obsolete pending jobs cannot send. |
| A27 | A 06:00 civil-date journey and an explicitly overnight midnight journey receive correct, different date attribution. |

Required verification: unit tests for schedule/status/metrics; database/API tests for ownership, atomicity, idempotency and revisions; worker tests with a fake clock and injected failures; browser tests for the main journey and offline states; actual-device push and audio tests; PDF extraction plus visual review; accessibility checks and manual keyboard navigation. Record outcomes and outstanding limitations before release.

## 11. Build boundaries and decisions before deployment

This document authorizes no paid service, deployment, message sending, or real reminder setup. It specifies the requested app. Implementation can start with a local development environment and simulated notification transport; label simulations clearly.

Before production, settle: hosting and database provider/budget, supported browser/device matrix, verified software versions, email sign-in transport, PDF rendering choice, audio/font rights, and the actual retention/backups policy. These choices do not block creating the specification. All practice names and schedules are user specific, editable during setup and versioned for future changes.

## 12. Official reference material

Sources checked on 5 September 2026. Verify compatibility again during implementation.

- [S1 — MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API): server push and service-worker handling when the application is not foregrounded.
- [S2 — Apple: Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers): Apple platform support and integration requirements.
- [S3 — WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): Home Screen installation and user-triggered permission request.
- [S4 — MDN: Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay): user activation and playback restrictions.
- [S5 — W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/): accessibility requirements used as a release target.
