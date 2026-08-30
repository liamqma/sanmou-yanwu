import { act, render, screen, waitFor } from '@testing-library/react';
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
      rosterRevision: 0,
      recommendationRosterRevision: 0,
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
vi.mock('../AnalysisGrid', () => ({
  default: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
}));
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

const recommendationResponse = (recommendedSetIndex: number) => ({
  success: true,
  recommendation: {
    recommended_set_index: recommendedSetIndex,
    recommended_set: [],
    analysis: [],
    preference: null,
  },
});

const deferredRecommendation = () => {
  let resolve!: (value: ReturnType<typeof recommendationResponse>) => void;
  const promise = new Promise<ReturnType<typeof recommendationResponse>>(
    (resolvePromise) => {
      resolve = resolvePromise;
    },
  );
  return { promise, resolve };
};

describe('GameBoard roster rescoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRecommendation.mockImplementation(async () =>
      recommendationResponse(2)
    );
    mocks.state.gameState = {
      ...mocks.state.gameState,
      support_hero: null,
      support_skills: [],
    };
    mocks.state.currentRecommendation = {
      recommended_set_index: 1,
      analysis: [],
    };
    mocks.state.rosterRevision = 0;
    mocks.state.recommendationRosterRevision = 0;
  });

  test('preserves offered sets and automatically recalculates after the roster changes', async () => {
    const { rerender } = render(<GameBoard />);
    expect(mocks.getRecommendation).not.toHaveBeenCalled();

    mocks.state.gameState = {
      ...mocks.state.gameState,
      support_hero: '曹仁',
    };
    mocks.state.rosterRevision += 1;
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
        type: 'RESCORE_RECOMMENDATION',
        recommendation: expect.objectContaining({ recommended_set_index: 2 }),
      });
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('settles the latest spinner and ignores an older rescore response', async () => {
    const first = deferredRecommendation();
    const second = deferredRecommendation();
    mocks.getRecommendation
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { rerender } = render(<GameBoard />);

    mocks.state.gameState = {
      ...mocks.state.gameState,
      support_hero: '曹仁',
    };
    mocks.state.rosterRevision += 1;
    rerender(<GameBoard />);
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeVisible());

    mocks.state.gameState = {
      ...mocks.state.gameState,
      support_hero: '曹操',
    };
    mocks.state.rosterRevision += 1;
    rerender(<GameBoard />);
    await waitFor(() => expect(mocks.getRecommendation).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve(recommendationResponse(0));
      await first.promise;
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar')).toBeVisible();

    await act(async () => {
      second.resolve(recommendationResponse(2));
      await second.promise;
    });
    await waitFor(() =>
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    );
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'RESCORE_RECOMMENDATION',
      recommendation: expect.objectContaining({ recommended_set_index: 2 }),
    });
  });

  test('recalculates a dirty recommendation on a newly mounted game route', async () => {
    mocks.state.rosterRevision = 1;
    mocks.state.recommendationRosterRevision = 0;

    render(<GameBoard />);

    await waitFor(() => {
      expect(mocks.getRecommendation).toHaveBeenCalledWith(
        'hero',
        [
          mocks.state.currentRoundInputs.set1,
          mocks.state.currentRoundInputs.set2,
          mocks.state.currentRoundInputs.set3,
        ],
        mocks.state.gameState,
      );
    });
    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'RESCORE_RECOMMENDATION',
        recommendation: expect.objectContaining({ recommended_set_index: 2 }),
      });
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
