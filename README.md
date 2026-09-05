# Sankalpa

A private, spiritually crafted companion for daily commitments, chanting sessions, reflections, and gentle reminders.

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
