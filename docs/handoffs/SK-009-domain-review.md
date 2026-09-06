# SK-009 independent pure-domain review

2026-09-06, Asia/Kolkata. Reviewer `/root/branch_audit`. Reviewed commit `78da7ecd6721ec0c30b1b0bf0fab0d0023192173` in `/Users/rajesh/sankalpa-worktrees/SK-009-domain`: `src/domain/reminders.ts`, `tests/unit/reminders.test.ts` and the worker handoff. Compared with the coordinator's current frozen `docs/handoffs/SK-009-domain-contract.md`, D19 and specification A02/A21. Reviewer did not author or modify the domain implementation.

**No actionable correctness finding within the frozen pure-calculation scope.** This is an independent review result, not SK-009/M4 completion or operational reminder approval. [TASKS](../TASKS.md) remains authoritative.

## Reviewed behavior

- Lines14–29 strictly validate types, unknown fields, offset limits/count/uniqueness, enabled-with-offsets and distinct minute quiet bounds. Disabled preferences still validate retained suggestions. Defaults remain with callers as specified.
- Lines58–72 evaluate half-open local wall-time quiet hours against each actual instant and its saved timezone. Midnight wrapping, spring gaps and both occurrences of an autumn fold follow the contract without moving the intended instant.
- Lines99–126 sort copies, retain all configured preview entries and suppress exact-now/past instants with `target <= now`. A02's four intended instants and civil dates agree. Disabled/completed/superseded conditions are explicit; deterministic suppression precedence is documented.
- Lines75–85 reject nonpositive windows and cap expiry at the earlier of intended+5minutes and close. Lines130–150 allow snooze at opening, reject at/after close, require target strictly before close and evaluate quiet hours at the target. Elapsed-minute arithmetic handles clock transitions without using the browser's timezone or the associated practice date.
- Inputs are preserved: schema parsing/cloned sorting and immutable Temporal operations do not alter offsets, quiet settings or session data. Returned items share no mutable state with subsequent calls.

## Fresh verification

`fnm exec --using 24.20.0 npm run test:unit -- tests/unit/reminders.test.ts` in the domain worktree: **74tests PASS**, exit0, Vitest5.0.0. No app/environment/server/database was started. The domain worker's existing untracked `node_modules` symlink was left untouched.

Additional pure calculations ran from the reviewer's own core worktree using `fnm exec --using 24.20.0 node --import tsx --input-type=module`, importing the reviewed module by absolute path and using `node:assert/strict`. Results: **9,600 quiet-hour comparisons and6 additional assertions PASS**. The oracle used native `Intl.DateTimeFormat('en-GB', {timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'})`, converted its hour/minute parts to minute-of-day and compared ordinary integer half-open intervals against `quietHoursContain`.

Reproducible sweep parameters:

- Zones: UTC, Asia/Kolkata, America/New_York, Australia/Lord_Howe, Pacific/Chatham.
- UTC starts: `2026-03-08T00:00:00Z`, `2026-11-01T00:00:00Z`, `2026-10-03T12:00:00Z`, `2026-04-04T12:00:00Z`.
- For each start/zone,96instants at15-minute steps over24hours; quiet ranges00:00–00:15,01:15–01:45,02:00–03:00,09:00–17:00,21:00–06:00. Thus5×4×96×5comparisons. Existing focused tests separately cover nanosecond-adjacent boundaries.

The6 additional assertions used a deeply frozen session opening `2026-11-01T06:30:00Z`, closing `07:30:00Z`, timezone America/New_York, unconfirmed/nonsuperseded; deeply frozen enabled preferences `[0,-60]`, quiet01:15–01:45. They verified:

| Case                                           | Expected result, observed PASS                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Preview at05:00Z                               | 05:30Z and06:30Z both quiet-suppressed: the two01:30fold occurrences.                          |
| Snooze at06:40Z                                | 06:50Z target,06:55Z expiry; evaluates target outside quiet hours despite request inside them. |
| Snooze at07:20Z                                | Ineligible `deadline`: target would equal close.                                               |
| Snooze at07:19:59.999Z                         | Eligible07:29:59.999Z, expiry capped07:30Z.                                                    |
| After all calls                                | Frozen session/preferences serialize identically to their original snapshot.                   |
| Mutate returned preview item, then recalculate | Fresh preview still returns05:30Z; no cross-call output alias.                                 |

## Limits and integration reminders

The frozen contract intentionally accepts canonical `SessionRecord` fields as caller preconditions; this is not a replacement for boundary validation of account ownership or a saved IANA timezone. `quietHoursContain(..., null)` immediately returnsfalse by its stated contract. Inactive/suppressed preview entries remain visible rather than being runnable jobs.

Snooze non-overlap requires the future server transaction to replace pending jobs in `[now,target]`; it cannot be proved by this pure module. Similarly, due-job execution uses `scheduled_at <= dispatch_now < expires_at`; the planner's strictly-future generation check must not be reused to reject already-created jobs exactly when due. Device eligibility, preference/subscription generations, completion/archive/deletion races, dispatch-time quiet revalidation, retries/leases, database grants and actual push/display are separate unimplemented/integration gates, not defects in this assigned module.

Build, database/API, browser UI, worker dispatch, real device notification and integrated reminder testing were **NOT RUN by this reviewer**. Exact next action: coordinator may integrate the reviewed pure-domain commit, rerun appropriate integrated unit/static gates and freeze transactional job contracts before dependent reminder work. Only this report is committed in the reviewer's worktree; no domain source, worker branch, dependency or shared tracking status changed.
