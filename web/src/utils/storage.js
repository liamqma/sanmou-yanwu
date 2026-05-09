import Cookies from 'js-cookie';

const GAME_PROGRESS_KEY = 'gameProgress';

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
};
