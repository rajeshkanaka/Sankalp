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

Specification complete; application implementation has not started. No dependencies, accounts, notification services, or deployment have been configured.

## Documents

- [Full application specification](docs/APP_SPECIFICATION.md): product requirements, screen behavior, spiritual visual design, midnight scheduling, reminders, data model, architecture, privacy, and acceptance criteria.
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): ordered build milestones and release checks.

## Personalized journeys

Each user chooses their own practices or stotras, targets, duration, weekdays, time, timezone, reminders, theme, and sound. Begin with a blank journey or an editable template. Morning and daytime practices use normal calendar dates; overnight attribution is an explicit option.

## Optional example template

21 nights of Kunjika and Bhairav Stotra, with chanting scheduled at midnight and opt-in reminders starting at 10 PM. In this template, a night belongs to its evening date, so the night of 5 September has a practice time of 00:00 on 6 September.

## Implementation direction

Mobile-first installable web application with authenticated private storage and a server-side reminder scheduler. The specification proposes technologies without installing or pinning them. Verify current supported versions and hosting capabilities before implementation.
