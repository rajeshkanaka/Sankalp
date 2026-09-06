import { isIP } from 'node:net';

// Conservative IANA special-purpose snapshot, verified 2026-09-06. Specialized
// public allocations are intentionally excluded as well. See the frozen contract.
const ipv4Denied = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.31.196.0/24',
  '192.52.193.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '192.175.48.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];
const ipv6Denied = ['2001::/23', '2001:db8::/32', '2002::/16', '2620:4f:8000::/48', '3fff::/20'];

function addressBits(address: string, family: 4 | 6): bigint {
  if (family === 4)
    return address.split('.').reduce((value, part) => (value << 8n) | BigInt(part), 0n);
  const [left, right] = address.split('::');
  const before = left ? left.split(':') : [];
  const after = right ? right.split(':') : [];
  const parts =
    right === undefined
      ? before
      : [...before, ...Array<string>(8 - before.length - after.length).fill('0'), ...after];
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function compileRanges(ranges: string[], family: 4 | 6) {
  return ranges.map((range) => {
    const [address, prefix] = range.split('/') as [string, string];
    const shift = BigInt((family === 4 ? 32 : 128) - Number(prefix));
    return { network: addressBits(address, family) >> shift, shift };
  });
}

const v4Ranges = compileRanges(ipv4Denied, 4);
const v6Ranges = compileRanges(ipv6Denied, 6);

export function isPublicPushAddress(address: string): boolean {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family !== 4 && family !== 6) return false;
  // Do not reinterpret embedded IPv4, including mapped/compatible/NAT64 forms.
  if (family === 6 && address.includes('.')) return false;
  const bits = addressBits(address, family);
  if (family === 6 && bits >> 125n !== 1n) return false;
  return !(family === 4 ? v4Ranges : v6Ranges).some(
    ({ network, shift }) => bits >> shift === network,
  );
}

export function validatePushEndpoint(endpoint: string): URL {
  const reject = () => {
    throw new Error('Push endpoint is not allowed');
  };
  if (
    typeof endpoint !== 'string' ||
    endpoint.length > 4_096 ||
    /[\s\\#]/u.test(endpoint) ||
    [...endpoint].some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 32 || (code >= 127 && code <= 159);
    })
  )
    return reject();
  const authority = /^https:\/\/([^/?#]+)/i.exec(endpoint)?.[1];
  if (!authority || /[^\x21-\x7e]|[%@]/u.test(authority)) return reject();
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return reject();
  }
  const hostname = parsed.hostname;
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    hostname.endsWith('.') ||
    isIP(hostname.replace(/^\[|\]$/g, '')) !== 0 ||
    !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return reject();
  const allowed =
    hostname === 'fcm.googleapis.com' ||
    hostname === 'updates.push.services.mozilla.com' ||
    (hostname.endsWith('.push.apple.com') && hostname !== 'push.apple.com');
  if (!allowed) return reject();
  // Reject URL-normalized path alterations; provider tokens are opaque.
  const resource = endpoint.slice(endpoint.indexOf(authority) + authority.length);
  if (resource && resource !== parsed.pathname + parsed.search) return reject();
  return parsed;
}
