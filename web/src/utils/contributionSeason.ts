import Cookies from 'js-cookie';
import type { GameplayDatabase } from '../types/domain';

export const CONTRIBUTION_SEASON_COOKIE = 'battleUploadSeason';

interface CookieStore {
  get(name: string): string | undefined;
  set(
    name: string,
    value: string,
    options: {
      expires: number;
      path: string;
      sameSite: 'Lax';
    }
  ): unknown;
}

export function maxCatalogSeason(database: GameplayDatabase): number {
  const seasons = [
    ...Object.values(database.heroes).map((hero) => hero.season),
    ...Object.values(database.skills).map((skill) => skill.season),
  ].filter((season): season is number => Number.isInteger(season) && season >= 1);
  return seasons.length > 0 ? Math.max(...seasons) : 1;
}

export function loadContributionSeason(
  maximumSeason: number,
  cookieStore: CookieStore = Cookies
): number {
  const raw = cookieStore.get(CONTRIBUTION_SEASON_COOKIE);
  const season = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(season) && season >= 1 && season <= maximumSeason
    ? season
    : maximumSeason;
}

export function saveContributionSeason(
  season: number,
  cookieStore: CookieStore = Cookies
): void {
  cookieStore.set(CONTRIBUTION_SEASON_COOKIE, String(season), {
    expires: 365,
    path: '/',
    sameSite: 'Lax',
  });
}
