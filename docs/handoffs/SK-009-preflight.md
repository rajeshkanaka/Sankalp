# SK-009 read-only reminder preflight

Verified 2026-09-06 by the offline-core worker against the integrated repository. This is a read-only design handoff: no SK-009 application work, dependency installation, service provisioning or task-status change occurred. [TASKS](../TASKS.md) remains authoritative. Coordinator owns reminder migrations, shared contracts and subsequent decisions; implementation remains gated on SK-008/M3 technical completion under the approved plan.

## Existing hooks and boundaries

- `src/domain/contracts.ts:18` defines `ReminderPreferences`: enabled, offsets, nullable quiet hours and detailed payload choice. `src/domain/validation.ts:52` validates eight unique signed offsets in -1440..0. This schema is currently private to journey validation; no standalone preference mutation/revision exists.
- `src/server/journeys/service.ts:106` rejects enabled reminders. Its draft preview already maps each actual session opening plus offset to an instant and `isPast`. `toJourney` reads reminders from the draft JSON. Future schedule revisions copy the current draft into a historical schedule definition. SK-009 must define one authoritative preference revision and reconcile these reads; avoid an independently mutable duplicate setting.
- `activateJourney` creates versions/practices/sessions in a transaction. `src/server/journeys/revisions.ts:333` supersedes only unopened future sessions, then creates replacements. Neither path currently inserts/cancels reminder jobs. `src/server/sessions/service.ts:173` confirms a session, but reminder cancellation does not yet exist. Add those hooks inside their existing transactions when real job tables arrive; rerun schedule-revision and correction regressions.
- No reminder preference table, subscription table, job table, worker pool/role, worker loop or push route exists at this checkpoint. `web-push`3.6.7 and its type declarations are selected by DECISIONS but are not yet dependencies in package.json/lockfile or installed node_modules. No install was performed during preflight.
- Existing rates in `202609060004_rate_limits.sql` cover sign-in and generic writes. Subscription changes ten/hour and explicit test-push one/minute/five/hour still need their approved database-backed counters.

## Locking, history and privilege requirements

`src/server/db/client.ts:21` verifies a restricted `app_api` connection, sets the authenticated subject transaction-locally, and acquires the account privacy shared advisory lock (`hashtextextended(owner,2)`). `src/server/db/operations.ts` then serializes an owner/operation receipt (`seed0`). `src/server/sessions/locking.ts` locks journey before session and captures one domain-clock value after locking. Schedule revision locks its journey then active sessions ordered by opening/id. Preserve that order for eligibility-changing operations. Job-only `FOR UPDATE SKIP LOCKED` claims must commit before account/journey/session revalidation; never hold a transaction while sending HTTP.

`202609060008_history_reflections.sql` already provides `app.notification_event`, with composite ownership foreign keys, immutable event insertion and unique partial indexes for closure per session and correction per amendment. `src/server/sessions/history.ts:69` writes `session_closed` with `occurred_at=closesAt`, an independently recorded insertion time, and the original status/revision. The worker sweeper must share this identity and maintain closure-before-correction ordering; it must not invent a second closure stream or rely on reminders being enabled.

Two concrete migration traps:

1. The event CHECK constraints currently permit only `session_closed`/`session_corrected`, with amendment nullability tied to those kinds. `app_api` currently has owner-scoped INSERT on the table. Simply expanding kinds would also let that role insert purported worker acceptance/failure facts. Keep the application role's insertion policy restricted to its allowed event kinds or replace it with narrow functions; worker facts must use worker-only privileges.
2. `history.ts:54` maps every non-closure event to `session_corrected`; `readSessionHistory` currently selects every event for the session. Adding push kinds therefore requires filtering this reader to its original two kinds or deliberately extending its type/UI. Preserve `SessionHistoryEvent` and the existing correction timeline unless that shared change is coordinated.

Follow the existing fixed-search-path SECURITY DEFINER pattern in `202609060004_rate_limits.sql:13`, including explicit session-user checks and revocations. Create a separate restricted worker login with narrowly granted claim/revalidate/settle/closure procedures; no `app_api` membership, BYPASSRLS, object ownership, arbitrary table access or reflection reads. Do not reuse `withUser` as a worker connection adapter.

## Contract checkpoint before SK-010/011

Freeze these concrete records/interfaces before assigning dependent workers:

- Versioned current preferences and preview results, including quiet-hour suppression reason and skipped past offsets.
- Account-owned subscription ID, generation, enabled/revoked state, validated device metadata and server-only endpoint/key material; five active devices per account.
- Job identity comprising session ID, schedule version, preference revision, subscription generation and offset/kind; distinct idempotent snooze request identity. Include intended/expiry times, state, attempts, retry time, lease token and lease expiry.
- Worker-only `claimJobs(now,limit)`, `revalidateJob(jobId,leaseToken,now)`, `settleJob(jobId,leaseToken,result)` plus closure sweep and heartbeat contract. Approved bounds: poll30seconds, claim50, concurrency4, lease60seconds, overall send10seconds, at most3attempts within5minutes and strictly before closing.
- `PushTransport.send` result discriminating accepted, terminal failure, transient failure and uncertain. Generic safe payload by default, stable per-session/device notification tag, canonical session deep link, and authenticated/deduplicated click report. History-read and click-open are separate facts.
- Owner-only paginated history/filter/read contracts. Keep accepted-by-service distinct from display/opened. Permission denial must not block practice or history. Local/CI transport remains visibly simulated.

The exact same job generation/cancellation policy must be used by activation, schedule changes, preference revisions, subscription replacement/revocation and completion. Revalidation also checks archive/deletion and quiet hours. A send already handed off before cancellation remains an honest race, not an exactly-once claim. Quiet-hour equal start/end and enabled-with-no-offset handling need an explicit conservative validation rule when SK-009 is written; the current schema permits both without defining their meaning.

## Verified transport capability and selected adapter path

Primary-source verification date: 2026-09-06.

- [web-push3.6.7 package](https://github.com/web-push-libs/web-push/blob/v3.6.7/package.json): published source version3.6.7, Node>=16.
- [Pinned send implementation](https://github.com/web-push-libs/web-push/blob/v3.6.7/src/web-push-lib.js): custom `https.Agent` is accepted and passed to `https.request`; proxy configuration overrides it. The send path makes one request and rejects non-2xx; it does not follow redirects. It exposes neither custom `lookup` nor AbortSignal directly as send options.
- [Pinned API documentation](https://github.com/web-push-libs/web-push/blob/v3.6.7/README.md#sendnotificationpushsubscription-payload-options): timeout is socket inactivity, not an overall response deadline. Slow trickling can exceed ten seconds. A Promise race alone would not cancel the underlying request.
- [Request-details API](https://github.com/web-push-libs/web-push/blob/v3.6.7/README.md#generaterequestdetailspushsubscription-payload-options): the library can generate encrypted body, headers, endpoint and method without sending.
- [Node24.20 HTTPS options](https://github.com/nodejs/node/blob/v24.20.0/doc/api/https.md#httpsrequesturl-options-callback) inherit HTTP options. [Pinned HTTP documentation](https://github.com/nodejs/node/blob/v24.20.0/doc/api/http.md#httprequesturl-options-callback) exposes custom `lookup` and AbortSignal; abort destroys the request. [Pinned net documentation](https://github.com/nodejs/node/blob/v24.20.0/doc/api/net.md#socketconnectoptions-connectlistener) documents lookup/all-address family behavior.

Use the approved guarded-adapter boundary with `web-push.generateRequestDetails()` followed by native `https.request()`. This uses the selected Node/web-push stack, not a replacement library. Validate the HTTPS provider URL and every A/AAAA result; reject credentials, custom ports and disallowed address forms. Pin validated addresses in a custom lookup that never performs a second DNS resolution. Preserve the original hostname, Host and TLS SNI/certificate verification. Use an explicit non-proxy, non-reusing agent; do not inherit environment proxy settings. Refuse redirects immediately, bound response accumulation, and apply a ten-second overall deadline spanning DNS preparation and dispatch. Any late DNS result after abort must not start a request. Classify a timeout after possible transmission as uncertain; never infer successful display.

The library provides enough public interfaces for this adapter, so no source-capability blocker requires a stack change. However, its security/cancellation behavior has **not yet been implemented or tested**. Registration/provider host patterns still need verification against actual authorized browser subscriptions; no endpoint or device result was invented.

## Required next evidence

Coordinator may proceed with SK-009 once dependencies are ready. Retain real database tests proving job identity, stale-generation cancellation, closure uniqueness, lease-token fencing and worker/app role denials. Before SK-011 completion, test private IPv4/IPv6/mapped forms, mixed public/private DNS answers, rebinding, redirects, stalled DNS/TLS, trickling response deadlines, bounded bodies, cancellation uncertainty and no late request after abort. Use fake external transport for M4, actual application/SQL/worker integration, and truthful screenshots/history.

Preflight checks were source/document inspection only. No application, database, worker, network-adapter or device tests ran for SK-009. Those checks remain NOT RUN. Real delivery remains the approved SK-017 gate.
