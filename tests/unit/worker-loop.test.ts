import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReminderWorkerStore } from '../../src/server/reminders/worker-contracts';
import { runWorkerCli, runWorkerLoop, waitForNextTick } from '../../src/worker/loop';

const now = '2026-09-05T16:30:00.000Z';
function fixture() {
  const store: ReminderWorkerStore = {
    claim: vi.fn(async () => []),
    prepare: vi.fn(async () => ({ ready: false as const })),
    settle: vi.fn(async () => true),
    dueClosures: vi.fn(async () => []),
    closeSession: vi.fn(async () => false),
    heartbeat: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return { store, transport: { send: vi.fn() }, now: () => now, simulated: true };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('worker lifecycle with injected store and signal source', () => {
  it('one-shot runs once, reports safe counters, closes and exits zero', async () => {
    const test = fixture();
    const report = vi.fn();
    expect(await runWorkerCli(['--once'], { ...test, onTick: report }, new EventEmitter())).toBe(0);
    expect(test.store.claim).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ operationalFailures: 0 }));
    expect(test.store.close).toHaveBeenCalledTimes(1);
  });

  it('one-shot operational failure exits nonzero and still closes', async () => {
    const test = fixture();
    vi.mocked(test.store.claim).mockRejectedValue(new Error('synthetic-private-error'));
    expect(await runWorkerCli(['--once'], test, new EventEmitter())).toBe(1);
    expect(test.store.dueClosures).toHaveBeenCalledTimes(1);
    expect(test.store.close).toHaveBeenCalledTimes(1);
  });

  it.each([['--bad'], ['--once', '--once'], ['--once', 'extra']])(
    'rejects unknown/duplicate args %j without running a tick',
    async (...args) => {
      const test = fixture();
      expect(await runWorkerCli(args, test, new EventEmitter())).toBe(2);
      expect(test.store.claim).not.toHaveBeenCalled();
      expect(test.store.close).toHaveBeenCalledTimes(1);
    },
  );

  it('schedules the next tick 30 seconds after completion and never overlaps a pending tick', async () => {
    vi.useFakeTimers();
    const test = fixture();
    const controller = new AbortController();
    const entered = deferred();
    const release = deferred();
    vi.mocked(test.store.claim).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return [];
    });
    const report = vi.fn(() => {
      if (report.mock.calls.length === 2) controller.abort();
    });
    const running = runWorkerLoop({ ...test, signal: controller.signal, onTick: report });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(test.store.claim).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    release.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(test.store.claim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await running).toBe(0);
    expect(test.store.claim).toHaveBeenCalledTimes(2);
    expect(test.store.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['SIGINT', 'SIGTERM'])(
    'handles %s by waiting for current work and cleaning listeners/pool',
    async (signal) => {
      const test = fixture();
      const signals = new EventEmitter();
      const entered = deferred();
      const release = deferred();
      vi.mocked(test.store.claim).mockImplementationOnce(async () => {
        entered.resolve();
        await release.promise;
        return [];
      });
      const running = runWorkerCli([], test, signals);
      await entered.promise;
      signals.emit(signal);
      expect(test.store.close).not.toHaveBeenCalled();
      release.resolve();
      expect(await running).toBe(0);
      expect(test.store.close).toHaveBeenCalledTimes(1);
      expect(test.store.dueClosures).not.toHaveBeenCalled();
      expect(signals.listenerCount('SIGINT')).toBe(0);
      expect(signals.listenerCount('SIGTERM')).toBe(0);
    },
  );

  it('aborts an idle interval immediately and removes its timer/listener', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const wait = waitForNextTick(30_000, controller.signal);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await wait;
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('shutdown aborts transport but waits for its truthful settlement before closing the pool', async () => {
    const test = fixture();
    const signals = new EventEmitter();
    const sending = deferred();
    const settling = deferred();
    const releaseSettlement = deferred();
    const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
    const lease = { jobId: id(1), leaseToken: id(2), leaseUntil: '2026-09-05T16:31:00.000Z' };
    vi.mocked(test.store.claim).mockResolvedValueOnce([lease]);
    vi.mocked(test.store.prepare).mockResolvedValue({
      ready: true,
      jobId: id(1),
      leaseToken: id(2),
      attempt: 1,
      eventId: id(3),
      journeyId: id(4),
      sessionId: id(5),
      subscriptionId: id(6),
      subscriptionGeneration: 1,
      expiresAt: '2026-09-05T16:35:00.000Z',
      simulated: true,
      journeyTitle: null,
      subscription: {
        endpoint: 'https://fcm.googleapis.com/synthetic',
        keys: { p256dh: 'synthetic', auth: 'synthetic' },
      },
    });
    test.transport.send.mockImplementation(async (...args) => {
      const options = args[3];
      sending.resolve();
      await new Promise<void>((resolve) =>
        options.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { mode: 'simulated', httpStatus: null, kind: 'uncertain', reason: 'aborted' };
    });
    vi.mocked(test.store.settle).mockImplementation(async (_job, outcome) => {
      expect(outcome).toEqual({
        mode: 'simulated',
        httpStatus: null,
        kind: 'uncertain',
        reason: 'aborted',
      });
      settling.resolve();
      await releaseSettlement.promise;
      return true;
    });
    const running = runWorkerCli([], test, signals);
    await sending.promise;
    signals.emit('SIGTERM');
    await settling.promise;
    expect(test.store.close).not.toHaveBeenCalled();
    releaseSettlement.resolve();
    expect(await running).toBe(0);
    expect(test.store.settle).toHaveBeenCalledTimes(1);
    expect(test.store.close).toHaveBeenCalledTimes(1);
    expect(test.store.claim).toHaveBeenCalledTimes(1);
  });

  it('an already-aborted worker only closes its pool', async () => {
    const test = fixture();
    expect(await runWorkerLoop({ ...test, signal: AbortSignal.abort() })).toBe(0);
    expect(test.store.claim).not.toHaveBeenCalled();
    expect(test.store.close).toHaveBeenCalledTimes(1);
  });

  it('a failed close cannot produce a successful one-shot exit', async () => {
    const test = fixture();
    vi.mocked(test.store.close).mockRejectedValue(new Error('synthetic-close-failure'));
    expect(await runWorkerCli(['--once'], test, new EventEmitter())).toBe(1);
  });
});
