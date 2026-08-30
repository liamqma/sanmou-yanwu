import { gameReducer, initialState } from '../GameContext';
import type { GameAction } from '../../types/game';
import { storage } from '../../utils/storage';

/**
 * Acceptance tests for gameReducer. In particular they pin down that the
 * removed action types (NEXT_ROUND, SET_LOADING, ADD_TEAM_MEMBER,
 * REMOVE_TEAM_MEMBER) are no longer handled and now fall through to the
 * default case, returning state unchanged rather than throwing.
 */
describe('gameReducer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('unknown / removed action types return the same state reference', () => {
    for (const type of ['NEXT_ROUND', 'SET_LOADING', 'ADD_TEAM_MEMBER', 'REMOVE_TEAM_MEMBER', 'TOTALLY_UNKNOWN']) {
      expect(gameReducer(initialState, { type } as unknown as GameAction)).toBe(initialState);
    }
  });

  test('UPDATE_ROUND_INPUT updates only the named set', () => {
    const next = gameReducer({
      ...initialState,
      selectedOptionIndex: 1,
      currentRecommendation: { recommended_set_index: 1 },
    }, {
      type: 'UPDATE_ROUND_INPUT',
      setName: 'set2',
      items: ['孙权'],
    });
    expect(next.currentRoundInputs.set2).toEqual(['孙权']);
    expect(next.currentRoundInputs.set1).toEqual([]);
    expect(next.selectedOptionIndex).toBeNull();
    expect(next.currentRecommendation).toBeNull();
  });

  test('UPDATE_TEAM preserves the current offers and selected option for rescoring', () => {
    const next = gameReducer({
      ...initialState,
      gameState: {
        current_heroes: ['刘备'],
        current_skills: ['战法甲'],
        support_hero: null,
        support_skills: [],
        round_number: 2,
        round_history: [],
      },
      currentRoundInputs: {
        set1: ['战法乙', '战法丙', '战法丁'],
        set2: ['战法戊', '战法己', '战法庚'],
        set3: ['战法辛', '战法壬', '战法癸'],
      },
      selectedOptionIndex: 0,
      currentRecommendation: { recommended_set_index: 0 },
    }, {
      type: 'UPDATE_TEAM',
      heroes: ['刘备'],
      skills: ['战法甲', '战法乙'],
    });

    expect(next.currentRoundInputs.set1).toEqual(['战法乙', '战法丙', '战法丁']);
    expect(next.selectedOptionIndex).toBe(0);
    expect(next.currentRecommendation).toEqual({ recommended_set_index: 0 });
  });

  test('UPDATE_TEAM cannot create a partial game state before setup', () => {
    const next = gameReducer(initialState, {
      type: 'UPDATE_TEAM',
      heroes: ['刘备'],
      skills: ['避其锐气'],
    });

    expect(next).toBe(initialState);
    expect(next.gameState).toBeNull();
  });

  test('changing support selections preserves offers for automatic rescoring', () => {
    const next = gameReducer({
      ...initialState,
      gameState: {
        current_heroes: ['刘备'],
        current_skills: ['战法甲'],
        support_hero: null,
        support_skills: [],
        round_number: 7,
        round_history: [],
      },
      currentRoundInputs: {
        set1: ['诸葛亮', '曹操'],
        set2: ['孙权', '周瑜'],
        set3: ['袁绍', '颜良'],
      },
      selectedOptionIndex: 0,
      currentRecommendation: { recommended_set_index: 0 },
    }, {
      type: 'SET_SUPPORT_HERO',
      hero: '诸葛亮',
    });

    expect(next.currentRoundInputs.set1).toEqual(['诸葛亮', '曹操']);
    expect(next.selectedOptionIndex).toBe(0);
    expect(next.currentRecommendation).toEqual({ recommended_set_index: 0 });
  });

  test('SET_ERROR sets the error and clears loading', () => {
    const next = gameReducer({ ...initialState, isLoading: true }, {
      type: 'SET_ERROR',
      error: 'boom',
    });
    expect(next.error).toBe('boom');
    expect(next.isLoading).toBe(false);
  });

  test.each([
    [7, 'round7_interstitial_dismissed'],
    [9, 'round9_interstitial_dismissed'],
  ] as const)(
    'dismisses the qualification interstitial for round %i',
    (roundNumber, dismissedField) => {
      const next = gameReducer({
        ...initialState,
        gameState: {
          current_heroes: [],
          current_skills: [],
          support_hero: null,
          support_skills: [],
          round_number: roundNumber,
          round_history: [],
        },
      }, {
        type: 'DISMISS_ROUND_INTERSTITIAL',
        roundNumber,
      });

      expect(next.gameState?.[dismissedField]).toBe(true);
      expect(
        next.gameState?.[
          roundNumber === 7
            ? 'round9_interstitial_dismissed'
            : 'round7_interstitial_dismissed'
        ]
      ).toBeUndefined();
    }
  );

  test('LOAD_DATABASE marks the database as loaded', () => {
    const next = gameReducer(initialState, {
      type: 'LOAD_DATABASE',
      heroes: ['孙权'],
      skills: ['skillA'],
      maxSeason: 16,
      selectedSeason: 5,
    });
    expect(next.databaseLoaded).toBe(true);
    expect(next.availableHeroes).toEqual(['孙权']);
    expect(next.maxSeason).toBe(16);
    expect(next.selectedSeason).toBe(5);
  });

  test('SET_SEASON updates a valid season and falls back to latest for invalid values', () => {
    const state = {
      ...initialState,
      maxSeason: 16,
      selectedSeason: 5,
    };

    expect(gameReducer(state, { type: 'SET_SEASON', season: 9 }).selectedSeason).toBe(9);
    expect(gameReducer(state, { type: 'SET_SEASON', season: 17 }).selectedSeason).toBe(16);
    expect(gameReducer(state, { type: 'SET_SEASON', season: 1.5 }).selectedSeason).toBe(16);
  });

  test('RESET_GAME preserves database and season state', () => {
    const clearGameProgress = vi
      .spyOn(storage, 'clearGameProgress')
      .mockImplementation(() => undefined);
    const clearTeamBuilder = vi
      .spyOn(storage, 'clearTeamBuilder')
      .mockImplementation(() => undefined);

    const next = gameReducer({
      ...initialState,
      availableHeroes: ['孙权'],
      maxSeason: 16,
      selectedSeason: 5,
      databaseLoaded: true,
    }, {
      type: 'RESET_GAME',
    });

    expect(next.availableHeroes).toEqual(['孙权']);
    expect(next.maxSeason).toBe(16);
    expect(next.selectedSeason).toBe(5);
    expect(next.databaseLoaded).toBe(true);
    expect(clearGameProgress).toHaveBeenCalledOnce();
    expect(clearTeamBuilder).toHaveBeenCalledOnce();
  });
});
