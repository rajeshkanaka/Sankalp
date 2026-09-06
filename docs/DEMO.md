# Show Sankalpa locally

A presenter guide for the working application on `main`. Use an **online, local demonstration** with synthetic data. The audience sees real email-link authentication, real database saves and the actual interface; only the practice clock is simulated. No external email, reminder delivery or deployed website is part of this demo.

[Back to README](../README.md) · [Current checkpoint](PROJECT_PROGRESS.md) · [Branch/worktree map](BRANCHES.md)

## Before your audience arrives

- Use accepted `main` application code. The emergency checkpoint plus this demo-tooling follow-up has the same application feature source. The reminder integration branch is unfinished and is unsuitable for this walkthrough.
- Complete [first-time setup](../README.md#run-locally-on-macos) before the meeting. Container downloads and the first build take time.
- Use a dedicated browser profile for synthetic demonstrations. Keep the app and its captured-mail inbox in the **same profile** so the email-link verifier is available.
- Confirm the page shows **Demo data · simulated clock**. If it does not, stop and use the explicit clock launch below. A plain `npm run start` uses the real date.
- Stay connected to the local backend. The unresolved [PR5 P1 review](handoffs/SK-008-independent-review.md) concerns offline navigation; do not present disconnected navigation as finished.
- Use screen sharing if your audience is remote. `localhost` means this Mac, and these services deliberately listen only on loopback. A phone or another laptop cannot use this address; there is no public demo URL yet.

## Restart the existing Mac checkout

For the current maintainer checkout, **slot 1** is already allocated:

| Purpose        | Address                                                        |
| -------------- | -------------------------------------------------------------- |
| App            | [http://localhost:3001/welcome](http://localhost:3001/welcome) |
| Captured email | [http://127.0.0.1:54424](http://127.0.0.1:54424)               |

If the app is already running, open those pages. There is no need to start a second server or reseed. For a stopped app:

```sh
cd /Users/rajesh/sankalpa
./setup.sh
```

This installs the pinned dependencies, starts the owned local backend, applies migrations, preserves the existing demo data and clock, builds, then opens the app and captured inbox. It keeps slot 1. No environment copying, manual credentials or separate seed command is needed. The script stops early if an app/test server is still using this checkout.

## The five-minute walkthrough

These exact starting values apply **immediately after a fresh `M3` seed**. Reusing an already-edited demo keeps those edits; reset it deliberately if you need the same opening state.

The practice clock is **6 September 2026, 05:00, Asia/Kolkata** (`2026-09-05T23:30:00Z`). It stays fixed, even if you show the app on a later date. Authentication still uses real time, so request a new sign-in link when needed. Times outside the journey's timezone may appear differently on another browser; the saved practice date remains stable.

### 1. Introduce the idea and sign in

Say: **“Sankalpa helps you turn an intention into a practice you return to. You choose the tradition, the activities and the schedule.”**

Open `/welcome`, enter `maya@example.test` and select **Send sign-in link**. Open the newest message addressed to Maya in the captured inbox. Follow its action link in the same browser profile. If it opens in a different default browser, copy the link into the original profile; do not display or save the private URL in presentation materials.

There is no demo password and no Gmail dependency. This is the actual local email-link authentication flow, with mail captured inside the local stack.

### 2. Complete a morning practice

On **Today**, choose **Morning grounding** from **Your journey**. This civil-date journey has 21 daily sessions, starting 6 September at 05:00 with a 60-minute completion window.

Select **Open practice** (**Continue practice** if you already checked an activity during an earlier attempt). Check **Sit quietly**, then **Set an intention**. Wait until each value is saved and the completion button is available. Select **Complete this session**.

Expected: **Your practice is recorded.** and **On schedule.** Select **Done**, staying online. Today shows **1 of 21 completed, 20 upcoming, 5% complete**, with the next morning practice on 7 September at 05:00. Refresh the page: the completion remains. The 5% is the rounded value of 1/21.

Say: **“A checklist is progress; confirmation is the completed session. Refreshing shows that the result is actually saved.”**

### 3. Preserve a reflection

Open **View recorded practice**. In the private reflection editor, write:

> I began quietly and returned my attention to the present. शांत.

Click **Save reflection** and wait until the **Private reflection** section says **Saved.** A local draft message alone does not mean the reflection has reached the journal. Open **Journal**. Enter `returned` in **Reflection contains**, then select **Apply filters**. The saved reflection should appear. Clear the filter when finished.

Say: **“The journal preserves what the practice meant to you, in your own language.”**

### 4. Show honest accountability

Open **Journeys**, then **21-night Sankalpa**. Its example practices are **Kunjika** and **Bhairav Stotra**; these are editable examples, not a required tradition.

Open the first session from the journey's session list. Only Kunjika was checked in the seed. Its midnight-to-04:00 window has already closed, so the record is **partial** and earns no completed-session credit. The history retains the closure result. The session belongs to **Night 1 / 5 September**, although its actual start was 00:00 on 6 September: this example explicitly uses previous-evening attribution.

Leave this record partial during the short demonstration. Historical corrections and actual practice times can be explored separately without silently turning a partial day into an on-time completion.

### 5. Show the bigger picture

Open **Calendar** to see the month overview. For the morning journey, select **September 2026**, choose **Morning grounding**, enter **2026-09-06** in **Practice date (optional)**, then **Apply filters**. Show the completed first date and remaining dates in the month grid. Select **Session list** and apply again to show that day's record. End at **Today** with the morning journey selected.

Current limitation: despite its optional label, an empty practice date is rejected on form submission. Keep the explicit date above for this presentation; the defect is recorded as SK-005-P2. A direct unfiltered Calendar navigation still shows the whole month.

Say: **“You can see what happened, what is ahead and where there are gaps—without changing the meaning of a missed or partial day.”**

Optional privacy check: in a separate browser profile, sign in as `arun@example.test` through that profile's own captured-link request. Arun begins without Maya's journeys or reflections. Do not switch the presenter's account while unsaved edits are pending.

## Reset deliberately, repeat, or stop

### Repeat the same presentation

**This resets application data for the marked local demo accounts, including any notes and journeys you created as Maya or Arun.** It preserves unrelated accounts and refuses mismatched markers or unexpected schema. Save anything you want to retain first. While still online, let pending edits finish syncing and **Sign out** to clear this browser's local account records. Alternatively, use a fresh dedicated browser profile after the reset; do not reopen old signed-in tabs against the reset fixture. Then stop the app with **Ctrl-C**, close old practice tabs and run:

```sh
./setup.sh --reset-demo
```

The script rebuilds and starts the demo after the explicit reset. Request a fresh sign-in link if the existing session is unavailable. Do not use a database reset, delete Docker volumes or bypass a seed guard to prepare a presentation.

### Show a prefilled 33% progress example

For a progress-focused presentation, deliberately replace the demo fixture with `M2` instead. This is the **same demo namespace**, not an additional independent dataset. Follow the same save, sync, sign-out and stop procedure above first:

```sh
fnm exec --using 24.20.0 npm run demo:seed -- --profile M2
DEMO_CLOCK_FILE="$PWD/.local/demo-clock.json" fnm exec --using 24.20.0 npm run start
```

Select **21-night Sankalpa**. The fixture has **7 of 21 completed · 14 upcoming · 33% complete**, with the next practice at midnight on 13 September 2026 in Asia/Kolkata. The fixed clock is 12 September 04:01 in that timezone. Return to the `M3` reset above before following the five-minute script again.

### Stop or use real-time development

Press **Ctrl-C** in the app terminal, then `fnm exec --using 24.20.0 npm run db:stop` to stop the local backend while keeping its data. To restart later, use the earlier restart sequence. No process is expected to survive a reboot or a new agent session.

The script's Node selection applies inside its process. Before using manual npm commands in a new terminal, select the pinned Node as shown in the advanced setup section below. For development on the already-seeded `M3` fixture, `npm run dev:demo -- --profile M3` builds the public offline shell and starts Next's development server with the fixed clock. For ordinary real-time local development, use `npm run dev`; old demo dates will then be in the past. Do not use the real-time command accidentally during a scripted presentation.

## Ports and checkouts

`npm run db:status` prints safe app/mail addresses for the **current checkout**. Slot allocation is recorded privately in `.local/runtime.json`; do not edit that file or transplant it into another clone.

| Checkout                        | Slot | App  | Mail  | Backend API / database |
| ------------------------------- | ---- | ---- | ----- | ---------------------- |
| Fresh clone on a fresh machine  | 0    | 3000 | 54324 | 54321 /54322           |
| Current maintainer checkout     | 1    | 3001 | 54424 | 54421 /54422           |
| Unfinished reminder integration | 2    | 3002 | 54524 | 54521 /54522           |

The setup script selects an unused slot for a fresh checkout, excluding registered worktrees, stopped Docker containers/volumes/networks and occupied app/test/backend ports. Existing checkouts retain their allocated slot. On the maintainer's Mac, legacy slot 0 is preserved; leave it untouched. For advanced manual setup, select a free slot during a genuinely new checkout's **initial** `workspace:prepare` call (for example `--slot 3` only after checking it is free). The wrapper rejects occupied ports. An already-allocated checkout keeps its slot; supplying another number does not move its services.

## Setup and recovery

`./setup.sh` is the normal entry point. It wraps the repository's existing guarded tools; the launcher adds no production service or runtime dependency. It supports `--no-open`, `--reset-demo`, and `--help`.

- **Fresh setup:** a new runtime is allocated only after checking existing local resources; then M3 is seeded. If setup was interrupted after allocation and no ready fixture exists, automatic seeding is refused. Deliberately use `--reset-demo` only after confirming this is your disposable synthetic demo.
- **Repeat setup:** a ready M1, M2 or M3 fixture and its exact clock are preserved. Missing, incomplete or invalid metadata/clock is a recovery condition, not permission to erase records.
- **Isolation:** only a local Docker socket is accepted. Inherited shell database, origin, port and clock settings are removed from child processes so the generated checkout configuration is authoritative. Existing manually edited `.env.local` values retain the local wrapper's ownership protection.
- **Concurrency:** an occupied app/test port or `.local/setup.lock` prevents installation/build. The lock stays held while the script's app runs. Ctrl-C stops its owned process group, waits for shutdown and releases the lock; database volumes are retained.
- **Failure:** the terminal identifies the failed stage. Details are in private, ignored `.local/setup.log`; inspect locally and do not publish credentials or authentication links from logs.
- **Unexpected hard interruption:** first check the recorded checkout, app/test ports and running setup/build processes. Only after confirming that no setup or owned child is running, remove the empty stale lock with `rmdir .local/setup.lock`, then rerun. Never delete `.local`, `.env.local` or database volumes as a repair shortcut.

<details>
<summary>Advanced: run the individual commands manually</summary>

For a fresh checkout with prerequisites installed and default ports free:

```sh
eval "$(fnm env --shell zsh)"
fnm install 24.20.0
fnm use 24.20.0
npm install --global npm@11.19.0
npm ci --include=dev
npm run workspace:prepare -- --slot 0
npm run db:start
npm run db:migrate
npm run demo:seed -- --profile M3
npm run build
DEMO_CLOCK_FILE="$PWD/.local/demo-clock.json" npm run start
```

Use the slot guidance above for another checkout. Do not repeat the seed step against an edited demo without the explicit reset precautions. The fixed-clock environment variable is essential for a production-mode presentation; a plain `npm run start` uses real time.

</details>

## Quick recovery

| Symptom                                            | What to do                                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker connection error                            | Open Docker Desktop, wait for its engine, then rerun `npm run db:start`.                                                                                               |
| Port already in use                                | Check the existing app tab/terminal and `npm run db:status`. Reuse or stop your existing server; do not kill an unknown process.                                       |
| No sign-in email in Gmail                          | Use the captured local inbox above. All demo mail stays local.                                                                                                         |
| Link invalid, expired or opened in another browser | Request a new link from the browser profile you intend to use; open its newest message there.                                                                          |
| Calendar/session dates seem wrong                  | Look for the simulated-clock badge and restart with `DEMO_CLOCK_FILE` set. Select September 2026.                                                                      |
| Expected fresh fixture values differ               | You are viewing retained demo edits. Use the deliberate `M3` reset, or keep those edits and adjust the presentation.                                                   |
| Seed refuses schema/account markers                | Check the branch, allocated slot and [handoff](PROJECT_PROGRESS.md). Do not weaken the guard or reset private data. M4 has a different unfinished schema.              |
| Calendar says “Choose calendar dates”              | Select **Reset calendar filters**, then provide both a journey and an explicit practice date before applying. Empty optional fields are a recorded defect (SK-005-P2). |
| Offline navigation shows a network error           | Restore connectivity. This is the known [P1](handoffs/SK-008-independent-review.md); use the online presentation until corrected.                                      |

## Verification and boundaries

Guide checked against accepted main application `23f15b2`, current scripts and deterministic fixture source on **2026-09-06**. The root welcome page returned HTTP 200 and supplied the README hero. The new launcher was also executed in a separate fresh local clone: dependency installation, isolated slot allocation, PostgreSQL/auth startup, migrations, M3 seed, production build and ready-page check succeeded. Real local sign-in, checklist confirmation, online Done navigation, persisted 1/21 progress and multilingual journal matching/nonmatching search passed in Chromium. See [retained evidence and limits](evidence/demo-launcher/manifest.md). The maintainer's existing demo was not reseeded.

Source of reproducible behavior: [local wrapper](../scripts/local.mjs), [app launcher](../scripts/run-next.mjs), [guarded seed](../scripts/seed.ts), [demo profiles](../scripts/seed-profiles.ts), [fixture identities and clock](../tests/fixtures/ids.ts), and [dependency pins](../package.json). Prerequisite instructions were checked against official [fnm](https://github.com/Schniz/fnm#installation), [Docker for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) and [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) documentation on the same date.

Real phone push, PDF, themes/audio, hosted access and full release approval are outside this demonstrated slice. Refer to [TASKS](TASKS.md) for authoritative task status and [PROJECT_PROGRESS](PROJECT_PROGRESS.md) for implementation resume instructions.
