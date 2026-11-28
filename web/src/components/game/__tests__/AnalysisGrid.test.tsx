import { render, screen, within } from '@testing-library/react';
import AnalysisGrid from '../AnalysisGrid';
import type { OptionAnalysis } from '../../../types/game';

const option = (setIndex: number, gap: number, joins: string[] = []): OptionAnalysis => ({
  set_index: setIndex,
  score: -30 + gap,
  gap,
  teams: [
    { heroes: ['刘备', joins[0] ?? '', ''], skills: ['仁德', '', joins[1] ?? '', '', '', ''], strength: 0.512 },
    { heroes: ['关羽', '张飞', '赵云'], skills: ['', '', '', '', '', ''], strength: 0.248 },
    { heroes: ['', '', ''], skills: ['', '', '', '', '', ''], strength: null },
  ],
});

describe('AnalysisGrid', () => {
  const sets = {
    set1: ['A', 'B', 'C'],
    set2: ['D', 'E', 'F'],
    set3: ['G', 'H', 'I'],
  };
  const analysis = [option(0, 0, ['A', '战法乙']), option(1, -1.26), option(2, -0.01)];

  test('shows each set against the best one and the win rates of its lineup', () => {
    render(
      <AnalysisGrid
        sets={sets}
        analysis={analysis}
        selectedIndex={null}
        recommendedIndex={0}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    const cards = screen.getAllByTestId('analysis-set-card');
    expect(cards[0]).toHaveAttribute('data-ai-recommended', 'true');
    expect(cards[1]).not.toHaveAttribute('data-ai-recommended');
    expect(screen.getByTestId('option-score-0')).toHaveTextContent('最优');
    expect(screen.getByTestId('option-score-1')).toHaveTextContent('比最优低1.3');
    // A gap that rounds to 0.0 is a tie.
    expect(screen.getByTestId('option-score-2')).toHaveTextContent('最优');
    expect(screen.getByTestId('option-strengths-0')).toHaveTextContent('选后三队胜率 51% / 25% / —');
  });

  test('lays out the lineup after the pick with the offered cards in bold', () => {
    render(
      <AnalysisGrid
        sets={sets}
        analysis={analysis}
        selectedIndex={null}
        recommendedIndex={0}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    const lineup = within(screen.getAllByTestId('option-lineup')[0]);
    expect(lineup.getByText('队伍一 · 胜率 51%')).toBeInTheDocument();
    expect(lineup.getByText('A').tagName).toBe('STRONG');
    // Only the offered cards are bold, not what the model moves around them.
    expect(lineup.getByText('战法乙').tagName).not.toBe('STRONG');
    expect(lineup.getByText('刘备', { exact: false })).toHaveTextContent('刘备（仁德）');
    expect(lineup.getByText('队伍三').nextElementSibling).toHaveTextContent('空');
  });

  test('names offered cards the model has never seen', () => {
    render(
      <AnalysisGrid
        sets={sets}
        analysis={analysis}
        unknown={{ heroes: ['E', '不在本轮'], skills: ['A'] }}
        selectedIndex={null}
        recommendedIndex={0}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    expect(screen.getAllByTestId('option-unknown-cards')).toHaveLength(1);
    expect(screen.getByTestId('option-unknown-cards')).toHaveTextContent('模型没见过E，按未知卡估算');
  });

  test('renders all three card groups without a mobile tab switcher', () => {
    render(
      <AnalysisGrid
        sets={sets}
        analysis={analysis}
        selectedIndex={2}
        recommendedIndex={1}
        onSelectSet={vi.fn()}
        roundType="hero"
      />
    );

    expect(screen.getByTestId('three-option-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId('analysis-set-card')).toHaveLength(3);
    expect(screen.getAllByTestId(/^game-card-hero-/)).toHaveLength(9);
    expect(screen.queryByTestId('mobile-option-switcher')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '选择本组' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '已选' })).toBeInTheDocument();
  });

  test('shows hero and skill guide rankings without affecting unranked items', () => {
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
          战法甲: { season: 1, ranking: 'S', category: '兵刃' },
          战法乙: { season: 1, ranking: 'B', category: '辅助' },
          战法丙: { season: 1 },
        }}
      />
    );

    expect(screen.getByText('战法甲 · S档')).toBeInTheDocument();
    expect(screen.getByText('战法乙 · B档')).toBeInTheDocument();
    expect(screen.getByText('战法丙')).toBeInTheDocument();
  });
});
