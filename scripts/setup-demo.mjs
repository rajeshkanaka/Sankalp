import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  closeSync,
  chmodSync,
  rmdirSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export function readRuntime(root) {
  const file = resolve(root, '.local/runtime.json');
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, 'utf8'));
  const slot = value.slot;
  if (
    value.root !== root ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot > 50 ||
    value.port !== 3000 + slot ||
    value.testPort !== 3100 + slot ||
    value.apiPort !== 54321 + slot * 100 ||
    value.dbPort !== 54322 + slot * 100 ||
    value.mailPort !== 54324 + slot * 100 ||
    value.projectId !== `sankalpa-slot-${slot}`
  )
    throw new Error(
      'Runtime belongs to another checkout or has an invalid slot. Do not copy .local between checkouts.',
    );
  return value;
}

export function demoAction(root, fresh, reset) {
  if (reset) return 'seed';
  const file = resolve(root, '.local/fixtures/M1-demo.json');
  if (!existsSync(file)) {
    if (fresh) return 'seed';
    throw new Error(
      'No ready demo checkpoint exists. Existing data was preserved. See docs/DEMO.md before deliberately using --reset-demo.',
    );
  }
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  if (
    fixture.state !== 'ready' ||
    fixture.namespace !== 'demo' ||
    !['M1', 'M2', 'M3'].includes(fixture.profile)
  )
    throw new Error(
      'The demo checkpoint is incomplete or invalid. Existing data was preserved; see docs/DEMO.md.',
    );
  const clock = resolve(root, '.local/demo-clock.json');
  if (
    !existsSync(clock) ||
    !Number.isFinite(Date.parse(JSON.parse(readFileSync(clock, 'utf8')).now))
  )
    throw new Error(
      'The saved demo clock is missing or invalid. Restore its checkpoint; do not silently change practice dates.',
    );
  return 'preserve';
}

export async function portFree(port) {
  const server = createServer();
  return new Promise((done) => {
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}

export async function chooseSlot(registry, dockerNames, free = portFree) {
  for (let slot = 0; slot <= 50; slot++) {
    // Stopped containers and volumes also reserve a slot: never adopt an old database.
    if (
      Object.hasOwn(registry, String(slot)) ||
      new RegExp(`sankalpa-slot-${slot}(?:$|[^0-9])`, 'm').test(dockerNames)
    )
      continue;
    const ports = [
      3000 + slot,
      3100 + slot,
      3200 + slot,
      ...Array.from({ length: 20 }, (_, i) => 54320 + slot * 100 + i),
    ];
    let available = true;
    for (const port of ports)
      if (!(await free(port))) {
        available = false;
        break;
      }
    if (available) return slot;
  }
  throw new Error('No free local service slot is available. Existing resources were preserved.');
}

export function localChildEnvironment(environment) {
  const local = { ...environment };
  // Node --env-file does not override exported values. This checkout's generated
  // file must own every connection and clock setting, including during next build.
  for (const key of [
    'APP_ENV',
    'APP_ORIGIN',
    'PORT',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'DATABASE_URL',
    'RATE_LIMIT_SECRET',
    'LOCAL_ADMIN_DATABASE_URL',
    'LOCAL_SUPABASE_SECRET_KEY',
    'LOCAL_MAIL_URL',
    'SUPABASE_SERVICES_HOSTNAME',
    'DEMO_CLOCK_FILE',
    'NODE_ENV',
  ])
    delete local[key];
  return local;
}

export async function stopOwnedGroup(pid) {
  if (!pid) return;
  const alive = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!alive()) return;
    try {
      process.kill(-pid, signal);
    } catch {
      return;
    }
    const deadline = Date.now() + 2000;
    while (alive() && Date.now() < deadline) await delay(50);
  }
  if (alive())
    throw new Error(
      'An owned child process has not stopped. The setup lock is retained; see docs/DEMO.md.',
    );
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0)
    throw new Error(`${command} preflight failed. Check that it is installed and available.`);
  return result.stdout.trim();
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some((arg) => !['--no-open', '--reset-demo'].includes(arg)))
    throw new Error('Run ./setup.sh --help for supported options.');
  const root = process.cwd();
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (
    process.versions.node !== manifest.engines.node ||
    capture('npm', ['--version']) !== manifest.engines.npm
  )
    throw new Error('Use ./setup.sh to select the repository-pinned Node and npm versions.');
  if (process.env.APP_ENV && !['local', 'ci'].includes(process.env.APP_ENV))
    throw new Error('Demo setup refuses hosted environments.');
  const commonGit = resolve(root, capture('git', ['rev-parse', '--git-common-dir']));
  let runtime = readRuntime(root);
  const fresh = runtime === null;
  if (runtime)
    for (const port of [runtime.port, runtime.testPort, runtime.testPort + 100]) {
      if (!(await portFree(port)))
        throw new Error(
          `Port ${port} is already in use by an app or test server. If your demo is running, open http://localhost:${runtime.port}/welcome and http://127.0.0.1:${runtime.mailPort}. To rebuild, stop its original terminal first. No dependencies, database or build were changed.`,
        );
    }
  if (fresh && existsSync(resolve(root, '.env.local')))
    throw new Error(
      'This checkout has an environment but no owned runtime. Preserve it and reconcile the checkpoint before setup.',
    );
  const action = demoAction(root, fresh, argv.includes('--reset-demo'));
  const directory = resolve(root, '.local');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = resolve(directory, 'setup.lock');
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(
      'Another setup owns .local/setup.lock. See docs/DEMO.md for interrupted-setup recovery.',
      { cause: error },
    );
  }
  const logPath = resolve(directory, 'setup.log');
  let log;
  let active;
  let activeDone;
  let stopping;
  const childEnvironment = localChildEnvironment(process.env);
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    if (active?.pid) {
      stopping ??= stopOwnedGroup(active.pid);
      // The awaited child/finally path reports failure; avoid an unhandled
      // rejection while escalation runs independently of the leader's exit.
      void stopping.catch(() => {});
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const start = (command, args, env = childEnvironment) => {
    if (interrupted) throw new Error('Setup interrupted; saved data is retained.');
    const child = spawn(command, args, {
      cwd: root,
      env,
      detached: true,
      stdio: ['ignore', log, log],
    });
    active = child;
    let exited = false;
    const done = new Promise((accept) => {
      child.once('error', () => {
        exited = true;
        accept(127);
      });
      child.once('close', (code) => {
        exited = true;
        accept(code ?? 1);
      });
    });
    const finished = done.then(async (code) => {
      await (stopping ?? stopOwnedGroup(child.pid));
      if (active === child) active = undefined;
      return code;
    });
    activeDone = finished;
    return { done: finished, exited: () => exited };
  };
  const run = async (label, command, args) => {
    console.log(`  ${label}…`);
    if ((await start(command, args).done) !== 0)
      throw new Error(`${label} did not finish. Private local log: ${logPath}`);
  };
  try {
    log = openSync(logPath, 'w', 0o600);
    chmodSync(logPath, 0o600);
    console.log('\nSankalpa · preparing your local demo\n');
    const contextEndpoint = capture('docker', [
      'context',
      'inspect',
      '--format',
      '{{.Endpoints.docker.Host}}',
    ]);
    // Both inputs must be local even when Docker's CLI would ignore one.
    // Do not pass a remote override through to another Docker client.
    if (
      !contextEndpoint.startsWith('unix:///') ||
      (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix:///'))
    )
      throw new Error(
        'Select a local Docker Desktop context and unset any remote DOCKER_HOST. Demo setup refuses a remote Docker engine.',
      );
    if (spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 10000 }).status !== 0) {
      if (process.platform !== 'darwin') throw new Error('Start Docker, then rerun ./setup.sh.');
      console.log('  Opening Docker Desktop; waiting for its engine…');
      await run('Open Docker Desktop', 'open', ['-a', 'Docker']);
      let ready = false;
      for (let attempt = 0; attempt < 30 && !interrupted; attempt++) {
        if (spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 2000 }).status === 0) {
          ready = true;
          break;
        }
        await delay(2000);
      }
      if (!ready)
        throw new Error('Docker is not ready. Finish its first-run setup, then rerun ./setup.sh.');
    }
    let slot = runtime?.slot;
    if (fresh) {
      const registryPath = resolve(commonGit, 'sankalpa-runtime-slots.json');
      const registry = existsSync(registryPath)
        ? JSON.parse(readFileSync(registryPath, 'utf8'))
        : {};
      const names = [
        capture('docker', ['ps', '-a', '--format', '{{.Names}}']),
        capture('docker', ['volume', 'ls', '--format', '{{.Name}}']),
        capture('docker', ['network', 'ls', '--format', '{{.Name}}']),
      ].join('\n');
      slot = await chooseSlot(registry, names);
    }
    await run('Install locked dependencies', 'npm', ['ci', '--include=dev']);
    await run('Check isolated local resources', 'npm', [
      'run',
      'workspace:prepare',
      '--',
      '--slot',
      String(slot),
    ]);
    runtime = readRuntime(root);
    await run('Start local database, authentication and inbox', 'npm', ['run', 'db:start']);
    await run('Apply database migrations and local configuration', 'npm', ['run', 'db:migrate']);
    if (action === 'seed')
      await run('Load M3 sample journeys for Maya and Arun', 'npm', [
        'run',
        'demo:seed',
        '--',
        '--profile',
        'M3',
      ]);
    else console.log('  Keeping your existing demo journeys, reflections and clock.');
    await run('Build the presentation app', 'npm', ['run', 'build']);
    const app = `http://localhost:${runtime.port}/welcome`;
    const mail = `http://127.0.0.1:${runtime.mailPort}`;
    const server = start(
      process.execPath,
      ['--env-file=.env.local', 'scripts/run-next.mjs', 'start'],
      {
        ...childEnvironment,
        DEMO_CLOCK_FILE: resolve(directory, 'demo-clock.json'),
      },
    );
    let ready = false;
    for (let attempt = 0; attempt < 60 && !server.exited() && !interrupted; attempt++) {
      try {
        const response = await fetch(app, {
          redirect: 'manual',
          signal: globalThis.AbortSignal.timeout(1000),
        });
        const html = await response.text();
        if (
          response.status === 200 &&
          html.includes('Send sign-in link') &&
          html.includes('Demo data')
        ) {
          ready = true;
          break;
        }
      } catch {
        /* Next may still be starting. */
      }
      await delay(500);
    }
    if (!ready) {
      stop();
      await server.done;
      throw new Error(`Demo did not become ready. Private local log: ${logPath}`);
    }
    console.log(
      `\nReady to present.\n\n  App:   ${app}\n  Inbox: ${mail}\n  Sign in as maya@example.test and open its captured email link.\n\n  Real local authentication; simulated practice clock.\n  Keep this terminal open. Ctrl-C stops the app and preserves database data.\n  Presenter walkthrough: docs/DEMO.md\n`,
    );
    if (!argv.includes('--no-open') && process.platform === 'darwin') {
      const opened = spawnSync('open', [app, mail], { stdio: 'ignore', timeout: 10000 });
      if (opened.status !== 0)
        console.log('  Browser did not open automatically; use the URLs above.');
    }
    const code = await server.done;
    if (!interrupted && code !== 0)
      throw new Error(`App exited unexpectedly. Private local log: ${logPath}`);
  } finally {
    if (active) {
      stop();
      await activeDone;
    }
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (log !== undefined) closeSync(log);
    rmdirSync(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : 'Setup failed.'}\n`);
    process.exitCode = 1;
  });
}
