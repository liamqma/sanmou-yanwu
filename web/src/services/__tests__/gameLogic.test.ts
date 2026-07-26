import type { GameState, RoundType } from '../../types/game';
import {
  getItemsPerSet,
  getRoundInfo,
  getRoundType,
  ROUND_NUMBERS,
  TOTAL_ROUNDS,
  updateGameState,
} from '../gameLogic';

const makeGameState = (roundNumber: number): GameState => ({
  current_heroes: [],
  current_skills: [],
  support_hero: null,
  support_skills: [],
  round_number: roundNumber,
  round_history: [],
});

describe('ten-round game flow', () => {
  test('defines the canonical type and offer size for every round', () => {
    const expectedTypes: RoundType[] = [
      'hero',
      'skill',
      'skill',
      'hero',
      'skill',
      'skill',
      'hero',
      'skill',
      'hero',
      'skill',
    ];

    expect(TOTAL_ROUNDS).toBe(10);
    expect(ROUND_NUMBERS.map(getRoundType)).toEqual(expectedTypes);
    expect(ROUND_NUMBERS.map(getItemsPerSet)).toEqual([
      3, 3, 3, 3, 3, 3, 2, 3, 2, 3,
    ]);
  });

  test('repeats the late-game hero and skill round shapes', () => {
    expect(getRoundInfo(7)).toMatchObject({
      roundType: 'hero',
      itemsPerSet: 2,
      cycleNumber: 3,
      roundInCycle: 1,
    });
    expect(getRoundInfo(9)).toMatchObject({
      roundType: 'hero',
      itemsPerSet: 2,
      cycleNumber: 4,
      roundInCycle: 1,
    });
    expect(getRoundInfo(10)).toMatchObject({
      roundType: 'skill',
      itemsPerSet: 3,
      cycleNumber: 4,
      roundInCycle: 2,
    });
  });

  test('only marks the game complete after recording round 10', () => {
    const roundNine = updateGameState(
      makeGameState(9),
      'hero',
      ['武将甲', '武将乙'],
      0
    );
    expect(roundNine.gameComplete).toBe(false);
    expect(roundNine.gameState.round_number).toBe(10);

    const roundTen = updateGameState(
      makeGameState(10),
      'skill',
      ['战法甲', '战法乙', '战法丙'],
      1
    );
    expect(roundTen.gameComplete).toBe(true);
    expect(roundTen.gameState.round_number).toBe(11);
  });

  test('rejects round numbers outside the supported flow', () => {
    expect(() => getRoundType(11)).toThrow(RangeError);
  });
});
