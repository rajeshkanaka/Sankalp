import { describe, expect, it } from 'vitest';
import {
  allowsOfflineNavigation,
  isPublicAssetResponse,
  publicAssetFor,
} from '../../src/service-worker/policy';

const origin = 'https://sankalpa.example';
const assets = [
  { path: '/offline/index.html', contentType: 'text/html' },
  { path: '/offline/assets/app-abcd.js', contentType: 'application/javascript' },
];
describe('public-only cache boundary', () => {
  it('matches exact public paths and refuses private, query-bearing and cross-origin requests', () => {
    expect(publicAssetFor(origin + assets[0].path, origin, assets)).toBe(assets[0]);
    for (const path of [
      '/today',
      '/api/sessions/123',
      '/auth/confirm?token_hash=synthetic',
      '/offline/index.html?_rsc=123',
      '/offline/index.html?private=1',
      '/offline/assets/unknown.js',
    ])
      expect(publicAssetFor(origin + path, origin, assets)).toBeUndefined();
    expect(
      publicAssetFor('https://other.example/offline/index.html', origin, assets),
    ).toBeUndefined();
  });
  it('limits network-failure document fallback to known app pages', () => {
    const session =
      '/journeys/a0000000-0000-4000-8000-000000000001/sessions/b0000000-0000-4000-8000-000000000001';
    for (const path of ['/today', '/offline/saved', session])
      expect(allowsOfflineNavigation(origin + path, origin)).toBe(true);
    for (const path of [
      '/auth/confirm',
      '/welcome',
      '/setup',
      '/api/sessions/1',
      '/export.pdf',
      '/today?_rsc=1',
      '/journeys/bad/sessions/bad',
    ])
      expect(allowsOfflineNavigation(origin + path, origin)).toBe(false);
    expect(allowsOfflineNavigation('https://other.example/today', origin)).toBe(false);
  });
  it('accepts validated navigation filters without widening the asset cache', () => {
    const journey = 'a0000000-0000-4000-8000-000000000001';
    for (const route of [
      `/today?journey=${journey}`,
      '/calendar',
      `/calendar?month=2026-09&journey=${journey}`,
      '/calendar?month=2026-09&mode=list&date=2026-09-05',
    ]) {
      expect(allowsOfflineNavigation(origin + route, origin), route).toBe(true);
      expect(publicAssetFor(origin + route, origin, assets)).toBeUndefined();
    }
    for (const route of [
      '/today?journey=',
      '/today?journey=invalid',
      `/today?journey=${journey}&journey=${journey}`,
      `/today?journey=${journey}&token_hash=private`,
      '/today?month=2026-09',
      '/calendar?month=2026-13',
      '/calendar?date=2026-02-30',
      '/calendar?mode=unknown',
      '/calendar?code=private',
      '/offline/saved?journey=' + journey,
      `/journeys/${journey}/sessions/${journey}?journey=${journey}`,
      '/journeys/a0000000-0000-0000-8000-000000000001/sessions/' + journey,
      `/today?journey=${journey}#private`,
    ])
      expect(allowsOfflineNavigation(origin + route, origin), route).toBe(false);
  });
  it('rejects redirects, failed responses, wrong MIME and foreign origins before caching', () => {
    const response = (overrides: Partial<Response>) =>
      ({
        ok: true,
        redirected: false,
        url: origin + assets[0].path,
        headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
        ...overrides,
      }) as Response;
    expect(isPublicAssetResponse(response({}), assets[0], origin)).toBe(true);
    for (const overrides of [
      { ok: false },
      { redirected: true },
      { url: 'https://other.example/offline/index.html' },
      { headers: new Headers({ 'Content-Type': 'application/json' }) },
    ])
      expect(isPublicAssetResponse(response(overrides), assets[0], origin)).toBe(false);
  });
});
