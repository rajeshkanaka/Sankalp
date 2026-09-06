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
  if (target.origin !== origin || target.search || target.hash) return false;
  if (['/today', '/offline/saved'].includes(target.pathname)) return true;
  const id = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
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
