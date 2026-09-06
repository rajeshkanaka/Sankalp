import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
export function getRuntimeInfo() {
  const appEnv = requiredEnv('APP_ENV');
  if (!['local', 'ci', 'staging', 'production'].includes(appEnv))
    throw new Error('Invalid APP_ENV');
  const clock = process.env.DEMO_CLOCK_FILE;
  if (clock && !['local', 'ci'].includes(appEnv))
    throw new Error('Demonstration clock prohibited in hosted environments.');
  const now: string = clock
    ? JSON.parse(readFileSync(resolve(clock), 'utf8')).now
    : new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid demonstration clock.');
  return { demo: Boolean(clock), now, appEnv };
}
export function getOrigin() {
  const origin = new URL(requiredEnv('APP_ORIGIN'));
  const { appEnv } = getRuntimeInfo();
  if (['staging', 'production'].includes(appEnv) && origin.protocol !== 'https:')
    throw new Error('Hosted app requires HTTPS.');
  return origin.origin;
}
