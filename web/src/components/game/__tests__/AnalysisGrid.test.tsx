import { render, screen } from '@testing-library/react';
import AnalysisGrid from '../AnalysisGrid';
import type { OptionAnalysis } from '../../../services/recommendationEngine';

const option = (setIndex: number, score: number): OptionAnalysis => ({
  set_index: setIndex,
  items: [],
  final_score: score,
  rank: setIndex + 1,
  item_scores: [],
  synergies: [],
  combo_synergies: [],
  combo_tradeoffs: [],
  tradeoffs: [],
  evidence: { featureCount: 0, totalSupport: 0, minSupport: 0 },
});

describe('AnalysisGrid player preference display', () => {
  const sets = {
    set1: ['A', 'B', 'C'],
    set2: ['D', 'E', 'F'],
    set3: ['G', 'H', 'I'],
  };
  const analysis = [
    option(0, 8),
    option(1, 7),
    option(2, 4),
  ];

  test('uses player-choice labels and highlights its top separately from AI', () => {
    render(
      <AnalysisGrid
        sets={sets}
        analysis={analysis}
        selectedIndex={null}
        recommendedIndex={0}
        preference={{
          version: 'preference-v1:0000000000000001',
          probabilities: [0.3, 0.55, 0.15],
          top_index: 1,
          probability_margin: 0.25,
          meaningful_margin: 0.1,
          explanation_driver: 'D、E在模型中的选择信号较强。',
        }}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    expect(screen.getByTestId('option-preference-0')).toHaveTextContent(
      '玩家选择概率：30.0%'
    );
    expect(screen.getByTestId('option-preference-1')).toHaveTextContent(
      '玩家选择概率：55.0%'
    );
    expect(screen.getByTestId('option-preference-2')).toHaveTextContent(
      '玩家选择概率：15.0%'
    );
    expect(screen.getByText('玩家选择最高')).toBeInTheDocument();
    expect(screen.queryByText('玩家偏好最高')).not.toBeInTheDocument();
    const cards = screen.getAllByTestId('analysis-set-card');
    expect(cards[0]).toHaveAttribute('data-ai-recommended', 'true');
    expect(cards[0]).not.toHaveAttribute('data-player-choice-top');
    expect(cards[1]).toHaveAttribute('data-player-choice-top', 'true');
    expect(cards[1]).not.toHaveAttribute('data-ai-recommended');
    expect(screen.getByTestId('preference-disagreement')).toHaveTextContent(
      'AI 按当前阵容强度推荐 A；玩家选择模型认为 B 更常被选（55.0%）。D、E在模型中的选择信号较强。 这描述玩家偏好，不会改变 AI 推荐。'
    );
  });

  test('does not explain a disagreement below the meaningful margin', () => {
    render(
      <AnalysisGrid
        sets={sets}
        analysis={analysis}
        selectedIndex={null}
        recommendedIndex={0}
        preference={{
          version: 'preference-v1:0000000000000001',
          probabilities: [0.42, 0.47, 0.11],
          top_index: 1,
          probability_margin: 0.05,
          meaningful_margin: 0.1,
          explanation_driver: 'D在模型中的选择信号较强。',
        }}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    expect(screen.getByText('玩家选择最高')).toBeInTheDocument();
    expect(screen.queryByTestId('preference-disagreement')).not.toBeInTheDocument();
  });

  test('does not explain a meaningful margin when both models pick the same option', () => {
    render(
      <AnalysisGrid
        sets={sets}
        analysis={analysis}
        selectedIndex={null}
        recommendedIndex={1}
        preference={{
          version: 'preference-v1:0000000000000001',
          probabilities: [0.2, 0.7, 0.1],
          top_index: 1,
          probability_margin: 0.5,
          meaningful_margin: 0.1,
          explanation_driver: 'D在模型中的选择信号较强。',
        }}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    const cards = screen.getAllByTestId('analysis-set-card');
    expect(cards[1]).toHaveAttribute('data-ai-recommended', 'true');
    expect(cards[1]).toHaveAttribute('data-player-choice-top', 'true');
    expect(screen.queryByTestId('preference-disagreement')).not.toBeInTheDocument();
  });

  test('shows hero guide rankings but keeps skill candidates free of removed tiers', () => {
    const { rerender } = render(
      <AnalysisGrid
        sets={{ set1: ['甲'], set2: ['乙'], set3: ['丙'] }}
        selectedIndex={null}
        onSelectSet={vi.fn()}
        roundType="hero"
        heroMetadata={{
          甲: { ranking: 'S' },
          乙: { ranking: 'A' },
          丙: { ranking: 'B' },
        }}
      />
    );

    expect(screen.getByText('甲 · S档')).toBeInTheDocument();
    expect(screen.getByText('乙 · A档')).toBeInTheDocument();
    expect(screen.getByText('丙 · B档')).toBeInTheDocument();

    rerender(
      <AnalysisGrid
        sets={{ set1: ['战法甲'], set2: ['战法乙'], set3: ['战法丙'] }}
        selectedIndex={null}
        onSelectSet={vi.fn()}
        roundType="skill"
        skillMetadata={{
          战法甲: { season: 1 },
          战法乙: { season: 1 },
          战法丙: { season: 1 },
        }}
      />
    );

    expect(screen.getByText('战法甲')).toBeInTheDocument();
    expect(screen.queryByText(/T[0-9]/)).not.toBeInTheDocument();
  });

  test('shows exact signed values for positive and negative combination evidence', () => {
    const combinationAnalysis = analysis.map((entry) => ({ ...entry }));
    combinationAnalysis[0] = {
      ...combinationAnalysis[0],
      combo_synergies: [
        { label: '甲 + 乙', family: 'HP', weight: 0.36, support: 20 },
        { label: '戊 + 己', family: 'HP', weight: 0.45, support: 15 },
      ],
      combo_tradeoffs: [
        { label: '丙 + 丁', family: 'HP', weight: -0.18, support: 10 },
      ],
    };

    render(
      <AnalysisGrid
        sets={sets}
        analysis={combinationAnalysis}
        selectedIndex={null}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    expect(screen.queryByText('单项加分:')).not.toBeInTheDocument();
    expect(screen.queryByText('关键组合依据（已计入评分）')).not.toBeInTheDocument();
    expect(screen.getByTestId('combination-evidence')).toBeInTheDocument();
    expect(screen.getByText('+4.5')).toBeInTheDocument();
    expect(screen.getByText('+3.6')).toBeInTheDocument();
    expect(screen.getByText('−1.8')).toBeInTheDocument();
    expect(screen.queryByText(/👍|👎/)).not.toBeInTheDocument();
  });
});
