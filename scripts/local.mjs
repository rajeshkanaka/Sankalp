import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const root = process.cwd();
const directory = resolve(root, '.local');
const backend = resolve(directory, 'backend');
const runtimeFile = resolve(directory, 'runtime.json');
const command = process.argv[2];
const args = process.argv.slice(3).filter((arg) => arg !== '--');
const value = (flag, fallback) =>
  args[args.indexOf(flag) + 1] && args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
if (process.env.APP_ENV && !['local', 'ci'].includes(process.env.APP_ENV))
  throw new Error('Local tools refuse hosted environments.');
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (!existsSync(runtimeFile)) {
  if (command !== 'prepare')
    throw new Error(
      'Run npm run workspace:prepare -- --slot 0 first. Use a unique slot per worktree.',
    );
  const slot = Number(value('--slot', '0'));
  if (!Number.isInteger(slot) || slot < 0 || slot > 50) throw new Error('Slot must be 0–50.');
  writeFileSync(
    runtimeFile,
    JSON.stringify(
      {
        root,
        slot,
        port: 3000 + slot,
        testPort: 3100 + slot,
        apiPort: 54321 + slot * 100,
        dbPort: 54322 + slot * 100,
        mailPort: 54324 + slot * 100,
        projectId: `sankalpa-slot-${slot}`,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'));
if (runtime.root !== root)
  throw new Error('Runtime belongs to another worktree; allocate an independent slot.');
function syncConfig() {
  mkdirSync(resolve(backend, 'supabase'), { recursive: true });
  cpSync(resolve(root, 'supabase'), resolve(backend, 'supabase'), {
    recursive: true,
    filter: (source) => !source.includes('/.temp'),
  });
  let config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
  config = config.replace('project_id = "sankalpa"', `project_id = "${runtime.projectId}"`);
  for (const base of [54320, 54321, 54322, 54324])
    config = config.replaceAll(String(base), String(base + runtime.slot * 100));
  config = config.replaceAll('localhost:3000', `localhost:${runtime.port}`);
  config = config.replace(
    'additional_redirect_urls = [',
    `additional_redirect_urls = ["http://localhost:${runtime.testPort}/auth/confirm", `,
  );
  writeFileSync(resolve(backend, 'supabase/config.toml'), config);
}
function cli(parts, capture = false) {
  return execFileSync(
    resolve(root, 'node_modules/.bin/supabase'),
    ['--workdir', backend, ...parts],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', capture ? 'pipe' : 'inherit'] },
  );
}
function status() {
  return JSON.parse(cli(['status', '--output', 'json'], true));
}
async function environment() {
  const state = status();
  const dbUrl = new URL(state.DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || Number(dbUrl.port) !== runtime.dbPort)
    throw new Error('Unexpected database target.');
  const secretFile = resolve(directory, 'database-password');
  if (!existsSync(secretFile))
    writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  const password = readFileSync(secretFile, 'utf8');
  const client = new pg.Client({ connectionString: dbUrl.href });
  await client.connect();
  try {
    // Password is locally generated hexadecimal, never user-controlled or printed.
    if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid local role secret.');
    await client.query(`ALTER ROLE app_api PASSWORD '${password}'`);
  } finally {
    await client.end();
  }
  dbUrl.username = 'app_api';
  dbUrl.password = password;
  const entries = {
    APP_ENV: 'local',
    APP_ORIGIN: `http://localhost:${runtime.port}`,
    PORT: String(runtime.port),
    DATABASE_URL: dbUrl.href,
    SUPABASE_URL: state.API_URL,
    SUPABASE_PUBLISHABLE_KEY: state.PUBLISHABLE_KEY || state.ANON_KEY,
    LOCAL_ADMIN_DATABASE_URL: state.DB_URL,
    LOCAL_SUPABASE_SECRET_KEY: state.SECRET_KEY || state.SERVICE_ROLE_KEY,
    LOCAL_MAIL_URL: `http://127.0.0.1:${runtime.mailPort}`,
  };
  if (Object.values(entries).some((entry) => !entry))
    throw new Error('CLI status omitted a required local connection field.');
  writeFileSync(
    resolve(root, '.env.local'),
    Object.entries(entries)
      .map(([key, entry]) => `${key}=${JSON.stringify(entry)}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  console.log('Local environment written to ignored .env.local. Secrets were not printed.');
}
syncConfig();
switch (command) {
  case 'prepare':
    console.log(
      `Slot ${runtime.slot}: app http://localhost:${runtime.port}, isolated tests ${runtime.testPort}, database ${runtime.dbPort}.`,
    );
    break;
  case 'start':
    cli(['start']);
    await environment();
    console.log('Local Supabase stack started. Use npm run db:status for safe connection details.');
    break;
  case 'migrate':
    cli(['migration', 'up', '--local']);
    await environment();
    break;
  case 'env':
    await environment();
    break;
  case 'status': {
    const state = status();
    console.log(
      JSON.stringify(
        {
          project: runtime.projectId,
          app: `http://localhost:${runtime.port}`,
          mail: `http://127.0.0.1:${runtime.mailPort}`,
          databasePort: runtime.dbPort,
          ready: Boolean(state.DB_URL),
        },
        null,
        2,
      ),
    );
    break;
  }
  case 'stop':
    cli(['stop']);
    break;
  case 'clock': {
    const at = value('--at', null);
    if (!at || !Number.isFinite(Date.parse(at))) throw new Error('Supply --at ISO_INSTANT.');
    writeFileSync(
      resolve(directory, 'demo-clock.json'),
      JSON.stringify({ now: new Date(at).toISOString() }),
    );
    console.log('Local demonstration clock updated. Authentication still uses real time.');
    break;
  }
  case 'demo': {
    if (!existsSync(resolve(directory, 'demo-clock.json')))
      throw new Error('Seed a demonstration profile first.');
    const run = spawnSync(
      process.execPath,
      ['--env-file=.env.local', 'scripts/run-next.mjs', 'dev'],
      {
        stdio: 'inherit',
        env: { ...process.env, DEMO_CLOCK_FILE: resolve(directory, 'demo-clock.json') },
      },
    );
    process.exitCode = run.status ?? 1;
    break;
  }
  default:
    throw new Error('Unknown local command.');
}
