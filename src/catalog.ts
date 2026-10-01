import type { Asset, Catalog } from './types';

export const ASSET_BASE = 'https://onmyoji-assets.fireschain.org';
export const CATALOG_URL = `${ASSET_BASE}/assets/catalog.json`;
export const assetRequestUrl = (url: string): string => {
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  return import.meta.env.DEV || localPreview ? `/r2${new URL(url).pathname}` : url;
};
let pending: Promise<Catalog> | null = null;

function assets(value: unknown): Asset[] {
  if (!Array.isArray(value)) throw new Error('R2 素材目录格式不正确');
  return value.flatMap((record: Record<string, unknown>) => {
    if (!record || typeof record !== 'object') return [];
    const names = record.names as Record<string, unknown> | undefined;
    if (record.id == null || typeof names?.zh !== 'string' || typeof record.avatar !== 'string') return [];
    const url = new URL(record.avatar, ASSET_BASE);
    // Only public assets from the canonical onmyoji-data release are loaded.
    if (url.origin !== ASSET_BASE || !url.pathname.startsWith('/assets/')) return [];
    return [{ id: String(record.id), name: names.zh, avatar: url.href,
      ...(typeof record.rarity === 'string' ? { rarity: record.rarity.toUpperCase() } : {}),
      ...(typeof record.type === 'string' ? { type: record.type } : {}),
    }];
  });
}

export function loadCatalog(): Promise<Catalog> {
  if (!pending) {
    pending = fetch(assetRequestUrl(CATALOG_URL), { cache: 'no-cache', signal: AbortSignal.timeout(20_000) })
      .then(async (response) => {
        if (!response.ok) throw new Error(`R2 素材目录读取失败（${response.status}）`);
        const raw = await response.json();
        if (raw.schemaVersion !== 1 || typeof raw.catalogVersion !== 'string' || !raw.libraries) {
          throw new Error('暂不支持这个版本的 R2 素材目录');
        }
        return { version: raw.catalogVersion, shikigami: assets(raw.libraries.shikigami), yuhun: assets(raw.libraries.yuhun) };
      }).catch((error: unknown) => { pending = null; throw error; });
  }
  return pending;
}
