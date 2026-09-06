export * from './types';
export { OfflineError } from './model';
export { ReplayError } from './transport';
export { createOfflineCore } from './core';
import { createOfflineCore } from './core';
import type { OfflineCore } from './types';
let instance: OfflineCore | undefined;
const core = (): OfflineCore => (instance ??= createOfflineCore());
export const bindAccount: OfflineCore['bindAccount'] = (...args) => core().bindAccount(...args);
export const getDeviceState: OfflineCore['getDeviceState'] = (...args) =>
  core().getDeviceState(...args);
export const saveSnapshot: OfflineCore['saveSnapshot'] = (...args) => core().saveSnapshot(...args);
export const saveDraft: OfflineCore['saveDraft'] = (...args) => core().saveDraft(...args);
export const enqueue: OfflineCore['enqueue'] = (...args) => core().enqueue(...args);
export const read: OfflineCore['read'] = (...args) => core().read(...args);
export const listSavedSessions: OfflineCore['listSavedSessions'] = (...args) =>
  core().listSavedSessions(...args);
export const flush: OfflineCore['flush'] = (...args) => core().flush(...args);
export const refreshConflict: OfflineCore['refreshConflict'] = (...args) =>
  core().refreshConflict(...args);
export const resolve: OfflineCore['resolve'] = (...args) => core().resolve(...args);
export const clearAccount: OfflineCore['clearAccount'] = (...args) => core().clearAccount(...args);
export const setSharedDevice: OfflineCore['setSharedDevice'] = (...args) =>
  core().setSharedDevice(...args);
export const subscribe: OfflineCore['subscribe'] = (...args) => core().subscribe(...args);
