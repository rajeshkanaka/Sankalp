import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBrowserIdentity, verifyBrowserAccount } from '../../src/offline/account-identity';
import { getDeviceState, type DeviceState } from '../../src/offline/core';

vi.mock('../../src/offline/core', () => ({ getDeviceState: vi.fn() }));

const accountId = 'a0000000-0000-4000-8000-000000000001';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('browser account freshness', () => {
  it('verifies the current cookie without caching or redirecting identity requests', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ accountId }));
    vi.stubGlobal('fetch', fetcher);
    expect(await verifyBrowserAccount(accountId)).toBe('verified');
    expect(fetcher).toHaveBeenCalledWith('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    });
    expect(await verifyBrowserAccount('b0000000-0000-4000-8000-000000000001')).toBe(
      'different_account',
    );
  });
  it('fails closed for rejected, malformed and missing account identities', async () => {
    for (const response of [
      Response.json({ accountId }, { status: 503 }),
      Response.json({ error: { code: 'ACCOUNT_UNAVAILABLE' } }, { status: 401 }),
      Response.json({}, { status: 401 }),
      new Response('invalid json'),
      Response.json(null),
      Response.json({}),
      Response.json({ accountId: 'invalid' }),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      expect(await readBrowserIdentity()).toEqual({ kind: 'rejected' });
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json({ error: { code: 'SIGN_IN_REQUIRED' } }, { status: 401 }),
        ),
    );
    expect(await readBrowserIdentity()).toEqual({ kind: 'unauthenticated' });
    expect(await verifyBrowserAccount(accountId)).toBe('signed_out');
  });
  it('distinguishes transport loss for the explicit saved-shell caller, but never trusts stale SSR', async () => {
    for (const error of [new TypeError('Synthetic outage'), new DOMException('', 'TimeoutError')]) {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
      expect(await readBrowserIdentity()).toEqual({ kind: 'network_unavailable' });
      expect(await verifyBrowserAccount(accountId)).toBe('unavailable');
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Synthetic unexpected failure')));
    expect(await readBrowserIdentity()).toEqual({ kind: 'rejected' });
  });
  it('permits an explicit offline recheck only for the current private stored account', async () => {
    const scope = { accountId, generation: 'c0000000-0000-4000-8000-000000000001' };
    const device: DeviceState = {
      scope,
      managementScope: scope,
      bindingGeneration: scope.generation,
      sharedDevice: false,
      quarantined: false,
      pendingOperations: 1,
      pendingDrafts: 1,
      locksAvailable: true,
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Synthetic outage')));
    vi.mocked(getDeviceState).mockResolvedValue(device);
    expect(await verifyBrowserAccount(accountId, true)).toBe('verified');
    expect(await verifyBrowserAccount(accountId)).toBe('unavailable');
    for (const overrides of [
      { scope: null },
      { scope: { ...scope, accountId: 'b0000000-0000-4000-8000-000000000001' } },
      { sharedDevice: true },
      { quarantined: true },
    ]) {
      vi.mocked(getDeviceState).mockResolvedValue({ ...device, ...overrides });
      expect(await verifyBrowserAccount(accountId, true)).toBe('different_account');
    }
    vi.mocked(getDeviceState).mockRejectedValue(new Error('Synthetic storage outage'));
    expect(await verifyBrowserAccount(accountId, true)).toBe('unavailable');
    vi.mocked(getDeviceState).mockResolvedValue(device);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: { code: 'SIGN_IN_REQUIRED' } }, { status: 401 })),
    );
    expect(await verifyBrowserAccount(accountId, true)).toBe('signed_out');
  });
});
