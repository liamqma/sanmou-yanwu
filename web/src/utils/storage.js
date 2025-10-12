import Cookies from 'js-cookie';

const GAME_PROGRESS_KEY = 'gameProgress';

export const storage = {
  saveGameProgress: (gameState, currentRoundInputs) => {
    const data = { gameState, currentRoundInputs };
    // Save for 1 year, across all paths
    Cookies.set(GAME_PROGRESS_KEY, JSON.stringify(data), { 
      expires: 365,  // days
      path: '/',
      sameSite: 'Lax'
    });
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
