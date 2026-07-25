import Cookies from 'js-cookie';
import { TOTAL_ROUNDS } from '../services/gameLogic';
import type { CurrentRoundInputs, GameState } from '../types/game';

export const GAME_PROGRESS_STORAGE_KEY = 'gameProgress';
export const GAME_PROGRESS_STORAGE_VERSION = 1;
const TEAM_BUILDER_KEY = 'teamBuilder';
const SELECTED_SEASON_KEY = 'selectedSeason';

const COOKIE_OPTS: Cookies.CookieAttributes = { expires: 365, path: '/', sameSite: 'Lax' };

export interface StoredProgress {
  gameState: GameState;
  currentRoundInputs?: CurrentRoundInputs;
}

interface StoredProgressEnvelope extends StoredProgress {
  version: typeof GAME_PROGRESS_STORAGE_VERSION;
}

const CURRENT_ROUND_INPUT_KEYS = ['set1', 'set2', 'set3'] as const;

const getLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Some browser/privacy contexts expose Window but throw on storage access.
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isCurrentRoundInputs = (value: unknown): value is CurrentRoundInputs => {
  if (!isRecord(value) || Object.keys(value).length !== CURRENT_ROUND_INPUT_KEYS.length) {
    return false;
  }

  return CURRENT_ROUND_INPUT_KEYS.every((key) => isStringArray(value[key]));
};

const isRoundHistoryEntry = (
  value: unknown
): value is GameState['round_history'][number] => {
  if (!isRecord(value)) return false;

  return (
    typeof value.round_number === 'number' &&
    Number.isInteger(value.round_number) &&
    value.round_number >= 1 &&
    value.round_number <= TOTAL_ROUNDS &&
    (value.round_type === 'hero' || value.round_type === 'skill') &&
    isStringArray(value.chosen_set) &&
    typeof value.set_index === 'number' &&
    Number.isInteger(value.set_index) &&
    value.set_index >= 0 &&
    value.set_index <= 2
  );
};

const isGameState = (value: unknown): value is GameState => {
  if (!isRecord(value)) return false;

  return (
    isStringArray(value.current_heroes) &&
    isStringArray(value.current_skills) &&
    (value.support_hero === null || typeof value.support_hero === 'string') &&
    isStringArray(value.support_skills) &&
    typeof value.round_number === 'number' &&
    Number.isInteger(value.round_number) &&
    value.round_number >= 1 &&
    value.round_number <= TOTAL_ROUNDS + 1 &&
    Array.isArray(value.round_history) &&
    value.round_history.every(isRoundHistoryEntry) &&
    (value.round7_interstitial_dismissed === undefined ||
      typeof value.round7_interstitial_dismissed === 'boolean') &&
    (value.round9_interstitial_dismissed === undefined ||
      typeof value.round9_interstitial_dismissed === 'boolean')
  );
};

const parseStoredProgress = (value: unknown): StoredProgress | null => {
  if (
    !isRecord(value) ||
    value.version !== GAME_PROGRESS_STORAGE_VERSION ||
    !isGameState(value.gameState) ||
    (value.currentRoundInputs !== undefined &&
      !isCurrentRoundInputs(value.currentRoundInputs))
  ) {
    return null;
  }

  return {
    gameState: value.gameState,
    ...(value.currentRoundInputs !== undefined
      ? { currentRoundInputs: value.currentRoundInputs }
      : {}),
  };
};

export const storage = {
  saveGameProgress: (gameState: GameState, currentRoundInputs: CurrentRoundInputs): void => {
    const progressStorage = getLocalStorage();
    if (!progressStorage) return;
    const data: StoredProgressEnvelope = {
      version: GAME_PROGRESS_STORAGE_VERSION,
      gameState,
      currentRoundInputs,
    };
    try {
      progressStorage.setItem(GAME_PROGRESS_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save game progress:', e);
    }
  },

  loadGameProgress: (): StoredProgress | null => {
    const progressStorage = getLocalStorage();
    if (!progressStorage) return null;

    try {
      const data = progressStorage.getItem(GAME_PROGRESS_STORAGE_KEY);
      if (!data) return null;
      return parseStoredProgress(JSON.parse(data) as unknown);
    } catch (e) {
      console.error('Failed to parse game progress:', e);
      return null;
    }
  },

  clearGameProgress: (): void => {
    const progressStorage = getLocalStorage();
    if (!progressStorage) return;
    try {
      progressStorage.removeItem(GAME_PROGRESS_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear game progress:', e);
    }
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
