#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Supabase 2.116 emits separate `docker create -p host:container` arguments.
// Docker Desktop 29.4.2 ignores the bridge default for these host publications.
export function bindLoopback(argv) {
  const args = [...argv];
  if (args[0] !== 'create') return args;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === '-p') {
      const port = args[++index] ?? '';
      if (/^\d+:\d+(?:\/(?:tcp|udp))?$/.test(port)) args[index] = `127.0.0.1:${port}`;
      else if (!/^127\.0\.0\.1:\d+:\d+(?:\/(?:tcp|udp))?$/.test(port))
        throw new Error('Supabase requested an unsupported or non-loopback port mapping.');
    } else if (
      args[index] === '-P' ||
      args[index].startsWith('--publish') ||
      /^-p./.test(args[index])
    )
      throw new Error('Supabase changed its port argument contract; inspect before continuing.');
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const executable = process.env.SANKALPA_REAL_DOCKER;
    if (!executable || !executable.startsWith('/') || executable === resolve(process.argv[1]))
      throw new Error('A verified absolute Docker executable is required.');
    const result = spawnSync(executable, bindLoopback(process.argv.slice(2)), { stdio: 'inherit' });
    if (result.error) throw new Error('Docker could not be started.');
    process.exitCode = result.status ?? 1;
  } catch (error) {
    // Never include the command: Docker create also carries local service credentials.
    console.error(error instanceof Error ? error.message : 'Local Docker invocation failed.');
    process.exitCode = 1;
  }
}
