import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateLocalSeedEnvironment, type GuardedLocalRuntime } from '../fixtures/local';

interface EnvironmentInput {
  cwd: string;
  runtime: unknown;
  appEnv: string | undefined;
  adminDatabaseUrl: string | undefined;
  applicationDatabaseUrl: string | undefined;
  supabaseUrl: string | undefined;
  supabaseSecretKey: string | undefined;
}

export interface GuardedIntegrationRuntime extends GuardedLocalRuntime {
  applicationDatabaseUrl: string;
}

export interface SyntheticMarker {
  version: 1;
  task: 'SK-001';
  suite: 'activation' | 'auth-boundaries';
  account: string;
}

export interface SyntheticUserShape {
  email?: string;
  app_metadata: Record<string, unknown>;
}

export const SYNTHETIC_MARKER_KEY = 'sankalpa_fixture' as const;

function validateApplicationDatabaseUrl(value: string | undefined, port: number): string {
  if (!value) throw new Error('Integration environment is missing DATABASE_URL.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    Number(url.port) !== port ||
    url.username !== 'app_api' ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash
  )
    throw new Error('DATABASE_URL does not match the allocated local postgres database.');
  return url.href;
}

export function validateLocalIntegrationEnvironment(
  input: EnvironmentInput,
): GuardedIntegrationRuntime {
  const runtime = validateLocalSeedEnvironment({
    cwd: input.cwd,
    runtime: input.runtime,
    appEnv: input.appEnv,
    adminDatabaseUrl: input.adminDatabaseUrl,
    supabaseUrl: input.supabaseUrl,
  });
  const applicationDatabaseUrl = validateApplicationDatabaseUrl(
    input.applicationDatabaseUrl,
    runtime.dbPort,
  );
  if (!input.supabaseSecretKey)
    throw new Error('Integration environment is missing LOCAL_SUPABASE_SECRET_KEY.');
  return { ...runtime, applicationDatabaseUrl };
}

export function loadGuardedIntegrationRuntime(cwd = process.cwd()): GuardedIntegrationRuntime {
  if (!process.env.DATABASE_URL) {
    const environmentPath = resolve(cwd, '.env.local');
    if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
  }

  let runtime: unknown;
  try {
    runtime = JSON.parse(readFileSync(resolve(cwd, '.local/runtime.json'), 'utf8'));
  } catch {
    throw new Error('Missing or invalid .local/runtime.json. Run npm run workspace:prepare first.');
  }

  return validateLocalIntegrationEnvironment({
    cwd,
    runtime,
    appEnv: process.env.APP_ENV,
    adminDatabaseUrl: process.env.LOCAL_ADMIN_DATABASE_URL,
    applicationDatabaseUrl: process.env.DATABASE_URL,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseSecretKey: process.env.LOCAL_SUPABASE_SECRET_KEY,
  });
}

export function buildSyntheticMarker(
  suite: SyntheticMarker['suite'],
  account: string,
): SyntheticMarker {
  return { version: 1, task: 'SK-001', suite, account };
}

export function isExpectedSyntheticUser(
  user: SyntheticUserShape,
  expectedEmail: string,
  expectedMarker: SyntheticMarker,
): boolean {
  const marker = user.app_metadata[SYNTHETIC_MARKER_KEY];
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false;
  const values = marker as Record<string, unknown>;
  return (
    user.email === expectedEmail &&
    Object.keys(values).sort().join(',') === 'account,suite,task,version' &&
    values.version === expectedMarker.version &&
    values.task === expectedMarker.task &&
    values.suite === expectedMarker.suite &&
    values.account === expectedMarker.account
  );
}
