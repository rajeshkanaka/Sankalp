# Numeric migration first run

2026-09-06 against production389e493.3PASS/3FAIL: all legacy cases passed after explicit online-only routing. All3newunified cases read page.url immediately after a client-side link click; it still saidtoday, before transition committed. The nexttestchange asserts the actual session URL before reading its ID. No target/pending/replay pass is inferred from this early failure. Actual app/source gates must rerun before completion.
