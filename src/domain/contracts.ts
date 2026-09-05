export type Id = string;
export type IsoInstant = string;
export type PracticeDate = string;
export type Revision = number;
export type PracticeDefinition = { id: Id; label: string; order: number } & (
  { kind: 'checkbox'; target: null } | { kind: 'repetitions' | 'minutes'; target: number }
);
export interface ScheduleInput {
  startDate: PracticeDate;
  durationMode: 'calendar_days' | 'occurrences';
  durationValue: number;
  weekdays: number[];
  localTime: string;
  timeZone: string;
  attribution: 'civil' | 'previous_evening';
  windowMinutes: number;
}
export interface ReminderPreferences {
  enabled: boolean;
  offsets: number[];
  quietHours: { start: string; end: string } | null;
  detailed: boolean;
}
export interface JourneyDraft {
  title: string;
  intention: string;
  practices: PracticeDefinition[];
  schedule: ScheduleInput;
  reminders: ReminderPreferences;
}
export interface PlannedOccurrence {
  ordinal: number;
  practiceDate: PracticeDate;
  opensAt: IsoInstant;
  closesAt: IsoInstant;
  adjustment: string | null;
}
export interface SchedulePreview {
  occurrences: PlannedOccurrence[];
  total: number;
  warnings: string[];
}
export interface SessionPractice extends Omit<PracticeDefinition, 'kind' | 'target'> {
  kind: 'checkbox' | 'repetitions' | 'minutes';
  target: number | null;
  value: boolean | number;
}
export interface SessionRecord extends PlannedOccurrence {
  id: Id;
  journeyId: Id;
  scheduleVersionId: Id;
  timeZone: string;
  attribution: 'civil' | 'previous_evening';
  practices: SessionPractice[];
  confirmed: boolean;
  performedAt: IsoInstant | null;
  recordedAt: IsoInstant | null;
  revision: Revision;
  supersededAt: IsoInstant | null;
}
export type SessionStatus = 'upcoming' | 'open' | 'partial' | 'complete' | 'missed';
export interface JourneyMetrics {
  total: number;
  complete: number;
  partial: number;
  missed: number;
  upcoming: number;
  open: number;
  percent: number;
  onScheduleRatio: number | null;
  currentStreak: number;
  longestStreak: number;
  ended: boolean;
  fullyCompleted: boolean;
}
export interface JourneyRecord extends JourneyDraft {
  id: Id;
  state: 'draft' | 'active' | 'archived';
  revision: Revision;
  activeScheduleVersionId: Id | null;
  createdAt: IsoInstant;
}
export interface JourneyView {
  journey: JourneyRecord;
  sessions: SessionRecord[];
  metrics: JourneyMetrics;
  now: IsoInstant;
}
export interface ReminderTimePreview {
  practiceDate: PracticeDate;
  offsetMinutes: number;
  scheduledFor: IsoInstant;
  isPast: boolean;
}
export interface JourneyDraftPreview {
  journey: JourneyRecord;
  preview: SchedulePreview;
  fingerprint: string;
  reminderTimes: ReminderTimePreview[];
}
export interface MutationEnvelope<T> {
  operationId: Id;
  baseRevision: Revision;
  payload: T;
}
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    correlationId: string;
    fields?: Record<string, string[]>;
    current?: unknown;
  };
}
