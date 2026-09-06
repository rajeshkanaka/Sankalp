import { getDeviceState, type AccountVerification } from './core';
export type { AccountVerification } from './core';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BrowserIdentity =
  | { kind: 'verified'; accountId: string }
  | { kind: 'network_unavailable' }
  | { kind: 'unauthenticated' }
  | { kind: 'rejected' };

/** Fresh cookie verification; server-rendered identity can become stale before hydration. */
export async function readBrowserIdentity(): Promise<BrowserIdentity> {
  let response: Response;
  try {
    response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    return {
      kind:
        error instanceof TypeError ||
        (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
          ? 'network_unavailable'
          : 'rejected',
    };
  }
  if (response.status === 401) {
    try {
      const failure = (await response.json()) as { error?: { code?: unknown } } | null;
      return {
        kind: failure?.error?.code === 'SIGN_IN_REQUIRED' ? 'unauthenticated' : 'rejected',
      };
    } catch {
      return { kind: 'rejected' };
    }
  }
  if (!response.ok || response.redirected) return { kind: 'rejected' };
  try {
    const identity: unknown = await response.json();
    if (
      identity &&
      typeof identity === 'object' &&
      'accountId' in identity &&
      typeof identity.accountId === 'string' &&
      UUID.test(identity.accountId)
    )
      return { kind: 'verified', accountId: identity.accountId };
  } catch {
    // A malformed response is never evidence of an offline connection.
  }
  return { kind: 'rejected' };
}

export async function verifyBrowserAccount(
  accountId: string,
  allowOffline = false,
): Promise<AccountVerification> {
  const identity = await readBrowserIdentity();
  if (identity.kind === 'verified')
    return identity.accountId === accountId ? 'verified' : 'different_account';
  if (identity.kind === 'unauthenticated') return 'signed_out';
  if (identity.kind !== 'network_unavailable' || !allowOffline) return 'unavailable';
  try {
    const device = await getDeviceState();
    return !device.quarantined && !device.sharedDevice && device.scope?.accountId === accountId
      ? 'verified'
      : 'different_account';
  } catch {
    return 'unavailable';
  }
}
