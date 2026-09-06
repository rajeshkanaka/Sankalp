import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  readRuntime,
  demoAction,
  chooseSlot,
  portFree,
  localChildEnvironment,
  stopOwnedGroup,
} from '../../scripts/setup-demo.mjs';

const temporary: string[] = [];
const children: ChildProcess[] = [];
const script = resolve('scripts/setup-demo.mjs');
function directory() {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'sankalpa setup test ')));
  temporary.push(root);
  mkdirSync(resolve(root, '.local/fixtures'), { recursive: true });
  return root;
}
function json(root: string, file: string, value: unknown) {
  writeFileSync(resolve(root, file), JSON.stringify(value));
}
function runtime(root: string, slot = 40) {
  return {
    root,
    slot,
    port: 3000 + slot,
    testPort: 3100 + slot,
    apiPort: 54321 + slot * 100,
    dbPort: 54322 + slot * 100,
    mailPort: 54324 + slot * 100,
    projectId: `sankalpa-slot-${slot}`,
  };
}
function fixture(root: string, profile = 'M3') {
  json(root, '.local/fixtures/M1-demo.json', { state: 'ready', namespace: 'demo', profile });
  json(root, '.local/demo-clock.json', { now: '2026-09-05T23:30:00Z' });
}
async function until(check: () => boolean, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting for launcher test.');
    await delay(25);
  }
}
function mockedCheckout(root: string) {
  mkdirSync(resolve(root, '.git'));
  mkdirSync(resolve(root, 'bin'));
  mkdirSync(resolve(root, 'scripts'));
  json(root, 'package.json', { engines: { node: process.versions.node, npm: '11.19.0' } });
  json(
    root,
    '.git/sankalpa-runtime-slots.json',
    Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), 'another-checkout'])),
  );
  const executable = `#!${process.execPath}\n`;
  writeFileSync(resolve(root, 'bin/git'), executable + "console.log('.git');\n", { mode: 0o700 });
  writeFileSync(
    resolve(root, 'bin/docker'),
    executable +
      "if (process.argv[2] === 'context') console.log('unix:///synthetic-local-docker.sock'); process.exit(0);\n",
    { mode: 0o700 },
  );
  writeFileSync(
    resolve(root, 'bin/npm'),
    executable +
      `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('11.19.0'); process.exit(0); }
const action = args[0] === 'run' ? args[1] : args[0];
fs.appendFileSync('calls', action + '\\n');
if (process.env.SETUP_TEST_FAIL === action) process.exit(7);
if (action === 'workspace:prepare' && !fs.existsSync('.local/runtime.json')) {
  const slot = Number(args.at(-1));
  fs.writeFileSync('.local/runtime.json', JSON.stringify({ root: process.cwd(), slot, port: 3000 + slot, testPort: 3100 + slot, apiPort: 54321 + slot * 100, dbPort: 54322 + slot * 100, mailPort: 54324 + slot * 100, projectId: 'sankalpa-slot-' + slot }));
}
if (action === 'db:migrate') {
  const {port} = JSON.parse(fs.readFileSync('.local/runtime.json'));
  fs.writeFileSync('.env.local', 'PORT=' + port + '\\n');
}
if (action === 'demo:seed') {
  fs.writeFileSync('.local/fixtures/M1-demo.json', JSON.stringify({ state: 'ready', namespace: 'demo', profile: 'M3' }));
  fs.writeFileSync('.local/demo-clock.json', JSON.stringify({ now: '2026-09-05T23:30:00Z' }));
}
`,
    { mode: 0o700 },
  );
  writeFileSync(
    resolve(root, 'scripts/run-next.mjs'),
    `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
writeFileSync('launched-clock', process.env.DEMO_CLOCK_FILE);
writeFileSync('inherited-database', process.env.DATABASE_URL || 'not-inherited');
const server = createServer((req, res) => { res.end('Send sign-in link · Demo data'); });
server.listen(Number(process.env.PORT), '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
  );
}
function launch(root: string, args: string[] = [], environment: Record<string, string> = {}) {
  let output = '';
  let exitCode: number | null | undefined;
  const child = spawn(process.execPath, [script, '--no-open', ...args], {
    cwd: root,
    env: { ...process.env, PATH: `${resolve(root, 'bin')}:${process.env.PATH}`, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.on('exit', (code) => {
    exitCode = code;
  });
  return { child, output: () => output, exitCode: () => exitCode };
}
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGTERM');
  await delay(75);
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('demo setup preservation and allocation', () => {
  it('keeps a ready M2 fixture and its exact clock', () => {
    const root = directory();
    fixture(root, 'M2');
    const before = readFileSync(resolve(root, '.local/demo-clock.json'), 'utf8');
    expect(demoAction(root, false, false)).toBe('preserve');
    expect(readFileSync(resolve(root, '.local/demo-clock.json'), 'utf8')).toBe(before);
  });
  it('seeds automatically only for a new runtime; reset requires an explicit flag', () => {
    const root = directory();
    expect(demoAction(root, true, false)).toBe('seed');
    expect(() => demoAction(root, false, false)).toThrow(/preserved/);
    expect(demoAction(root, false, true)).toBe('seed');
  });
  it('refuses incomplete metadata and missing clocks without rewriting them', () => {
    const root = directory();
    json(root, '.local/fixtures/M1-demo.json', {
      state: 'incomplete',
      namespace: 'demo',
      profile: 'M3',
    });
    expect(() => demoAction(root, false, false)).toThrow(/incomplete/);
    fixture(root);
    rmSync(resolve(root, '.local/demo-clock.json'));
    expect(() => demoAction(root, false, false)).toThrow(/clock/);
  });
  it('rejects wrong-root runtime metadata and incorrect derived ports', () => {
    const root = directory();
    json(root, '.local/runtime.json', runtime('/another-checkout'));
    expect(() => readRuntime(root)).toThrow(/another checkout/);
    json(root, '.local/runtime.json', { ...runtime(root), dbPort: 54322 });
    expect(() => readRuntime(root)).toThrow(/invalid slot/);
  });
  it('skips registry allocations, stopped Docker volumes/networks, and occupied ports', async () => {
    const slot = await chooseSlot(
      { 0: 'legacy' },
      'supabase_db_sankalpa-slot-1\nsankalpa-slot-2-loopback',
      async (port: number) => port !== 3003,
    );
    expect(slot).toBe(4);
    expect(await chooseSlot({}, 'supabase_db_sankalpa-slot-10', async () => true)).toBe(0);
  });
  it('removes exported runtime overrides while retaining normal tool settings', () => {
    expect(
      localChildEnvironment({
        DATABASE_URL: 'wrong-checkout',
        PORT: '9999',
        DEMO_CLOCK_FILE: '/wrong',
        NODE_ENV: 'production',
        PATH: '/bin',
      }),
    ).toEqual({ PATH: '/bin' });
  });
  it('terminates a remaining owned descendant after its leader exits', async () => {
    const root = directory();
    const pidFile = resolve(root, 'descendant-pid');
    const leader = spawn(
      process.execPath,
      [
        '-e',
        `
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {stdio: 'ignore'});
      require('node:fs').writeFileSync(process.argv[1], String(child.pid));
      process.on('SIGTERM', () => process.exit(0));
      setInterval(() => {}, 1000);
    `,
        pidFile,
      ],
      { detached: true, stdio: 'ignore' },
    );
    children.push(leader);
    await until(() => existsSync(pidFile));
    const descendant = Number(readFileSync(pidFile, 'utf8'));
    await delay(100);
    try {
      leader.kill('SIGTERM');
      await until(() => leader.exitCode !== null);
      await stopOwnedGroup(leader.pid);
      expect(() => process.kill(descendant, 0)).toThrow();
    } finally {
      try {
        process.kill(-leader.pid!, 'SIGKILL');
      } catch {
        /* Gone. */
      }
    }
  }, 10000);
  it('detects an actually occupied loopback port', async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    expect(address && typeof address === 'object').toBe(true);
    try {
      expect(await portFree((address as { port: number }).port)).toBe(false);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

describe('actual launcher process with simulated external setup commands', () => {
  it('orders fresh setup, launches with the clock and stops only its owned server', async () => {
    const root = directory();
    mockedCheckout(root);
    const running = launch(root);
    await until(
      () => running.output().includes('Ready to present.') || running.exitCode() !== undefined,
    );
    expect(running.output()).toContain('Ready to present.');
    expect(readFileSync(resolve(root, 'calls'), 'utf8').trim().split('\n')).toEqual([
      'ci',
      'workspace:prepare',
      'db:start',
      'db:migrate',
      'demo:seed',
      'build',
    ]);
    expect(readFileSync(resolve(root, 'launched-clock'), 'utf8')).toBe(
      resolve(root, '.local/demo-clock.json'),
    );
    const selected = readRuntime(root)!;
    const second = launch(root);
    await until(() => second.exitCode() !== undefined);
    expect(second.output()).toMatch(/already in use|setup.lock/);
    expect(readFileSync(resolve(root, 'calls'), 'utf8').match(/\bci\b/g)).toHaveLength(1);
    running.child.kill('SIGINT');
    await until(() => running.exitCode() !== undefined);
    expect(running.exitCode()).toBe(0);
    expect(existsSync(resolve(root, '.local/setup.lock'))).toBe(false);
    expect(await portFree(selected.port)).toBe(true);
  }, 15000);
  it('keeps an existing M2 profile and does not invoke seed', async () => {
    const root = directory();
    mockedCheckout(root);
    fixture(root, 'M2');
    json(root, '.local/runtime.json', runtime(root));
    const running = launch(root, [], { DATABASE_URL: 'wrong-checkout-sentinel' });
    await until(
      () => running.output().includes('Ready to present.') || running.exitCode() !== undefined,
    );
    expect(running.output()).toContain('Ready to present.');
    expect(readFileSync(resolve(root, 'inherited-database'), 'utf8')).toBe('not-inherited');
    expect(readFileSync(resolve(root, 'calls'), 'utf8')).not.toContain('demo:seed');
    expect(
      JSON.parse(readFileSync(resolve(root, '.local/fixtures/M1-demo.json'), 'utf8')).profile,
    ).toBe('M2');
    running.child.kill('SIGTERM');
    await until(() => running.exitCode() !== undefined);
  }, 15000);
  it('escalates shutdown even when the running server leader ignores SIGTERM', async () => {
    const root = directory();
    mockedCheckout(root);
    const launcher = resolve(root, 'scripts/run-next.mjs');
    writeFileSync(
      launcher,
      readFileSync(launcher, 'utf8').replace(
        "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
        "process.on('SIGTERM', () => {});",
      ),
    );
    const running = launch(root);
    await until(
      () => running.output().includes('Ready to present.') || running.exitCode() !== undefined,
    );
    expect(running.output()).toContain('Ready to present.');
    const selected = readRuntime(root)!;
    running.child.kill('SIGINT');
    await until(() => running.exitCode() !== undefined);
    expect(running.exitCode()).toBe(0);
    expect(existsSync(resolve(root, '.local/setup.lock'))).toBe(false);
    expect(await portFree(selected.port)).toBe(true);
  }, 15000);
  it('protects an existing test server before any installation', async () => {
    const root = directory();
    mockedCheckout(root);
    fixture(root);
    const slot = await chooseSlot({}, '', portFree);
    const allocation = runtime(root, slot);
    json(root, '.local/runtime.json', allocation);
    const listener = createServer();
    await new Promise<void>((done) => listener.listen(allocation.testPort, '127.0.0.1', done));
    try {
      const running = launch(root);
      await until(() => running.exitCode() !== undefined);
      expect(running.output()).toContain('already in use');
      expect(existsSync(resolve(root, 'calls'))).toBe(false);
    } finally {
      await new Promise<void>((done) => listener.close(() => done()));
    }
  });
  it('refuses a second setup lock before installing', async () => {
    const root = directory();
    mockedCheckout(root);
    mkdirSync(resolve(root, '.local/setup.lock'));
    const running = launch(root);
    await until(() => running.exitCode() !== undefined);
    expect(running.output()).toContain('Another setup owns');
    expect(existsSync(resolve(root, 'calls'))).toBe(false);
    expect(existsSync(resolve(root, '.local/setup.lock'))).toBe(true);
  });
  it('refuses a remote Docker engine without starting services', async () => {
    const root = directory();
    mockedCheckout(root);
    const running = launch(root, [], {
      DOCKER_HOST: 'tcp://remote.invalid:2375',
      DOCKER_CONTEXT: '',
    });
    await until(() => running.exitCode() !== undefined);
    expect(running.output()).toContain('refuses a remote Docker engine');
    expect(existsSync(resolve(root, 'calls'))).toBe(false);
  });
  it('stops after migration failure and releases its setup lock', async () => {
    const root = directory();
    mockedCheckout(root);
    const running = launch(root, [], { SETUP_TEST_FAIL: 'db:migrate' });
    await until(() => running.exitCode() !== undefined);
    expect(running.exitCode()).toBe(1);
    expect(readFileSync(resolve(root, 'calls'), 'utf8')).not.toMatch(/demo:seed|build/);
    expect(existsSync(resolve(root, '.local/setup.lock'))).toBe(false);
    expect(running.output()).toContain('Private local log:');
  });
  it('rejects hosted mode before installing or allocating', async () => {
    const root = directory();
    mockedCheckout(root);
    const running = launch(root, [], { APP_ENV: 'production' });
    await until(() => running.exitCode() !== undefined);
    expect(running.output()).toContain('refuses hosted');
    expect(existsSync(resolve(root, 'calls'))).toBe(false);
  });
});
