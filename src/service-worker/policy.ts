export interface PublicAsset {
  path: string;
  contentType: string;
}

export function publicAssetFor(url: string, origin: string, assets: readonly PublicAsset[]) {
  const target = new URL(url);
  if (target.origin !== origin || target.search || target.hash) return undefined;
  return assets.find((asset) => asset.path === target.pathname);
}

export function allowsOfflineNavigation(url: string, origin: string) {
  const target = new URL(url);
  if (target.origin !== origin || target.hash) return false;
  const id = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  if (['/today', '/calendar'].includes(target.pathname)) {
    // Navigation filters select an app view; they never become asset cache keys.
    const seen = new Set<string>();
    for (const [key, value] of target.searchParams) {
      if (seen.has(key)) return false;
      seen.add(key);
      if (key === 'journey' && new RegExp(`^${id}$`, 'i').test(value)) continue;
      if (target.pathname !== '/calendar') return false;
      if (key === 'month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) continue;
      if (key === 'mode' && ['grid', 'list'].includes(value)) continue;
      if (key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(`${value}T00:00:00Z`);
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) continue;
      }
      return false;
    }
    return true;
  }
  if (target.search) return false;
  if (target.pathname === '/offline/saved') return true;
  return new RegExp(`^/journeys/${id}/sessions/${id}$`, 'i').test(target.pathname);
}

export function isPublicAssetResponse(response: Response, asset: PublicAsset, origin: string) {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim();
  return (
    response.ok &&
    !response.redirected &&
    new URL(response.url).origin === origin &&
    (contentType === asset.contentType ||
      (asset.contentType === 'text/javascript' && contentType === 'application/javascript'))
  );
}
