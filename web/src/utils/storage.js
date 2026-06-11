import Cookies from 'js-cookie';

const GAME_PROGRESS_KEY = 'gameProgress';
const TEAM_BUILDER_KEY = 'teamBuilder';

const COOKIE_OPTS = { expires: 365, path: '/', sameSite: 'Lax' };

export const storage = {
  saveGameProgress: (gameState, currentRoundInputs) => {
    const data = { gameState, currentRoundInputs };
    Cookies.set(GAME_PROGRESS_KEY, JSON.stringify(data), COOKIE_OPTS);
  },

  loadGameProgress: () => {
    const data = Cookies.get(GAME_PROGRESS_KEY);
    if (!data) return null;

    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse game progress cookie:', e);
      return null;
    }
  },

  clearGameProgress: () => {
    Cookies.remove(GAME_PROGRESS_KEY, { path: '/' });
  },

  /**
   * Persist the /build-a-team page arrangement (3 teams x 3 heroes x 2 skills).
   * Kept in a separate cookie so it is decoupled from the main game progress.
   */
  saveTeamBuilder: (teams) => {
    Cookies.set(TEAM_BUILDER_KEY, JSON.stringify(teams), COOKIE_OPTS);
  },

  loadTeamBuilder: () => {
    const data = Cookies.get(TEAM_BUILDER_KEY);
    if (!data) return null;

    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse team builder cookie:', e);
      return null;
    }
  },

  clearTeamBuilder: () => {
    Cookies.remove(TEAM_BUILDER_KEY, { path: '/' });
  },
};
