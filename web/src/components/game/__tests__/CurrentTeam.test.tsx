import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import CurrentTeam from '../CurrentTeam';

const mocks = vi.hoisted(() => ({
  state: {
    selectedSeason: 7,
    heroMetadata: {},
    skillMetadata: {},
    currentRoundInputs: {
      set1: [] as string[],
      set2: [] as string[],
      set3: [] as string[],
    },
  },
  dispatch: vi.fn(),
  runLineup: vi.fn(),
}));

vi.mock('../../../context/GameContext', () => ({
  useGame: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));

vi.mock('../../../services/lineupClient', () => ({
  LineupSuperseded: class LineupSuperseded extends Error {},
  runLineup: mocks.runLineup,
}));

interface SupportInput {
  heroes: string[];
  skills: string[];
  kind: 'hero' | 'skill';
  count: number;
  candidates: string[];
}

const ranked = (cards: string[], score: number) => ({ cards, lineup: { score, teams: [] } });

/** The model likes the first candidates best, one point apart. */
const supportRanking = ({ count, candidates }: SupportInput) => ({
  base: -30,
  recommended: candidates.slice(0, count),
  single: candidates.map((card, index) => ranked([card], -28 - index)),
  pairs: count > 1 ? [ranked(candidates.slice(0, 2), -25)] : [],
});

const supportRequest = (call = 0): SupportInput => mocks.runLineup.mock.calls[call][1];

const heroes = ['刘备', '关羽', '张飞', '赵云'];
const skills = [
  '避其锐气',
  '青囊急救',
  '如沐春风',
  '锐不可当',
  '横扫千军',
  '水淹七军',
  '烈火焚营',
  '破阵驰围',
];
const availableHeroes = [...heroes, '曹操', '孙权'];
const availableSkills = [...skills, '百战不殆', '坚壁清野', '清风驱疾'];
const heroMetadata = {};
const skillMetadata = {};
const onUpdateTeam = vi.fn();

const team = (
  overrides: Partial<ComponentProps<typeof CurrentTeam>> = {},
) => (
  <CurrentTeam
    heroes={heroes}
    skills={skills}
    availableHeroes={availableHeroes}
    availableSkills={availableSkills}
    heroMetadata={heroMetadata}
    skillMetadata={skillMetadata}
    onUpdateTeam={onUpdateTeam}
    {...overrides}
  />
);

describe('CurrentTeam support actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runLineup.mockImplementation((_task: string, input: SupportInput) =>
      Promise.resolve(supportRanking(input))
    );
    mocks.state.selectedSeason = 7;
    mocks.state.currentRoundInputs = { set1: [], set2: [], set3: [] };
  });

  test('keeps recommendations private and uncounted until a placeholder is clicked', () => {
    const { rerender } = render(team());

    expect(screen.getByText('武将 (4)', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('战法 (8)', { exact: true })).toBeInTheDocument();
    expect(mocks.runLineup).not.toHaveBeenCalled();

    const heroAction = screen.getByRole('button', { name: '推荐支援武将' });
    const skillActions = screen.getAllByRole('button', { name: '推荐支援战法' });
    expect(heroAction).toHaveTextContent('＋');
    expect(skillActions).toHaveLength(2);
    expect(skillActions[0]).toHaveTextContent('＋');
    expect(skillActions[1]).toHaveTextContent('＋');
    expect(screen.queryByTestId('game-card-hero-曹操')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-card-tactic-百战不殆')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-card-tactic-坚壁清野')).not.toBeInTheDocument();

    rerender(team());
    expect(mocks.runLineup).not.toHaveBeenCalled();
  });

  test('ranks support heroes on click and allows selecting the recommended one', async () => {
    render(team());

    fireEvent.click(screen.getByRole('button', { name: '推荐支援武将' }));

    expect(mocks.runLineup).toHaveBeenCalledTimes(1);
    expect(mocks.runLineup).toHaveBeenCalledWith(
      'support',
      { heroes, skills, kind: 'hero', count: 1, candidates: ['曹操', '孙权'] },
      expect.any(Function),
    );
    const dialog = within(screen.getByRole('dialog', { name: '推荐支援武将' }));
    expect(await dialog.findByText('曹操', { selector: 'strong' })).toBeInTheDocument();
    // Each candidate shows how much it changes the lineup score.
    expect(dialog.getByText('阵容评分 +2.0')).toBeInTheDocument();
    expect(dialog.getByText('阵容评分 +1.0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设为支援武将' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'SET_SUPPORT_HERO',
      hero: '曹操',
    });
  });

  test('shows progress while ranking and reports a failure', async () => {
    let fail!: (error: Error) => void;
    mocks.runLineup.mockImplementation(
      (_task: string, _input: SupportInput, onProgress: (progress: number) => void) => {
        onProgress(0.42);
        return new Promise((_resolve, reject) => {
          fail = reject;
        });
      }
    );
    render(team());

    fireEvent.click(screen.getByRole('button', { name: '推荐支援武将' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在逐个比较候选武将… 42%');
    expect(screen.getByRole('button', { name: '设为支援武将' })).toBeDisabled();

    await act(async () => fail(new Error('模型加载失败')));
    expect(screen.getByRole('alert')).toHaveTextContent('推荐失败：模型加载失败');
  });

  test('ranks support tactics on click and allows selecting the recommended pair', async () => {
    render(team());

    fireEvent.click(screen.getAllByRole('button', { name: '推荐支援战法' })[0]);

    expect(mocks.runLineup).toHaveBeenCalledTimes(1);
    expect(supportRequest()).toMatchObject({ kind: 'skill', count: 2 });
    expect(screen.getByRole('dialog', { name: '推荐支援战法' })).toBeInTheDocument();
    expect(await screen.findByText('本次已选 2/2 个战法：')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设为支援战法' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'SET_SUPPORT_SKILLS',
      skills: ['百战不殆', '坚壁清野'],
    });
  });

  test('puts confirmed support first and counts a single remaining support tactic', () => {
    render(
      team({
        supportHero: '曹操',
        supportSkills: ['百战不殆'],
      }),
    );

    expect(screen.getByText('武将 (5)', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('战法 (9)', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '推荐支援武将' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '推荐支援战法' })).toHaveLength(1);
    expect(mocks.runLineup).not.toHaveBeenCalled();

    const [heroList, skillList] = screen.getAllByTestId('game-card-list');
    const firstHeroImage = within(heroList).getAllByRole('img')[0];
    const firstSkillImage = within(skillList).getAllByRole('img')[0];
    expect(firstHeroImage.getAttribute('alt')).toMatch(/^曹操武将卡面/);
    expect(firstSkillImage.getAttribute('alt')).toMatch(/^百战不殆战法卡面/);
    expect(within(heroList).getByText('★ 支援', { exact: true })).toBeInTheDocument();
    expect(within(skillList).getByText('★ 支援', { exact: true })).toBeInTheDocument();
  });

  test('fills only the open support tactic slot and preserves the confirmed tactic', async () => {
    render(team({ supportSkills: ['百战不殆'] }));

    fireEvent.click(screen.getByRole('button', { name: '推荐支援战法' }));
    // The confirmed support tactic is part of the pool, not a candidate.
    expect(supportRequest()).toEqual({
      heroes,
      skills: [...skills, '百战不殆'],
      kind: 'skill',
      count: 1,
      candidates: ['坚壁清野', '清风驱疾'],
    });
    expect(await screen.findByText('本次已选 1/1 个战法：')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '设为支援战法' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'SET_SUPPORT_SKILLS',
      skills: ['百战不殆', '坚壁清野'],
    });
  });

  test('excludes active offers from support recommendations', async () => {
    mocks.state.currentRoundInputs = {
      set1: ['曹操', '百战不殆'],
      set2: [],
      set3: [],
    };
    render(team());

    fireEvent.click(screen.getByRole('button', { name: '推荐支援武将' }));
    expect(supportRequest().candidates).toEqual(['孙权']);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '推荐支援武将' })).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getAllByRole('button', { name: '推荐支援战法' })[0]);
    expect(supportRequest(1)).toMatchObject({ count: 2, candidates: ['坚壁清野', '清风驱疾'] });
  });

  test.each([
    { season: 1, expected: ['曹操'] },
    { season: 2, expected: ['曹操', '孙权'] },
    { season: 3, expected: ['曹操', '孙权', '周瑜'] },
    { season: 4, expected: ['曹操', '孙权', '周瑜', '司马懿', '陆逊', '姜维'] },
    { season: 5, expected: ['曹操', '孙权', '周瑜', '司马懿', '陆逊', '姜维'] },
    { season: 7, expected: ['曹操', '孙权', '周瑜', '司马懿', '陆逊', '姜维'] },
  ])('uses the cumulative S1–S3 / unrestricted S4+ hero pool in S$season', ({ season, expected }) => {
    mocks.state.selectedSeason = season;
    mocks.state.currentRoundInputs = { set1: ['袁绍'], set2: [], set3: [] };
    const seasonMetadata = {
      曹操: { season: 1 },
      孙权: { season: 2 },
      周瑜: { season: 3 },
      司马懿: { season: 4 },
      陆逊: { season: 5 },
      姜维: { season: 16 },
      袁绍: { season: 1 },
    };
    render(team({
      availableHeroes: [...heroes, ...Object.keys(seasonMetadata)],
      heroMetadata: seasonMetadata,
    }));

    fireEvent.click(screen.getByRole('button', { name: '推荐支援武将' }));

    // Exact candidates also prove owned heroes and active offers stay excluded.
    expect(mocks.runLineup).toHaveBeenCalledTimes(1);
    expect(supportRequest()).toMatchObject({ candidates: expected, heroes, skills });
  });

  test.each([4, 7])('allows searching and selecting a later-season support hero in S%i', async (season) => {
    mocks.state.selectedSeason = season;
    render(team({
      availableHeroes: [...availableHeroes, '姜维'],
      heroMetadata: { 曹操: { season: 1 }, 姜维: { season: 16 } },
    }));
    fireEvent.click(screen.getByRole('button', { name: '推荐支援武将' }));
    await userEvent.type(screen.getByLabelText('搜索武将...'), '姜维');
    fireEvent.click(await screen.findByRole('option', { name: /^姜维/ }));
    fireEvent.click(screen.getByRole('button', { name: '设为支援武将' }));

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'SET_SUPPORT_HERO', hero: '姜维' });
  });

  test.each([4, 7])('keeps support tactics season-limited in S%i', (season) => {
    mocks.state.selectedSeason = season;
    render(team({
      skillMetadata: {
        百战不殆: { season: 1 },
        坚壁清野: { season: 4 },
        清风驱疾: { season: 16 },
      },
    }));
    fireEvent.click(screen.getAllByRole('button', { name: '推荐支援战法' })[0]);

    expect(supportRequest()).toEqual({
      heroes,
      skills,
      kind: 'skill',
      count: 2,
      candidates: ['百战不殆', '坚壁清野'],
    });
  });

  test('keeps the roster header on one line with 44px edit targets', () => {
    render(team());

    expect(getComputedStyle(screen.getByTestId('current-roster-header')).flexWrap)
      .toBe('nowrap');
    const edit = screen.getByRole('button', { name: '编辑队伍' });
    expect(getComputedStyle(edit).height).toBe('44px');
    fireEvent.click(edit);

    const save = screen.getByRole('button', { name: '保存修改' });
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(getComputedStyle(save).height).toBe('44px');
    expect(getComputedStyle(cancel).height).toBe('44px');
  });

  test('does not expose support actions for a read-only roster', () => {
    render(team({ editable: false }));

    expect(screen.queryByRole('button', { name: '推荐支援武将' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '推荐支援战法' })).not.toBeInTheDocument();
  });
});
