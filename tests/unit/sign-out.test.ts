import type { CookieOptions } from '@supabase/ssr';
import { AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/auth/sign-out/route';

const sdk = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), signOut: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: sdk.createClient }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [
      { name: 'sb-synthetic-auth-token', value: 'synthetic-session' },
      { name: 'theme', value: 'quiet' },
    ],
  }),
}));
vi.mock('../../src/server/config', () => ({
  requiredEnv: () => 'synthetic-auth-test',
  getOrigin: () => 'http://localhost:3199',
}));
// Use actual request/auth helpers while resolving route aliases within the unit-only project.
vi.mock('@/server/auth/server', () => import('../../src/server/auth/server'));
vi.mock('@/server/http', () => import('../../src/server/http'));
vi.mock('@/server/errors', () => import('../../src/server/errors'));

const accountA = 'a0000000-0000-4000-8000-000000000001';
const accountB = 'a0000000-0000-4000-8000-000000000002';
type AuthCookie = { name: string; value: string; options: CookieOptions };
function stageCookies(items: AuthCookie[]) {
  const options = sdk.createClient.mock.calls[0][2] as {
    cookies: { setAll(items: AuthCookie[], headers: Record<string, string>): void };
  };
  options.cookies.setAll(items, {});
}
function expirationCookies(): AuthCookie[] {
  return ['sb-synthetic-auth-token', 'sb-synthetic-auth-token-code-verifier'].map((name) => ({
    name,
    value: '',
    options: { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' },
  }));
}
function request(body: string | undefined = JSON.stringify({ accountId: accountA }), headers = {}) {
  return new Request('http://localhost:3199/api/auth/sign-out', {
    method: 'POST',
    headers: { Origin: 'http://localhost:3199', 'Content-Type': 'application/json', ...headers },
    body,
  });
}
async function expectFailure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('cache-control')).toContain('no-store');
}

beforeEach(() => {
  vi.resetAllMocks();
  sdk.createClient.mockReturnValue({ auth: { getUser: sdk.getUser, signOut: sdk.signOut } });
  sdk.getUser.mockResolvedValue({ data: { user: { id: accountA } }, error: null });
  sdk.signOut.mockImplementation(async () => {
    stageCookies(expirationCookies());
    return { error: null };
  });
});
afterEach(() => vi.restoreAllMocks());

it.each([{}, { accountId: null }, { accountId: 'invalid' }, { accountId: accountA, extra: true }])(
  'rejects missing/invalid account body %# before auth or cookie changes',
  async (body) => {
    await expectFailure(await POST(request(JSON.stringify(body))), 422, 'VALIDATION');
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(sdk.getUser).not.toHaveBeenCalled();
    expect(sdk.signOut).not.toHaveBeenCalled();
  },
);

it.each([
  [
    'wrong origin',
    JSON.stringify({ accountId: accountA }),
    { Origin: 'http://other.example.test' },
    403,
    'ORIGIN_DENIED',
  ],
  [
    'wrong content type',
    JSON.stringify({ accountId: accountA }),
    { 'Content-Type': 'text/plain' },
    415,
    'JSON_REQUIRED',
  ],
  ['malformed JSON', '{', {}, 400, 'INVALID_JSON'],
  ['oversized body', ' '.repeat(131073), {}, 413, 'BODY_TOO_LARGE'],
] as const)('preserves %s request boundary', async (_label, body, headers, status, code) => {
  await expectFailure(await POST(request(body, headers)), status, code);
  expect(sdk.createClient).not.toHaveBeenCalled();
  expect(sdk.signOut).not.toHaveBeenCalled();
});

it('preserves the missing request-body boundary', async () => {
  const empty = new Request('http://localhost:3199/api/auth/sign-out', {
    method: 'POST',
    headers: { Origin: 'http://localhost:3199', 'Content-Type': 'application/json' },
  });
  await expectFailure(await POST(empty), 400, 'BODY_REQUIRED');
  expect(sdk.createClient).not.toHaveBeenCalled();
  expect(sdk.signOut).not.toHaveBeenCalled();
});

it('rejects stale account A when the request cookies now authenticate B', async () => {
  sdk.getUser.mockImplementation(async () => {
    // A refresh may stage cookie updates during verification; rejected responses cannot send them.
    stageCookies([
      { name: 'sb-synthetic-auth-token', value: 'synthetic-B-refresh', options: { path: '/' } },
    ]);
    return { data: { user: { id: accountB } }, error: null };
  });
  await expectFailure(await POST(request()), 409, 'ACCOUNT_CHANGED');
  expect(sdk.createClient).toHaveBeenCalledTimes(1);
  expect(sdk.getUser).toHaveBeenCalledTimes(1);
  expect(sdk.signOut).not.toHaveBeenCalled();
});

it.each([
  ['missing session', new AuthSessionMissingError(), 401, 'SIGN_IN_REQUIRED'],
  [
    'provider outage',
    new AuthRetryableFetchError('synthetic outage', 503),
    503,
    'AUTH_UNAVAILABLE',
  ],
  [
    'network failure',
    new AuthRetryableFetchError('synthetic network failure', 0),
    503,
    'AUTH_UNAVAILABLE',
  ],
] as const)(
  'rejects %s without calling sign-out or clearing browser cookies',
  async (_label, error, status, code) => {
    sdk.getUser.mockImplementation(async () => {
      stageCookies(expirationCookies());
      return { data: { user: null }, error };
    });
    await expectFailure(await POST(request()), status, code);
    expect(sdk.createClient).toHaveBeenCalledTimes(1);
    expect(sdk.signOut).not.toHaveBeenCalled();
  },
);

it('handles a rejected verification promise without sign-out or cookies', async () => {
  sdk.getUser.mockRejectedValue(new TypeError('synthetic transport internals'));
  await expectFailure(await POST(request()), 503, 'AUTH_UNAVAILABLE');
  expect(sdk.signOut).not.toHaveBeenCalled();
});

it('uses the verified client once for local scope and sends only expected cookie expirations', async () => {
  sdk.getUser.mockImplementation(async () => {
    stageCookies([
      { name: 'sb-synthetic-auth-token', value: 'synthetic-refreshed-A', options: { path: '/' } },
    ]);
    return { data: { user: { id: accountA } }, error: null };
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(sdk.createClient).toHaveBeenCalledTimes(1);
  expect(sdk.getUser).toHaveBeenCalledTimes(1);
  expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  expect(sdk.getUser.mock.invocationCallOrder[0]).toBeLessThan(
    sdk.signOut.mock.invocationCallOrder[0],
  );
  expect(response.cookies.getAll()).toEqual(
    expect.arrayContaining(
      expirationCookies().map(({ name }) =>
        expect.objectContaining({
          name,
          value: '',
          maxAge: 0,
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
        }),
      ),
    ),
  );
  expect(response.cookies.getAll()).toHaveLength(2);
  expect(response.cookies.has('theme')).toBe(false);
  expect(response.headers.get('set-cookie')).not.toContain('synthetic-refreshed-A');
});

it.each(['returned', 'rejected'] as const)(
  'keeps %s sign-out failure safe and withholds staged cookie changes',
  async (delivery) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    sdk.signOut.mockImplementation(async () => {
      stageCookies(expirationCookies());
      const error = new AuthRetryableFetchError(
        'synthetic provider internals must not escape',
        503,
      );
      if (delivery === 'rejected') throw error;
      return { error };
    });
    const response = await POST(request());
    await expectFailure(response, 503, 'UNAVAILABLE');
    expect(sdk.createClient).toHaveBeenCalledTimes(1);
    expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(log.mock.calls[0][0] as string);
    expect(Object.keys(logged).sort()).toEqual(['correlationId', 'event']);
    expect(logged.event).toBe('request_failed');
  },
);
