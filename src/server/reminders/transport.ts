import { Resolver } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage, ProxyEnv } from 'node:http';
import { Agent, request, type RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';
import type { TLSSocket } from 'node:tls';

import { Temporal } from '@js-temporal/polyfill';
import webPush from 'web-push';

import { isPublicPushAddress, validatePushEndpoint } from './endpoint-policy';
import type {
  PushOutcome,
  PushResult,
  PushSubscriptionTarget,
  PushTransport,
} from './transport-contracts';

type VapidDetails = { subject: string; publicKey: string; privateKey: string };
type AttemptResolver = Pick<Resolver, 'cancel'> & {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
};
export type PushTransportDependencies = {
  createResolver: () => AttemptResolver;
  request: (
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => ClientRequest;
  clock: { now: () => number; monotonic: () => number };
};

const defaults: PushTransportDependencies = {
  createResolver: () => new Resolver(),
  request,
  clock: { now: () => Date.now(), monotonic: () => performance.now() },
};
// Node 24.20 documented X509 rejections, plus its hostname verification error.
// OUT_OF_MEM is a resource failure, not evidence of a permanently untrusted peer.
const certificateRejections = new Set([
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
]);
const terminal = (
  reason: Extract<PushOutcome, { kind: 'terminal_failure' }>['reason'],
  invalidateSubscription = false,
): PushOutcome => ({ kind: 'terminal_failure', reason, invalidateSubscription });
const transient = (
  reason: Extract<PushOutcome, { kind: 'transient_failure' }>['reason'],
  retryAfterMs: number | null = null,
): PushOutcome => ({ kind: 'transient_failure', reason, retryAfterMs });
const uncertain = (reason: Extract<PushOutcome, { kind: 'uncertain' }>['reason']): PushOutcome => ({
  kind: 'uncertain',
  reason,
});

function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
function validKey(value: string, length: number): boolean {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9_-]+={0,2}$/.test(value))
    return false;
  const bytes = Buffer.from(value, 'base64url');
  return (
    bytes.length === length &&
    bytes.toString('base64url') === value.replace(/=+$/, '') &&
    (length !== 65 || bytes[0] === 4)
  );
}
function validateInput(
  subscription: PushSubscriptionTarget,
  payload: string,
  tag: string,
  expiresAt: string,
): { url: URL; expires: number } | PushOutcome {
  if (
    typeof payload !== 'string' ||
    !payload ||
    payload.length > 3_072 ||
    Buffer.byteLength(payload, 'utf8') > 3_072 ||
    typeof tag !== 'string' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(tag) ||
    !subscription?.keys ||
    !validKey(subscription.keys.p256dh, 65) ||
    !validKey(subscription.keys.auth, 16) ||
    typeof expiresAt !== 'string' ||
    expiresAt.length > 64
  )
    return terminal('invalid_input');
  let expires: number;
  try {
    expires = Temporal.Instant.from(expiresAt).epochMilliseconds;
  } catch {
    return terminal('invalid_input');
  }
  try {
    return { url: validatePushEndpoint(subscription.endpoint), expires };
  } catch {
    return terminal('endpoint_blocked');
  }
}

function pinnedLookup(
  hostname: string,
  addresses: { address: string; family: 4 | 6 }[],
): LookupFunction {
  return (requestedHost, options, callback) => {
    const candidates = addresses.filter(
      (entry) => !options.family || entry.family === options.family,
    );
    if (requestedHost !== hostname || !candidates.length) {
      callback(
        Object.assign(new Error('Pinned address unavailable'), { code: 'ENOTFOUND' }),
        '',
        4,
      );
    } else if (options.all)
      callback(
        null,
        candidates.map((entry) => ({ ...entry })),
      );
    else callback(null, candidates[0]!.address, candidates[0]!.family);
  };
}

function retryAfter(value: string | string[] | undefined, now: number): number | null {
  if (typeof value !== 'string' || value.length > 128) return null;
  const text = value.trim();
  const delay = /^\d+$/.test(text)
    ? Number(text) * 1_000
    : /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)
      ? Date.parse(text) - now
      : NaN;
  // A reminder's maximum life is five minutes; this bound cannot extend that life.
  return Number.isNaN(delay) ? null : Math.min(300_000, Math.max(0, delay));
}

export function createRealPushTransport(
  vapid: VapidDetails,
  overrides: Partial<PushTransportDependencies> = {},
): PushTransport {
  const dependencies = { ...defaults, ...overrides };
  const vapidDetails = { ...vapid };
  return {
    async send(subscription, payload, tag, options): Promise<PushResult> {
      const started = dependencies.clock.monotonic();
      const signal = options.signal;
      const input = validateInput(subscription, payload, tag, options.expiresAt);
      const real = (outcome: PushOutcome, httpStatus: number | null = null): PushResult => ({
        ...outcome,
        mode: 'real',
        httpStatus,
      });
      if ('kind' in input) return real(input);
      if (signal?.aborted) return real(terminal('canceled'));
      const life = input.expires - dependencies.clock.now();
      if (life <= 0) return real(terminal('expired'));
      const deadline = started + Math.min(10_000, life);
      const target = { endpoint: input.url.href, keys: { ...subscription.keys } };

      return new Promise<PushResult>((resolve) => {
        let settled = false;
        let mayHaveSent = false;
        let resolvedDns = false;
        let status: number | null = null;
        let resolver: AttemptResolver | undefined;
        let agent: Agent | undefined;
        let outgoing: ClientRequest | undefined;
        let incoming: IncomingMessage | undefined;
        const finish = (outcome: PushOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          resolver?.cancel();
          incoming?.destroy();
          outgoing?.destroy();
          agent?.destroy();
          resolve(real(outcome, status));
        };
        const abort = () => finish(mayHaveSent ? uncertain('aborted') : terminal('canceled'));
        const timedOut = () =>
          finish(
            mayHaveSent
              ? uncertain('timeout')
              : input.expires <= dependencies.clock.now()
                ? terminal('expired')
                : transient(resolvedDns ? 'network_before_send' : 'dns_failure'),
          );
        const canContinue = () => {
          if (settled) return false;
          if (signal?.aborted) {
            abort();
            return false;
          }
          if (
            dependencies.clock.monotonic() >= deadline ||
            dependencies.clock.now() >= input.expires
          ) {
            timedOut();
            return false;
          }
          return true;
        };
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(timedOut, Math.max(0, deadline - dependencies.clock.monotonic()));

        const onResponse = (response: IncomingMessage) => {
          if (!canContinue()) {
            response.destroy();
            return;
          }
          incoming = response;
          status =
            Number.isInteger(response.statusCode) &&
            response.statusCode! >= 200 &&
            response.statusCode! <= 599
              ? response.statusCode!
              : null;
          if (status === null) {
            finish(uncertain('invalid_response'));
            return;
          }
          if (status >= 300 && status < 400) {
            finish(terminal('provider_rejected'));
            return;
          }
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            if (!canContinue()) return;
            received += chunk.length;
            if (received > 8_192) finish(uncertain('invalid_response'));
          });
          response.once('aborted', () => finish(uncertain('invalid_response')));
          response.once('error', () => finish(uncertain('invalid_response')));
          response.once('end', () => {
            if (!canContinue()) return;
            if (!response.complete) {
              finish(uncertain('invalid_response'));
              return;
            }
            if (status! < 300) finish({ kind: 'accepted' });
            else if (status === 404 || status === 410) finish(terminal('subscription_gone', true));
            else if (status === 408 || status === 429 || status! >= 500)
              finish(
                transient(
                  'provider_retry',
                  retryAfter(response.headers['retry-after'], dependencies.clock.now()),
                ),
              );
            else finish(terminal('provider_rejected'));
          });
        };

        const prepare = async () => {
          if (!canContinue()) return;
          resolver = dependencies.createResolver();
          const answers = await Promise.allSettled([
            resolver.resolve4(input.url.hostname),
            resolver.resolve6(input.url.hostname),
          ]);
          if (!canContinue()) return;
          if (
            answers.some(
              (answer) => answer.status === 'rejected' && errorCode(answer.reason) !== 'ENODATA',
            )
          ) {
            finish(transient('dns_failure'));
            return;
          }
          const addresses = answers.flatMap((answer, index) =>
            answer.status === 'fulfilled'
              ? answer.value.map((address) => ({
                  address,
                  family: index === 0 ? (4 as const) : (6 as const),
                }))
              : [],
          );
          if (!addresses.length) {
            finish(transient('dns_failure'));
            return;
          }
          if (
            addresses.some(
              ({ address, family }) =>
                !isPublicPushAddress(address) || (family === 4) !== !address.includes(':'),
            )
          ) {
            finish(terminal('endpoint_blocked'));
            return;
          }
          resolvedDns = true;
          let details: ReturnType<typeof webPush.generateRequestDetails>;
          try {
            const ttl = Math.max(
              0,
              Math.min(
                300,
                Math.floor(
                  (input.expires -
                    dependencies.clock.now() -
                    Math.max(0, deadline - dependencies.clock.monotonic())) /
                    1_000,
                ),
              ),
            );
            details = webPush.generateRequestDetails(target, payload, {
              vapidDetails,
              TTL: ttl,
              topic: tag,
              contentEncoding: 'aes128gcm',
              urgency: 'normal',
            });
          } catch {
            finish(terminal('invalid_input'));
            return;
          }
          if (
            !details.body ||
            details.body.length > 4_096 ||
            details.method !== 'POST' ||
            details.endpoint !== target.endpoint
          ) {
            finish(terminal('invalid_input'));
            return;
          }
          if (!canContinue()) return;
          // Next augments ProcessEnv with required NODE_ENV, but Node explicitly
          // accepts an empty proxy configuration. Do not read/copy process.env.
          agent = new Agent({ keepAlive: false, proxyEnv: {} as ProxyEnv });
          outgoing = dependencies.request(
            {
              protocol: 'https:',
              hostname: input.url.hostname,
              port: 443,
              path: input.url.pathname + input.url.search,
              servername: input.url.hostname,
              method: 'POST',
              headers: details.headers,
              agent,
              lookup: pinnedLookup(input.url.hostname, addresses),
              rejectUnauthorized: true,
              maxHeaderSize: 16_384,
            },
            onResponse,
          );
          if (settled) {
            outgoing.destroy();
            return;
          }
          outgoing.once('error', (error: unknown) => {
            const code = errorCode(error);
            finish(
              mayHaveSent
                ? uncertain(code === 'HPE_HEADER_OVERFLOW' ? 'invalid_response' : 'network')
                : certificateRejections.has(code ?? '')
                  ? terminal('tls_rejected')
                  : transient('network_before_send'),
            );
          });
          outgoing.once('upgrade', (_response, socket) => {
            socket.destroy();
            finish(uncertain('invalid_response'));
          });
          outgoing.once('socket', (socket) => {
            (socket as TLSSocket).once('secureConnect', () => {
              if (!canContinue()) return;
              if (!(socket as TLSSocket).authorized) {
                finish(terminal('tls_rejected'));
                return;
              }
              // Waiting for verified TLS distinguishes failures before any HTTP write.
              mayHaveSent = true;
              try {
                outgoing!.end(details.body);
              } catch {
                finish(uncertain('network'));
              }
            });
          });
        };
        void prepare().catch(() =>
          finish(
            mayHaveSent
              ? uncertain('network')
              : transient(resolvedDns ? 'network_before_send' : 'dns_failure'),
          ),
        );
      });
    },
  };
}

export function createSimulatedPushTransport(
  outcome: PushOutcome = { kind: 'accepted' },
  clock: Pick<PushTransportDependencies['clock'], 'now'> = defaults.clock,
): PushTransport {
  const result = (): PushOutcome => {
    switch (outcome.kind) {
      case 'accepted':
        return { kind: 'accepted' };
      case 'terminal_failure':
        return terminal(outcome.reason, outcome.invalidateSubscription);
      case 'transient_failure':
        return transient(
          outcome.reason,
          outcome.retryAfterMs === null || !Number.isFinite(outcome.retryAfterMs)
            ? null
            : Math.max(0, Math.min(300_000, outcome.retryAfterMs)),
        );
      case 'uncertain':
        return uncertain(outcome.reason);
    }
  };
  return {
    async send(subscription, payload, tag, options) {
      const input = validateInput(subscription, payload, tag, options.expiresAt);
      const chosen =
        'kind' in input
          ? input
          : options.signal?.aborted
            ? terminal('canceled')
            : input.expires <= clock.now()
              ? terminal('expired')
              : result();
      return { ...chosen, mode: 'simulated', httpStatus: null };
    },
  };
}
