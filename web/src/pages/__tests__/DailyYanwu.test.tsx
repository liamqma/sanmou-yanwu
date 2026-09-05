import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DailyYanwu, {
  DAILY_YANWU_FLIP_DURATION_MS,
  DAILY_YANWU_FLIP_STAGGER_MS,
} from '../DailyYanwu';

const renderPage = () =>
  render(
    <MemoryRouter
      initialEntries={['/daily-yanwu?dailyYanwuFixture=reference']}
    >
      <DailyYanwu />
    </MemoryRouter>
  );

describe('DailyYanwu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  test('renders the generated arena, opening roster, and explicit Beta notice', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: '每天演武' })
    ).toBeVisible();
    expect(screen.getByTestId('daily-yanwu-frame')).toBeVisible();
    expect(screen.getByTestId('daily-yanwu-environment')).toHaveAttribute(
      'src',
      '/game-assets/daily-yanwu/yanwu-drum-arena-background.png'
    );
    expect(screen.queryByTestId('daily-yanwu-scene-crop')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('daily-yanwu-shared-hero')).toHaveLength(1);
    expect(screen.getAllByTestId('daily-yanwu-empty-hero')).toHaveLength(3);
    expect(screen.getAllByTestId('daily-yanwu-shared-tactic')).toHaveLength(8);
    expect(
      screen.getByRole('button', { name: '抽取初始' })
    ).toBeVisible();

    const notice = screen.getByTestId('daily-yanwu-development-notice');
    expect(notice).toHaveAttribute('data-visual-priority', 'tertiary');
    expect(screen.getByText('BETA · 开发中')).toBeVisible();
    expect(
      screen.getByText('当前仅开放开局抽将演示，完整玩法尚未开放')
    ).toBeVisible();
    const creatorNote = screen.getByTestId('daily-yanwu-creator-note');
    expect(creatorNote).toHaveTextContent(
      '做这个网页版演武，是因为游戏里一周只能玩一次，实在不过瘾。策划迟迟不推出每周双演武或演武天梯，所以决定自己做一个。当前还是半成品。'
    );
    expect(creatorNote).toHaveAttribute('data-visual-priority', 'tertiary');

    for (const removedCopy of [
      '赛程',
      '开赛预告',
      '可抽取抽将',
      '查看规则',
      '赛季排行',
    ]) {
      expect(screen.queryByText(removedCopy)).not.toBeInTheDocument();
    }
  });

  test('moves through backs, staggered flipping, reveal, and confirmation', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '抽取初始' }));
    const dialog = screen.getByRole('dialog', {
      name: '抽取本期个人初始武将',
    });
    expect(dialog).toBeVisible();
    expect(screen.getAllByTestId('daily-yanwu-draw-card')).toHaveLength(3);
    expect(screen.getAllByLabelText(/未揭晓武将卡/)).toHaveLength(3);
    expect(screen.getByRole('button', { name: '抽取' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '抽取' }));
    expect(screen.getByTestId('daily-yanwu-page')).toHaveAttribute(
      'data-phase',
      'flipping'
    );
    expect(screen.getAllByLabelText(/正在揭晓武将卡/)).toHaveLength(3);

    act(() => {
      vi.advanceTimersByTime(
        DAILY_YANWU_FLIP_DURATION_MS +
          DAILY_YANWU_FLIP_STAGGER_MS * 2 +
          100
      );
    });

    expect(screen.getByTestId('daily-yanwu-page')).toHaveAttribute(
      'data-phase',
      'revealed'
    );
    for (const hero of ['黄盖', '张宝', '李儒']) {
      const card = screen.getByLabelText(`抽取武将：${hero}`);
      expect(card).toBeVisible();
      expect(card.querySelector('.daily-yanwu-draw-card__caption')).toHaveTextContent(
        hero
      );
      expect(card.querySelector('.daily-yanwu-draw-card__caption')).not.toHaveTextContent(
        '50'
      );
    }
    expect(screen.getByRole('button', { name: '确认' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('daily-yanwu-empty-hero')).toHaveLength(0);
    expect(screen.getAllByTestId('daily-yanwu-selected-hero')).toHaveLength(3);
    for (const hero of ['黄盖', '张宝', '李儒']) {
      expect(screen.getByLabelText(`已抽取武将：${hero}`)).toBeVisible();
    }
  });
});
