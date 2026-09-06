// Harness-only pause after real IndexedDB enqueue, before the UI cleans its raw draft.
export * from '../../src/offline/core';
import type {} from './harness';
import {
  enqueue as actualEnqueue,
  setSharedDevice as actualSetSharedDevice,
  type OfflineCore,
} from '../../src/offline/core';
export const enqueue: OfflineCore['enqueue'] = async (...args) => {
  const result = await actualEnqueue(...args);
  await window.offlineUiHarness.afterEnqueue();
  return result;
};

export const setSharedDevice: OfflineCore['setSharedDevice'] = async (...args) => {
  const result = await actualSetSharedDevice(...args);
  window.offlineUiHarness.afterPrivacyMutation();
  return result;
};
