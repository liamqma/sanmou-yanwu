const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const gameDataCacheVersion = (date = new Date()): string => {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = new Date(utcMidnight).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return new Date(utcMidnight - daysSinceMonday * MS_PER_DAY).toISOString().slice(0, 10);
};

export const gameDataUrl = (origin = ''): string =>
  `${origin}/game-data/database.json?v=${gameDataCacheVersion()}`;

export const formulaUrl = (origin = ''): string => `${origin}/game-data/formula.md`;
