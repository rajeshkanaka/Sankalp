import { spawn } from 'node:child_process';

const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) throw new Error('Expected dev or start.');
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    mode,
    '--hostname',
    '127.0.0.1',
    '--port',
    process.env.PORT || '3000',
  ],
  { stdio: 'inherit', env: process.env },
);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
