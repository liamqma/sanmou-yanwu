import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    recordRoundTelemetry: vi.fn(),
    getRecommendation: vi.fn(async () => ({
      success: true,
      recommendation: {
        recommended_set_index: 2,
        recommended_set: [],
        analysis: [],
        preference: null,
      },
    })),
    copyImageToClipboard: vi.fn(async () => true),
    renderRoundShareImage: vi.fn(async () =>
      new Blob(['png'], { type: 'image/png' })
    ),
  };
});

vi.mock('../../../context/GameContext', () => ({
  useGame: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));
vi.mock('../../../services/api', () => ({
  api: { getRecommendation: mocks.getRecommendation },
}));
vi.mock('../../../services/telemetry', () => ({
  recordRoundTelemetry: mocks.recordRoundTelemetry,
}));
vi.mock('../../../utils/clipboard', () => ({
  copyToClipboard: vi.fn(async () => true),
  copyImageToClipboard: mocks.copyImageToClipboard,
}));
vi.mock('../../../utils/roundShareImage', () => ({
  renderRoundShareImage: mocks.renderRoundShareImage,
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
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRecommendation.mockImplementation(async () =>
      recommendationResponse(2)
    );
    mocks.state.gameState = {
      ...mocks.state.gameState,
      support_hero: null,
      support_skills: [],
      round_number: 1,
    };
    mocks.state.currentRecommendation = {
      recommended_set_index: 1,
      analysis: [],
    };
    mocks.state.rosterRevision = 0;
    mocks.state.recommendationRosterRevision = 0;
    mocks.copyImageToClipboard.mockResolvedValue(true);
    mocks.renderRoundShareImage.mockResolvedValue(
      new Blob(['png'], { type: 'image/png' })
    );
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
        rosterRevision: 1,
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
      rosterRevision: 2,
    });
  });

  test('ignores a pending manual response after a roster rescore starts', async () => {
    const manual = deferredRecommendation();
    const rescore = deferredRecommendation();
    mocks.getRecommendation
      .mockImplementationOnce(() => manual.promise)
      .mockImplementationOnce(() => rescore.promise);
    const { rerender } = render(<GameBoard />);

    fireEvent.click(screen.getByRole('button', { name: '重新分析' }));
    await waitFor(() => expect(mocks.getRecommendation).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('progressbar')).toBeVisible();

    mocks.state.gameState = {
      ...mocks.state.gameState,
      support_hero: '曹仁',
    };
    mocks.state.rosterRevision += 1;
    rerender(<GameBoard />);
    await waitFor(() => expect(mocks.getRecommendation).toHaveBeenCalledTimes(2));

    await act(async () => {
      manual.resolve(recommendationResponse(0));
      await manual.promise;
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar')).toBeVisible();

    await act(async () => {
      rescore.resolve(recommendationResponse(2));
      await rescore.promise;
    });
    await waitFor(() =>
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    );
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'RESCORE_RECOMMENDATION',
      recommendation: expect.objectContaining({ recommended_set_index: 2 }),
      rosterRevision: 1,
    });
  });

  test('blocks confirmation and telemetry while visible scores are stale', () => {
    const pending = deferredRecommendation();
    mocks.getRecommendation.mockImplementationOnce(() => pending.promise);
    mocks.state.rosterRevision = 1;
    mocks.state.recommendationRosterRevision = 0;

    render(<GameBoard />);

    const confirm = screen.getByRole('button', {
      name: '确认选择并进入下一轮',
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mocks.recordRoundTelemetry).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RECORD_CHOICE' })
    );
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
        rosterRevision: 1,
      });
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('copies a complete candidate-and-roster PNG with the current round state', async () => {
    render(<GameBoard />);

    fireEvent.click(
      screen.getByRole('button', { name: '复制选项与阵容图片' })
    );

    await waitFor(() => expect(mocks.copyImageToClipboard).toHaveBeenCalledTimes(1));
    expect(mocks.renderRoundShareImage).toHaveBeenCalledWith(
      expect.objectContaining({
        roundNumber: 1,
        roundType: 'hero',
        season: 1,
        sets: [
          ['曹操', '孙权', '袁绍'],
          ['周瑜', '陆逊', '吕蒙'],
          ['诸葛亮', '庞统', '黄忠'],
        ],
        heroes: ['刘备', '关羽', '张飞', '赵云'],
        skills: ['战法甲'],
        supportHero: null,
        supportSkills: [],
      })
    );
    expect(await screen.findByText('图片已复制，可粘贴到微信')).toBeVisible();
  });

  test.each([
    { roundNumber: 6, nextRound: 7, transition: 'qualification' },
    { roundNumber: 10, nextRound: 11, transition: 'completion' },
  ])(
    'keeps the round $roundNumber fallback visible after the $transition transition',
    async ({ roundNumber, nextRound, transition }) => {
      mocks.state.gameState = {
        ...mocks.state.gameState,
        round_number: roundNumber,
      };
      mocks.copyImageToClipboard.mockResolvedValue(false);
      let resolvePng!: (blob: Blob) => void;
      const pngPromise = new Promise<Blob>((resolve) => {
        resolvePng = resolve;
      });
      mocks.renderRoundShareImage.mockReturnValue(pngPromise);
      const previewUrl = `blob:round-${roundNumber}`;
      const createObjectURL = vi.fn(() => previewUrl);
      const revokeObjectURL = vi.fn();
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: createObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: revokeObjectURL,
      });
      const { rerender, unmount } = render(<GameBoard />);

      fireEvent.click(
        screen.getByRole('button', { name: '复制选项与阵容图片' })
      );
      await waitFor(() =>
        expect(mocks.copyImageToClipboard).toHaveBeenCalledTimes(1)
      );

      mocks.state.gameState = {
        ...mocks.state.gameState,
        round_number: nextRound,
      };
      rerender(<GameBoard />);
      if (transition === 'qualification') {
        expect(
          screen.getAllByRole('button', { name: '我赢了，进入下一轮' })
        ).not.toHaveLength(0);
      } else {
        expect(
          screen.getByRole('heading', { name: '对局完成' })
        ).toBeVisible();
      }

      await act(async () => {
        resolvePng(new Blob(['png'], { type: 'image/png' }));
        await pngPromise;
      });

      expect(
        await screen.findByRole('dialog', { name: '发送到微信' })
      ).toBeVisible();
      expect(
        screen.getByRole('img', { name: '本轮候选组与当前阵容分享图片预览' })
      ).toHaveAttribute('src', previewUrl);

      unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith(previewUrl);
    }
  );

  test('keeps image generation failures visible after a completion transition', async () => {
    mocks.state.gameState = {
      ...mocks.state.gameState,
      round_number: 10,
    };
    mocks.copyImageToClipboard.mockResolvedValue(false);
    let rejectPng!: (error: Error) => void;
    const pngPromise = new Promise<Blob>((_resolve, reject) => {
      rejectPng = reject;
    });
    mocks.renderRoundShareImage.mockReturnValue(pngPromise);
    const { rerender } = render(<GameBoard />);

    fireEvent.click(
      screen.getByRole('button', { name: '复制选项与阵容图片' })
    );
    await waitFor(() =>
      expect(mocks.copyImageToClipboard).toHaveBeenCalledTimes(1)
    );

    mocks.state.gameState = {
      ...mocks.state.gameState,
      round_number: 11,
    };
    rerender(<GameBoard />);
    expect(screen.getByRole('heading', { name: '对局完成' })).toBeVisible();

    await act(async () => {
      rejectPng(new Error('画布导出失败'));
      await pngPromise.catch(() => undefined);
    });

    expect(await screen.findByText('生成分享图片失败：画布导出失败')).toBeVisible();
  });

  test('does not publish a pending fallback after the game board unmounts', async () => {
    mocks.copyImageToClipboard.mockResolvedValue(false);
    let resolvePng!: (blob: Blob) => void;
    const pngPromise = new Promise<Blob>((resolve) => {
      resolvePng = resolve;
    });
    mocks.renderRoundShareImage.mockReturnValue(pngPromise);
    const createObjectURL = vi.fn(() => 'blob:orphaned-round-share');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const { unmount } = render(<GameBoard />);

    fireEvent.click(
      screen.getByRole('button', { name: '复制选项与阵容图片' })
    );
    await waitFor(() =>
      expect(mocks.copyImageToClipboard).toHaveBeenCalledTimes(1)
    );
    unmount();

    await act(async () => {
      resolvePng(new Blob(['png'], { type: 'image/png' }));
      await pngPromise;
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  test('keeps native-share failures visible and retryable after completion', async () => {
    mocks.state.gameState = {
      ...mocks.state.gameState,
      round_number: 10,
    };
    mocks.copyImageToClipboard.mockResolvedValue(false);
    const previewUrl = 'blob:native-share-failure';
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => previewUrl),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const nativeShare = vi.fn()
      .mockRejectedValueOnce(new Error('微信分享不可用'))
      .mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: nativeShare,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: vi.fn(() => true),
    });
    const { rerender } = render(<GameBoard />);

    fireEvent.click(
      screen.getByRole('button', { name: '复制选项与阵容图片' })
    );
    expect(await screen.findByRole('dialog', { name: '发送到微信' })).toBeVisible();

    mocks.state.gameState = {
      ...mocks.state.gameState,
      round_number: 11,
    };
    rerender(<GameBoard />);
    expect(screen.getByText(/你已完成全部 10 轮/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '分享图片' }));
    expect(await screen.findByText('分享图片失败：微信分享不可用')).toBeVisible();
    expect(screen.getByRole('dialog', { name: '发送到微信' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '分享图片' }));
    await waitFor(() => expect(nativeShare).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('分享图片失败：微信分享不可用')).not.toBeInTheDocument()
    );
  });

  test('keeps fallback labels tied to the exported round when the game advances', async () => {
    mocks.copyImageToClipboard.mockResolvedValue(false);
    let resolvePng!: (blob: Blob) => void;
    const pngPromise = new Promise<Blob>((resolve) => {
      resolvePng = resolve;
    });
    mocks.renderRoundShareImage.mockReturnValue(pngPromise);
    const createObjectURL = vi.fn(() => 'blob:round-share');
    const revokeObjectURL = vi.fn();
    const nativeShare = vi.fn(async () => undefined);
    const canShare = vi.fn(() => true);
    const clickedDownloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clickedDownloads.push(this.download);
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: nativeShare,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: canShare,
    });
    const { rerender } = render(<GameBoard />);

    fireEvent.click(
      screen.getByRole('button', { name: '复制选项与阵容图片' })
    );
    mocks.state.gameState = {
      ...mocks.state.gameState,
      round_number: 2,
    };
    rerender(<GameBoard />);
    resolvePng(new Blob(['png'], { type: 'image/png' }));

    expect(await screen.findByRole('dialog', { name: '发送到微信' })).toBeVisible();
    expect(
      screen.getByRole('img', { name: '本轮候选组与当前阵容分享图片预览' })
    ).toHaveAttribute('src', 'blob:round-share');

    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    expect(clickedDownloads).toEqual(['sanmou-round-1.png']);

    fireEvent.click(screen.getByRole('button', { name: '分享图片' }));
    await waitFor(() => {
      expect(nativeShare).toHaveBeenCalledWith({
        files: [expect.objectContaining({ name: 'sanmou-round-1.png' })],
        title: '三谋演武第 1 轮',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:round-share');
  });
});
