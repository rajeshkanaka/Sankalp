import { describe, expect, it, vi } from 'vitest';

import type { PushResult, PushTransport } from '../../src/server/reminders/transport-contracts';
import type {
  PreparedReminder,
  ReminderLease,
  ReminderWorkerStore,
} from '../../src/server/reminders/worker-contracts';
import { createSimulatedPushTransport } from '../../src/server/reminders/transport';
import { reminderPayload, reminderTag, runOnce } from '../../src/worker/runner';

const now = '2026-09-05T16:30:00.000Z';
const expiresAt = '2026-09-05T16:35:00.000Z';
const id = (number: number) => `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`;
type Ready = Extract<PreparedReminder, { ready: true }>;

function job(number = 1): Ready {
  return {
    ready: true,
    jobId: id(number),
    leaseToken: id(1000 + number),
    attempt: 1,
    eventId: id(2000 + number),
    journeyId: id(3000),
    sessionId: id(4000 + number),
    subscriptionId: id(5000),
    subscriptionGeneration: 1,
    expiresAt,
    simulated: true,
    journeyTitle: null,
    subscription: {
      endpoint: 'https://fcm.googleapis.com/synthetic',
      keys: { p256dh: 'synthetic-key', auth: 'synthetic-auth' },
    },
  };
}

function lease(value: Ready): ReminderLease {
  return {
    jobId: value.jobId,
    leaseToken: value.leaseToken,
    leaseUntil: '2026-09-05T16:31:00.000Z',
  };
}

function fixture(jobs: Ready[] = [job()]) {
  const queue = jobs.map(lease);
  const calls: string[] = [];
  const store: ReminderWorkerStore = {
    claim: vi.fn(async (_now, limit) => {
      calls.push('claim');
      return queue.splice(0, limit);
    }),
    prepare: vi.fn(async (item) => {
      calls.push('prepare');
      return jobs.find((value) => value.jobId === item.jobId)!;
    }),
    settle: vi.fn(async () => {
      calls.push('settle');
      return true;
    }),
    dueClosures: vi.fn(async () => {
      calls.push('dueClosures');
      return [];
    }),
    closeSession: vi.fn(async () => true),
    heartbeat: vi.fn(async () => {
      calls.push('heartbeat');
    }),
    close: vi.fn(async () => {}),
  };
  const transport: PushTransport = {
    send: vi.fn(async (): Promise<PushResult> => {
      calls.push('send');
      return { mode: 'simulated', httpStatus: null, kind: 'accepted' };
    }),
  };
  const options = { store, transport, now: () => now, simulated: true };
  return { jobs, calls, store, transport, options };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('bounded reminder tick with simulated store and transport', () => {
  it('uses the selected simulated transport with the injected historical clock and preserves numeric retry advice', async () => {
    const test = fixture();
    test.jobs[0].subscription = {
      endpoint: 'https://fcm.googleapis.com/synthetic',
      keys: {
        p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
        auth: Buffer.alloc(16, 1).toString('base64url'),
      },
    };
    const transport = createSimulatedPushTransport(
      { kind: 'transient_failure', reason: 'provider_retry', retryAfterMs: 0.5 },
      { now: () => Date.parse(now) },
    );
    expect(await runOnce({ ...test.options, transport })).toMatchObject({
      transientFailures: 1,
      settled: 1,
      operationalFailures: 0,
    });
    expect(test.store.settle).toHaveBeenCalledWith(
      test.jobs[0],
      {
        mode: 'simulated',
        httpStatus: null,
        kind: 'transient_failure',
        reason: 'provider_retry',
        retryAfterMs: 0.5,
      },
      now,
    );
  });

  it('prepares before sending, settles before another claim, and exposes only aggregate counts', async () => {
    const test = fixture();
    const counts = await runOnce(test.options);
    expect(test.calls).toEqual([
      'claim',
      'prepare',
      'send',
      'settle',
      'claim',
      'dueClosures',
      'heartbeat',
    ]);
    expect(counts).toEqual({
      claimed: 1,
      prepared: 1,
      sent: 1,
      settled: 1,
      skipped: 0,
      accepted: 1,
      terminalFailures: 0,
      transientFailures: 0,
      uncertain: 0,
      closures: 0,
      operationalFailures: 0,
    });
    expect(Object.values(counts).every((value) => Number.isInteger(value))).toBe(true);
    expect(test.store.settle).toHaveBeenCalledWith(
      test.jobs[0],
      { mode: 'simulated', httpStatus: null, kind: 'accepted' },
      now,
    );
    expect(test.store.close).not.toHaveBeenCalled();
  });

  it('passes actual target, matching payload/tag, expiry and abort signal to the transport', async () => {
    const test = fixture();
    const controller = new AbortController();
    await runOnce({ ...test.options, signal: controller.signal });
    const [target, payload, tag, options] = vi.mocked(test.transport.send).mock.calls[0];
    expect(target).toEqual(test.jobs[0].subscription);
    expect(JSON.parse(payload)).toEqual({
      version: 1,
      eventId: id(2001),
      journeyId: id(3000),
      sessionId: id(4001),
      subscriptionId: id(5000),
      subscriptionGeneration: 1,
      tag,
      title: 'Your practice reminder',
      body: 'A moment for your commitment.',
    });
    expect(tag).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(options).toEqual({ expiresAt, signal: controller.signal });
  });

  it('sends nothing for an ineligible preparation', async () => {
    const test = fixture();
    vi.mocked(test.store.prepare).mockResolvedValue({ ready: false });
    expect(await runOnce(test.options)).toMatchObject({
      skipped: 1,
      sent: 0,
      operationalFailures: 0,
    });
    expect(test.transport.send).not.toHaveBeenCalled();
    expect(test.store.settle).not.toHaveBeenCalled();
  });

  it.each(['jobId', 'leaseToken', 'simulated', 'attempt', 'sessionId'] as const)(
    'rejects malformed or mismatched preparation %s without sending',
    async (field) => {
      const test = fixture();
      const invalid = {
        ...job(),
        [field]:
          field === 'simulated'
            ? false
            : field === 'attempt'
              ? 0
              : field === 'sessionId'
                ? null
                : id(999),
      };
      vi.mocked(test.store.prepare).mockResolvedValue(invalid as Ready);
      expect(await runOnce(test.options)).toMatchObject({ sent: 0, operationalFailures: 1 });
      expect(test.store.settle).not.toHaveBeenCalled();
    },
  );

  it.each(['expiresAt', 'leaseUntil'] as const)(
    'does not send at the exact %s boundary and persists a no-send expiry',
    async (field) => {
      const test = fixture();
      if (field === 'expiresAt') test.jobs[0].expiresAt = now;
      else
        vi.mocked(test.store.claim)
          .mockResolvedValueOnce([{ ...lease(test.jobs[0]), leaseUntil: now }])
          .mockResolvedValue([]);
      expect(await runOnce(test.options)).toMatchObject({
        sent: 0,
        settled: 1,
        terminalFailures: 1,
        operationalFailures: 0,
      });
      expect(test.store.settle).toHaveBeenCalledWith(
        test.jobs[0],
        {
          mode: 'simulated',
          httpStatus: null,
          kind: 'terminal_failure',
          reason: 'expired',
          invalidateSubscription: false,
        },
        now,
      );
    },
  );

  it('checks the clock after prepare, so a preparation crossing expiry cannot send', async () => {
    const test = fixture();
    let current = now;
    vi.mocked(test.store.prepare).mockImplementation(async () => {
      current = expiresAt;
      return job();
    });
    await runOnce({ ...test.options, now: () => current });
    expect(test.transport.send).not.toHaveBeenCalled();
    expect(test.store.settle).toHaveBeenCalledWith(
      test.jobs[0],
      expect.objectContaining({ reason: 'expired' }),
      expiresAt,
    );
  });

  it('an already-aborted tick performs no work', async () => {
    const test = fixture();
    await runOnce({ ...test.options, signal: AbortSignal.abort() });
    expect(test.calls).toEqual([]);
  });

  it('cancellation after prepare is settled without invoking transport', async () => {
    const test = fixture();
    const controller = new AbortController();
    vi.mocked(test.store.prepare).mockImplementation(async () => {
      controller.abort();
      return job();
    });
    expect(await runOnce({ ...test.options, signal: controller.signal })).toMatchObject({
      prepared: 1,
      sent: 0,
      settled: 1,
    });
    expect(test.store.settle).toHaveBeenCalledWith(
      test.jobs[0],
      {
        mode: 'simulated',
        httpStatus: null,
        kind: 'terminal_failure',
        reason: 'canceled',
        invalidateSubscription: false,
      },
      now,
    );
  });

  it('limits each batch and concurrent sends to four and each tick to fifty jobs', async () => {
    const test = fixture(Array.from({ length: 75 }, (_, index) => job(index + 1)));
    let active = 0;
    let peak = 0;
    vi.mocked(test.transport.send).mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return { mode: 'simulated', httpStatus: null, kind: 'accepted' };
    });
    expect(await runOnce(test.options)).toMatchObject({
      claimed: 50,
      accepted: 50,
      settled: 50,
      operationalFailures: 0,
    });
    expect(peak).toBe(4);
    expect(vi.mocked(test.store.claim).mock.calls.map((call) => call[1])).toEqual([
      ...Array<number>(12).fill(4),
      2,
    ]);
  });

  it('does not claim a later batch while any settlement in the current batch is pending', async () => {
    const test = fixture(Array.from({ length: 5 }, (_, index) => job(index + 1)));
    const entered = deferred();
    const release = deferred();
    vi.mocked(test.store.settle).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return true;
    });
    const tick = runOnce(test.options);
    await entered.promise;
    expect(test.store.claim).toHaveBeenCalledTimes(1);
    release.resolve();
    expect(await tick).toMatchObject({ accepted: 5 });
  });

  it('rejects duplicate claims rather than sending the same job twice in one tick', async () => {
    const test = fixture();
    vi.mocked(test.store.claim).mockResolvedValue([lease(job())]);
    expect(await runOnce(test.options)).toMatchObject({
      claimed: 1,
      sent: 1,
      operationalFailures: 1,
    });
    expect(test.transport.send).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized claim batch rather than launching unbounded sends', async () => {
    const test = fixture();
    vi.mocked(test.store.claim).mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => lease(job(index + 1))),
    );
    expect(await runOnce(test.options)).toMatchObject({ sent: 0, operationalFailures: 1 });
  });

  it.each<PushResult>([
    {
      mode: 'simulated',
      httpStatus: null,
      kind: 'terminal_failure',
      reason: 'subscription_gone',
      invalidateSubscription: true,
    },
    {
      mode: 'simulated',
      httpStatus: null,
      kind: 'transient_failure',
      reason: 'provider_retry',
      retryAfterMs: 1200,
    },
    { mode: 'simulated', httpStatus: null, kind: 'uncertain', reason: 'timeout' },
  ])(
    'preserves actual transport outcome $kind without local retry or operational failure',
    async (result) => {
      const test = fixture();
      vi.mocked(test.transport.send).mockResolvedValue(result);
      expect(await runOnce(test.options)).toMatchObject({
        sent: 1,
        settled: 1,
        operationalFailures: 0,
      });
      expect(test.store.settle).toHaveBeenCalledWith(test.jobs[0], result, now);
      expect(test.transport.send).toHaveBeenCalledTimes(1);
    },
  );

  it('ambiguous transport exceptions record uncertainty and no raw exception content', async () => {
    const test = fixture();
    vi.mocked(test.transport.send).mockRejectedValue(
      new Error('synthetic-private-endpoint-and-key'),
    );
    const counts = await runOnce(test.options);
    expect(counts).toMatchObject({ uncertain: 1, accepted: 0, operationalFailures: 1 });
    expect(test.store.settle).toHaveBeenCalledWith(
      test.jobs[0],
      { mode: 'simulated', httpStatus: null, kind: 'uncertain', reason: 'network' },
      now,
    );
    expect(JSON.stringify(counts)).not.toContain('synthetic');
  });

  it('an exception during abort after transport invocation remains uncertain', async () => {
    const test = fixture();
    const controller = new AbortController();
    vi.mocked(test.transport.send).mockImplementation(async () => {
      controller.abort();
      throw new Error('interrupted');
    });
    expect(await runOnce({ ...test.options, signal: controller.signal })).toMatchObject({
      uncertain: 1,
    });
    expect(test.store.settle).toHaveBeenCalledWith(
      test.jobs[0],
      expect.objectContaining({ kind: 'uncertain', reason: 'aborted' }),
      now,
    );
  });

  it.each([true, false])(
    'a mismatched transport mode is never relabeled (simulated=%s)',
    async (simulated) => {
      const test = fixture([{ ...job(), simulated }]);
      vi.mocked(test.transport.send).mockResolvedValue({
        mode: simulated ? 'real' : 'simulated',
        httpStatus: null,
        kind: 'accepted',
      });
      expect(await runOnce({ ...test.options, simulated })).toMatchObject({
        sent: 1,
        settled: 0,
        accepted: 0,
        operationalFailures: 1,
      });
      expect(test.store.settle).not.toHaveBeenCalled();
    },
  );

  it('malformed transport output is not forwarded to the database', async () => {
    const test = fixture();
    vi.mocked(test.transport.send).mockResolvedValue({
      mode: 'simulated',
      httpStatus: null,
      kind: 'accepted',
      raw: 'synthetic-private-content',
    } as PushResult);
    expect(await runOnce(test.options)).toMatchObject({ settled: 0, operationalFailures: 1 });
    expect(test.store.settle).not.toHaveBeenCalled();
  });

  it('preserves a real-mode provider receipt without promoting it to device delivery', async () => {
    const test = fixture([{ ...job(), simulated: false }]);
    const result = { mode: 'real', httpStatus: 201, kind: 'accepted' } as const;
    vi.mocked(test.transport.send).mockResolvedValue(result);
    expect(await runOnce({ ...test.options, simulated: false })).toMatchObject({
      accepted: 1,
      settled: 1,
      operationalFailures: 0,
    });
    expect(test.store.settle).toHaveBeenCalledWith(test.jobs[0], result, now);
  });

  it.each(['reject', 'false'] as const)(
    'settlement %s never fabricates a durable accepted receipt',
    async (failure) => {
      const test = fixture();
      if (failure === 'reject')
        vi.mocked(test.store.settle).mockRejectedValue(new Error('connection lost'));
      else vi.mocked(test.store.settle).mockResolvedValue(false);
      expect(await runOnce(test.options)).toMatchObject({
        sent: 1,
        settled: 0,
        accepted: 0,
        operationalFailures: 1,
      });
    },
  );

  it.each(['claim', 'prepare', 'settle'] as const)(
    'a %s failure does not block the independent closure sweep',
    async (method) => {
      const test = fixture();
      vi.mocked(test.store[method]).mockRejectedValue(new Error('synthetic-database-error'));
      vi.mocked(test.store.dueClosures).mockResolvedValue([id(9), id(10)]);
      vi.mocked(test.store.closeSession).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      expect(await runOnce(test.options)).toMatchObject({ closures: 1, operationalFailures: 1 });
      expect(test.store.closeSession).toHaveBeenCalledTimes(2);
      expect(test.store.heartbeat).toHaveBeenCalledTimes(1);
    },
  );

  it('one closure failure does not prevent other sessions from closing', async () => {
    const test = fixture([]);
    vi.mocked(test.store.dueClosures).mockResolvedValue([id(9), id(10)]);
    vi.mocked(test.store.closeSession)
      .mockRejectedValueOnce(new Error('closure failed'))
      .mockResolvedValueOnce(true);
    expect(await runOnce(test.options)).toMatchObject({ closures: 1, operationalFailures: 1 });
  });

  it('caps and bounds closure batches, deduplicates sessions, and records heartbeat failure', async () => {
    const test = fixture([]);
    vi.mocked(test.store.dueClosures).mockResolvedValue([id(9), id(9), id(10)]);
    vi.mocked(test.store.heartbeat).mockRejectedValue(new Error('heartbeat failed'));
    expect(await runOnce(test.options)).toMatchObject({ closures: 2, operationalFailures: 1 });
    expect(test.store.dueClosures).toHaveBeenCalledWith(now, 50);
    expect(test.store.closeSession).toHaveBeenCalledTimes(2);
  });
});

describe('notification payload privacy and stable replacement tags', () => {
  it('includes a title only when detailed opt-in supplied it and never serializes the subscription', () => {
    const generic = reminderPayload(job());
    expect(generic).not.toContain('synthetic');
    const detailed = reminderPayload({ ...job(), journeyTitle: 'My selected practice' });
    expect(JSON.parse(detailed).title).toBe('My selected practice');
    expect(Object.keys(JSON.parse(detailed))).toEqual([
      'version',
      'eventId',
      'journeyId',
      'sessionId',
      'subscriptionId',
      'subscriptionGeneration',
      'tag',
      'title',
      'body',
    ]);
  });

  it.each(['🙏'.repeat(4000), '"\\\n'.repeat(4000), 'ध्यान'.repeat(4000)])(
    'bounds Unicode and escaped text to 3072 UTF-8 bytes',
    (title) => {
      const payload = reminderPayload({ ...job(), journeyTitle: title });
      const decoded = JSON.parse(payload);
      expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(3072);
      expect(title.startsWith(decoded.title)).toBe(true);
      expect(decoded.title.length).toBeGreaterThan(0);
      expect(decoded.title).not.toContain('\uFFFD');
    },
  );

  it('test notifications have null routing IDs and a generic test title', () => {
    const payload = JSON.parse(
      reminderPayload({
        ...job(),
        sessionId: null,
        journeyId: null,
        journeyTitle: 'ignored private title',
      }),
    );
    expect(payload).toMatchObject({ title: 'Test reminder', sessionId: null, journeyId: null });
  });

  it('keeps the same session/device tag across jobs and retries, but changes for a generation/session/device', () => {
    const original = job();
    const tag = reminderTag(original);
    expect(reminderTag({ ...original, jobId: id(88), attempt: 3, eventId: id(99) })).toBe(tag);
    for (const update of [
      { subscriptionGeneration: 2 },
      { sessionId: id(55) },
      { subscriptionId: id(66) },
    ])
      expect(reminderTag({ ...original, ...update })).not.toBe(tag);
    expect(reminderTag({ ...original, journeyId: null, sessionId: null })).not.toBe(
      reminderTag({ ...original, jobId: id(77), journeyId: null, sessionId: null }),
    );
  });
});
