import { fireEvent, render, screen, within } from '@testing-library/react';
import RelationshipRankingPanel from '../RelationshipRankingPanel';
import type {
  AnalyticsRelationshipFamily,
  AnalyticsRelationshipRanking,
  AnalyticsRelationshipRankings,
} from '../../../services/recommendationEngine';

const emptyRankings: AnalyticsRelationshipRankings = {
  HP: [],
  HT: [],
  HS: [],
  THS: [],
  B: [],
  M: [],
};

const makeRows = (
  family: AnalyticsRelationshipFamily,
  count: number
): AnalyticsRelationshipRanking[] =>
  Array.from({ length: count }, (_, index) => {
    const rank = index + 1;
    const primaryHero =
      family === 'HP' && rank <= 60
        ? '共同武将'
        : family === 'HP' && rank === 65
          ? '深层武将'
          : `武将${rank}`;
    const heroes =
      family === 'HP'
        ? [primaryHero, `搭档${rank}`]
        : family === 'HT'
          ? [`武将${rank}甲`, `武将${rank}乙`, `武将${rank}丙`]
          : family === 'HS' || family === 'THS'
            ? [primaryHero]
            : family === 'B'
              ? [primaryHero, `搭档${rank}`]
              : [];
    const skills =
      family === 'HS' || family === 'THS' ? [`战法${rank}`] : [];
    const bond =
      family === 'B'
        ? {
            name: `缘分${rank}`,
            required_members: 2 as const,
            members: heroes,
          }
        : undefined;
    const mechanic =
      family === 'M'
        ? {
            name: `机制${rank}`,
            consumerRelation: 'requires',
            consumerRelationLabel: '需要',
            side: 'friendly' as const,
            sideLabel: '友方',
          }
        : undefined;
    return {
      rank,
      featureId: `${family}|fixture-${String(rank).padStart(3, '0')}`,
      family,
      label: `${family}-${rank}`,
      weight: rank <= 80 ? 1 - rank / 100 : -(rank - 80) / 100,
      support: 100 + rank,
      heroes,
      skills,
      ...(bond ? { bond } : {}),
      ...(mechanic ? { mechanic } : {}),
    };
  });

const pagedRankings: AnalyticsRelationshipRankings = {
  HP: makeRows('HP', 85),
  HT: makeRows('HT', 36),
  HS: makeRows('HS', 85),
  THS: makeRows('THS', 85),
  B: makeRows('B', 34),
  M: makeRows('M', 17),
};

const renderPanel = (
  rankings: AnalyticsRelationshipRankings = pagedRankings,
  selectedHeroes: string[] = [],
  selectedSkills: string[] = []
) =>
  render(
    <RelationshipRankingPanel
      rankings={rankings}
      selectedHeroes={selectedHeroes}
      selectedSkills={selectedSkills}
    />
  );

describe('RelationshipRankingPanel empty states', () => {
  test('names the active relationship type in all six modes', () => {
    renderPanel(emptyRankings);

    const panel = screen.getByTestId('relationship-ranking-panel');
    expect(within(panel).getByText('暂无两人同队关系数据')).toBeVisible();

    fireEvent.click(within(panel).getByRole('button', { name: '三人同队' }));
    expect(within(panel).getByText('暂无三人同队关系数据')).toBeVisible();

    fireEvent.click(within(panel).getByRole('button', { name: '战法搭配' }));
    expect(within(panel).getByText('暂无武将自己携带战法关系数据')).toBeVisible();

    fireEvent.click(within(panel).getByRole('button', { name: '队内战法' }));
    expect(within(panel).getByText('暂无武将队内存在战法关系数据')).toBeVisible();

    fireEvent.click(within(panel).getByRole('button', { name: '特殊加成' }));
    expect(within(panel).getByText('暂无缘分关系数据')).toBeVisible();

    fireEvent.click(within(panel).getByRole('button', { name: '机制联动' }));
    expect(within(panel).getByText('暂无机制联动关系数据')).toBeVisible();
  });
});

describe('RelationshipRankingPanel progressive disclosure', () => {
  test('renders 40 rows initially, reveals 40 at a time, and keeps negative rows reachable', () => {
    renderPanel();
    const panel = screen.getByTestId('relationship-ranking-panel');

    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(40);
    expect(within(panel).getByRole('status')).toHaveTextContent('当前显示 40 / 85');

    const firstMore = within(panel).getByRole('button', {
      name: '显示更多两人同队关系：再显示 40 条',
    });
    fireEvent.click(firstMore);
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(80);
    expect(within(panel).getByRole('status')).toHaveTextContent('当前显示 80 / 85');

    const lastMore = within(panel).getByRole('button', {
      name: '显示更多两人同队关系：再显示 5 条',
    });
    fireEvent.click(lastMore);
    const allRows = within(panel).getAllByTestId('relationship-ranking-row');
    expect(allRows).toHaveLength(85);
    expect(allRows[80]).toHaveTextContent('−0.010');
    expect(within(panel).getByRole('status')).toHaveTextContent('当前显示 85 / 85');
    expect(within(panel).queryByTestId('relationship-show-more')).not.toBeInTheDocument();
  });

  test('does not offer more when a family fits within the data-driven page size', () => {
    renderPanel();
    const panel = screen.getByTestId('relationship-ranking-panel');

    fireEvent.click(within(panel).getByRole('button', { name: '三人同队' }));
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(36);
    expect(within(panel).queryByTestId('relationship-show-more')).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '特殊加成' }));
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(34);
    expect(within(panel).queryByTestId('relationship-show-more')).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '机制联动' }));
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(17);
    expect(within(panel).queryByTestId('relationship-show-more')).not.toBeInTheDocument();
  });

  test('filters before limiting and displays an immutable global rank below 40', () => {
    renderPanel(pagedRankings, ['深层武将']);
    const panel = screen.getByTestId('relationship-ranking-panel');
    const rows = within(panel).getAllByTestId('relationship-ranking-row');

    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getAllByRole('cell')[0]).toHaveTextContent('65');
    expect(rows[0]).toHaveTextContent('深层武将');
    expect(within(panel).getByRole('status')).toHaveTextContent(
      '所选武将匹配 1 / 85 条全榜关系；当前显示 1 / 1 条匹配结果，排名保留全榜名次'
    );
    expect(within(panel).queryByTestId('relationship-show-more')).not.toBeInTheDocument();
  });

  test('resets expansion after family and selected-filter changes', () => {
    const view = renderPanel();
    const panel = screen.getByTestId('relationship-ranking-panel');

    fireEvent.click(within(panel).getByTestId('relationship-show-more'));
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(80);

    fireEvent.click(within(panel).getByRole('button', { name: '三人同队' }));
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(36);
    fireEvent.click(within(panel).getByRole('button', { name: '两人同队' }));
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(40);

    fireEvent.click(within(panel).getByTestId('relationship-show-more'));
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(80);
    view.rerender(
      <RelationshipRankingPanel
        rankings={pagedRankings}
        selectedHeroes={['共同武将']}
        selectedSkills={[]}
      />
    );
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(40);
    expect(within(panel).getByRole('status')).toHaveTextContent(
      '所选武将匹配 60 / 85 条全榜关系；当前显示 40 / 60 条匹配结果'
    );
    const filteredMore = within(panel).getByRole('button', {
      name: '显示更多两人同队关系：再显示 20 条',
    });
    expect(filteredMore).toBeVisible();
    fireEvent.click(filteredMore);
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(60);

    view.rerender(
      <RelationshipRankingPanel
        rankings={pagedRankings}
        selectedHeroes={['共同武将']}
        selectedSkills={['不适用战法']}
      />
    );
    expect(within(panel).getAllByTestId('relationship-ranking-row')).toHaveLength(40);
    expect(within(panel).getByRole('status')).toHaveTextContent(
      '已选战法不用于此关系类型'
    );
  });
});
