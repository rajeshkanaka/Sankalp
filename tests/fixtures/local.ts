import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { FIXTURE_NAMESPACES, FIXTURE_PROFILE, type FixtureNamespace } from './ids';

const runtimeSchema = z
  .object({
    root: z.string().min(1),
    slot: z.number().int().min(0).max(50),
    port: z.number().int(),
    testPort: z.number().int(),
    apiPort: z.number().int(),
    dbPort: z.number().int(),
    mailPort: z.number().int(),
    projectId: z.string().min(1),
  })
  .strict();

export type LocalRuntime = z.infer<typeof runtimeSchema>;

export interface SeedArguments {
  profile: typeof FIXTURE_PROFILE;
  namespace: FixtureNamespace;
}

export function parseSeedArguments(argv: string[]): SeedArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--profile', '--namespace'].includes(flag) || !value || values.has(flag))
      throw new Error('Usage: npm run demo:seed -- --profile M1 [--namespace demo|ui|integration]');
    values.set(flag, value);
  }
  if (values.get('--profile') !== FIXTURE_PROFILE)
    throw new Error('Only the M1 synthetic seed profile is available.');
  const namespace = values.get('--namespace') ?? 'demo';
  if (!FIXTURE_NAMESPACES.includes(namespace as FixtureNamespace))
    throw new Error('Fixture namespace must be demo, ui, or integration.');
  return { profile: FIXTURE_PROFILE, namespace: namespace as FixtureNamespace };
}

interface EnvironmentInput {
  cwd: string;
  runtime: unknown;
  appEnv: string | undefined;
  adminDatabaseUrl: string | undefined;
  supabaseUrl: string | undefined;
}

export interface GuardedLocalRuntime extends LocalRuntime {
  root: string;
  adminDatabaseUrl: string;
  supabaseUrl: string;
}

function parseLoopbackUrl(value: string | undefined, name: string): URL {
  if (!value) throw new Error(`Missing ${name}. Run npm run db:start or npm run env:local.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL.`);
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error(`${name} must target the allocated loopback service.`);
  return url;
}

export function validateLocalSeedEnvironment(input: EnvironmentInput): GuardedLocalRuntime {
  if (!['local', 'ci'].includes(input.appEnv ?? ''))
    throw new Error('Synthetic seeding requires APP_ENV=local or APP_ENV=ci.');
  const runtime = runtimeSchema.parse(input.runtime);
  const root = resolve(input.cwd);
  if (resolve(runtime.root) !== root)
    throw new Error('Runtime belongs to another worktree; refusing to seed it.');
  if (
    runtime.port !== 3000 + runtime.slot ||
    runtime.testPort !== 3100 + runtime.slot ||
    runtime.apiPort !== 54321 + runtime.slot * 100 ||
    runtime.dbPort !== 54322 + runtime.slot * 100 ||
    runtime.mailPort !== 54324 + runtime.slot * 100 ||
    runtime.projectId !== `sankalpa-slot-${runtime.slot}`
  )
    throw new Error('Runtime allocation does not match the selected worktree slot.');

  const database = parseLoopbackUrl(input.adminDatabaseUrl, 'LOCAL_ADMIN_DATABASE_URL');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    Number(database.port) !== runtime.dbPort ||
    database.username !== 'postgres' ||
    database.pathname !== '/postgres' ||
    database.search ||
    database.hash
  )
    throw new Error('LOCAL_ADMIN_DATABASE_URL does not match the allocated local database.');

  const supabase = parseLoopbackUrl(input.supabaseUrl, 'SUPABASE_URL');
  if (
    supabase.protocol !== 'http:' ||
    Number(supabase.port) !== runtime.apiPort ||
    !['', '/'].includes(supabase.pathname) ||
    supabase.username ||
    supabase.password ||
    supabase.search ||
    supabase.hash
  )
    throw new Error('SUPABASE_URL does not match the allocated local API.');

  return {
    ...runtime,
    root,
    adminDatabaseUrl: database.href,
    supabaseUrl: supabase.origin,
  };
}

export function loadGuardedLocalRuntime(
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): GuardedLocalRuntime {
  let runtime: unknown;
  try {
    runtime = JSON.parse(readFileSync(resolve(cwd, '.local/runtime.json'), 'utf8'));
  } catch {
    throw new Error('Missing or invalid .local/runtime.json. Run npm run workspace:prepare first.');
  }
  return validateLocalSeedEnvironment({
    cwd,
    runtime,
    appEnv: environment.APP_ENV,
    adminDatabaseUrl: environment.LOCAL_ADMIN_DATABASE_URL,
    supabaseUrl: environment.SUPABASE_URL,
  });
}
