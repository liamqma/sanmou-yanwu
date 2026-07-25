import { render, screen } from '@testing-library/react';
import BattleStrengthNotice from '../BattleStrengthNotice';

describe('BattleStrengthNotice', () => {
  test('shows a compact upset and evidence caveat without a comparison panel', () => {
    render(
      <BattleStrengthNotice
        comparison={{
          team1: {
            rawScore: 1,
            share: 0.73,
            displayPercent: 73,
            lowEvidence: false,
          },
          team2: {
            rawScore: 0,
            share: 0.27,
            displayPercent: 27,
            lowEvidence: true,
          },
          displayedTie: false,
          upset: true,
        }}
      />
    );

    expect(
      screen.getByText('以弱胜强！阵容评分较低的一方赢下了本场。')
    ).toBeVisible();
    expect(
      screen.getByText(
        /阵容评分由当前版本模型根据现有战报计算，仅供参考.*部分组合的历史参考场次较少。/
      )
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: '模型火力值对比' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
