import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import GameBoard from '../GameBoard';

const mocks = vi.hoisted(() => {
  const gameState = {
    current_heroes: ['刘备', '关羽', '张飞', '赵云'],
    current_skills: ['战法甲'],
    support_hero: null as string | null,
    support_skills: [] as string[],
    round_number: 1,
    round_history: [],
  };
  return {
    state: {
      selectedSeason: 1,
      gameState,
      currentRoundInputs: {
        set1: ['曹操', '孙权', '袁绍'],
        set2: ['周瑜', '陆逊', '吕蒙'],
        set3: ['诸葛亮', '庞统', '黄忠'],
      },
      selectedOptionIndex: 1,
      currentRecommendation: {
        recommended_set_index: 1,
        analysis: [],
      },
      availableHeroes: [],
      heroMetadata: {},
      skillMetadata: {},
      regularSkills: [],
      orangeRegularSkills: [],
    },
    dispatch: vi.fn(),
    getRecommendation: vi.fn(async () => ({
      success: true,
      recommendation: {
        recommended_set_index: 2,
        recommended_set: [],
        analysis: [],
        preference: null,
      },
    })),
  };
});

vi.mock('../../../context/GameContext', () => ({
  useGame: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));
vi.mock('../../../services/api', () => ({
  api: { getRecommendation: mocks.getRecommendation },
}));
vi.mock('../RoundInfo', () => ({ default: () => <div /> }));
vi.mock('../CurrentTeam', () => ({ default: () => <div /> }));
vi.mock('../AnalysisGrid', () => ({ default: () => <div /> }));
vi.mock('../KnownStrongTeams', () => ({ default: () => <div /> }));
vi.mock('../RecommendationPanel', () => ({ default: () => <div /> }));
vi.mock('../../common/ResponsiveDisclosure', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../../services/recommendationDebug', () => ({
  SANMOU_DEBUG_SCHEMA: 'test',
  buildRoundRecommendationDebugContext: vi.fn(() => ({})),
  registerSanmouDebugContext: vi.fn(() => () => {}),
}));

describe('GameBoard roster rescoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.gameState = {
      ...mocks.state.gameState,
      support_hero: null,
    };
  });

  test('preserves offered sets and automatically recalculates after the roster changes', async () => {
    const { rerender } = render(<GameBoard />);
    expect(mocks.getRecommendation).not.toHaveBeenCalled();

    mocks.state.gameState = {
      ...mocks.state.gameState,
      support_hero: '曹仁',
    };
    rerender(<GameBoard />);

    await waitFor(() => {
      expect(mocks.getRecommendation).toHaveBeenCalledWith(
        'hero',
        [
          mocks.state.currentRoundInputs.set1,
          mocks.state.currentRoundInputs.set2,
          mocks.state.currentRoundInputs.set3,
        ],
        expect.objectContaining({ support_hero: '曹仁' }),
      );
    });
    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'SET_RECOMMENDATION',
        recommendation: expect.objectContaining({ recommended_set_index: 2 }),
      });
    });
  });
});
