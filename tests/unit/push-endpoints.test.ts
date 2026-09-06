import { describe, expect, it } from 'vitest';

import {
  isPublicPushAddress,
  validatePushEndpoint,
} from '../../src/server/reminders/endpoint-policy';

describe('push provider endpoint policy', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/SYNTHETIC%2Ftoken?opaque=a%2Bb',
    'https://updates.push.services.mozilla.com/wpush/v2/SYNTHETIC_token',
    'https://web.push.apple.com/SYNTHETIC_token',
    'https://region.web.push.apple.com/SYNTHETIC_token',
  ])('preserves an opaque allowed endpoint %s', (endpoint) => {
    expect(validatePushEndpoint(endpoint).href).toBe(endpoint);
  });

  it('accepts case-insensitive DNS and the explicit standard HTTPS port', () => {
    expect(validatePushEndpoint('https://FCM.GOOGLEAPIS.COM:443/synthetic').href).toBe(
      'https://fcm.googleapis.com/synthetic',
    );
  });

  it.each([
    'http://fcm.googleapis.com/synthetic',
    'https://fcm.googleapis.com:444/synthetic',
    'https://secret@fcm.googleapis.com/synthetic',
    'https://@fcm.googleapis.com/synthetic',
    'https://fcm.googleapis.com/synthetic#',
    'https://fcm.googleapis.com/synthetic#fragment',
    ' https://fcm.googleapis.com/synthetic',
    'https://fcm.googleapis.com/synthetic\n',
    'https://fcm.googleapis.com/\u0000synthetic',
    'https://fcm.googleapis.com\\@evil.test/synthetic',
    'https://fcm.googleapis.com./synthetic',
    'https://fcm.googleapis.com.evil.test/synthetic',
    'https://evilfcm.googleapis.com/synthetic',
    'https://evil.push.apple.com.evil.test/synthetic',
    'https://evilpush.apple.com/synthetic',
    'https://push.apple.com/synthetic',
    'https://.push.apple.com/synthetic',
    'https://a..push.apple.com/synthetic',
    'https://-a.push.apple.com/synthetic',
    'https://ＦＣＭ.googleapis.com/synthetic',
    'https://%66cm.googleapis.com/synthetic',
    'https://updates-autopush.dev.mozaws.net/synthetic',
    'https://wns.notify.windows.com/synthetic',
    'https://127.0.0.1/synthetic',
    'https://2130706433/synthetic',
    'https://0177.0.0.1/synthetic',
    'https://0x7f000001/synthetic',
    'https://127.1/synthetic',
    'https://[::1]/synthetic',
    'https://[::ffff:127.0.0.1]/synthetic',
    'https://localhost/synthetic',
    'https://fcm.googleapis.com/a/../synthetic',
    'https://fcm.googleapis.com/a/%2e%2e/synthetic',
    '/relative',
    'not-a-url',
    '',
  ])('rejects normalization/authority bypass %j without leaking it', (endpoint) => {
    expect(() => validatePushEndpoint(endpoint)).toThrow('Push endpoint is not allowed');
  });

  it('bounds opaque endpoint input', () => {
    expect(() => validatePushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(4_096)}`)).toThrow();
  });
});

describe('public push address policy', () => {
  it.each([
    ['0.0.0.0', '0.255.255.255'],
    ['10.0.0.0', '10.255.255.255'],
    ['100.64.0.0', '100.127.255.255'],
    ['127.0.0.0', '127.255.255.255'],
    ['169.254.0.0', '169.254.255.255'],
    ['172.16.0.0', '172.31.255.255'],
    ['192.0.0.0', '192.0.0.255'],
    ['192.0.2.0', '192.0.2.255'],
    ['192.31.196.0', '192.31.196.255'],
    ['192.52.193.0', '192.52.193.255'],
    ['192.88.99.0', '192.88.99.255'],
    ['192.168.0.0', '192.168.255.255'],
    ['192.175.48.0', '192.175.48.255'],
    ['198.18.0.0', '198.19.255.255'],
    ['198.51.100.0', '198.51.100.255'],
    ['203.0.113.0', '203.0.113.255'],
    ['224.0.0.0', '239.255.255.255'],
    ['240.0.0.0', '255.255.255.255'],
  ])('denies both ends of the IPv4 exclusion %s–%s', (first, last) => {
    expect(isPublicPushAddress(first)).toBe(false);
    expect(isPublicPushAddress(last)).toBe(false);
  });

  it.each([
    ['2001::', '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff'],
    ['2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff'],
    ['2002::', '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    ['2620:4f:8000::', '2620:4f:8000:ffff:ffff:ffff:ffff:ffff'],
    ['3fff::', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff'],
  ])('denies both ends of the IPv6 exclusion %s–%s', (first, last) => {
    expect(isPublicPushAddress(first)).toBe(false);
    expect(isPublicPushAddress(last)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '100.63.255.255',
    '100.128.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '192.0.1.255',
    '192.0.3.0',
    '192.31.195.255',
    '192.31.197.0',
    '198.17.255.255',
    '198.20.0.0',
    '223.255.255.255',
    '2000::',
    '2001:200::',
    '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:db9::',
    '2003::',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '2620:4f:7fff:ffff:ffff:ffff:ffff:ffff',
    '2620:4f:8001::',
    '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '3fff:1000::',
  ])('accepts ordinary public unicast / exclusion neighbor %s', (address) => {
    expect(isPublicPushAddress(address)).toBe(true);
  });

  it.each([
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '::ffff:7f00:1',
    '::808:808',
    '64:ff9b::808:808',
    '64:ff9b:1::a00:1',
    'fc00::1',
    'fdff::1',
    'fe80::1',
    'ff02::1',
    '100::1',
    '5f00::1',
    '4000::',
    '2001:4860::1%en0',
    '1.2.3',
    '127.01.0.1',
    '0x08080808',
    '134744072',
    '1.2.3.999',
    '2001:::1',
    '2001:4860::1\n',
    '[2001:4860::1]',
    '',
    'SYNTHETIC_SECRET',
  ])('denies special, embedded or malformed address %j', (address) => {
    expect(isPublicPushAddress(address)).toBe(false);
  });
});
