# Sankalpa

**Sankalpa is a personal spiritual commitment companion designed to help users turn a sincere intention into consistent daily practice.** It addresses a common challenge: people take a sankalp with devotion but struggle to maintain the schedule, remember each session, and track their progress through completion.

Whether the commitment is 21 days of stotra pathana, daily puja, mantra japa, meditation, or another practice, the app should help users:

- **Define their sankalp:** Record the intention, practices, daily targets, start date, duration, and preferred practice time.
- **Arrive prepared:** Receive configurable reminders before and at the scheduled time, with a countdown to the next session.
- **Record daily practice:** Mark individual activities complete and confirm the session once all required targets are met.
- **See progress clearly:** View completed sessions, upcoming sessions, missed or partial days, completion percentage, and consistency through a dashboard and calendar.
- **Maintain accountability:** Keep an honest history of on-time, late, and missed practice, helping users recognize gaps and follow their chosen routine with discipline.
- **Preserve the journey:** Add private daily reflections and download a summary of their practice and progress.

## Example journey

Someone undertaking **21 days of morning puja at 6 AM** could choose reminders at 5:30 and 5:55 AM, complete the daily checklist, and see:

> 7 of 21 sessions completed · 14 upcoming · 33% complete · Next practice tomorrow at 6 AM.

## Experience and purpose

The experience should feel calm, spiritually meaningful, personal, and easy to use. Its purpose is to support disciplined follow-through through timely prompts and visible accountability, while respecting the user's own tradition and choices. The planned reminders support this routine; they should not be presented as guaranteed wake-up alarms.

## Project status

Implementation follows the approved repository plan. See [the current project handoff](docs/PROJECT_PROGRESS.md) for the approval gate and exact next action; [TASKS](docs/TASKS.md) is the only task-status register.

**Resume from `main`.** Its [progress](docs/PROJECT_PROGRESS.md), [session log](docs/SESSION_LOG.md) and [branch/worktree map](docs/BRANCHES.md) identify the accepted app and any unfinished worker branches. Historical worker copies of these documents are not the current project checkpoint.

## Documents

- [Shared agent instructions](AGENTS.md) and [Claude adapter](CLAUDE.md): start/resume, checkpoints, ownership and verification rules.
- [Application specification](docs/APP_SPECIFICATION.md): product behavior and A01–A27 acceptance requirements.
- [Complete implementation plan](docs/PROJECT_PLAN.md): one stack/architecture, runnable milestones, setup, demos, tests and deployment approach.
- [Task register](docs/TASKS.md): accountable execution, dependencies, ownership, acceptance and evidence.
- [Current handoff](docs/PROJECT_PROGRESS.md), [decisions and verified sources](docs/DECISIONS.md), [session log](docs/SESSION_LOG.md): durable project context and approvals.

## Personalized journeys

Each user chooses their own practices or stotras, targets, duration, weekdays, time, timezone, reminders, theme, and sound. Begin with a blank journey or an editable template. Morning and daytime practices use normal calendar dates; overnight attribution is an explicit option.

## Optional example template

21 nights of Kunjika and Bhairav Stotra, with chanting scheduled at midnight and opt-in reminders starting at 10 PM. In this template, a night belongs to its evening date, so the night of 5 September has a practice time of 00:00 on 6 September.

## Implementation direction

Mobile-first installable web application with authenticated private storage and a server-side reminder worker. The selected stack, exact version baseline, rationale and official verification sources are in [DECISIONS](docs/DECISIONS.md). Commands in the implementation plan are explicitly marked planned until their owning task creates and verifies them.
