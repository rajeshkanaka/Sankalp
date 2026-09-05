import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  chmodSync,
  renameSync,
  rmdirSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createServer } from 'node:net';
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
async function assertPortFree(port) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', () =>
      reject(new Error(`Port ${port} is already occupied. Choose another worktree slot.`)),
    );
    server.listen(port, '127.0.0.1', () => server.close(done));
  });
}
if (!existsSync(runtimeFile)) {
  if (command !== 'prepare')
    throw new Error(
      'Run npm run workspace:prepare -- --slot 0 first. Use a unique slot per worktree.',
    );
  const slot = Number(value('--slot', '0'));
  if (!Number.isInteger(slot) || slot < 0 || slot > 50) throw new Error('Slot must be 0–50.');
  for (const port of [
    3000 + slot,
    3100 + slot,
    ...Array.from({ length: 20 }, (_, index) => 54320 + slot * 100 + index),
  ])
    await assertPortFree(port);
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
const gitDirectory = resolve(
  root,
  execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim(),
);
const registryPath = resolve(gitDirectory, 'sankalpa-runtime-slots.json');
const registryLock = resolve(gitDirectory, 'sankalpa-runtime-slots.lock');
try {
  mkdirSync(registryLock);
} catch {
  throw new Error('Another worktree is allocating resources. Retry after that command finishes.');
}
try {
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : {};
  if (registry[runtime.slot] && registry[runtime.slot] !== root)
    throw new Error(
      `Slot ${runtime.slot} belongs to another worktree. Choose an independent slot.`,
    );
  registry[runtime.slot] = root;
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), { mode: 0o600 });
} finally {
  rmdirSync(registryLock);
}
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
const networkName = `${runtime.projectId}-loopback`;
function docker(parts) {
  return execFileSync('docker', parts, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function ensureLoopbackNetwork() {
  const existing = docker([
    'network',
    'ls',
    '--filter',
    `name=^${networkName}$`,
    '--format',
    '{{.Name}}',
  ]).trim();
  if (!existing)
    docker([
      'network',
      'create',
      '--driver',
      'bridge',
      '--label',
      `app.sankalpa.runtime-root=${root}`,
      '--opt',
      'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
      networkName,
    ]);
  const [network] = JSON.parse(docker(['network', 'inspect', networkName]));
  if (
    network.Driver !== 'bridge' ||
    network.Labels?.['app.sankalpa.runtime-root'] !== root ||
    network.Options?.['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1'
  )
    throw new Error('Local network ownership or loopback binding does not match this worktree.');
}
function assertLoopbackBindings() {
  const ids = docker([
    'ps',
    '-q',
    '--filter',
    `label=com.supabase.cli.project=${runtime.projectId}`,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) throw new Error('No running containers found for the allocated local stack.');
  const containers = JSON.parse(docker(['inspect', ...ids]));
  const ports = new Set();
  for (const container of containers) {
    if (!container.NetworkSettings.Networks[networkName])
      throw new Error(
        'Local stack uses an older network. Run db:stop then db:start to preserve data and rebind it.',
      );
    for (const bindings of Object.values(container.NetworkSettings.Ports ?? {}))
      for (const binding of bindings ?? []) {
        if (binding.HostIp !== '127.0.0.1')
          throw new Error('Local stack exposes a non-loopback port. Stop it before continuing.');
        ports.add(Number(binding.HostPort));
      }
  }
  if (![runtime.dbPort, runtime.apiPort, runtime.mailPort].every((port) => ports.has(port)))
    throw new Error('Local stack omitted an expected loopback port.');
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
  dbUrl.username = 'app_api';
  dbUrl.password = password;
  const rateSecretFile = resolve(directory, 'rate-limit-key');
  if (!existsSync(rateSecretFile))
    writeFileSync(rateSecretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
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
    RATE_LIMIT_SECRET: readFileSync(rateSecretFile, 'utf8'),
  };
  if (Object.values(entries).some((entry) => !entry))
    throw new Error('CLI status omitted a required local connection field.');
  const envFile = resolve(root, '.env.local');
  const ownershipFile = resolve(directory, 'env-generated.json');
  const existing = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const owned = existsSync(ownershipFile) ? JSON.parse(readFileSync(ownershipFile, 'utf8')) : {};
  const digest = (entry) => createHash('sha256').update(entry).digest('hex');
  for (const [key, entry] of Object.entries(entries)) {
    if (
      existing[key] !== undefined &&
      existing[key] !== entry &&
      owned[key] !== digest(existing[key])
    )
      throw new Error(
        `Refusing to overwrite manually configured ${key}. Reconcile your local configuration first.`,
      );
  }
  const client = new pg.Client({ connectionString: state.DB_URL });
  await client.connect();
  try {
    const version = await client.query('show server_version_num');
    if (Math.floor(Number(version.rows[0].server_version_num) / 10000) !== 17)
      throw new Error('Expected PostgreSQL major 17.');
    // Validate environment ownership before changing the runtime role's password.
    if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid local role secret.');
    await client.query(`ALTER ROLE app_api PASSWORD '${password}'`);
  } finally {
    await client.end();
  }
  writeFileSync(
    envFile,
    Object.entries({ ...existing, ...entries })
      .map(([key, entry]) => `${key}=${JSON.stringify(entry)}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  chmodSync(envFile, 0o600);
  writeFileSync(
    ownershipFile,
    JSON.stringify(
      Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, digest(entry)])),
    ),
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
    ensureLoopbackNetwork();
    cli(['start', '--network-id', networkName]);
    assertLoopbackBindings();
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
    assertLoopbackBindings();
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
    const temporaryClock = resolve(directory, 'demo-clock.next.json');
    writeFileSync(temporaryClock, JSON.stringify({ now: new Date(at).toISOString() }));
    renameSync(temporaryClock, resolve(directory, 'demo-clock.json'));
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
