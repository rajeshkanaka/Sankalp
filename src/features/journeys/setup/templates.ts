import type { SetupValues } from './types';

export const blankSetupValues: SetupValues = {
  title: '',
  intention: '',
  practices: [{ key: 1, label: '', kind: 'checkbox', target: '' }],
  startDate: '',
  durationMode: 'occurrences',
  duration: '',
  daily: true,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  localTime: '',
  timeZone: '',
  attribution: 'civil',
  windowMinutes: '',
  reminderOffsets: [],
};

export function twentyOneNightTemplate(): SetupValues {
  return {
    ...blankSetupValues,
    title: '21-night Sankalpa',
    practices: [
      { key: 1, label: 'Kunjika', kind: 'checkbox', target: '' },
      { key: 2, label: 'Bhairav Stotra', kind: 'checkbox', target: '' },
    ],
    duration: '21',
    localTime: '00:00',
    timeZone: 'Asia/Kolkata',
    attribution: 'previous_evening',
    windowMinutes: '240',
    reminderOffsets: [-120, -30, -5, 0],
  };
}
