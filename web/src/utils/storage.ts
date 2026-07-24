import Cookies from 'js-cookie';
import type { CurrentRoundInputs, GameState } from '../types/game';

const GAME_PROGRESS_KEY = 'gameProgress';
const TEAM_BUILDER_KEY = 'teamBuilder';
const SELECTED_SEASON_KEY = 'selectedSeason';

const COOKIE_OPTS: Cookies.CookieAttributes = { expires: 365, path: '/', sameSite: 'Lax' };

export interface StoredProgress {
  gameState: GameState;
  currentRoundInputs?: CurrentRoundInputs;
}

export const storage = {
  saveGameProgress: (gameState: GameState, currentRoundInputs: CurrentRoundInputs): void => {
    const data = { gameState, currentRoundInputs };
    Cookies.set(GAME_PROGRESS_KEY, JSON.stringify(data), COOKIE_OPTS);
  },

  loadGameProgress: (): StoredProgress | null => {
    const data = Cookies.get(GAME_PROGRESS_KEY);
    if (!data) return null;

    try {
      return JSON.parse(data) as StoredProgress;
    } catch (e) {
      console.error('Failed to parse game progress cookie:', e);
      return null;
    }
  },

  clearGameProgress: (): void => {
    Cookies.remove(GAME_PROGRESS_KEY, { path: '/' });
  },

  saveSelectedSeason: (season: number): void => {
    Cookies.set(SELECTED_SEASON_KEY, String(season), COOKIE_OPTS);
  },

  loadSelectedSeason: (): number | null => {
    const data = Cookies.get(SELECTED_SEASON_KEY);
    if (!data) return null;

    const season = Number(data);
    return Number.isInteger(season) && season >= 1 ? season : null;
  },

  /**
   * Persist the /build-a-team page arrangement (3 teams x 3 heroes x 2 skills).
   * Kept in a separate cookie so it is decoupled from the main game progress.
   */
  saveTeamBuilder: (teams: unknown): void => {
    Cookies.set(TEAM_BUILDER_KEY, JSON.stringify(teams), COOKIE_OPTS);
  },

  loadTeamBuilder: (): unknown => {
    const data = Cookies.get(TEAM_BUILDER_KEY);
    if (!data) return null;

    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse team builder cookie:', e);
      return null;
    }
  },
};
