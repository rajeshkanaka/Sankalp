# Native accessibility review

These checks require macOS and installed Google Chrome. Preparing a window does not establish a keyboard, zoom or VoiceOver pass. Use the native procedure and restoration checklist in [SK-002-native-audio-plan](../../docs/handoffs/SK-002-native-audio-plan.md); retain only synthetic screenshots and verified audio clips, never the accompanying diagnostic archive.

From the coordinator checkout on Node24.20.0, restart the preserved local services with `npm run db:start`. Use the guarded `npm run demo:seed -- --profile M3` only when the synthetic demo needs resetting; never reset another account or database. Build the current source with `npm run build`, then start the production demo in a terminal:

```sh
DEMO_CLOCK_FILE="$PWD/.local/demo-clock.json" npm run start
```

In another terminal:

```sh
node --env-file=.env.local --import tsx tests/manual/prepare-native-review.ts
```

The helper verifies the allocated loopback environment and M3 demo marker, starts a separate Chrome Guest instance, signs in the synthetic demo account through captured local mail, and leaves Today open. It neither resets rate counters nor prints/stores the one-time link. `.local/native-review.json` records only the local origin, source/browser version, process ID and ready/stopped timestamps. Confirm the actual Guest state before native interaction. Native checks must cover focus, 200% reflow, actual keyboard practice/save behavior and observable VoiceOver output. Agent automation must not infer spoken output from an accessibility tree.

Restore the original VoiceOver state and browser zoom before closing only this test window. Closing its browser or sending SIGINT/SIGTERM to the helper stops the owned browser. Stop the separately owned demo server when appropriate; no process is assumed to survive a session. Record actual results, limitations, source revision and the exact next substep in the task handoff. The helper has only static/build verification until its first successful execution is recorded there.
