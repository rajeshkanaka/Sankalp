# Final service-worker regression — 2026-09-06

Applicationce56222 plus reporter-only checkpoint5c14a13: **3/3 PASS** across Chromium/WebKit/Firefox in19.8seconds. Command: `UI_RUN_ID=offline-final-port-check fnm exec --using 24.20.0 npm run test:ui -- tests/ui/m2-schedule.spec.ts --grep unified`. Real application/auth/database and actual test-proxy disconnection; no mock save or assertion changes. Synthetic pending/completed screenshots and safe summary retained here.

Final applicationce56222 passed full verify215unit/84DB/build/smoke. After the reporter regression was added, full unit suite **216/216 PASS**; reporter-specific5checks, lint/types/format passed. Full browser suite98/98 on the preceding application build is retained in M3/offline-full-final, with exact provenance explained. Latest UI reporter captures the run-start revision. Hosted exact-head CI remains required before merge; native VoiceOver and physical-phone delivery remain separate unverified gates.
