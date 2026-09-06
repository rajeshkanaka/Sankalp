# SK-008: real network cutoff for service-worker verification

2026-09-06. Owner: offline-core worker. Branch/worktree: `rajesh_kanaka/offline-core`, `/Users/rajesh/sankalpa-worktrees/SK-008-core`; base `ef6e85f`. This report records a testing limitation and test-only fixture. It does not declare SK-008 complete; TASKS remains authoritative.

## Finding and measured evidence

Playwright 1.63.0 offline emulation is not a reliable cross-browser test of this service worker's navigation fallback. A captured copy of the **actual** `src/service-worker/worker.ts` and `policy.ts` was bundled with one synthetic public HTML asset. Each case used a fresh context and its own random loopback port; before failure injection it asserted an active controller and the expected cached HTML. Physically stopping that HTTP server allowed the unchanged worker to serve its fallback in every engine. No app, authentication, database, private data, or native-device behavior was tested by this probe.

| Engine/version         | Failure injection          | `/offline/saved` navigation                                       | Direct cached `/offline/index.html` navigation |
| ---------------------- | -------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Chromium 153.0.8010.12 | `context.setOffline(true)` | PASS: cached fallback, HTTP 200                                   | PASS: cached HTML, HTTP 200                    |
| Chromium 153.0.8010.12 | Server and sockets stopped | PASS: cached fallback, HTTP 200                                   | PASS: cached HTML, HTTP 200                    |
| WebKit 26.6            | `context.setOffline(true)` | FAIL: `WebKit encountered an internal error`                      | FAIL: same internal error                      |
| WebKit 26.6            | Server and sockets stopped | PASS: cached fallback, HTTP 200                                   | PASS: cached HTML, HTTP 200                    |
| Firefox 155.0          | `context.setOffline(true)` | FAIL as offline simulation: worker still fetched live online HTML | PASS: cached HTML, HTTP 200                    |
| Firefox 155.0          | Server and sockets stopped | PASS: cached fallback, HTTP 200                                   | PASS: cached HTML, HTTP 200                    |

All twelve cases had zero page-error events. Firefox's four cases were repeated with `localhost` instead of `127.0.0.1`: identical results. The integrated app's Firefox `NS_ERROR_OFFLINE` was **not** reproduced exactly in this synthetic probe; an online worker fetch followed by the authenticated route's redirect is a plausible explanation, not a proven trace. The differential result identifies an offline-emulation limitation without establishing an upstream browser implementation root cause. No production worker change is justified by this evidence.

Captured source SHA-256:

- `worker.ts`: `bf4020d787fa027da3c451117c059d204073ab07fd07e744b68f19db73d3dd98`
- `policy.ts`: `f5e9b04919ecafde60444587b0b0949c0b062b717bbef8414689b193ff727961`
- Concatenated worker then policy: `a46df701f8c94e32d25b` is the first 20 hash characters and the probe's public cache version.

Commands actually run from the assigned worktree:

```sh
fnm exec --using 24.20.0 node .local/sw-diagnosis/run.mjs
fnm exec --using 24.20.0 node .local/sw-diagnosis/run-localhost.mjs
```

Local diagnostic code, immutable captured sources and detailed synthetic results remain in ignored `.local/sw-diagnosis/`; durable sanitized outcomes are above. Those temporary probe paths are evidence from this machine, not repository setup commands.

Primary sources verified 2026-09-06:

- [Playwright service-worker documentation](https://playwright.dev/docs/service-workers): its dedicated service-worker inspection/network APIs are Chromium-only. This does not mean native workers cannot run in the other browser engines; the probe verified they do.
- [Playwright 1.63.0 Firefox implementation](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/firefox/ffBrowser.ts#L293-L295): context offline emulation uses `Browser.setOnlineOverride`.
- [Playwright 1.63.0 WebKit implementation](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/webkit/wkPage.ts#L705-L707): page state uses `Network.setEmulateOfflineState`.

## New fixture and coordinator integration

Owned files: `scripts/run-ui-server.mjs`, `tests/ui/helpers/network.ts`. No dependencies or production code changed.

The script is restricted to `APP_ENV=ci`, an explicit loopback `APP_ORIGIN` and matching public `PORT`. It starts existing `scripts/run-next.mjs start` on loopback `PORT + 100`, while preserving the public `APP_ORIGIN`. Its public proxy forwards request bodies, public Host and response headers unchanged. An atomic `.local/ui-network.json` state with a generation controls actual socket destruction, including active requests. `.local/ui-network-applied.json` acknowledges that generation. No HTTP control endpoint and no request/cookie logging are added. Startup resets to connected. Shutdown removes the file watcher, destroys proxy/upstream sockets and signals/waits for the isolated child process group; bounded escalation applies only to that owned group.

Tests call `await setUiNetworkDisconnected(true)` to cut the real test origin, then `false` in a `finally` block to restore it. The helper waits at most five seconds for the matching acknowledgment. **`navigator.onLine` remains unchanged**; this tests actual server/network unavailability and the worker's real fetch failure path. Tests that specifically assert offline events may still use Chromium emulation separately. Use a single serialized UI worker and do not run multiple suites against one `.local` control file.

Coordinator-owned integration remains required:

1. Change Playwright webServer command to `node scripts/run-ui-server.mjs`; keep public origin/PORT and reserve internal `testPort + 100` in the runtime slot registry.
2. Reset the control file in setup if needed before browser tests; script startup already initializes connected. Import the helper into offline tests and restore connectivity in `finally`/afterEach.
3. Run actual production-build UI tests in Chromium, WebKit and Firefox. Assert navigation fallback and its functional UI, exact public cache allowlist, failed private API/RSC fetches during cutoff, retained local drafts/queue, and replay after reconnect. Keep real screenshots and zero uncaught page errors.
4. Preserve explicit HTTP errors as errors while online. Never replace the production worker or fulfill its fallback with a test mock.

## Verification of the fixture itself

An isolated temporary fixture started the **actual new proxy script**, with a synthetic child HTTP server in place of Next. It passed these assertions: public Host and APP_ORIGIN preservation; streamed POST body; response-header preservation; active request cut before acknowledgment; new requests fail during disconnection; reconnection works; SIGTERM waits for shutdown; both public/internal ports are closed afterward. It did not exercise actual Next/application authentication.

```sh
fnm exec --using 24.20.0 node --import tsx .local/sw-diagnosis/proxy-test.mjs
fnm exec --using 24.20.0 npx eslint scripts/run-ui-server.mjs tests/ui/helpers/network.ts
fnm exec --using 24.20.0 npx prettier --check scripts/run-ui-server.mjs tests/ui/helpers/network.ts docs/handoffs/SK-008-network-testing.md
fnm exec --using 24.20.0 npx tsc --noEmit
```

Proxy lifecycle probe PASS; scoped lint, formatting and full TypeScript PASS. An initial scoped lint run found a missing explicit `clearTimeout` import; fixed before the successful rerun. Actual integrated app tests with the new fixture: **NOT RUN by this worker**; coordinator owns them. All owned probe browsers/servers exited. Exact next action: coordinator cherry-picks this focused fixture/report commit and wires configuration, then runs the integrated app checks above.
