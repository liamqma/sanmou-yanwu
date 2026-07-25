import Cookies from 'js-cookie';
import {
  GAME_PROGRESS_STORAGE_KEY,
  GAME_PROGRESS_STORAGE_VERSION,
  storage,
} from '../storage';

const emptyInputs = { set1: [], set2: [], set3: [] };
const gameState = {
  current_heroes: [],
  current_skills: [],
  support_hero: null,
  support_skills: [],
  round_number: 1,
  round_history: [],
};

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
    Cookies.remove('gameProgress', { path: '/' });
    Cookies.remove('selectedSeason', { path: '/' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    Cookies.remove('gameProgress', { path: '/' });
    Cookies.remove('selectedSeason', { path: '/' });
  });

  test('stores game progress in a versioned, non-expiring localStorage envelope', () => {
    storage.saveGameProgress(gameState, emptyInputs);

    expect(JSON.parse(localStorage.getItem(GAME_PROGRESS_STORAGE_KEY)!)).toEqual({
      version: GAME_PROGRESS_STORAGE_VERSION,
      gameState,
      currentRoundInputs: emptyInputs,
    });
    expect(Cookies.get('gameProgress')).toBeUndefined();
    expect(storage.loadGameProgress()).toEqual({
      gameState,
      currentRoundInputs: emptyInputs,
    });
  });

  test('ignores the legacy game-progress cookie', () => {
    Cookies.set(
      'gameProgress',
      JSON.stringify({ gameState, currentRoundInputs: emptyInputs }),
      { path: '/' }
    );

    expect(storage.loadGameProgress()).toBeNull();
  });

  test('treats browser contexts that deny localStorage access as unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Storage is unavailable', 'SecurityError');
      },
    });

    try {
      expect(storage.loadGameProgress()).toBeNull();
      expect(() => storage.saveGameProgress(gameState, emptyInputs)).not.toThrow();
      expect(() => storage.clearGameProgress()).not.toThrow();
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor);
      }
    }
  });

  test('restores a versioned round-9 state without inventing a dismissal flag', () => {
    const roundNineState = {
      ...gameState,
      round_number: 9,
      round7_interstitial_dismissed: true,
    };
    localStorage.setItem(
      GAME_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: GAME_PROGRESS_STORAGE_VERSION,
        gameState: roundNineState,
        currentRoundInputs: emptyInputs,
      })
    );

    const restored = storage.loadGameProgress();
    expect(restored?.gameState).toEqual(roundNineState);
    expect(restored?.gameState.round9_interstitial_dismissed).toBeUndefined();
  });

  test('rejects a localStorage envelope from an unsupported version', () => {
    localStorage.setItem(
      GAME_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: GAME_PROGRESS_STORAGE_VERSION + 1,
        gameState,
        currentRoundInputs: emptyInputs,
      })
    );

    expect(storage.loadGameProgress()).toBeNull();
  });

  test('requires the localStorage envelope version', () => {
    localStorage.setItem(
      GAME_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        gameState,
        currentRoundInputs: emptyInputs,
      })
    );

    expect(storage.loadGameProgress()).toBeNull();
  });

  test.each([
    ['an empty object', {}],
    ['non-string heroes', { ...gameState, current_heroes: ['曹操', 1] }],
    ['a non-array skill pool', { ...gameState, current_skills: '乱世奸雄' }],
    ['an invalid support hero', { ...gameState, support_hero: 1 }],
    ['non-string support skills', { ...gameState, support_skills: ['避其锐气', null] }],
    ['a fractional current round', { ...gameState, round_number: 1.5 }],
    ['a current round below the supported range', { ...gameState, round_number: 0 }],
    ['a current round above the completed state', { ...gameState, round_number: 12 }],
    ['a non-array history', { ...gameState, round_history: {} }],
    [
      'a malformed history entry',
      {
        ...gameState,
        round_number: 2,
        round_history: [
          {
            round_number: 1,
            round_type: 'hero',
            chosen_set: ['曹操'],
            set_index: '0',
          },
        ],
      },
    ],
    [
      'an invalid round-history type',
      {
        ...gameState,
        round_number: 2,
        round_history: [
          {
            round_number: 1,
            round_type: 'support',
            chosen_set: ['曹操'],
            set_index: 0,
          },
        ],
      },
    ],
    [
      'a non-boolean dismissal flag',
      { ...gameState, round7_interstitial_dismissed: 'yes' },
    ],
  ])('rejects a v1 game state containing %s', (_description, malformedGameState) => {
    localStorage.setItem(
      GAME_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: GAME_PROGRESS_STORAGE_VERSION,
        gameState: malformedGameState,
      })
    );

    expect(storage.loadGameProgress()).toBeNull();
  });

  test.each([
    ['null', null],
    ['a missing set', { set1: [], set2: [] }],
    ['a non-array set', { set1: [], set2: [], set3: '曹操' }],
    ['a set containing a non-string', { set1: [], set2: [1], set3: [] }],
    ['an extra set', { set1: [], set2: [], set3: [], set4: [] }],
  ])('rejects v1 current-round inputs containing %s', (_description, malformedInputs) => {
    localStorage.setItem(
      GAME_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: GAME_PROGRESS_STORAGE_VERSION,
        gameState,
        currentRoundInputs: malformedInputs,
      })
    );

    expect(storage.loadGameProgress()).toBeNull();
  });

  test('restores the completed round after round 10', () => {
    const completedState = {
      ...gameState,
      round_number: 11,
      round7_interstitial_dismissed: true,
      round9_interstitial_dismissed: true,
    };
    localStorage.setItem(
      GAME_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: GAME_PROGRESS_STORAGE_VERSION,
        gameState: completedState,
        currentRoundInputs: emptyInputs,
      })
    );

    expect(storage.loadGameProgress()).toEqual({
      gameState: completedState,
      currentRoundInputs: emptyInputs,
    });
  });

  test('uses the same persistent cookie options as other saved state', () => {
    const setCookie = vi.spyOn(Cookies, 'set');

    storage.saveSelectedSeason(7);

    expect(setCookie).toHaveBeenCalledWith('selectedSeason', '7', {
      expires: 365,
      path: '/',
      sameSite: 'Lax',
    });
    expect(storage.loadSelectedSeason()).toBe(7);
  });

  test.each(['not-a-season', '0', '-1', '2.5'])(
    'treats %s as an invalid saved season',
    (value) => {
      Cookies.set('selectedSeason', value, { path: '/' });
      expect(storage.loadSelectedSeason()).toBeNull();
    }
  );

  test('clearing game progress does not remove the season preference', () => {
    storage.saveGameProgress(gameState, emptyInputs);
    storage.saveSelectedSeason(5);

    storage.clearGameProgress();

    expect(storage.loadGameProgress()).toBeNull();
    expect(storage.loadSelectedSeason()).toBe(5);
  });
});
