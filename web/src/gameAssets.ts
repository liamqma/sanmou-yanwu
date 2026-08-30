import manifestRaw from 'virtual:game-assets-manifest';

export type GameAssetKind = 'hero' | 'tactic';
export type GameAssetQuality = 'orange' | 'purple';

export interface GameAssetEntry {
  path: string;
  quality: GameAssetQuality;
  type: GameAssetKind;
  sourceName?: string;
  tacticType?: string;
}

export interface GameAssetManifest {
  schemaVersion: number;
  heroes: Record<string, GameAssetEntry>;
  tactics: Record<string, GameAssetEntry>;
}

export const gameAssetManifest = manifestRaw as GameAssetManifest;

export const getGameAsset = (
  name: string,
  kind: GameAssetKind
): GameAssetEntry | null => {
  const entry = kind === 'hero'
    ? gameAssetManifest.heroes[name]
    : gameAssetManifest.tactics[name];
  if (!entry || entry.type !== kind || !entry.path.startsWith('/game-assets/')) {
    return null;
  }
  return entry;
};

export const GAME_CARD_FALLBACK = '/game-assets/card-fallback.svg';
