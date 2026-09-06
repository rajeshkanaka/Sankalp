# SK-008 independent pre-merge review

## 2026-09-06 — read-only source review by an outside agent

Reviewer: **Claude Code session, not an assigned `/root/*` slot.** Requested by the user as an independent second reader on PR5 before merge. Inspected the coordinator checkout `/Users/rajesh/sankalpa` on `rajesh_kanaka/offline-recovery` at `526e947`, against fetched main `544f3ef`. Application source is unchanged between `ce56222` and `526e947` (only evidence, handoffs and `scripts/safe-ui-reporter.ts` differ), so findings apply to both.

**Boundaries observed.** No shared tracking document was touched: `TASKS.md`, `PROJECT_PROGRESS.md`, `SESSION_LOG.md`, `BRANCHES.md` and `DECISIONS.md` are unmodified by this reviewer. No migration, `package.json`, lockfile or shared contract was edited. No application, database, browser, native or test process was started or operated; no runtime slot was allocated. This file is the reviewer's only change. **This report marks nothing DONE and does not grant review approval** — TASKS remains the status authority and the coordinator owns every fix decision below.

**Method and its limit.** Findings originated from an automated review pass over the `544f3ef..526e947` diff. The reviewer then re-derived each item below directly from source and Git history, and **discarded or downgraded the items that did not survive that check** (recorded in §3). Reproduction sequences are established from the source execution path only; **no finding here was executed against a running app.** They remain hypotheses until the owner reproduces them.

---

## 1. Findings

### P1 — Offline navigation refuses every in-app link, because it shares an asset-cache predicate

`src/service-worker/policy.ts:12-18`. `allowsOfflineNavigation` rejects any URL carrying a query string:

```ts
if (target.origin !== origin || target.search || target.hash) return false;
```

Every in-app link to Today carries one. Confirmed call sites:

| File                                       | Line    |
| ------------------------------------------ | ------- |
| `src/offline/ui/session.tsx`               | 990     |
| `src/features/progress/today.tsx`          | 80, 158 |
| `src/features/progress/journey.tsx`        | 68      |
| `src/features/practice/practice-panel.tsx` | 487     |
| `src/features/journeys/setup-form.tsx`     | 138     |

All six use `` `/today?journey=${id}` ``. Sequence: a disconnected user confirms a practice, then clicks the "Done" link the offline editor itself renders at `session.tsx:990`. `worker.ts:97` consults `allowsOfflineNavigation`, receives `false`, never installs `respondWith`, the network fetch fails, and the browser renders its own network-error page instead of the cached shell. `src/features/progress/journey.tsx:75` additionally builds a two-parameter `/calendar?month=…&journey=…`.

**This is not a re-litigation of the accepted asset policy.** [SK-008-security-review](SK-008-security-review.md) correctly recorded query/hash rejection as a deliberate protection, and for `publicAssetFor` (`policy.ts:6-10`) it should stay exactly as it is — an asset cache keyed on a path must not serve a query variant. The defect is that `allowsOfflineNavigation` reuses the same predicate for a different job. Navigation targets legitimately carry parameters; assets do not.

**Suggested direction (coordinator's call):** split the two policies rather than loosening the shared one. Keep `publicAssetFor` strict. For navigation, decide per route — `/today` and `/calendar` accept a validated `journey` (and `month`) parameter, the session route stays exact-match. Validate parameter _values_ with the existing UUID pattern rather than admitting arbitrary search strings, so no new cache-poisoning surface opens. The shell is served from the path; the parameters are read by the client after mount.

**Why the suite is green anyway:** the offline UI tests reach the session route directly and assert in-page state; none of them follow a post-confirmation link while disconnected. A regression that clicks `session.tsx:990` offline and asserts the shell renders would have caught this, and is the test worth adding with the fix.

### P2 — A provider outage renders Next's default 500 on every private page

`src/server/auth/server.ts:26-44, 84-91` with `src/app/(private)/layout.tsx:9`.

`sessionError` deliberately classifies non-authoritative failures as `503 AUTH_UNAVAILABLE` — the comment at `server.ts:27-28` states the intent, and `389e493` ("preserve session uncertainty during auth provider failures") introduced it on purpose. That classification is correct and should stay.

The gap is downstream. `getPageUser` redirects only on 401 and rethrows everything else — that guard is original to `bbe176e`, not new — so the newly reachable 503 now escapes from `PrivateLayout`. Next's `error.js` does not catch a throw from the `layout.js` in **its own** segment, `src/app/(private)/error.tsx` is a sibling of that layout, and there is **no `src/app/global-error.tsx`** in the tree (verified). A Supabase 5xx or timeout therefore surfaces as the framework's raw 500 page on `/today`, `/journal`, `/setup` and every other private route.

The pre-`389e493` behavior for the same outage was a redirect to `/welcome` — wrong in a different way, which is why the classification changed, but at least not a raw error page. Neither is the honest recoverable state the milestone asks for.

**Suggested direction:** give the 503 somewhere to land — a `global-error.tsx`, or catch `AUTH_UNAVAILABLE` inside the layout and render an explicit "sign-in service is temporarily unavailable, your unsaved input is safe, retry" view. The user-facing distinction between "you are signed out" and "we cannot reach the sign-in service" is exactly what `389e493` set out to preserve, and it currently stops at the API boundary.

### P3 — `sessionError(undefined)` classifies a definitive signed-out answer as an outage

`src/server/auth/server.ts:82`. When the provider responds successfully with no error and no user, `getApiUser` calls `sessionError(undefined)`. Every `missing` branch is false for `undefined` — `isAuthSessionMissingError(undefined)`, `undefined instanceof AuthInvalidJwtError` and `isAuthApiError(undefined)` all return false — so the caller receives **503, where 401 is the truthful answer.** The provider gave a definitive answer; it was simply "nobody is signed in."

**Scope is narrower than it first appears, and the report should not overstate it.** The ordinary signed-out path returns `AuthSessionMissingError` on `result.error` and is correctly classified 401 at `server.ts:80`, which is why sign-out and redirect behavior is green. This path is reached only by a malformed provider response — a 200 with `user: null`, or a user object whose `id` is missing or empty. Real but uncommon. It chains into P2: the 503 rethrows out of the layout and produces the same 500 page.

**Suggested direction:** treat "no error and no usable user" as authoritative — pass an explicit sentinel, or special-case the `!user` branch to 401 — while leaving the thrown/`result.error` paths classifying as they do now.

### P3 — Rotated auth cookies are discarded on the 409 path

`src/app/api/auth/sign-out/route.ts:8-26`. `createAuthClient`'s `setAll` (`server.ts:60-66`) writes cookies **only** to the response object handed to it — here `authResponse`. `getApiUser(auth)` at line 14 can refresh an expired session as a side effect, consuming the old refresh token and setting a rotated one on `authResponse`. If `user.id !== accountId`, line 15 throws the 409, `handleApi` constructs a **different** `NextResponse`, and line 25's `result.ok && authResponse` evaluates false — the rotated `Set-Cookie` headers never reach the browser.

The client is then holding a refresh token the server has already consumed, and the next request fails with `refresh_token_already_used`. The ACCOUNT_CHANGED guard is designed to protect a user whose account changed under them; this side effect can sign that same user out for real. Any other throw after `createAuthClient` has the same shape.

**Suggested direction:** carry `authResponse`'s cookies onto the error response before returning, or construct the error response from `authResponse` so headers survive both paths.

### P3 — Reflection autosave depends on render cadence, not on its own timer

`src/offline/ui/session.tsx:658-678`. The effect closes with `});` — **no dependency array** — so its 900 ms timer is torn down and re-armed on every render. It currently fires only because `AUTOSAVE_DELAY` (900 ms) is shorter than the 1000 ms `setDeviceNow` tick at `session.tsx:220-224` that drives the re-render.

Nothing declares that coupling. Add any second periodic render, shorten the clock interval, or raise `AUTOSAVE_DELAY` above 1000 ms, and every cleanup cancels the timer before it can fire — **autosave stops silently, with no error and no user-visible signal.** Conversely, any unrelated state change restarts the full 900 ms wait, so a user typing steadily can push the save out indefinitely.

**Suggested direction:** give the effect an explicit dependency list, or drive the debounce from the input change rather than from render. Worth a regression that advances a fake clock and asserts a save occurs without relying on the tick.

---

## 2. Reported but not verified by this reviewer

Relayed for the owners' triage. The reviewer did **not** confirm these against source; treat each as a lead, not a finding. Nine items, listed most-consequential first.

**Sticky failure states in `src/offline/ui/account-context.tsx`** — three separate reports converge on one pattern, which is why they are worth triaging together:

- `:226` — a single transient `/api/auth/session` failure during `establish()` sets `status='invalidated'`; the reported refocus path at `:332-336` clears only `unverified` and never re-runs `establish()`, so the state is permanent for the document's life.
- `:326` — `checkVisibleAccount` returning `'unavailable'` leaves `unverified`/`identityPending` set, and `:601` renders `<div hidden={unverified…}>{children}</div>`, hiding the entire private UI.
- Common to both: no `online` event listener and no retry timer is reported, so recovery requires a manual button or full navigation **even after connectivity returns.**

If these hold, a brief network blip locks a user out of their own private UI until they navigate — arguably worse in daily use than P1, and directly against "explain recoverable errors" in AGENTS.

Remaining leads:

- `src/offline/ui/session.tsx:442` — retry timer caps at 60 s, but on early wake `core.ts:703` skips the op and returns the **same** `retryAfter` string; `setRetryAt` bails out on the identical value, the effect never re-runs, and automatic retry stalls until an online/focus/pageshow event. Reported trigger: a 429 carrying `Retry-After: 120`.
- `src/offline/ui/account-context.tsx:266` — `AccountProvider` replaces all children while `establish()` serially awaits identity → IndexedDB binding → SW readiness, reportedly gating the private app behind a bare spinner for up to ~12 s on cold load (5 s identity timeout + 7 s readiness race). `tests/ui/helpers/sign-in.ts` waiting 15 s for that text to clear is cited as corroboration.
- `src/offline/core/store.ts:100` — `prune` reportedly deletes the drafts row alongside an evicted session, resetting a monotonic revision to 0 while a live editor still holds the old one; the next `saveDraft` then throws `LOCAL_CONFLICT` ("Another tab changed this draft") for a conflict that never occurred. Requires >50 cached sessions.
- `src/offline/ui/session.tsx:509` — `commit()` returns early when `commitRef.current` is set, reportedly without setting `pendingRetry` or any message, dropping the user's intent while the editor still displays the text as if it were about to save.
- `src/components/app-shell.tsx:7` — importing `OfflineAccountControls` through the `@/offline/ui` barrel reportedly pulls `session.tsx` (1248 lines), `saved-page.tsx`, `conflict.tsx` and `@js-temporal/polyfill` into every private page's client bundle. Suggested: import from `@/offline/ui/account-controls` directly.
- `src/offline/ui/session.tsx:646, 673` — payload equality via `JSON.stringify` on both sides, where `src/offline/core/model.ts:157` already exports key-sorted `stableJson` and `core.ts` uses it for every comparison. Key-order drift would silently queue a redundant operation per autosave tick.
- `src/offline/account-identity.ts:4` — the UUID pattern is reportedly duplicated across four files in two disagreeing forms: strict (`[1-8]` version, `[89ab]` variant) in `account-identity.ts:4` and `account-context.tsx:55`, a third copy at `service-worker/shell/main.tsx:16`, and a looser `[0-9a-f]{4}` variant in `policy.ts:16`. A v0 UUID would pass `policy.ts` but fail `main.tsx`, so the shell falls back to the saved list instead of the requested session. Worth folding into the P1 fix, since both touch `policy.ts`.

---

## 3. Checked and withdrawn

Recorded so the coordinator does not spend time re-deciding settled questions.

**`signOut({ scope: 'local' })` is not an unannounced regression — withdrawn.** The automated pass flagged `src/app/api/auth/sign-out/route.ts:21` as silently dropping global session revocation, and `git log -S` does confirm `6edfa51` changed it from the default-global `auth.auth.signOut()` that had stood since `bbe176e`. But [SK-008-security-review](SK-008-security-review.md) records local scope as part of the **deliberate accepted fix** for the stale-sign-out race, alongside the required `accountId`, fresh identity verification and the 409. The reasoning is sound: a stale tab must not be able to revoke a newly signed-in account's sessions everywhere. No action needed.

One residual note, explicitly **not** a PR5 blocker: the accepted trade-off means "Sign out" no longer ends the account's sessions on other devices, which touches the shared-device story in SK-014 and the A16 privacy surface. The decision currently lives only in a review handoff. The coordinator may want it stated in DECISIONS and reflected in whatever the sign-out UI tells the user, at SK-014 time rather than now.

**"`getPageUser` now only redirects on 401" — restated, not withdrawn.** The automated pass framed the narrow redirect as new. It is not: that guard is original to `bbe176e`. What is new (`389e493`) is the 503 classification that made the rethrow branch reachable in practice. P2 above carries the corrected mechanism; the user-visible defect stands.

---

## 4. Verification and limits

The reviewer read source, the `544f3ef..526e947` diff, `git log -S` history for the sign-out and auth paths, the existing [security](SK-008-security-review.md) and [boundary](SK-008-boundary-review.md) reviews, and confirmed on disk that `src/app/global-error.tsx` does not exist and `src/app/(private)/error.tsx` is a sibling of the layout. P1's six call sites, P2's file layout, P3's `sessionError` branches, the sign-out response construction and the missing dependency array were each read directly at `526e947`.

**NOT RUN by this reviewer:** every functional test, the app, the database, any browser, any native check. No finding was reproduced against a running system. No test was written, run or modified. Hosted CI, service-worker upgrade behavior, real devices and the account-context internals in §2 were not exercised. The coordinator's own passing results — 98/98 UI on `5c8962f`, 215 unit / 84 DB / build / smoke on `ce56222` — are the coordinator's evidence and are not re-verified or contradicted here; §1 concerns failure paths that suite does not appear to cover, which is consistent with both results being true.

**Exact next action for the owner:** triage P1 first — it is the only finding that breaks the feature PR5 exists to deliver, on a path a real disconnected user is likely to take, and it needs a decision on splitting the navigation policy from the asset policy before the code changes. P2/P3 are contained and can follow. §2 needs a source pass by the `account-context.tsx` owner before anything is scheduled. Merge sequencing, blocking scope and any status change remain entirely the coordinator's decision.
