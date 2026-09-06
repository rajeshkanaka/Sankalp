# Sankalpa current checkpoint

- State: **AWAITING_TRIM_REVIEW**; stop after this one PR. [TASKS status table](TASKS.md#1-status-table--startup-reading-ends-after-this-table) is authoritative; D21 overrides older scope.
- Branch: `rajesh_kanaka/budget-scope-offline-fix` from main `5a8411b`; root `/Users/rajesh/sankalpa`, slot 1. PR5 already merged `23f15b2`; P1 correction now passes policy tests and actual Chromium Done/saved-session/calendar navigation, pending new PR integration.
- Restart: `./setup.sh`; preserved local app http://localhost:3001/welcome, DB 54422, API 54421, inbox 54424, tests 3101. Verify processes; do not assume they survive. [DEMO](DEMO.md) contains sign-in instructions.
- Paused M4: `/Users/rajesh/sankalpa-worktrees/SK-009-integration`, `rajesh_kanaka/reminder-integration` at `4d9fd1d`, slot 2. Migration 011 applied; 65 SQL passed / 9 failed; next migration 012. Pending refs: schema `a57388b`, worker `fd613d4`, preferences `e26bffe`; no worker active. Detailed locations: [BRANCHES](BRANCHES.md), lookup only.
- Next: user reviews trimming PR; after explicit resume, integrate approved fix then SK-005-P2 calendar filters, remaining M1–M3 review items and M4 reminders. B01/B02/B03/B04/B06 are in TASKS. Launch M1–M4 + reduced closeout only; no PDF/audio/container/staging/canary work, no provisioning now.
