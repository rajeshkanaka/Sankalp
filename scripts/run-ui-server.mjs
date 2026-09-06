// Test-only network cutoff: the production server and service worker stay unchanged.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from 'node:fs';
import { createServer, request } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

const port = Number(process.env.PORT);
const origin = new URL(process.env.APP_ORIGIN || 'http://invalid');
if (
  process.env.APP_ENV !== 'ci' ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65435 ||
  origin.protocol !== 'http:' ||
  !['localhost', '127.0.0.1'].includes(origin.hostname) ||
  Number(origin.port) !== port ||
  origin.username ||
  origin.password
)
  throw new Error(
    'UI network fixture requires APP_ENV=ci and an explicit loopback APP_ORIGIN/PORT.',
  );

const directory = resolve('.local');
const controlPath = resolve(directory, 'ui-network.json');
const appliedPath = resolve(directory, 'ui-network-applied.json');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const writeAtomic = (file, value) => {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, file);
};
let state = { disconnected: false, generation: randomUUID() };
writeAtomic(controlPath, state);
writeAtomic(appliedPath, state);
const sockets = new Set();
const upstreamRequests = new Set();
const cutConnections = () => {
  for (const socket of sockets) socket.destroy();
  for (const upstream of upstreamRequests) upstream.destroy();
};
const applyNetworkState = () => {
  try {
    const next = JSON.parse(readFileSync(controlPath, 'utf8'));
    if (
      typeof next.disconnected !== 'boolean' ||
      typeof next.generation !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(next.generation)
    )
      throw new Error('Invalid test network state.');
    if (next.generation !== state.generation) {
      state = { disconnected: next.disconnected, generation: next.generation };
      if (state.disconnected) cutConnections();
      writeAtomic(appliedPath, state);
    }
  } catch {
    // An unavailable/malformed control file must never silently reconnect a test.
    state = { disconnected: true, generation: '' };
    cutConnections();
  }
  return state.disconnected;
};
watchFile(controlPath, { interval: 25 }, applyNetworkState);

const server = createServer((incoming, outgoing) => {
  if (applyNetworkState()) {
    incoming.socket.destroy();
    return;
  }
  const upstream = request(
    {
      hostname: '127.0.0.1',
      port: port + 100,
      method: incoming.method,
      path: incoming.url,
      // Preserve the public authority so origin validation, redirects and cookies
      // exercise the same app origin as the browser, never the internal port.
      headers: incoming.headers,
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
      response.on('error', () => outgoing.destroy());
    },
  );
  upstreamRequests.add(upstream);
  upstream.on('close', () => upstreamRequests.delete(upstream));
  upstream.on('error', () => {
    if (!outgoing.headersSent && !outgoing.destroyed) {
      outgoing.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      outgoing.end('UI test server is not ready.');
    } else outgoing.destroy();
  });
  incoming.on('aborted', () => upstream.destroy());
  outgoing.on('close', () => upstream.destroy());
  incoming.pipe(upstream);
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
// Production UI checks do not use a development hot-reload WebSocket.
server.on('upgrade', (_request, socket) => socket.destroy());

let child;
let stopping;
const signalChild = (signal) => {
  if (!child?.pid) return;
  try {
    // The isolated group also owns run-next's Next child.
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
};
const stop = (exitCode) => {
  if (stopping) return stopping;
  stopping = (async () => {
    unwatchFile(controlPath, applyNetworkState);
    cutConnections();
    await new Promise((done) => server.close(done));
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      await new Promise((done) => {
        const timeout = setTimeout(() => signalChild('SIGKILL'), 5000);
        child.once('exit', () => {
          clearTimeout(timeout);
          done();
        });
        signalChild('SIGTERM');
      });
    }
    process.exitCode = exitCode;
  })();
  return stopping;
};
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void stop(0));
server.on('error', () => void stop(1));
server.listen(port, '127.0.0.1', () => {
  child = spawn(process.execPath, ['scripts/run-next.mjs', 'start'], {
    stdio: 'inherit',
    detached: true,
    env: { ...process.env, PORT: String(port + 100) },
  });
  child.on('error', () => void stop(1));
  child.on('exit', (code) => {
    if (!stopping) void stop(code ?? 1);
  });
});
