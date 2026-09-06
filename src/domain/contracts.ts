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
export type ScheduleRevisionSettings = Omit<ScheduleInput, 'startDate'>;
export interface ScheduleRevisionCandidate {
  effectivePracticeDate: PracticeDate;
  practices: PracticeDefinition[];
  schedule: ScheduleRevisionSettings;
}
export type ScheduleRevisionRequest =
  | { mode: 'preview'; baseRevision: Revision; payload: ScheduleRevisionCandidate }
  | ({ mode: 'apply' } & MutationEnvelope<{
      candidate: ScheduleRevisionCandidate;
      fingerprint: string;
    }>);
export interface RetainedSessionPreview extends Omit<PlannedOccurrence, 'adjustment'> {
  id: Id;
  scheduleVersionId: Id;
  reason: 'opened' | 'before_effective';
}
export interface RevisionTimestampChange {
  practiceDate: PracticeDate;
  previous: { id: Id; opensAt: IsoInstant; closesAt: IsoInstant } | null;
  proposed: PlannedOccurrence | null;
}
export interface ScheduleRevisionPreview {
  currentRevision: Revision;
  currentScheduleVersionId: Id;
  originalStartDate: PracticeDate;
  effectivePracticeDate: PracticeDate;
  retained: RetainedSessionPreview[];
  supersededSessionIds: Id[];
  proposed: PlannedOccurrence[];
  timestampChanges: RevisionTimestampChange[];
  remainingAllowance: number;
  totalActive: number;
  warnings: string[];
  fingerprint: string;
}
export interface ScheduleRevisionResult {
  view: JourneyView;
  retainedSessionIds: Id[];
  supersededSessionIds: Id[];
  createdSessionIds: Id[];
}
export interface JourneyMetadata {
  title: string;
  intention: string;
}
export interface CompletionTiming {
  practiceTiming: 'on_schedule' | 'practiced_late' | null;
  recordedLater: boolean;
}
export interface SessionListItem extends PlannedOccurrence, CompletionTiming {
  id: Id;
  journeyId: Id;
  journeyTitle: string;
  timeZone: string;
  attribution: ScheduleInput['attribution'];
  status: SessionStatus;
  windowClosed: boolean;
  performedAt: IsoInstant | null;
  recordedAt: IsoInstant | null;
}
export interface JourneyProgressItem {
  journey: JourneyRecord;
  metrics: JourneyMetrics;
  current: SessionListItem | null;
  next: SessionListItem | null;
  timeline: SessionListItem[];
}
export interface ProgressPreferences {
  hideStreaks: boolean;
}
export interface ProgressDashboard {
  now: IsoInstant;
  journeys: JourneyProgressItem[];
  preferences: ProgressPreferences;
}
export interface CalendarView {
  now: IsoInstant;
  from: PracticeDate;
  to: PracticeDate;
  journeys: {
    id: Id;
    title: string;
    timeZone: string;
    attribution: ScheduleInput['attribution'];
    metrics: JourneyMetrics;
  }[];
  sessions: SessionListItem[];
  preferences: ProgressPreferences;
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

export type AmendmentKind =
  'values_saved' | 'confirmed' | 'completion_corrected' | 'completion_removed';
export interface SessionAmendment {
  id: Id;
  sessionId: Id;
  scheduleVersionId: Id;
  kind: AmendmentKind;
  sessionRevision: Revision;
  recordedAt: IsoInstant;
  detail: Record<string, unknown>;
}
export type SessionHistoryEvent = {
  id: Id;
  sessionId: Id;
  journeyId: Id;
  occurredAt: IsoInstant;
  recordedAt: IsoInstant;
  sessionRevision: Revision;
} & (
  | { kind: 'session_closed'; detail: { status: 'complete' | 'partial' | 'missed' } }
  | {
      kind: 'session_corrected';
      amendmentId: Id;
      detail: {
        action: AmendmentKind;
        beforeStatus: SessionStatus;
        afterStatus: SessionStatus;
        beforeTiming: CompletionTiming;
        afterTiming: CompletionTiming;
      };
    }
);
export interface SessionMutationResult {
  session: SessionRecord;
  amendment: SessionAmendment;
  historyEvents: SessionHistoryEvent[];
}
export interface SessionHistory {
  amendments: SessionAmendment[];
  events: SessionHistoryEvent[];
}
export interface ReflectionRecord {
  sessionId: Id;
  journeyId: Id;
  scheduleVersionId: Id;
  text: string;
  moods: string[];
  revision: Revision;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
}
export interface ReflectionPayload {
  text: string;
  moods: string[];
}
/** Safe receipt acknowledgement. Never persist reflection text/moods in receipts. */
export interface ReflectionMutationResult {
  sessionId: Id;
  revision: Revision;
  updatedAt: IsoInstant;
}
export type ReflectionPromptId = 'noticed' | 'carry_tomorrow';
export interface ReflectionPreferences {
  prompts: ReflectionPromptId[];
}
export interface JournalQuery {
  journeyId?: Id;
  from?: PracticeDate;
  to?: PracticeDate;
  mood?: string;
  text?: string;
  cursor?: string;
  limit?: number;
}
export interface JournalEntry {
  sessionId: Id;
  journeyId: Id;
  journeyTitle: string;
  practiceDate: PracticeDate;
  status: SessionStatus;
  completionTiming: CompletionTiming;
  textPreview: string;
  moods: string[];
  reflectionRevision: Revision;
  updatedAt: IsoInstant;
}
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
