import { getRuntimeInfo, requiredEnv } from '../config.js';

export function getReminderRuntime() {
  const runtime = getRuntimeInfo();
  const mode =
    process.env.PUSH_TRANSPORT ??
    (['local', 'ci'].includes(runtime.appEnv) ? 'simulated' : requiredEnv('PUSH_TRANSPORT'));
  if (mode !== 'real' && mode !== 'simulated') throw new Error('Invalid PUSH_TRANSPORT.');
  if (mode === 'simulated' && !['local', 'ci'].includes(runtime.appEnv))
    throw new Error('Simulated reminders are prohibited in hosted environments.');
  if (mode === 'real' && runtime.demo) throw new Error('Real reminders cannot use a demo clock.');
  return { ...runtime, simulated: mode === 'simulated' };
}
