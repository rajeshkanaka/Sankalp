import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  FIXTURE_MARKER_KEY,
  FIXTURE_PROFILE,
  fixtureAccounts,
  fixtureIdentityFileName,
  type FixtureNamespace,
  type FixturePerson,
} from '../tests/fixtures/ids';
import {
  loadGuardedLocalRuntime,
  parseSeedArguments,
  validateApplicationDatabaseUrl,
} from '../tests/fixtures/local';
import { populateProfile } from './seed-profiles';

interface FixtureMarker {
  version: 1;
  profile: typeof FIXTURE_PROFILE;
  namespace: FixtureNamespace;
  person: FixturePerson;
}

interface FixtureUserShape {
  email?: string;
  app_metadata: Record<string, unknown>;
}

export function buildFixtureMarker(
  namespace: FixtureNamespace,
  person: FixturePerson,
): FixtureMarker {
  return { version: 1, profile: FIXTURE_PROFILE, namespace, person };
}

export function isExpectedFixtureUser(
  user: FixtureUserShape,
  expectedEmail: string,
  expectedMarker: FixtureMarker,
): boolean {
  const marker = user.app_metadata[FIXTURE_MARKER_KEY];
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false;
  const values = marker as Record<string, unknown>;
  return (
    user.email === expectedEmail &&
    values.version === expectedMarker.version &&
    values.profile === expectedMarker.profile &&
    values.namespace === expectedMarker.namespace &&
    values.person === expectedMarker.person
  );
}

async function listAllUsers(auth: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const result = await auth.auth.admin.listUsers({ page, perPage });
    if (result.error) throw new Error('Local Supabase admin user listing failed.');
    users.push(...result.data.users);
    if (result.data.users.length < perPage) return users;
  }
  throw new Error('Local Supabase contains too many auth users for guarded fixture lookup.');
}

async function verifyLocalDatabase(client: pg.Client): Promise<void> {
  const identity = await client.query<{
    database: string;
    role: string;
    profile: string | null;
    auth_user: string | null;
  }>(
    `select current_database() as database, current_user as role,
      to_regclass('app.profile')::text as profile,
      to_regclass('auth.users')::text as auth_user`,
  );
  const row = identity.rows[0];
  if (
    row?.database !== 'postgres' ||
    row.role !== 'postgres' ||
    row.profile !== 'app.profile' ||
    row.auth_user !== 'auth.users'
  )
    throw new Error('Local database identity or required schema does not match Sankalpa.');
  const tables = await client.query<{ name: string }>(
    `select c.relname as name from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind in ('r', 'p')
      order by c.relname`,
  );
  const expected = [
    'amendment',
    'journey',
    'operation_receipt',
    'practice_version',
    'profile',
    'rate_bucket',
    'schedule_version',
    'session',
    'session_practice',
  ];
  if (JSON.stringify(tables.rows.map((row) => row.name)) !== JSON.stringify(expected))
    throw new Error('Local application schema is not the expected M1 schema.');
}

async function verifyFixtureUsersInDatabase(
  client: pg.Client,
  users: User[],
  namespace: FixtureNamespace,
): Promise<void> {
  const result = await client.query<{
    id: string;
    email: string;
    app_metadata: Record<string, unknown>;
  }>(
    `select id::text, email, raw_app_meta_data as app_metadata
      from auth.users where id = any($1::uuid[])`,
    [users.map((user) => user.id)],
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  const specs = fixtureAccounts(namespace);
  for (let index = 0; index < users.length; index += 1) {
    const row = byId.get(users[index].id);
    const spec = specs[index];
    if (!row || !isExpectedFixtureUser(row, spec.email, buildFixtureMarker(namespace, spec.person)))
      throw new Error('Database auth identity does not match the guarded synthetic account.');
  }
}

async function provisionFixtureUsers(
  auth: SupabaseClient,
  namespace: FixtureNamespace,
): Promise<{ users: User[]; created: number }> {
  const specs = fixtureAccounts(namespace);
  const existing = await listAllUsers(auth);
  const byEmail = new Map(existing.filter((user) => user.email).map((user) => [user.email!, user]));

  for (const spec of specs) {
    const user = byEmail.get(spec.email);
    if (
      user &&
      !isExpectedFixtureUser(user, spec.email, buildFixtureMarker(namespace, spec.person))
    )
      throw new Error('A reserved fixture email belongs to an unmarked or different account.');
  }

  const users: User[] = [];
  let created = 0;
  for (const spec of specs) {
    const marker = buildFixtureMarker(namespace, spec.person);
    let user = byEmail.get(spec.email);
    if (!user) {
      const result = await auth.auth.admin.createUser({
        email: spec.email,
        email_confirm: false,
        app_metadata: { [FIXTURE_MARKER_KEY]: marker },
        user_metadata: { display_name: spec.displayName, synthetic_fixture: true },
      });
      if (result.error || !result.data.user)
        throw new Error('Local Supabase admin user creation failed.');
      user = result.data.user;
      created += 1;
    }
    if (!isExpectedFixtureUser(user, spec.email, marker))
      throw new Error('Supabase returned a fixture user without the expected synthetic marker.');
    users.push(user);
  }
  return { users, created };
}

async function countApplicationRows(client: pg.Client, userIds: string[]): Promise<number> {
  const result = await client.query<{ total: string }>(
    `select sum(total)::text as total from (
      select count(*) as total from app.profile where owner_id = any($1::uuid[])
      union all select count(*) from app.journey where owner_id = any($1::uuid[])
      union all select count(*) from app.schedule_version where owner_id = any($1::uuid[])
      union all select count(*) from app.practice_version where owner_id = any($1::uuid[])
      union all select count(*) from app.session where owner_id = any($1::uuid[])
      union all select count(*) from app.session_practice where owner_id = any($1::uuid[])
      union all select count(*) from app.amendment where owner_id = any($1::uuid[])
      union all select count(*) from app.operation_receipt where owner_id = any($1::uuid[])
    ) rows`,
    [userIds],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function resetApplicationRows(client: pg.Client, userIds: string[]): Promise<number> {
  const before = await countApplicationRows(client, userIds);
  await client.query('begin');
  try {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '15s'");
    await client.query('set constraints all deferred');
    await client.query(
      'update app.journey set active_schedule_version_id = null where owner_id = any($1::uuid[])',
      [userIds],
    );
    await client.query('delete from app.profile where owner_id = any($1::uuid[])', [userIds]);
    await client.query(
      'insert into app.profile(owner_id) select unnest($1::uuid[]) on conflict (owner_id) do update set disabled_at = null',
      [userIds],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  const after = await countApplicationRows(client, userIds);
  if (after !== userIds.length)
    throw new Error(
      'Synthetic application reset did not leave exactly one blank profile per account.',
    );
  return Math.max(0, before - after);
}

function writeJsonAtomically(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const options = parseSeedArguments(process.argv.slice(2));
  const runtime = loadGuardedLocalRuntime();
  const applicationDatabaseUrl = validateApplicationDatabaseUrl(
    process.env.DATABASE_URL,
    runtime.dbPort,
  );
  const secretKey = process.env.LOCAL_SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error('Missing LOCAL_SUPABASE_SECRET_KEY. Run npm run env:local.');

  // Authenticate the restricted connection before any synthetic data is reset.
  const application = new pg.Client({
    connectionString: applicationDatabaseUrl,
    connectionTimeoutMillis: 5000,
  });
  try {
    await application.connect();
    const role = await application.query(
      'select current_user, session_user, rolsuper, rolbypassrls, exists(select from pg_auth_members where member=r.oid) as memberships from pg_roles r where rolname=current_user',
    );
    const identity = role.rows[0];
    if (
      identity?.current_user !== 'app_api' ||
      identity?.session_user !== 'app_api' ||
      identity.rolsuper ||
      identity.rolbypassrls ||
      identity.memberships
    )
      throw new Error('Synthetic seed requires the restricted application role.');
  } finally {
    await application.end();
  }

  const database = new pg.Client({
    connectionString: runtime.adminDatabaseUrl,
    application_name: 'sankalpa-synthetic-seed',
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  await database.connect();
  try {
    await verifyLocalDatabase(database);
    const auth = createClient(runtime.supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const provisioned = await provisionFixtureUsers(auth, options.namespace);
    await verifyFixtureUsersInDatabase(database, provisioned.users, options.namespace);
    const localDirectory = resolve(runtime.root, '.local');
    const identityDirectory = resolve(localDirectory, 'fixtures');
    mkdirSync(identityDirectory, { recursive: true, mode: 0o700 });
    const identityPath = resolve(identityDirectory, fixtureIdentityFileName(options.namespace));
    // Once reset starts, an older ready marker cannot describe the new dataset.
    writeJsonAtomically(identityPath, {
      state: 'incomplete',
      profile: options.profile,
      namespace: options.namespace,
    });
    const removed = await resetApplicationRows(
      database,
      provisioned.users.map((user) => user.id),
    );
    const now = await populateProfile(options.profile, provisioned.users[0].id, runtime.root);

    if (options.namespace === 'demo')
      writeJsonAtomically(resolve(localDirectory, 'demo-clock.json'), { now });
    writeJsonAtomically(identityPath, {
      state: 'ready',
      profile: options.profile,
      namespace: options.namespace,
      accounts: Object.fromEntries(
        fixtureAccounts(options.namespace).map((spec, index) => [
          spec.person,
          { id: provisioned.users[index].id, email: spec.email },
        ]),
      ),
    });
    console.log(
      `Synthetic ${options.profile}/${options.namespace} ready: ${provisioned.users.length} accounts (${provisioned.created} created), ${removed} application rows cleared.`,
    );
  } finally {
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown seed failure.';
    console.error(`Synthetic seed refused: ${message}`);
    process.exitCode = 1;
  });
}
