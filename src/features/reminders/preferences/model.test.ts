import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createReminderAttempt,
  fieldsFromPreferences,
  formatPreviewTime,
  readPreferenceView,
  validateFields,
} from './model';

const preferences = { enabled: false, offsets: [] as number[], quietHours: null, detailed: false };

test('blank choices never enable reminders or create a preset', () => {
  const fields = fieldsFromPreferences(preferences);
  assert.deepEqual(fields, {
    enabled: false,
    offsets: [],
    quietEnabled: false,
    quietStart: '',
    quietEnd: '',
    detailed: false,
  });
  assert.deepEqual(validateFields(fields), { success: true, preferences });
  const enabled = validateFields({ ...fields, enabled: true });
  assert.equal(enabled.success, false);
  if (!enabled.success) assert.match(enabled.issues[0].message, /at least one reminder/);
});

test('raw minute inputs are preserved and invalid text is never coerced to a valid time', () => {
  for (const value of ['', ' ', '1e-', '1.5', '-5', '1441', 'Infinity']) {
    const fields = { ...fieldsFromPreferences(preferences), offsets: [value] };
    const before = structuredClone(fields);
    const result = validateFields(fields);
    assert.equal(result.success, false, value);
    if (!result.success) assert.equal(result.issues[0].field, 'offsets.0');
    assert.deepEqual(fields, before);
  }
  const valid = validateFields({
    ...fieldsFromPreferences(preferences),
    enabled: true,
    offsets: ['1440', '005', '0'],
  });
  assert.deepEqual(valid, {
    success: true,
    preferences: { ...preferences, enabled: true, offsets: [-1440, -5, 0] },
  });
});

test('duplicate, size and quiet-hour validation uses the shared rules even while disabled', () => {
  for (const offsets of [['5', '05'], Array.from({ length: 9 }, (_, index) => String(index))]) {
    const result = validateFields({ ...fieldsFromPreferences(preferences), offsets });
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.issues[0].field, 'offsets');
  }
  for (const [quietStart, quietEnd] of [
    ['09:00', '09:00'],
    ['9:00', '10:00'],
    ['', ''],
  ]) {
    const result = validateFields({
      ...fieldsFromPreferences(preferences),
      quietEnabled: true,
      quietStart,
      quietEnd,
    });
    assert.equal(result.success, false);
  }
  const result = validateFields({
    ...fieldsFromPreferences(preferences),
    quietEnabled: true,
    quietStart: '22:00',
    quietEnd: '06:00',
  });
  assert.deepEqual(result, {
    success: true,
    preferences: { ...preferences, quietHours: { start: '22:00', end: '06:00' } },
  });
});

test('retained retry envelope cannot be changed by the caller or the original input', () => {
  const input = { ...preferences, offsets: [-15, 0], quietHours: { start: '22:00', end: '06:00' } };
  const attempt = createReminderAttempt(input, 4, 'a0000000-0000-4000-8000-000000000001');
  const firstWire = JSON.stringify(attempt);
  input.offsets.push(-30);
  input.quietHours.start = '21:00';
  const callbackCopy = structuredClone(attempt);
  callbackCopy.payload.offsets.push(-60);
  callbackCopy.baseRevision = 9;
  assert.equal(JSON.stringify(structuredClone(attempt)), firstWire);
  assert.equal(Object.isFrozen(attempt), true);
  assert.equal(Object.isFrozen(attempt.payload), true);
  assert.equal(Object.isFrozen(attempt.payload.offsets), true);
  assert.equal(Object.isFrozen(attempt.payload.quietHours), true);
});

test('conflict and receipt views reject foreign journeys and malformed preferences', () => {
  const view = {
    journeyId: 'a0000000-0000-4000-8000-000000000001',
    journeyTitle: 'Synthetic reminder test',
    revision: 2,
    preferences,
    preview: [],
    activeDeviceCount: 0,
    simulated: true,
  };
  assert.deepEqual(readPreferenceView(view, view.journeyId), view);
  assert.equal(readPreferenceView(view, 'a0000000-0000-4000-8000-000000000002'), null);
  assert.equal(
    readPreferenceView({ ...view, preferences: { ...preferences, enabled: true } }, view.journeyId),
    null,
  );
  assert.equal(
    readPreferenceView({ ...view, preview: [{ scheduledAt: 'bad' }] }, view.journeyId),
    null,
  );
});

test('preview times keep the full local date and distinguish both DST-fold instants', () => {
  const kolkata = formatPreviewTime('2026-09-05T23:45:00Z', 'Asia/Kolkata');
  assert.match(kolkata ?? '', /September 6, 2026/);
  assert.match(kolkata ?? '', /05:15:00/);
  assert.match(kolkata ?? '', /GMT\+05:30/);
  const first = formatPreviewTime('2026-11-01T05:30:00Z', 'America/New_York');
  const second = formatPreviewTime('2026-11-01T06:30:00Z', 'America/New_York');
  assert.match(first ?? '', /01:30:00.*GMT-04:00/);
  assert.match(second ?? '', /01:30:00.*GMT-05:00/);
  assert.equal(formatPreviewTime('invalid', 'Asia/Kolkata'), null);
  assert.equal(formatPreviewTime('2026-09-05T23:45:00Z', 'Invalid/Zone'), null);
});
