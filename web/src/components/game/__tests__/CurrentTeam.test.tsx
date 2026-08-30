import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import CurrentTeam from '../CurrentTeam';

const mocks = vi.hoisted(() => ({
  state: {
    selectedSeason: 7,
    heroMetadata: {},
    skillMetadata: {},
  },
  dispatch: vi.fn(),
  recommendSingleHero: vi.fn(() => ({
    hero: '曹操',
    analysis: [],
  })),
  recommendTwoSkills: vi.fn(() => ({
    skills: ['百战不殆', '坚壁清野'],
    analysis: [],
    pair: null,
  })),
  currentRosterScore: vi.fn(() => 12.3),
}));

vi.mock('../../../context/GameContext', () => ({
  useGame: () => ({ state: mocks.state, dispatch: mocks.dispatch }),
}));

vi.mock('../../../services/recommendationEngine', () => ({
  recommendSingleHero: mocks.recommendSingleHero,
  recommendTwoSkills: mocks.recommendTwoSkills,
  currentRosterScore: mocks.currentRosterScore,
}));

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
    mocks.state.selectedSeason = 7;
  });

  test('keeps recommendations private and uncounted until a placeholder is clicked', () => {
    const { rerender } = render(team());

    expect(screen.getByText('武将 (4)', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('战法 (8)', { exact: true })).toBeInTheDocument();
    expect(mocks.currentRosterScore).toHaveBeenCalledWith(
      heroes,
      skills,
      expect.anything(),
    );
    expect(mocks.recommendSingleHero).not.toHaveBeenCalled();
    expect(mocks.recommendTwoSkills).not.toHaveBeenCalled();

    const heroAction = screen.getByRole('button', { name: '推荐支援武将' });
    const skillAction = screen.getByRole('button', { name: '推荐支援战法' });
    expect(heroAction).toHaveTextContent('＋');
    expect(skillAction).toHaveTextContent('＋');
    expect(screen.queryByTestId('game-card-hero-曹操')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-card-tactic-百战不殆')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-card-tactic-坚壁清野')).not.toBeInTheDocument();

    rerender(team());
    expect(mocks.recommendSingleHero).not.toHaveBeenCalled();
    expect(mocks.recommendTwoSkills).not.toHaveBeenCalled();
  });

  test('calculates a hero recommendation on click and allows selecting it', () => {
    render(team());

    fireEvent.click(screen.getByRole('button', { name: '推荐支援武将' }));

    expect(mocks.recommendSingleHero).toHaveBeenCalledTimes(1);
    expect(mocks.recommendTwoSkills).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '推荐支援武将' })).toBeInTheDocument();
    expect(screen.getByText('曹操', { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设为支援武将' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'SET_SUPPORT_HERO',
      hero: '曹操',
    });
  });

  test('calculates tactic recommendations on click and allows selecting them', () => {
    render(team());

    fireEvent.click(screen.getByRole('button', { name: '推荐支援战法' }));

    expect(mocks.recommendTwoSkills).toHaveBeenCalledTimes(1);
    expect(mocks.recommendSingleHero).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '推荐支援战法' })).toBeInTheDocument();
    expect(screen.getByText('已选择 2/2 个战法：')).toBeInTheDocument();

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
    expect(screen.queryByRole('button', { name: '推荐支援战法' })).not.toBeInTheDocument();
    expect(mocks.recommendSingleHero).not.toHaveBeenCalled();
    expect(mocks.recommendTwoSkills).not.toHaveBeenCalled();

    const [heroList, skillList] = screen.getAllByTestId('game-card-list');
    const firstHeroImage = within(heroList).getAllByRole('img')[0];
    const firstSkillImage = within(skillList).getAllByRole('img')[0];
    expect(firstHeroImage.getAttribute('alt')).toMatch(/^曹操武将卡面/);
    expect(firstSkillImage.getAttribute('alt')).toMatch(/^百战不殆战法卡面/);
    expect(within(heroList).getByText('⭐支援 曹操', { exact: true })).toBeInTheDocument();
    expect(within(skillList).getByText('⭐支援 百战不殆', { exact: true })).toBeInTheDocument();
  });

  test('does not expose support actions for a read-only roster', () => {
    render(team({ editable: false }));

    expect(mocks.recommendSingleHero).not.toHaveBeenCalled();
    expect(mocks.recommendTwoSkills).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '推荐支援武将' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '推荐支援战法' })).not.toBeInTheDocument();
  });
});
