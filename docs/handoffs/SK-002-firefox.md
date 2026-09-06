# SK-002 Firefox launch diagnosis

Owner: `/root/bootstrap_audit`

Worktree: `/Users/rajesh/sankalpa-worktrees/SK-001-fixtures`

Branch: `task/SK-001-fixtures`

Base: `4fa09a16e0296683d36c7c8801a4235ebff73b4a`

Scope: read-only diagnosis plus temporary launch probes. No application, Playwright configuration, browser installation, sandbox, TCC or system setting was changed. All temporary probe directories were removed.

## Result

This is the current macOS 27 Firefox direct-launch defect, not a missing Playwright profile. macOS denies a directly spawned Firefox process read access to Firefox's protected app-data directory before Firefox reaches Playwright's explicit `-profile` argument. Firefox 155 now reports that upstream failure as `Could not find profile folder.` and exits instead of hanging.

The minimal demonstrated workaround is to point `MOZ_APP_DATA` at a private, test-owned directory. This changes only Firefox's app-data registry location for that process. It does not disable SIP, sandboxing or app-data protection and does not grant a terminal or agent broad disk access.

## Local evidence

Environment: macOS 27.0 build `26A5425a`, Apple silicon; Node 24.20.0 for probes; Playwright 1.63.0; bundled Firefox 155.0 revision 1543.

| Probe | Observed result |
|---|---|
| Ordinary `firefox.launch({ headless: true })` | FAIL in about 0.2 seconds. Playwright created and passed `$TMPDIR/playwright_firefoxdev_profile-*`; Firefox printed `Could not find profile folder.` and exited 1 before Juggler started. |
| Canonical `TMPDIR=/private/var/folders/.../T/` | Same failure. The `/var` alias is not causal. |
| Minimal inherited environment (`HOME`, `USER`, `LOGNAME`, `PATH`, `TMPDIR`) | Same failure. The normal environment was only 7,477 bytes across 122 entries, so environment size is not causal. |
| Existing explicit `/private/tmp/playwright-firefox-profile-*` passed to `launchPersistentContext` | Same failure even though the directory was verified to exist immediately before launch. The Playwright profile is not missing. |
| Read check for `~/Library/Application Support/Firefox` | Directory exists, but `os.access(..., R_OK)` returned false and reading its extended attributes returned `Operation not permitted`. |
| Same ordinary Playwright launch with only `MOZ_APP_DATA` redirected to a mode-0700 `/private/tmp` directory | PASS. Firefox printed `Juggler listening to the pipe`; Playwright created a page, opened `about:blank`, and Firefox exited 0 after `browser.close()`. |

The successful run still printed `sandbox_extension_issue_file_to_process` warnings for `plugin-container.app`. Mozilla's investigation identifies those warnings as unrelated noise; they occur in working LaunchServices and redirected-app-data runs too.

## Safe invocation pattern

For a local focused run, create an ignored per-workspace directory with owner-only access and export it only for the test process:

```sh
SANKALPA_FIREFOX_APP_DATA="$PWD/.local/playwright-firefox-app-data"
install -d -m 700 "$SANKALPA_FIREFOX_APP_DATA"
MOZ_APP_DATA="$SANKALPA_FIREFOX_APP_DATA" npm run test:ui -- --project firefox
```

The coordinator can apply the same value before Playwright launches Firefox. Keep the directory under ignored `.local`; do not point it at a real Firefox profile. Remove the workaround after the upstream macOS/Firefox direct-exec defect is fixed and verified on the pinned browser revision.

## Authoritative references

- [Mozilla bug 2060476](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476) documents this exact macOS 27 direct-exec failure. Comment 7 shows that the failure occurs before `-profile`, correlates it with `EPERM` on `~/Library/Application Support/Firefox`, and demonstrates that `MOZ_APP_DATA` alone fixes launch. The issue remains open as of this diagnosis.
- [Mozilla bug 2062988](https://bugzilla.mozilla.org/show_bug.cgi?id=2062988) explains why Firefox 155 now prints `Could not find profile folder.` and exits rather than blocking forever in the headless profile-missing dialog. That reporting fix does not fix the underlying macOS 27 access failure.
- [Playwright issue 42082](https://github.com/microsoft/playwright/issues/42082) reports the same macOS 27 behavior with Playwright, including correctly created temporary profiles and unaffected Chromium/WebKit runs.
- [Apple macOS 27 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-27-release-notes) document that XProtect may restrict access to app data commonly targeted by malicious software and that the user manages these denials in Privacy & Security.
