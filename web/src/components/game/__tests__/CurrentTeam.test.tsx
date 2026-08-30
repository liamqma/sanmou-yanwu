import { fireEvent, render, screen } from '@testing-library/react';
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

const heroes = ['刘备'];
const skills = ['避其锐气'];
const availableHeroes = ['曹操', '孙权'];
const availableSkills = ['百战不殆', '坚壁清野', '清风驱疾'];
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

describe('CurrentTeam support previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.selectedSeason = 7;
  });

  test('does not calculate previews for a read-only roster', () => {
    render(team({ editable: false }));

    expect(mocks.recommendSingleHero).not.toHaveBeenCalled();
    expect(mocks.recommendTwoSkills).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '推荐支援武将' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '推荐支援战法' })).not.toBeInTheDocument();
  });

  test('does not calculate previews after support is complete', () => {
    render(
      team({
        supportHero: '曹操',
        supportSkills: ['百战不殆', '坚壁清野'],
      }),
    );

    expect(mocks.recommendSingleHero).not.toHaveBeenCalled();
    expect(mocks.recommendTwoSkills).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '推荐支援武将' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '推荐支援战法' })).not.toBeInTheDocument();
  });

  test('reuses previews until the roster or season changes', () => {
    const { rerender } = render(team());

    expect(mocks.recommendSingleHero).toHaveBeenCalledTimes(1);
    expect(mocks.recommendTwoSkills).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '推荐支援武将' }));
    expect(screen.getByRole('dialog', { name: '推荐支援武将' })).toBeInTheDocument();
    expect(mocks.recommendSingleHero).toHaveBeenCalledTimes(1);
    expect(mocks.recommendTwoSkills).toHaveBeenCalledTimes(1);

    rerender(team());
    expect(mocks.recommendSingleHero).toHaveBeenCalledTimes(1);
    expect(mocks.recommendTwoSkills).toHaveBeenCalledTimes(1);

    const expandedHeroes = [...heroes, '关羽'];
    rerender(team({ heroes: expandedHeroes }));
    expect(mocks.recommendSingleHero).toHaveBeenCalledTimes(2);
    expect(mocks.recommendTwoSkills).toHaveBeenCalledTimes(2);

    mocks.state.selectedSeason = 8;
    rerender(team({ heroes: expandedHeroes }));
    expect(mocks.recommendSingleHero).toHaveBeenCalledTimes(3);
    expect(mocks.recommendTwoSkills).toHaveBeenCalledTimes(3);
  });
});
