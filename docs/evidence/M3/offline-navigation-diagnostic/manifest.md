# Firefox reconnect diagnostic

2026-09-06, actual production app on local slot1, synthetic accounts and clock. Source: ef23eea with the coordinator's compact header, verified-controller reuse and initial private-boundary test wait. This is a diagnostic checkpoint, not milestone acceptance.

`UI_RUN_ID=offline-navigation-diagnostic npm run test:ui -- --project firefox --grep 'disconnected edits survive'` passed **1/1**. The actual public shell served the disconnected reload, queued completion/reflection survived, and canonical replay persisted session revision2 and reflection revision1. Screenshots show synthetic pending and replayed states.

Temporary test-only tracing recorded request method, sanitized route category, navigation/RSC flags, status/MIME and a fixed aborted-request boolean. No request bodies, headers, query strings, authentication links or private account identifiers were retained. Instrumentation was removed before the next source checkpoint; the ignored local log is artifacts/offline-navigation-diagnostic.log.

The reconnect reload started three canonical-refresh RSC requests as independent acknowledgments arrived. The test's extra same-URL full navigation interrupted the last RSC request; that diagnostic run still passed. A competing Next hard navigation was not established. Do not filter navigation errors or add sleeps. The subsequent regression uses the real Your journey link, asserts saved progress, reloads that page and reopens the session, retaining canonical revision and exact-text persistence assertions.
