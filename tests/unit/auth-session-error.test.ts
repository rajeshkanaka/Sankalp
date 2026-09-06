import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthInvalidTokenResponseError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiUser, getPageUser } from '../../src/server/auth/server';

const sdk = vi.hoisted(() => ({ getUser: vi.fn(), redirect: vi.fn() }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: sdk.getUser } }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock('next/navigation', () => ({ redirect: sdk.redirect }));
vi.mock('../../src/server/config', () => ({ requiredEnv: () => 'synthetic-auth-test' }));

const user = { id: 'a0000000-0000-4000-8000-000000000001', email: 'maya@example.test' };
const unavailable = { status: 503, code: 'AUTH_UNAVAILABLE' };
const signedOut = { status: 401, code: 'SIGN_IN_REQUIRED' };
const missingSession = [
  ['missing local session', new AuthSessionMissingError()],
  ['invalid JWT', new AuthInvalidJwtError('synthetic invalid JWT')],
  ['invalid API JWT', new AuthApiError('synthetic invalid JWT', 401, 'bad_jwt')],
  [
    'missing remote session',
    new AuthApiError('synthetic missing session', 403, 'session_not_found'),
  ],
  ['expired session', new AuthApiError('synthetic expired session', 400, 'session_expired')],
  [
    'missing refresh token',
    new AuthApiError('synthetic missing token', 400, 'refresh_token_not_found'),
  ],
  [
    'used refresh token',
    new AuthApiError('synthetic used token', 400, 'refresh_token_already_used'),
  ],
  ['deleted user', new AuthApiError('synthetic deleted user', 404, 'user_not_found')],
] as const;
const providerFailure = [
  ['network failure', new AuthRetryableFetchError('synthetic offline', 0)],
  ['temporary gateway failure', new AuthRetryableFetchError('synthetic gateway failure', 503)],
  ['API server failure', new AuthApiError('synthetic server failure', 500, 'unexpected_failure')],
  ['rate limit', new AuthApiError('synthetic rate limit', 429, 'over_request_rate_limit')],
  ['request timeout', new AuthApiError('synthetic timeout', 408, 'request_timeout')],
  ['unknown API401', new AuthApiError('synthetic unknown rejection', 401, undefined)],
  ['unknown API403', new AuthApiError('synthetic unknown forbidden', 403, 'unexpected_failure')],
  ['bad request', new AuthApiError('synthetic malformed request', 400, 'bad_json')],
  ['server failure with misleading session code', new AuthApiError('synthetic', 503, 'bad_jwt')],
  [
    'limited response with misleading session code',
    new AuthApiError('synthetic', 429, 'session_expired'),
  ],
  ['unknown SDK error', new AuthUnknownError('synthetic unknown failure', new Error('synthetic'))],
  ['invalid token response', new AuthInvalidTokenResponseError()],
  ['discarded refresh race', new AuthRefreshDiscardedError()],
  ['unknown thrown transport error', new TypeError('synthetic fetch failed')],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  sdk.redirect.mockImplementation(() => {
    throw new Error('synthetic redirect');
  });
});

describe.each(['returned', 'rejected'] as const)('SDK %s errors', (delivery) => {
  function fail(error: unknown) {
    if (delivery === 'returned') sdk.getUser.mockResolvedValue({ data: { user: null }, error });
    else sdk.getUser.mockRejectedValue(error);
  }
  it.each(missingSession)('preserves401 for %s', async (_label, error) => {
    fail(error);
    await expect(getApiUser()).rejects.toMatchObject(signedOut);
    expect(sdk.redirect).not.toHaveBeenCalled();
  });
  it.each(providerFailure)(
    'keeps %s retryable without claiming signed out',
    async (_label, error) => {
      fail(error);
      await expect(getApiUser()).rejects.toMatchObject(unavailable);
      expect(sdk.redirect).not.toHaveBeenCalled();
    },
  );
});

it('returns only the verified identity on success', async () => {
  sdk.getUser.mockResolvedValue({ data: { user: { ...user, app_metadata: {} } }, error: null });
  await expect(getApiUser()).resolves.toEqual(user);
  expect(sdk.getUser).toHaveBeenCalledTimes(1);
  expect(sdk.redirect).not.toHaveBeenCalled();
});

it.each([
  { data: { user: null }, error: null },
  { data: null, error: null },
  { data: { user: { id: '' } }, error: null },
  { data: { user: { id: 42 } }, error: null },
  undefined,
])('does not infer signed out from malformed success %#', async (result) => {
  sdk.getUser.mockResolvedValue(result);
  await expect(getApiUser()).rejects.toMatchObject(unavailable);
});

it('does not trust a user accompanying a provider error or expose its details', async () => {
  sdk.getUser.mockResolvedValue({
    data: { user },
    error: new AuthRetryableFetchError('synthetic provider internals must not escape', 503),
  });
  await expect(getApiUser()).rejects.toMatchObject({
    ...unavailable,
    message: 'Account verification is temporarily unavailable. Keep this page open and try again.',
  });
});

it.each(missingSession)('redirects a page only for %s', async (_label, error) => {
  sdk.getUser.mockResolvedValue({ data: { user: null }, error });
  await expect(getPageUser()).rejects.toThrow('synthetic redirect');
  expect(sdk.redirect).toHaveBeenCalledExactlyOnceWith('/welcome');
});

it.each(providerFailure)('surfaces page failure for %s without redirect', async (_label, error) => {
  sdk.getUser.mockResolvedValue({ data: { user: null }, error });
  await expect(getPageUser()).rejects.toMatchObject(unavailable);
  expect(sdk.redirect).not.toHaveBeenCalled();
});
