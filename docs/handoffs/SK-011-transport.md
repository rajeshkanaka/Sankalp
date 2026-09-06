# SK-011 guarded push transport preparation

2026-09-06. Owner `/root/ci_triage`; worktree `/Users/rajesh/sankalpa-worktrees/SK-011-transport`; branch `rajesh_kanaka/push-transport`; base `0d74076` (coordinator-frozen transport types and dependencies). This is isolated preparation under D12. [TASKS](../TASKS.md) remains the status authority; this report does not complete SK-011 or M4. Follow the [frozen contract](SK-011-transport-contract.md) and [shared types](../../src/server/reminders/transport-contracts.ts).

## Implemented boundaries

- [endpoint-policy.ts](../../src/server/reminders/endpoint-policy.ts): strict HTTPS/provider authority validation, opaque path/query preservation, and static conservative IANA IPv4/IPv6 policy. Every A/AAAA answer must pass; a single private, special or malformed answer blocks the attempt. Google/Mozilla/Apple candidate hosts are those in the frozen contract. Actual subscription-host verification remains SK-017/B04; Edge/WNS and Samsung Internet rules were not added.
- [transport.ts](../../src/server/reminders/transport.ts): `createRealPushTransport(vapid, dependencies?)` uses pinned `web-push` only for VAPID/encryption. Each send creates one resolver and one fresh nonproxy, non-reusing HTTPS agent. DNS families resolve together, addresses are pinned without another lookup, and Host/SNI/certificate validation remain tied to the approved hostname. The original target and abort signal are captured before asynchronous work.
- No HTTP body is written until TLS reports an authorized peer. The overall ten-second limit starts before DNS and is shortened by job lifetime. Abort/deadline cleanup cancels that resolver and destroys the request, response and agent. Late DNS/TLS callbacks cannot send. Headers, body chunks and response completion also check the deadline, so a delayed timer callback cannot permit late acceptance.
- Inputs are bounded to 3,072 UTF-8 payload bytes, 32 base64url tag characters, valid bounded subscription keys, a 4,096-character endpoint and an offset-bearing expiry instant. Ciphertext is bounded to 4,096 bytes. Response headers are limited to 16 KiB and discarded response bodies to 8 KiB. No response content, endpoints, keys, raw exception messages or VAPID material are returned or logged.
- TTL is recomputed before dispatch, bounded to 0–300 seconds and reduced by the remaining request budget for transit. Topic is the caller's stable opaque tag; the caller must also include its notification tag in the encrypted envelope. No four-week library default is used.
- Complete valid 2xx responses produce service acceptance only. 404/410 indicate subscription invalidation; 408/429/5xx are retryable; redirects and other permanent rejection are terminal. Incomplete, oversized or lost responses after possible transmission remain uncertain. Retry-After parsing is bounded by the five-minute maximum reminder lifetime. The worker must still apply its actual expiry, attempt limit and lease/generation rules before another send.
- `createSimulatedPushTransport(outcome?, clock?)` returns explicit `mode: 'simulated'`, `httpStatus: null` outcomes and makes no network request. Pass `{ now: () => domainClockMilliseconds }` for the deterministic M4 fixture; the default uses the actual clock. The coordinator owns environment guards selecting this adapter. It is not evidence of device notification delivery.

The optional test boundaries are resolver construction, native request construction and clock functions. Production defaults never read environment configuration, generate keys, override TLS verification or permit loopback destinations. Node's `ProxyEnv` type inherits Next's unrelated required `NODE_ENV` augmentation; a narrow type assertion permits the actual empty `{}` object documented by Node. No environment values are copied.

## Verification and retained evidence

Environment observed: Darwin 27.0.0, Node 24.20.0, OpenSSL 3.6.3. Existing coordinator-installed exact dependencies were accessed through a local `node_modules` symlink; no installation or dependency change occurred here.

| Command from this worktree                                                                                          | Actual result on 2026-09-06                        |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `fnm exec --using 24.20.0 npm run test:unit` before implementation                                                  | PASS; baseline 186 tests in ten files.             |
| `fnm exec --using 24.20.0 npm run test:unit -- tests/unit/push-endpoints.test.ts tests/unit/push-transport.test.ts` | PASS; final 212 tests in two files.                |
| `fnm exec --using 24.20.0 npm run test:unit` after implementation                                                   | PASS; final 398 tests in twelve files.             |
| `fnm exec --using 24.20.0 npm run typecheck`                                                                        | PASS; route type generation and `tsc --noEmit`.    |
| `fnm exec --using 24.20.0 npm run lint`                                                                             | PASS; full repository lint, zero warnings.         |
| `fnm exec --using 24.20.0 npm run format:check`                                                                     | PASS; full configured code/test/script formatting. |

The [endpoint tests](../../tests/unit/push-endpoints.test.ts) retain CIDR first/last-address cases, public neighbors, mapped/transition forms, normalization attacks, host suffix/empty-label attacks and opaque-token assertions. The [transport tests](../../tests/unit/push-transport.test.ts) retain deterministic DNS, deadline, cancellation, response, sanitation, expiry, key/payload, concurrent-attempt and simulated-clock assertions.

Five native HTTPS cases also ran successfully: complete responses on distinct connections; actual Host/SNI and encrypted body with cancellation/socket closure; a trickling response cut off at the job lifetime; a native oversized-header rejection; and an untrusted certificate rejected before HTTP reaches the server. Tests create temporary synthetic certificates with the existing OpenSSL executable, bind only ephemeral loopback ports, then close sockets/listeners and remove temporary key/certificate files in cleanup. A test-only request boundary redirects the connection to that local fixture while preserving native HTTP/TLS processing. This does not relax production endpoint/IP validation and does not contact a real push subscription or push service. DNS and socket destination are explicitly controlled in those tests; they do not verify live provider routing or real subscriptions.

Useful failures and fixes:

1. The first static pass found Next's `ProxyEnv` augmentation plus test-fixture readonly/stream/TLS type mismatches. These were corrected without changing shared types or runtime security settings. Full lint/typecheck subsequently passed.
2. A manually emitted fake TLS event initially preceded the test fixture's socket attachment. The test now awaits the actual attachment signal before emitting `secureConnect`; its assertions and timeout were not relaxed.
3. Two new deadline regressions first failed because late headers/end callbacks returned `accepted` when the timeout callback had not yet run. `npm run test:unit -- tests/unit/push-transport.test.ts -t 'refuses late response'` demonstrated two failures, then two passes after adding direct continuation/deadline checks. Both regressions remain in the final passing suite.

4. Independent review found three documented certificate trust errors incorrectly classified as retryable connection failures. The three-case probe reproduced failures and then passed after replacing broad prefix checks with the explicit Node 24.20 certificate-rejection set. The full documented trust-error table is tested; OUT_OF_MEM and unknown connection errors stay transient before transmission, while errors after possible transmission preserve uncertainty. [Pinned Node TLS error documentation](https://github.com/nodejs/node/blob/v24.20.0/doc/api/tls.md#x509-certificate-error-codes), verified 2026-09-06.

## Remaining work and resume

Independent review and coordinator integration are still required. Shared registration/API validation, authorization, worker/SQL/job wiring, browser permission/service-worker behavior and actual device delivery are outside this worker's scope. Production build, app smoke, database/API integration, worker integration, browser UI and real device/provider checks are **NOT RUN** here. No app or database service was started or changed.

The coordinator must select the real adapter only in an authorized configured environment, inject the demo clock into the simulated adapter, validate/persist the application-owned payload, and enforce current account/journey/device ownership, preference/subscription generations, cancellation, job expiry, maximum attempts, lease fencing and honest history. Return outcomes contain no receipt URI; do not interpret `mode: 'real'` alone as successful acceptance or display.

Next action: review and cherry-pick this worker's five-file commit into the assigned reminder integration branch, rerun the unit/static gates there, then implement the separately owned worker/database/application contracts. Use the commands above to resume; the helper tests create and clean up their own fixtures. The local dependency symlink must remain unstaged. No push, shared tracking update, deployment or real send is part of this worker checkpoint.

Primary-source links and the 2026-09-06 verification date are retained in the [frozen transport contract](SK-011-transport-contract.md); no new capability or provider-host claim was inferred during implementation.
