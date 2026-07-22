import { gameReducer, initialState } from '../GameContext';
import type { GameAction } from '../../types/game';

/**
 * Acceptance tests for gameReducer. In particular they pin down that the
 * removed action types (NEXT_ROUND, SET_LOADING, ADD_TEAM_MEMBER,
 * REMOVE_TEAM_MEMBER) are no longer handled and now fall through to the
 * default case, returning state unchanged rather than throwing.
 */
describe('gameReducer', () => {
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

  test('SET_ERROR sets the error and clears loading', () => {
    const next = gameReducer({ ...initialState, isLoading: true }, {
      type: 'SET_ERROR',
      error: 'boom',
    });
    expect(next.error).toBe('boom');
    expect(next.isLoading).toBe(false);
  });

  test('LOAD_DATABASE marks the database as loaded', () => {
    const next = gameReducer(initialState, {
      type: 'LOAD_DATABASE',
      heroes: ['孙权'],
      skills: ['skillA'],
    });
    expect(next.databaseLoaded).toBe(true);
    expect(next.availableHeroes).toEqual(['孙权']);
  });
});
