import { createECDH, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Agent, request as nativeRequest, createServer, type RequestOptions } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

import { afterEach, describe, expect, it, vi } from 'vitest';
import webPush from 'web-push';

import {
  createRealPushTransport,
  createSimulatedPushTransport,
  type PushTransportDependencies,
} from '../../src/server/reminders/transport';
import type {
  PushOutcome,
  PushSubscriptionTarget,
} from '../../src/server/reminders/transport-contracts';

const now = Date.parse('2026-09-06T10:00:00Z');
const vapid = { subject: 'mailto:synthetic@example.test', ...webPush.generateVAPIDKeys() };
const target: PushSubscriptionTarget = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/SYNTHETIC_ENDPOINT?opaque=a%2Fb',
  keys: {
    p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  },
};
const payload = JSON.stringify({
  title: 'Sankalpa',
  body: 'Your practice time is approaching.',
  tag: 'synthetic_tag',
});
const options = () => ({ expiresAt: new Date(Date.now() + 300_000).toISOString() });
const nodata = () => Promise.reject(Object.assign(new Error('No records'), { code: 'ENODATA' }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
class FakeRequest extends EventEmitter {
  destroyed = false;
  body: Buffer | undefined;
  socket = Object.assign(new EventEmitter(), { authorized: true });
  written = deferred<Buffer>();
  attached = deferred<void>();
  end(body: Buffer) {
    this.body = body;
    this.written.resolve(body);
  }
  destroy() {
    this.destroyed = true;
    return this;
  }
  attachSocket() {
    this.emit('socket', this.socket);
    this.attached.resolve();
  }
  secureConnect() {
    this.socket.emit('secureConnect');
  }
}
class FakeResponse extends EventEmitter {
  destroyed = false;
  complete = true;
  constructor(
    public statusCode: number,
    public headers: Record<string, string | string[]> = {},
  ) {
    super();
  }
  destroy() {
    this.destroyed = true;
    return this;
  }
}
function harness(
  config: {
    a?: () => Promise<string[]>;
    aaaa?: () => Promise<string[]>;
    autoConnect?: boolean;
  } = {},
) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const created = deferred<FakeRequest>();
  let captured!: RequestOptions;
  let respond!: (response: IncomingMessage) => void;
  const cancel = vi.fn();
  const resolver = {
    resolve4: vi.fn(config.a ?? (async () => ['8.8.8.8'])),
    resolve6: vi.fn(config.aaaa ?? nodata),
    cancel,
  };
  const request = vi.fn(
    (requestOptions: RequestOptions, callback: (response: IncomingMessage) => void) => {
      captured = requestOptions;
      respond = callback;
      const outgoing = new FakeRequest();
      created.resolve(outgoing);
      queueMicrotask(() => {
        outgoing.attachSocket();
        if (config.autoConnect !== false) outgoing.secureConnect();
      });
      return outgoing as unknown as ClientRequest;
    },
  );
  const transport = createRealPushTransport(vapid, {
    createResolver: () => resolver,
    request,
    clock: { now: () => Date.now(), monotonic: () => Date.now() },
  });
  const response = (status: number, headers: Record<string, string | string[]> = {}) => {
    const incoming = new FakeResponse(status, headers);
    respond(incoming as unknown as IncomingMessage);
    return incoming;
  };
  return {
    transport,
    created: created.promise,
    resolver,
    request,
    response,
    captured: () => captured,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('guarded push transport', () => {
  it('encrypts a real payload, pins both public DNS families and preserves request identity', async () => {
    const h = harness({ aaaa: async () => ['2001:4860:4860::8888'] });
    const pending = h.transport.send(target, payload, 'synthetic_tag', options());
    const outgoing = await h.created;
    const encrypted = await outgoing.written.promise;
    expect(encrypted.length).toBeGreaterThan(Buffer.byteLength(payload));
    expect(encrypted.includes(Buffer.from('Your practice'))).toBe(false);
    const config = h.captured();
    expect(config).toMatchObject({
      hostname: 'fcm.googleapis.com',
      servername: 'fcm.googleapis.com',
      port: 443,
      path: '/fcm/send/SYNTHETIC_ENDPOINT?opaque=a%2Fb',
      method: 'POST',
      rejectUnauthorized: true,
      maxHeaderSize: 16_384,
    });
    expect(config.headers).toMatchObject({
      TTL: 290,
      Topic: 'synthetic_tag',
      'Content-Encoding': 'aes128gcm',
    });
    expect((config.agent as Agent).options).toMatchObject({ keepAlive: false, proxyEnv: {} });
    const agentDestroyed = vi.spyOn(config.agent as Agent, 'destroy');
    const addresses = await new Promise<unknown>((resolve, reject) =>
      config.lookup!('fcm.googleapis.com', { all: true }, (error, result) =>
        error ? reject(error) : resolve(result),
      ),
    );
    expect(addresses).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
    await new Promise<void>((resolve) =>
      config.lookup!('unexpected.example.test', { all: false }, (error) => {
        expect(error?.code).toBe('ENOTFOUND');
        resolve();
      }),
    );
    expect(h.resolver.resolve4).toHaveBeenCalledTimes(1);
    expect(h.resolver.resolve6).toHaveBeenCalledTimes(1);
    const response = h.response(201);
    response.emit('end');
    expect(await pending).toEqual({ mode: 'real', kind: 'accepted', httpStatus: 201 });
    expect(outgoing.destroyed).toBe(true);
    expect(response.destroyed).toBe(true);
    expect(agentDestroyed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [['8.8.8.8', '127.0.0.1'], []],
    [['8.8.8.8'], ['::1']],
    [['10.0.0.1'], ['2001:4860:4860::8888']],
    [['8.8.8.8'], ['::ffff:8.8.8.8']],
    [['2001:4860:4860::8888'], []],
    [[], ['8.8.8.8']],
  ])('rejects the entire mixed or malformed DNS answer %j / %j', async (a, aaaa) => {
    const h = harness({ a: async () => a, aaaa: async () => aaaa });
    expect(await h.transport.send(target, payload, 'tag', options())).toMatchObject({
      kind: 'terminal_failure',
      reason: 'endpoint_blocked',
    });
    expect(h.request).not.toHaveBeenCalled();
  });

  it.each(['ENOTFOUND', 'SERVFAIL', 'ETIMEOUT'])(
    'refuses a failed AAAA lookup even with a public A answer: %s',
    async (code) => {
      const h = harness({
        aaaa: async () => {
          throw Object.assign(new Error('SYNTHETIC_SECRET'), { code });
        },
      });
      const result = await h.transport.send(target, payload, 'tag', options());
      expect(result).toMatchObject({ kind: 'transient_failure', reason: 'dns_failure' });
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it('requires at least one address', async () => {
    const h = harness({ a: nodata });
    expect(await h.transport.send(target, payload, 'tag', options())).toMatchObject({
      reason: 'dns_failure',
    });
    expect(h.request).not.toHaveBeenCalled();
  });

  it('cancels a stalled resolver and never dispatches when it resolves late', async () => {
    const late = deferred<string[]>();
    const h = harness({ a: () => late.promise });
    const pending = h.transport.send(target, payload, 'tag', options());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ kind: 'transient_failure', reason: 'dns_failure' });
    expect(h.resolver.cancel).toHaveBeenCalledOnce();
    late.resolve(['8.8.8.8']);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for AAAA completion before any request', async () => {
    const delayed = deferred<string[]>();
    const h = harness({ aaaa: () => delayed.promise });
    const pending = h.transport.send(target, payload, 'tag', options());
    await vi.advanceTimersByTimeAsync(1);
    expect(h.request).not.toHaveBeenCalled();
    delayed.resolve(['::1']);
    expect(await pending).toMatchObject({ reason: 'endpoint_blocked' });
  });

  it('pins DNS answers even if the caller changes its target and resolver answers later', async () => {
    const h = harness();
    const mutable = { ...target, keys: { ...target.keys } };
    const pending = h.transport.send(mutable, payload, 'tag', options());
    mutable.endpoint = 'https://127.0.0.1/SYNTHETIC_SECRET';
    mutable.keys.auth = 'SYNTHETIC_SECRET';
    const outgoing = await h.created;
    await outgoing.written.promise;
    h.resolver.resolve4.mockResolvedValue(['127.0.0.1']);
    await new Promise<void>((resolve) =>
      h.captured().lookup!('fcm.googleapis.com', { all: false }, (error, address) => {
        expect(error).toBeNull();
        expect(address).toBe('8.8.8.8');
        resolve();
      }),
    );
    h.response(204).emit('end');
    expect(await pending).toMatchObject({ kind: 'accepted' });
    expect(h.resolver.resolve4).toHaveBeenCalledOnce();
  });

  it.each([
    [400, 'terminal_failure', 'provider_rejected', false],
    [401, 'terminal_failure', 'provider_rejected', false],
    [403, 'terminal_failure', 'provider_rejected', false],
    [404, 'terminal_failure', 'subscription_gone', true],
    [410, 'terminal_failure', 'subscription_gone', true],
    [413, 'terminal_failure', 'provider_rejected', false],
    [408, 'transient_failure', 'provider_retry', undefined],
    [429, 'transient_failure', 'provider_retry', undefined],
    [500, 'transient_failure', 'provider_retry', undefined],
    [503, 'transient_failure', 'provider_retry', undefined],
  ])(
    'classifies complete HTTP %s without repeating the send',
    async (status, kind, reason, invalidateSubscription) => {
      const h = harness();
      const pending = h.transport.send(target, payload, 'tag', options());
      await (
        await h.created
      ).written.promise;
      h.response(status).emit('end');
      const result = await pending;
      expect(result).toMatchObject({ mode: 'real', httpStatus: status, kind, reason });
      if (invalidateSubscription !== undefined)
        expect(result).toHaveProperty('invalidateSubscription', invalidateSubscription);
      expect(h.request).toHaveBeenCalledOnce();
    },
  );

  it.each([301, 302, 303, 307, 308])(
    'never follows redirect %s, even to a public provider',
    async (status) => {
      const h = harness();
      const pending = h.transport.send(target, payload, 'tag', options());
      await (
        await h.created
      ).written.promise;
      h.response(status, {
        location: 'https://updates.push.services.mozilla.com/SYNTHETIC_SECRET',
      });
      expect(await pending).toEqual({
        mode: 'real',
        httpStatus: status,
        ...{ kind: 'terminal_failure', reason: 'provider_rejected', invalidateSubscription: false },
      });
      expect(h.request).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['12', 12_000],
    ['999999999999999999999999999', 300_000],
    ['-1', null],
    ['Sun, 06 Sep 2026 10:00:20 GMT', 20_000],
    ['Sun, 06 Sep 2026 09:00:00 GMT', 0],
    ['not a date', null],
    [['1', '2'], null],
  ])('parses and bounds Retry-After %j', async (header, retryAfterMs) => {
    const h = harness();
    const pending = h.transport.send(target, payload, 'tag', options());
    await (
      await h.created
    ).written.promise;
    h.response(429, { 'retry-after': header }).emit('end');
    expect(await pending).toMatchObject({ kind: 'transient_failure', retryAfterMs });
  });

  it.each(['aborted', 'error', 'truncated', 'oversized', 'invalid_status'])(
    'never accepts a %s response after transmission',
    async (fault) => {
      const h = harness();
      const pending = h.transport.send(target, payload, 'tag', options());
      await (
        await h.created
      ).written.promise;
      const response = h.response(fault === 'invalid_status' ? 999 : 201);
      if (fault === 'truncated') {
        response.complete = false;
        response.emit('end');
      } else if (fault === 'oversized') response.emit('data', Buffer.alloc(8_193));
      else if (fault !== 'invalid_status') response.emit(fault, new Error('SYNTHETIC_SECRET'));
      expect(await pending).toMatchObject({ kind: 'uncertain', reason: 'invalid_response' });
    },
  );

  it('has an overall deadline even when response bytes keep arriving', async () => {
    const h = harness();
    const pending = h.transport.send(target, payload, 'tag', options());
    const outgoing = await h.created;
    await outgoing.written.promise;
    const response = h.response(201);
    for (let second = 0; second < 10; second++) {
      response.emit('data', Buffer.from('a'));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(await pending).toMatchObject({ kind: 'uncertain', reason: 'timeout' });
    expect(response.destroyed).toBe(true);
    expect(outgoing.destroyed).toBe(true);
  });

  it('bounds a stalled TLS connection before any HTTP body is sent', async () => {
    const h = harness({ autoConnect: false });
    const pending = h.transport.send(target, payload, 'tag', options());
    const outgoing = await h.created;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({
      kind: 'transient_failure',
      reason: 'network_before_send',
    });
    outgoing.secureConnect();
    expect(outgoing.body).toBeUndefined();
    expect(outgoing.destroyed).toBe(true);
  });

  it.each(['headers', 'end'])(
    'refuses late response %s even if the timer callback has not run yet',
    async (phase) => {
      const h = harness();
      const pending = h.transport.send(target, payload, 'tag', options());
      await (
        await h.created
      ).written.promise;
      const response = phase === 'end' ? h.response(201) : undefined;
      vi.setSystemTime(now + 10_001);
      (response ?? h.response(201)).emit('end');
      expect(await pending).toMatchObject({ kind: 'uncertain', reason: 'timeout' });
    },
  );

  it('refuses a TLS connection whose peer was not authorized', async () => {
    const h = harness({ autoConnect: false });
    const pending = h.transport.send(target, payload, 'tag', options());
    const outgoing = await h.created;
    await outgoing.attached.promise;
    outgoing.socket.authorized = false;
    outgoing.secureConnect();
    expect(await pending).toMatchObject({ reason: 'tls_rejected' });
    expect(outgoing.body).toBeUndefined();
  });

  it('cancels before DNS settles and disregards the late family response', async () => {
    const late = deferred<string[]>();
    const h = harness({ aaaa: () => late.promise });
    const controller = new AbortController();
    const pending = h.transport.send(target, payload, 'tag', {
      ...options(),
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({ reason: 'canceled' });
    late.resolve(['2001:4860:4860::8888']);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.resolver.cancel).toHaveBeenCalledOnce();
  });

  it('accepts exactly 3072 UTF-8 payload bytes', async () => {
    const h = harness();
    const pending = h.transport.send(target, '😀'.repeat(768), 'tag', options());
    const encrypted = await (await h.created).written.promise;
    expect(encrypted.length).toBeLessThanOrEqual(4_096);
    h.response(201).emit('end');
    expect(await pending).toMatchObject({ kind: 'accepted' });
  });

  it.each([
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_CRL',
    'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
    'UNABLE_TO_DECRYPT_CRL_SIGNATURE',
    'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
    'CERT_SIGNATURE_FAILURE',
    'CRL_SIGNATURE_FAILURE',
    'CERT_NOT_YET_VALID',
    'CERT_HAS_EXPIRED',
    'CRL_NOT_YET_VALID',
    'CRL_HAS_EXPIRED',
    'ERROR_IN_CERT_NOT_BEFORE_FIELD',
    'ERROR_IN_CERT_NOT_AFTER_FIELD',
    'ERROR_IN_CRL_LAST_UPDATE_FIELD',
    'ERROR_IN_CRL_NEXT_UPDATE_FIELD',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_CHAIN_TOO_LONG',
    'CERT_REVOKED',
    'INVALID_CA',
    'PATH_LENGTH_EXCEEDED',
    'INVALID_PURPOSE',
    'CERT_UNTRUSTED',
    'CERT_REJECTED',
    'HOSTNAME_MISMATCH',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('treats TLS rejection %s as terminal before writing', async (code) => {
    const h = harness({ autoConnect: false });
    const pending = h.transport.send(target, payload, 'tag', options());
    const outgoing = await h.created;
    outgoing.emit('error', Object.assign(new Error('SYNTHETIC_SECRET'), { code }));
    expect(await pending).toMatchObject({
      kind: 'terminal_failure',
      reason: 'tls_rejected',
      invalidateSubscription: false,
    });
    expect(outgoing.body).toBeUndefined();
  });

  it.each(['OUT_OF_MEM', 'ERR_TLS_SYNTHETIC_UNKNOWN'])(
    'keeps resource/unknown failure %s retryable before sending',
    async (code) => {
      const h = harness({ autoConnect: false });
      const pending = h.transport.send(target, payload, 'tag', options());
      (await h.created).emit('error', Object.assign(new Error('SYNTHETIC_SECRET'), { code }));
      expect(await pending).toMatchObject({
        kind: 'transient_failure',
        reason: 'network_before_send',
      });
    },
  );

  it('preserves uncertainty if an error follows possible HTTP transmission', async () => {
    const h = harness();
    const pending = h.transport.send(target, payload, 'tag', options());
    const outgoing = await h.created;
    await outgoing.written.promise;
    outgoing.emit('error', Object.assign(new Error('SYNTHETIC_SECRET'), { code: 'CERT_REJECTED' }));
    expect(await pending).toMatchObject({ kind: 'uncertain', reason: 'network' });
  });

  it.each([false, true])(
    'distinguishes cancellation after possible transmission=%s',
    async (sent) => {
      const h = harness({ autoConnect: sent });
      const controller = new AbortController();
      const pending = h.transport.send(target, payload, 'tag', {
        ...options(),
        signal: controller.signal,
      });
      const outgoing = await h.created;
      if (sent) await outgoing.written.promise;
      controller.abort();
      expect(await pending).toMatchObject(
        sent
          ? { kind: 'uncertain', reason: 'aborted' }
          : { kind: 'terminal_failure', reason: 'canceled' },
      );
      expect(outgoing.destroyed).toBe(true);
    },
  );

  it.each([false, true])(
    'distinguishes connection failure after possible transmission=%s without raw details',
    async (sent) => {
      const h = harness({ autoConnect: sent });
      const pending = h.transport.send(target, payload, 'tag', options());
      const outgoing = await h.created;
      if (sent) await outgoing.written.promise;
      outgoing.emit(
        'error',
        Object.assign(new Error(`${target.endpoint} ${target.keys.auth} SYNTHETIC_SECRET`), {
          code: 'ECONNRESET',
        }),
      );
      const result = await pending;
      expect(result).toMatchObject(
        sent
          ? { kind: 'uncertain', reason: 'network' }
          : { kind: 'transient_failure', reason: 'network_before_send' },
      );
      expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC|fcm|opaque/);
    },
  );

  it('does not resolve DNS or create requests for expired, already canceled, invalid or oversized inputs', async () => {
    const h = harness();
    const expired = { expiresAt: new Date(now).toISOString() };
    expect(await h.transport.send(target, payload, 'tag', expired)).toMatchObject({
      reason: 'expired',
    });
    expect(
      await h.transport.send(target, payload, 'tag', { ...options(), signal: AbortSignal.abort() }),
    ).toMatchObject({ reason: 'canceled' });
    for (const [body, tag] of [
      ['😀'.repeat(769), 'tag'],
      [payload, 'bad tag'],
      ['', 'tag'],
      [payload, 'a'.repeat(33)],
    ]) {
      expect(await h.transport.send(target, body!, tag!, options())).toMatchObject({
        reason: 'invalid_input',
      });
    }
    expect(
      await h.transport.send(
        { ...target, keys: { ...target.keys, auth: 'SYNTHETIC_SECRET' } },
        payload,
        'tag',
        options(),
      ),
    ).toMatchObject({ reason: 'invalid_input' });
    expect(
      await h.transport.send(
        { ...target, endpoint: 'https://127.0.0.1/private' },
        payload,
        'tag',
        options(),
      ),
    ).toMatchObject({ reason: 'endpoint_blocked' });
    expect(
      await h.transport.send(target, payload, 'tag', { expiresAt: '2026-09-06 10:00' }),
    ).toMatchObject({ reason: 'invalid_input' });
    expect(h.resolver.resolve4).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });

  it('rejects oversized generated ciphertext rather than trusting only input size', async () => {
    const h = harness();
    const original = webPush.generateRequestDetails.bind(webPush);
    vi.spyOn(webPush, 'generateRequestDetails').mockImplementation((subscription, body, opts) => ({
      ...original(subscription, body, opts),
      body: Buffer.alloc(4_097),
    }));
    expect(await h.transport.send(target, payload, 'tag', options())).toMatchObject({
      reason: 'invalid_input',
    });
    expect(h.request).not.toHaveBeenCalled();
  });

  it('shortens the overall deadline to the job expiry', async () => {
    const h = harness();
    const pending = h.transport.send(target, payload, 'tag', {
      expiresAt: new Date(now + 1_500).toISOString(),
    });
    await (
      await h.created
    ).written.promise;
    expect(h.captured().headers).toMatchObject({ TTL: 0 });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await pending).toMatchObject({ kind: 'uncertain', reason: 'timeout' });
  });

  it('isolates concurrent attempts, resolvers, agents and cancellation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const resolvers: { cancel: ReturnType<typeof vi.fn> }[] = [];
    const requests: {
      outgoing: FakeRequest;
      agent: Agent;
      callback: (response: IncomingMessage) => void;
    }[] = [];
    const bothCreated = deferred<void>();
    const transport = createRealPushTransport(vapid, {
      createResolver: () => {
        const resolver = { resolve4: async () => ['8.8.8.8'], resolve6: nodata, cancel: vi.fn() };
        resolvers.push(resolver);
        return resolver;
      },
      request: (config, callback) => {
        const outgoing = new FakeRequest();
        requests.push({ outgoing, agent: config.agent as Agent, callback });
        queueMicrotask(() => {
          outgoing.attachSocket();
          outgoing.secureConnect();
          if (requests.length === 2) bothCreated.resolve();
        });
        return outgoing as unknown as ClientRequest;
      },
      clock: { now: () => Date.now(), monotonic: () => Date.now() },
    });
    const abort = new AbortController();
    const first = transport.send(target, payload, 'tag', { ...options(), signal: abort.signal });
    const second = transport.send(target, payload, 'tag', options());
    await bothCreated.promise;
    await requests[0]!.outgoing.written.promise;
    await requests[1]!.outgoing.written.promise;
    abort.abort();
    expect(await first).toMatchObject({ reason: 'aborted' });
    expect(resolvers[0]!.cancel).toHaveBeenCalledOnce();
    expect(resolvers[1]!.cancel).not.toHaveBeenCalled();
    expect(requests[1]!.outgoing.destroyed).toBe(false);
    expect(requests[0]!.agent).not.toBe(requests[1]!.agent);
    const response = new FakeResponse(201);
    requests[1]!.callback(response as unknown as IncomingMessage);
    response.emit('end');
    expect(await second).toMatchObject({ kind: 'accepted' });
  });
});

describe('simulated transport', () => {
  it('uses the injected M4 domain clock for deterministic fixture expiry', async () => {
    const virtualNow = Date.parse('2026-09-05T16:30:00Z');
    const clock = { now: () => virtualNow };
    const transport = createSimulatedPushTransport({ kind: 'accepted' }, clock);
    expect(
      await transport.send(target, payload, 'tag', { expiresAt: '2026-09-05T16:35:00Z' }),
    ).toEqual({ kind: 'accepted', mode: 'simulated', httpStatus: null });
    expect(
      await transport.send(target, payload, 'tag', { expiresAt: '2026-09-05T16:30:00Z' }),
    ).toMatchObject({
      kind: 'terminal_failure',
      reason: 'expired',
      mode: 'simulated',
      httpStatus: null,
    });
  });

  it.each<PushOutcome>([
    { kind: 'accepted' },
    { kind: 'terminal_failure', reason: 'subscription_gone', invalidateSubscription: true },
    { kind: 'transient_failure', reason: 'provider_retry', retryAfterMs: 2_000 },
    { kind: 'uncertain', reason: 'timeout' },
  ])('labels every configured outcome %j explicitly simulated', async (outcome) => {
    const transport = createSimulatedPushTransport(outcome);
    expect(await transport.send(target, payload, 'tag', options())).toEqual({
      ...outcome,
      mode: 'simulated',
      httpStatus: null,
    });
  });
});

describe('bounded native HTTPS checks with a synthetic local TLS server', () => {
  it('accepts complete native responses and uses a separate connection for each attempt', async () => {
    const fixture = await localTls();
    try {
      const connections = new Set<unknown>();
      fixture.server.on('request', (request, response) => {
        connections.add(request.socket);
        request.resume();
        request.on('end', () => {
          response.writeHead(201);
          response.end('accepted');
        });
      });
      for (let index = 0; index < 2; index++) {
        expect(await fixture.transport.send(target, payload, 'tag', options())).toEqual({
          mode: 'real',
          kind: 'accepted',
          httpStatus: 201,
        });
      }
      expect(connections.size).toBe(2);
    } finally {
      await fixture.close();
    }
  }, 10_000);

  it('rejects native response headers above the 16 KiB limit', async () => {
    const fixture = await localTls();
    try {
      fixture.server.on('request', (request, response) => {
        request.resume();
        request.on('end', () => {
          response.writeHead(201, { 'X-Synthetic': 'a'.repeat(16_384) });
          response.end();
        });
      });
      expect(await fixture.transport.send(target, payload, 'tag', options())).toMatchObject({
        kind: 'uncertain',
        reason: 'invalid_response',
      });
    } finally {
      await fixture.close();
    }
  }, 10_000);

  it('preserves actual Host/SNI, encrypts the request and closes the native connection after cancellation', async () => {
    const fixture = await localTls();
    try {
      const controller = new AbortController();
      const received = deferred<{
        host: string | undefined;
        servername: string | undefined;
        body: Buffer;
      }>();
      fixture.server.on('request', (request) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () =>
          received.resolve({
            host: request.headers.host,
            servername: (request.socket as TLSSocket & { servername?: string }).servername,
            body: Buffer.concat(chunks),
          }),
        );
      });
      const pending = fixture.transport.send(target, payload, 'tag', {
        ...options(),
        signal: controller.signal,
      });
      const observation = await received.promise;
      expect(observation.host).toBe('fcm.googleapis.com');
      expect(observation.servername).toBe('fcm.googleapis.com');
      expect(observation.body.includes(Buffer.from('Your practice'))).toBe(false);
      controller.abort();
      expect(await pending).toMatchObject({ kind: 'uncertain', reason: 'aborted' });
      await fixture.socketClosed.promise;
    } finally {
      await fixture.close();
    }
  }, 10_000);

  it('enforces a real lifetime deadline against a trickling native response', async () => {
    const fixture = await localTls();
    let interval: ReturnType<typeof setInterval> | undefined;
    try {
      fixture.server.on('request', (request, response) => {
        request.resume();
        response.writeHead(201);
        interval = setInterval(() => response.write('a'), 20);
        response.on('close', () => clearInterval(interval));
      });
      const start = performance.now();
      const result = await fixture.transport.send(target, payload, 'tag', {
        expiresAt: new Date(Date.now() + 400).toISOString(),
      });
      expect(result).toMatchObject({ kind: 'uncertain', reason: 'timeout', httpStatus: 201 });
      expect(performance.now() - start).toBeLessThan(2_000);
      await fixture.socketClosed.promise;
    } finally {
      clearInterval(interval);
      await fixture.close();
    }
  }, 10_000);

  it('rejects an untrusted certificate before the native server receives HTTP', async () => {
    const fixture = await localTls(false);
    try {
      const received = vi.fn();
      fixture.server.on('request', received);
      expect(await fixture.transport.send(target, payload, 'tag', options())).toMatchObject({
        kind: 'terminal_failure',
        reason: 'tls_rejected',
      });
      expect(received).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  }, 10_000);
});

async function localTls(trustCertificate = true) {
  const directory = mkdtempSync(join(tmpdir(), 'sankalpa-push-tls-'));
  const keyPath = join(directory, 'synthetic-key.pem');
  const certPath = join(directory, 'synthetic-cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=fcm.googleapis.com',
        '-addext',
        'subjectAltName=DNS:fcm.googleapis.com',
      ],
      { stdio: 'pipe', timeout: 5_000 },
    );
    const cert = readFileSync(certPath);
    const server = createServer({ key: readFileSync(keyPath), cert });
    const sockets = new Set<import('node:stream').Duplex>();
    const socketClosed = deferred<void>();
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => {
        sockets.delete(socket);
        socketClosed.resolve();
      });
    });
    server.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as import('node:net').AddressInfo).port;
    const dependencies: Partial<PushTransportDependencies> = {
      createResolver: () => ({ resolve4: async () => ['8.8.8.8'], resolve6: nodata, cancel() {} }),
      request: (config, callback) => {
        // Test-only socket destination: production endpoint/IP validation stays intact.
        // Native HTTP options, TLS verification, response handling and cleanup remain real.
        const agent = config.agent as Agent;
        agent.createConnection = (connectionOptions) =>
          tlsConnect({
            host: '127.0.0.1',
            port,
            servername: connectionOptions.servername,
            rejectUnauthorized: connectionOptions.rejectUnauthorized,
            ca: trustCertificate ? cert : undefined,
          });
        return nativeRequest(config, callback);
      },
    };
    return {
      server,
      socketClosed,
      transport: createRealPushTransport(vapid, dependencies),
      close: async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
