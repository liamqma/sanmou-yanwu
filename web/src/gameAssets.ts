import manifestRaw from 'virtual:game-assets-manifest';

export type GameAssetKind = 'hero' | 'tactic';
export type GameAssetQuality = 'orange' | 'purple';

export interface GameAssetEntry {
  path: string;
  quality: GameAssetQuality;
  type: GameAssetKind;
  tacticType?: string;
}

export interface GameAssetManifest {
  schemaVersion: number;
  heroes: Record<string, GameAssetEntry>;
  tactics: Record<string, GameAssetEntry>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeGameAsset = (
  value: unknown,
  kind: GameAssetKind
): GameAssetEntry | null => {
  if (!isRecord(value)) return null;
  const prefix = `/game-assets/${kind === 'hero' ? 'heroes' : 'tactics'}/`;
  const path = value.path;
  const quality = value.quality;
  if (
    typeof path !== 'string' ||
    !path.startsWith(prefix) ||
    !path.endsWith('.png') ||
    path.slice(prefix.length).includes('/') ||
    (quality !== 'orange' && quality !== 'purple') ||
    value.type !== kind
  ) {
    return null;
  }
  return {
    path,
    quality,
    type: kind,
    ...(kind === 'tactic' && typeof value.tacticType === 'string'
      ? { tacticType: value.tacticType }
      : {}),
  };
};

const normalizeGameAssets = (
  value: unknown,
  kind: GameAssetKind
): Record<string, GameAssetEntry> => {
  if (!isRecord(value)) return {};
  const entries: Array<[string, GameAssetEntry]> = [];
  for (const [name, entry] of Object.entries(value)) {
    const normalized = normalizeGameAsset(entry, kind);
    if (normalized) entries.push([name, normalized]);
  }
  return Object.fromEntries(entries);
};

const rawManifest = isRecord(manifestRaw) ? manifestRaw : {};

export const gameAssetManifest: GameAssetManifest = {
  schemaVersion:
    typeof rawManifest.schemaVersion === 'number' ? rawManifest.schemaVersion : 0,
  heroes: normalizeGameAssets(rawManifest.heroes, 'hero'),
  tactics: normalizeGameAssets(rawManifest.tactics, 'tactic'),
};

export const getGameAsset = (
  name: string,
  kind: GameAssetKind
): GameAssetEntry | null =>
  (kind === 'hero'
    ? gameAssetManifest.heroes[name]
    : gameAssetManifest.tactics[name]) ?? null;

export const GAME_CARD_FALLBACK = '/game-assets/card-fallback.svg';
