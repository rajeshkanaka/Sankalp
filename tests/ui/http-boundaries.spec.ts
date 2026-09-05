import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { resetUiSignInLimits } from './helpers/rate-limits';

const UI_MAYA_EMAIL = 'ui-http-maya@example.test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ApiError {
  code: string;
  correlationId: string;
  fields?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeJson(response: APIResponse): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`Expected a JSON response with status ${response.status()}.`);
  }
  if (!isRecord(value)) throw new Error(`Expected a JSON object with status ${response.status()}.`);
  return value;
}

function appOrigin(): string {
  const value = process.env.UI_ORIGIN;
  if (!value) throw new Error('UI_ORIGIN is required.');
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.pathname !== '/')
    throw new Error('UI_ORIGIN must be the allocated localhost test server.');
  return url.origin;
}

function localService(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error(`${name} must use the local loopback service.`);
  return url;
}

function jsonHeaders(origin = appOrigin()): Record<string, string> {
  return { origin, 'content-type': 'application/json' };
}

function expectPrivateCacheHeaders(response: APIResponse): void {
  const headers = response.headers();
  expect(headers['cache-control']).toContain('private');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['cache-control']).toContain('no-cache');
  expect(headers['cache-control']).toContain('must-revalidate');
  expect(headers.pragma).toBe('no-cache');
  expect(headers.expires).toBe('0');
}

async function expectApiError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<ApiError> {
  expect(response.status()).toBe(status);
  expectPrivateCacheHeaders(response);
  const body = await safeJson(response);
  if (!isRecord(body.error)) throw new Error('API response omitted its structured error.');
  const error = body.error;
  expect(error.code).toBe(code);
  expect(error.correlationId).toEqual(expect.stringMatching(UUID));
  if (typeof error.code !== 'string' || typeof error.correlationId !== 'string')
    throw new Error('API response returned an invalid structured error.');
  return {
    code: error.code,
    correlationId: error.correlationId,
    ...(isRecord(error.fields) ? { fields: error.fields } : {}),
  };
}

async function capturedMessageIds(request: APIRequestContext, mail: URL): Promise<Set<string>> {
  const search = new URL('/api/v1/search', mail);
  search.searchParams.set('query', `to:"${UI_MAYA_EMAIL}"`);
  search.searchParams.set('limit', '50');
  const response = await request.get(search.href);
  expect(response.ok()).toBe(true);
  const body = await safeJson(response);
  if (!Array.isArray(body.messages)) throw new Error('Captured-mail search omitted messages.');
  return new Set(
    body.messages.map((message) => {
      if (!isRecord(message) || typeof message.ID !== 'string')
        throw new Error('Captured-mail search returned an invalid message identifier.');
      return message.ID;
    }),
  );
}

async function consumeCapturedSignIn(
  request: APIRequestContext,
  mail: URL,
  priorIds: Set<string>,
): Promise<void> {
  let messageId = '';
  await expect
    .poll(
      async () => {
        const currentIds = await capturedMessageIds(request, mail);
        messageId = [...currentIds].find((id) => !priorIds.has(id)) ?? '';
        return Boolean(messageId);
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const messageResponse = await request.get(
    new URL(`/api/v1/message/${encodeURIComponent(messageId)}`, mail).href,
  );
  expect(messageResponse.ok()).toBe(true);
  const message = await safeJson(messageResponse);
  if (typeof message.HTML !== 'string') throw new Error('Captured email omitted its HTML body.');
  const href = message.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  if (!href) throw new Error('Captured email omitted the sign-in link.');
  const target = new URL(href);
  if (target.origin !== appOrigin() || target.pathname !== '/auth/confirm')
    throw new Error('Captured link has an unexpected destination.');

  // The link and its token stay local to this request and are never logged or retained.
  const callback = await request.get(target.href, { maxRedirects: 0 });
  expect(callback.status()).toBe(307);
  const location = callback.headers().location;
  if (!location) throw new Error('Successful authentication omitted its redirect.');
  const redirect = new URL(location, appOrigin());
  expect(redirect.origin).toBe(appOrigin());
  expect(redirect.pathname).toBe('/today');
  expect(redirect.search).toBe('');
}

function tamperedAuthCookie(): string {
  const supabase = localService('SUPABASE_URL');
  const storageKey = `sb-${supabase.hostname.split('.')[0]}-auth-token`;
  const value = Buffer.from(
    JSON.stringify({
      access_token: 'tampered.header.signature',
      refresh_token: 'tampered',
      expires_at: Math.floor(Date.now() / 1_000) + 3_600,
    }),
  ).toString('base64url');
  return `${storageKey}=base64-${value}`;
}

test.describe('@M1 @SK-002 real HTTP boundaries', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'HTTP boundaries are browser-neutral.',
  );

  test('redirects the loopback alias to the configured local origin', async ({ request }) => {
    const alias = new URL('/welcome', appOrigin());
    alias.hostname = '127.0.0.1';
    const response = await request.get(alias.href, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(`${appOrigin()}/welcome`);
  });

  for (const [label, origin] of [
    ['missing', undefined],
    ['wrong', 'https://attacker.example.test'],
  ] as const) {
    test(`rejects a ${label} sign-in Origin`, async ({ request }) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (origin) headers.origin = origin;
      const response = await request.post('/api/auth/sign-in', {
        headers,
        data: JSON.stringify({ email: UI_MAYA_EMAIL }),
      });
      await expectApiError(response, 403, 'ORIGIN_DENIED');
    });
  }

  test('requires JSON for sign-in', async ({ request }) => {
    const response = await request.post('/api/auth/sign-in', {
      headers: { origin: appOrigin(), 'content-type': 'text/plain' },
      data: JSON.stringify({ email: UI_MAYA_EMAIL }),
    });
    await expectApiError(response, 415, 'JSON_REQUIRED');
  });

  test('returns a safe structured error for malformed JSON', async ({ request }) => {
    const response = await request.post('/api/auth/sign-in', {
      headers: jsonHeaders(),
      data: Buffer.from('{"email":'),
    });
    await expectApiError(response, 400, 'INVALID_JSON');
  });

  test('rejects JSON bodies larger than 128 KiB', async ({ request }) => {
    const response = await request.post('/api/auth/sign-in', {
      headers: jsonHeaders(),
      data: JSON.stringify({ email: `${'a'.repeat(131_073)}@example.test` }),
    });
    await expectApiError(response, 413, 'BODY_TOO_LARGE');
  });

  test('returns field validation for an invalid email', async ({ request }) => {
    const response = await request.post('/api/auth/sign-in', {
      headers: jsonHeaders(),
      data: JSON.stringify({ email: 'invalid' }),
    });
    const error = await expectApiError(response, 422, 'VALIDATION');
    expect(error.fields).toBeDefined();
    expect(error.fields?.email).toEqual(expect.any(Array));
  });

  test('rejects missing and tampered journey authentication cookies', async ({ request }) => {
    const missing = await request.post('/api/journeys', {
      headers: jsonHeaders(),
      data: '{}',
    });
    await expectApiError(missing, 401, 'SIGN_IN_REQUIRED');

    const tampered = await request.post('/api/journeys', {
      headers: { ...jsonHeaders(), cookie: tamperedAuthCookie() },
      data: '{}',
    });
    await expectApiError(tampered, 401, 'SIGN_IN_REQUIRED');
  });

  test('sets private cache, referrer and fresh CSP nonce headers', async ({ request }) => {
    const first = await request.get('/welcome');
    const second = await request.get('/welcome');
    expect(first.ok()).toBe(true);
    expect(second.ok()).toBe(true);
    expectPrivateCacheHeaders(first);
    expectPrivateCacheHeaders(second);

    const firstHeaders = first.headers();
    expect(firstHeaders['referrer-policy']).toBe('no-referrer');
    expect(firstHeaders['x-content-type-options']).toBe('nosniff');
    expect(firstHeaders['x-frame-options']).toBe('DENY');
    const firstPolicy = firstHeaders['content-security-policy'];
    const secondPolicy = second.headers()['content-security-policy'];
    expect(firstPolicy).toContain("default-src 'self'");
    expect(firstPolicy).toContain("'strict-dynamic'");
    expect(firstPolicy).toContain("frame-ancestors 'none'");
    const firstScriptNonce = firstPolicy.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
    const firstStyleNonce = firstPolicy.match(/style-src[^;]*'nonce-([^']+)'/)?.[1];
    const secondScriptNonce = secondPolicy.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
    expect(firstScriptNonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(firstStyleNonce).toBe(firstScriptNonce);
    expect(secondScriptNonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(secondScriptNonce).not.toBe(firstScriptNonce);
  });

  test('keeps application and direct Auth sign-in limits distinct', async ({ request }) => {
    await resetUiSignInLimits(UI_MAYA_EMAIL);
    const mail = localService('LOCAL_MAIL_URL');
    const priorIds = await capturedMessageIds(request, mail);

    const first = await request.post('/api/auth/sign-in', {
      headers: jsonHeaders(),
      data: JSON.stringify({ email: UI_MAYA_EMAIL }),
    });
    expect(first.status()).toBe(200);
    expectPrivateCacheHeaders(first);
    expect(await safeJson(first)).toEqual({ ok: true });

    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!publishableKey) throw new Error('SUPABASE_PUBLISHABLE_KEY is required.');
    const auth = new URL('/auth/v1/otp', localService('SUPABASE_URL'));
    auth.searchParams.set('redirect_to', `${appOrigin()}/auth/confirm`);

    const [second, directAuth] = await Promise.all([
      request.post('/api/auth/sign-in', {
        headers: jsonHeaders(),
        data: JSON.stringify({ email: UI_MAYA_EMAIL }),
      }),
      request.post(auth.href, {
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${publishableKey}`,
          'content-type': 'application/json',
        },
        data: {
          email: UI_MAYA_EMAIL,
          data: {},
          create_user: false,
          gotrue_meta_security: { captcha_token: null },
        },
      }),
    ]);

    await expectApiError(second, 429, 'RATE_LIMITED');
    const retryAfter = second.headers()['retry-after'];
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);

    // This is Supabase Auth's independent resend-frequency response. The application
    // route's five-per-hour policy does not protect this directly reachable endpoint.
    expect(directAuth.status()).toBe(429);

    await consumeCapturedSignIn(request, mail, priorIds);
  });
});
