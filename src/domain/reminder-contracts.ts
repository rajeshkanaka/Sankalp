import type { Id, ReminderPreferences } from './contracts';

export interface ReminderPreviewItem {
  sessionId: Id;
  practiceDate: string;
  timeZone: string;
  offsetMinutes: number;
  scheduledAt: string;
  expiresAt: string;
  suppressionReason: null | 'disabled' | 'completed' | 'superseded' | 'past' | 'quiet_hours';
}

export interface ReminderPreferenceView {
  journeyId: Id;
  journeyTitle: string;
  revision: number;
  preferences: ReminderPreferences;
  preview: ReminderPreviewItem[];
  activeDeviceCount: number;
  simulated: boolean;
}
