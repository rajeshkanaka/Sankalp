import type { WorkerCounts, WorkerOptions } from './runner.js';
import { runOnce } from './runner.js';

export function waitForNextTick(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export interface WorkerLoopOptions extends WorkerOptions {
  once?: boolean;
  onTick?: (counts: Readonly<WorkerCounts>) => void;
  wait?: typeof waitForNextTick;
}

/** One tick settles fully before the 30-second pause; shutdown owns pool cleanup. */
export async function runWorkerLoop(options: WorkerLoopOptions): Promise<number> {
  let exitCode = 0;
  try {
    while (!options.signal?.aborted) {
      const counts = await runOnce(options);
      options.onTick?.(counts);
      if (options.once) {
        exitCode = counts.operationalFailures > 0 ? 1 : 0;
        break;
      }
      if (options.signal?.aborted) break;
      await (options.wait ?? waitForNextTick)(30_000, options.signal);
    }
  } catch {
    exitCode = 1;
  } finally {
    try {
      await options.store.close();
    } catch {
      exitCode = 1;
    }
  }
  return exitCode;
}

interface SignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

/** Runtime credentials/mode/clock are supplied by the coordinator's guarded entrypoint. */
export async function runWorkerCli(
  args: readonly string[],
  options: Omit<WorkerLoopOptions, 'once'>,
  signals: SignalSource = process,
): Promise<number> {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--once')) {
    try {
      await options.store.close();
    } catch {
      return 1;
    }
    return 2;
  }
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  const signal = options.signal
    ? AbortSignal.any([options.signal, shutdown.signal])
    : shutdown.signal;
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  try {
    return await runWorkerLoop({ ...options, signal, once: args[0] === '--once' });
  } finally {
    signals.removeListener('SIGINT', stop);
    signals.removeListener('SIGTERM', stop);
  }
}
