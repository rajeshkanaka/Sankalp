'use client';
import { requestJson } from '@/components/api';
import type { ReminderPreferenceView } from '@/domain/reminder-contracts';
import { ReminderPreferencesForm } from './preferences';
export function ReminderPreferencesClient({ initial }: { initial: ReminderPreferenceView }) {
  return (
    <ReminderPreferencesForm
      initial={initial}
      onSave={(input) =>
        requestJson<ReminderPreferenceView>(
          `/api/journeys/${initial.journeyId}/reminders`,
          'PUT',
          input,
          input.operationId,
        )
      }
    />
  );
}
