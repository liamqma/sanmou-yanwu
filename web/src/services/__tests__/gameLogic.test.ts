import type { GameState, RoundType } from '../../types/game';
import {
  createInitialGameState,
  getItemsPerSet,
  getRoundInfo,
  getRoundType,
  ROUND_NUMBERS,
  TOTAL_ROUNDS,
  updateGameState,
  validateGameInput,
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
  test('records and preserves the explicitly shared starting resources', () => {
    const heroes = ['武将甲', '武将乙', '共有武将', '武将丁'];
    const skills = [
      '战法一',
      '战法二',
      '战法三',
      '战法四',
      '战法五',
      '战法六',
      '战法七',
      '战法八',
    ];

    const initial = createInitialGameState(heroes, skills, heroes[2]);

    expect(initial.shared_initial_hero).toBe('共有武将');
    expect(initial.shared_initial_skills).toEqual(skills);

    const afterRoundOne = updateGameState(
      initial,
      'hero',
      ['新增武将甲', '新增武将乙', '新增武将丙'],
      1
    ).gameState;

    expect(afterRoundOne.shared_initial_hero).toBe('共有武将');
    expect(afterRoundOne.shared_initial_skills).toEqual(skills);
  });

  test.each([
    ['missing', undefined],
    ['null', null],
    ['not in the starting roster', '其他武将'],
  ] as const)(
    'rejects a %s shared starting hero',
    (_description, sharedInitialHero) => {
      const result = validateGameInput(
        ['武将甲', '武将乙', '武将丙', '武将丁'],
        [
          '战法一',
          '战法二',
          '战法三',
          '战法四',
          '战法五',
          '战法六',
          '战法七',
          '战法八',
        ],
        sharedInitialHero
      );

      expect(result).toEqual({
        valid: false,
        error: '请选择双方共有的 1 名初始武将',
      });
    }
  );

  test('accepts a shared hero that belongs to the four-hero starting roster', () => {
    expect(
      validateGameInput(
        ['武将甲', '武将乙', '共有武将', '武将丁'],
        [
          '战法一',
          '战法二',
          '战法三',
          '战法四',
          '战法五',
          '战法六',
          '战法七',
          '战法八',
        ],
        '共有武将'
      )
    ).toEqual({ valid: true });
  });

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
