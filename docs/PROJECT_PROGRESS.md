# Sankalpa current handoff

Updated **2026-09-06, Asia/Kolkata**. Read this document from **origin/main** first. [TASKS](TASKS.md) is the only task-status authority; [BRANCHES](BRANCHES.md) maps every active and historical worktree.

| Field | Current checkpoint |
|---|---|
| Project state | **RESUMING_MAIN_CONSOLIDATION** |
| Authorization | User resumed continuous implementation and explicitly authorized PRs/merges, commits and pushes. D18 makes main the accepted source of context. D10 visual pauses remain waived; technical gates remain required. |
| Current milestone | M3 correction history, private journal and offline recovery. Native accessibility B06 remains unresolved under D12; merging tested increments does not close it. |
| Accepted application | Overnight application checkpoint ef6e0a9 is the basis of the consolidation PR. Real sign-in, personalized schedules, progress/calendar, corrections/journal and HTTP account guards are integrated. Unfinished offline source is excluded from main. |
| Current integration | rajesh_kanaka/consolidate-main at /Users/rajesh/sankalpa. Review fix: rajesh_kanaka/closure-history-fix, narrow SK-006 scope. Actual PR/merge reference will be recorded after it exists. |
| Remaining source | Only task/SK-008-core86769b5 and task/SK-008-ui3d54c3b contain useful unintegrated source. Their exact worktrees and reports are in BRANCHES and SK-008 coordinator handoff. All other old task branches are historical. |
| Fresh verification | Resume npm verify PASS: formatting/lint/types,115unit,83database,production build and actual Chromium smoke. Hosted CI33995477654 for ef6e0a9 SUCCESS, including full UI and audits. Evidence from the overnight50/50 UI run remains docs/evidence/M3/morning-checkpoint. Consolidation changes require their own checks. |
| Active task references | SK-006 cross-tab closing-history review fix; SK-008 reconciliation and remaining core/UI/app integration. TASKS holds owners/status; BRANCHES holds locations. |
| Local runtime | Root slot1 restarted; Node24.20.0/npm11.19.0, PostgreSQL17.6, migrations001–008. Loopback API54421/DB54422/Mail54424. App3001 and UI3101 only run when explicitly launched. Old slot0 remains stopped/preserved per D16. |
| External inputs | Minimum cost and local quality first. Samsung S25 Ultra available; email supplied privately. B01–B05 remain provider/domain/retention/iPhone/release prerequisites. No paid service or real sending provisioned. |
| Exact next action | Verify and integrate SK-006 closure-history fix, finish consolidation PR checks, merge to main, fast-forward local main and record actual merge. Then resume SK-008 from its stale-comparison regression using the main-based branch route in BRANCHES. |

Restart in the recorded coordinator checkout: `fnm use 24.20.0`; `npm run db:start`; `npm run db:status`; `npm run build`; `npm run test:smoke`. For the visible preserved M3 demo, run `npm run dev:demo -- --profile M3` and open **http://localhost:3001/welcome**. Do not assume any app process survived. Database/environment recovery is [SK-006-runtime](handoffs/SK-006-runtime.md); never reset preserved legacy slot0.

Current resume pointers: [SK-008 coordinator handoff](handoffs/SK-008.md), [historical break checkpoint](handoffs/SK-008-break.md), D15 history/journal and D17 offline interfaces. Read the active branch's task report only after main's accepted checkpoint. Native B06 remains NOT RUN for unobserved VoiceOver/authenticated checks; all prior desktop settings were restored. No completed app or user visual approval is implied.
