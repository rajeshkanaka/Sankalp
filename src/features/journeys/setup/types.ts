import type { JourneyDraft, PracticeDefinition, ScheduleInput } from '@/domain/contracts';

export type PracticeKind = PracticeDefinition['kind'];
export type DurationMode = ScheduleInput['durationMode'];
export type Attribution = ScheduleInput['attribution'];

export interface PracticeInput {
  key: number;
  id?: string;
  label: string;
  kind: PracticeKind;
  target: string;
}

export interface SetupValues {
  title: string;
  intention: string;
  practices: PracticeInput[];
  startDate: string;
  durationMode: DurationMode;
  duration: string;
  daily: boolean;
  weekdays: number[];
  localTime: string;
  timeZone: string;
  attribution: Attribution;
  windowMinutes: string;
  reminderOffsets: number[];
}

export const WEEKDAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
] as const;

export function createJourneyDraft(values: SetupValues): JourneyDraft {
  return {
    title: values.title.trim(),
    intention: values.intention.trim(),
    practices: values.practices.map((practice, order) => {
      const common = {
        id: practice.id ?? crypto.randomUUID(),
        label: practice.label.trim(),
        order,
      };
      return practice.kind === 'checkbox'
        ? { ...common, kind: 'checkbox', target: null }
        : { ...common, kind: practice.kind, target: Number(practice.target) };
    }),
    schedule: {
      startDate: values.startDate,
      durationMode: values.durationMode,
      durationValue: Number(values.duration),
      weekdays: values.daily ? WEEKDAYS.map(({ value }) => value) : values.weekdays,
      localTime: values.localTime,
      timeZone: values.timeZone.trim(),
      attribution: values.attribution,
      windowMinutes: Number(values.windowMinutes),
    },
    reminders: {
      enabled: false,
      offsets: values.reminderOffsets,
      quietHours: null,
      detailed: false,
    },
  };
}

export function setupValuesFromDraft(draft: JourneyDraft): SetupValues {
  return {
    title: draft.title,
    intention: draft.intention,
    practices: draft.practices.map((practice, index) => ({
      key: index + 1,
      id: practice.id,
      label: practice.label,
      kind: practice.kind,
      target: practice.target === null ? '' : String(practice.target),
    })),
    startDate: draft.schedule.startDate,
    durationMode: draft.schedule.durationMode,
    duration: String(draft.schedule.durationValue),
    daily:
      draft.schedule.weekdays.length === WEEKDAYS.length &&
      WEEKDAYS.every(({ value }) => draft.schedule.weekdays.includes(value)),
    weekdays: [...draft.schedule.weekdays],
    localTime: draft.schedule.localTime,
    timeZone: draft.schedule.timeZone,
    attribution: draft.schedule.attribution,
    windowMinutes: String(draft.schedule.windowMinutes),
    reminderOffsets: [...draft.reminders.offsets],
  };
}

export function draftSignature(draft: JourneyDraft) {
  return JSON.stringify({
    ...draft,
    practices: draft.practices.map(({ label, order, kind, target }) => ({
      label,
      order,
      kind,
      target,
    })),
  });
}
