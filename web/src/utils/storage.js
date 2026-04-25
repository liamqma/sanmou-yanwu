import Cookies from 'js-cookie';

const GAME_PROGRESS_KEY = 'gameProgress';
const SETTINGS_KEY = 'appSettings';
const SEEN_CONTEXT_KEY = 'aiPromptSeen';

const COOKIE_OPTS = { expires: 365, path: '/', sameSite: 'Lax' };

const DEFAULT_SETTINGS = {
  incrementalPrompt: false,
};

const DEFAULT_SEEN_CONTEXT = {
  seenHeroes: [],
  seenSkills: [],
  seenBondIds: [],
  staticShown: false,
};

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

  // ── Settings ──
  saveSettings: (settings) => {
    Cookies.set(SETTINGS_KEY, JSON.stringify(settings), COOKIE_OPTS);
  },

  loadSettings: () => {
    const data = Cookies.get(SETTINGS_KEY);
    if (!data) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    } catch (e) {
      console.error('Failed to parse settings cookie:', e);
      return { ...DEFAULT_SETTINGS };
    }
  },

  // ── AI prompt "seen" context ──
  saveSeenContext: (seenContext) => {
    Cookies.set(SEEN_CONTEXT_KEY, JSON.stringify(seenContext), COOKIE_OPTS);
  },

  loadSeenContext: () => {
    const data = Cookies.get(SEEN_CONTEXT_KEY);
    if (!data) return { ...DEFAULT_SEEN_CONTEXT };
    try {
      return { ...DEFAULT_SEEN_CONTEXT, ...JSON.parse(data) };
    } catch (e) {
      console.error('Failed to parse seen context cookie:', e);
      return { ...DEFAULT_SEEN_CONTEXT };
    }
  },

  clearSeenContext: () => {
    Cookies.remove(SEEN_CONTEXT_KEY, { path: '/' });
  },
};

export { DEFAULT_SETTINGS, DEFAULT_SEEN_CONTEXT };
