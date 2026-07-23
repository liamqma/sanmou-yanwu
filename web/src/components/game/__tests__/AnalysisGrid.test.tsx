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
  tradeoffs: [],
  evidence: { featureCount: 0, totalSupport: 0, minSupport: 0 },
});

describe('AnalysisGrid player preference display', () => {
  test('shows normalized probabilities and highlights meaningful model disagreement', () => {
    render(
      <AnalysisGrid
        sets={{
          set1: ['A', 'B', 'C'],
          set2: ['D', 'E', 'F'],
          set3: ['G', 'H', 'I'],
        }}
        analysis={[
          option(0, 8),
          option(1, 7),
          option(2, 4),
        ]}
        selectedIndex={null}
        recommendedIndex={0}
        preference={{
          version: 'preference-v1:0000000000000001',
          probabilities: [0.3, 0.55, 0.15],
          top_index: 1,
          probability_margin: 0.25,
          meaningful_margin: 0.1,
        }}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    expect(screen.getByTestId('option-preference-0')).toHaveTextContent('30.0%');
    expect(screen.getByTestId('option-preference-1')).toHaveTextContent('55.0%');
    expect(screen.getByTestId('option-preference-2')).toHaveTextContent('15.0%');
    expect(screen.getByText('玩家偏好最高')).toBeInTheDocument();
    expect(screen.getByTestId('preference-disagreement')).toHaveTextContent(
      'AI 评分推荐与玩家偏好模型的首选不同'
    );
  });
});
