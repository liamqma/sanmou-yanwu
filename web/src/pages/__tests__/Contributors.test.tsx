import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fetchUploadLeaderboard } from '../../services/uploadLeaderboard';
import type { UploadLeaderboardData } from '../../types/battleUpload';
import Contributors from '../Contributors';

vi.mock('../../services/uploadLeaderboard', () => ({
  fetchUploadLeaderboard: vi.fn(),
}));

const leaderboard: UploadLeaderboardData = {
  schema_version: 1,
  updated_date: '2026-07-24',
  updated_through_id: 10,
  summary: {
    processed_reports: 10,
    accepted_reports: 9,
    rejected_reports: 1,
  },
  contributors: [
    { name: '玩家甲', accepted_reports: 6 },
    { name: '玩家乙', accepted_reports: 3 },
  ],
};

describe('Contributors', () => {
  beforeEach(() => {
    vi.mocked(fetchUploadLeaderboard).mockResolvedValue(leaderboard);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('renders the ranking as a dedicated page and links to upload', async () => {
    render(
      <MemoryRouter initialEntries={['/contributors']}>
        <Routes>
          <Route path="/contributors" element={<Contributors />} />
          <Route path="/contribute" element={<h1>上传目的地</h1>} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: '战报贡献榜' })
    ).toBeVisible();
    expect(screen.getByText('社区战报 · 每日更新')).toBeVisible();
    expect(screen.queryByText(/静态数据/)).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: '贡献者排名' })
    ).toBeVisible();
    expect(screen.getByText('已收录 9 份有效战报')).toBeVisible();
    expect(screen.getByText('玩家甲')).toBeVisible();
    expect(fetchUploadLeaderboard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '上传我的战报' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '上传目的地' })
    ).toBeVisible();
  });
});
