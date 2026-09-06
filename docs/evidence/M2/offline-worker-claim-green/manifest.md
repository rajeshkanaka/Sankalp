# Public worker claim regression — 2026-09-06

Source: a808388 plus the two reviewed changes to `src/service-worker/register.ts` and `src/service-worker/worker.ts`, committed with this evidence. No test assertion or timeout was changed for the GREEN run.

The actual Firefox setup → activation → numeric session → real network cutoff → replay workflow passed **1/1** in 8.0 seconds. Full `fnm exec --using 24.20.0 npm run verify` passed formatting, lint, types, **215 unit tests**, **84 database tests**, public-shell/Next build and Chromium smoke. Logs are retained locally at `artifacts/offline-worker-claim-green.log` and `artifacts/offline-worker-claim-verify.log`; the sanitized UI result and synthetic screenshots are stored here.

Before the change, the same workflow repeatedly failed its public-cache readiness assertion. [The diagnostic](../offline-firefox-worker-diagnostic/firefox/service-worker-readiness.json) shows a complete exact three-entry public cache and an activated registration, but the new document had no controller. The page now asks only the active worker to claim in-scope clients; the worker accepts a same-origin window message. Waiting updates are not activated, and private resources remain outside the cache policy.

Primary sources verified 2026-09-06: [MDN Clients.claim](https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim), [W3C Service Workers](https://w3c.github.io/ServiceWorker/). This targeted pass is not a full regression pass or a physical-device notification result. Full M1–M3 UI regression follows on the committed source.
