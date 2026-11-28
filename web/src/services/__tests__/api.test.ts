import { database } from '../../data';
import { api } from '../api';
import { runLineup } from '../lineupClient';
import { heroRankingRank, skillRankingRank } from '../../utils/rankings';

vi.mock('../lineupClient', () => ({ runLineup: vi.fn() }));

const compareChineseNames = (a: string, b: string): number =>
  a.localeCompare(b, 'zh-Hans-CN');

describe('database items', () => {
  test('keeps full catalogs and exposes season metadata with a combined maximum', async () => {
    const items = await api.getDatabaseItems();
    const heroNames = Object.keys(database.heroes);
    const skillNames = Object.keys(database.skills);
    const expectedMaxSeason = Math.max(
      ...Object.values(database.heroes).map((hero) => hero.season),
      ...Object.values(database.skills).map((skill) => skill.season)
    );

    expect(new Set(items.heroes)).toEqual(new Set(heroNames));
    expect(new Set(items.skills)).toEqual(new Set(skillNames));
    expect(items.maxSeason).toBe(expectedMaxSeason);

    for (const name of heroNames) {
      expect(items.heroMetadata[name]?.season).toBe(database.heroes[name].season);
      expect(items.heroMetadata[name]?.ranking).toBe(database.heroes[name].ranking);
      expect(items.heroMetadata[name]).not.toHaveProperty('label');
      expect(items.heroMetadata[name]).not.toHaveProperty('rank');
    }
    for (const name of skillNames) {
      expect(items.skillMetadata[name]?.season).toBe(database.skills[name].season);
      expect(items.skillMetadata[name]?.ranking).toBe(database.skills[name].ranking);
      expect(items.skillMetadata[name]?.category).toBe(database.skills[name].category);
      expect(items.skillMetadata[name]).not.toHaveProperty('tier');
      expect(items.skillMetadata[name]).not.toHaveProperty('note');
    }
  });

  test('sorts heroes and skills by presentation ranking then Chinese name', async () => {
    const items = await api.getDatabaseItems();
    const expectedHeroes = Object.keys(database.heroes).sort((a, b) => {
      const rankingDelta =
        heroRankingRank(database.heroes[a].ranking) -
        heroRankingRank(database.heroes[b].ranking);
      return rankingDelta || compareChineseNames(a, b);
    });

    expect(items.heroes).toEqual(expectedHeroes);
    for (const ranking of ['S', 'A', 'B', 'C', 'D'] as const) {
      const tierHeroes = items.heroes.filter(
        (hero) => items.heroMetadata[hero]?.ranking === ranking
      );
      expect(tierHeroes).toEqual([...tierHeroes].sort(compareChineseNames));
    }

    for (const skills of [
      items.skills,
      items.regularSkills,
      items.orangeRegularSkills,
      items.heroSkills,
    ]) {
      expect(skills).toEqual([...skills].sort((a, b) => {
        const rankingDelta =
          skillRankingRank(database.skills[a].ranking) -
          skillRankingRank(database.skills[b].ranking);
        return rankingDelta || compareChineseNames(a, b);
      }));
    }
  });

  test('treats explicitly marked shadow skills as hero skills only', async () => {
    const items = await api.getDatabaseItems();
    const shadowSkills = ['曲辞谄媚', '猿臂善射'];

    for (const skill of shadowSkills) {
      expect(database.skills[skill]?.shadow).toBe(true);
      expect(items.skills).toContain(skill);
      expect(items.heroSkills).toContain(skill);
      expect(items.regularSkills).not.toContain(skill);
      expect(items.orangeRegularSkills).not.toContain(skill);
    }
  });
});

describe('recommendation', () => {
  test('asks the lineup model about the whole pool and reports each gap to the best set', async () => {
    vi.mocked(runLineup).mockResolvedValue({
      version: '9:0123456789abcdef',
      recommended: 1,
      options: [-30, -28.5, -29].map((score) => ({ score, teams: [] })),
      unknown: { heroes: ['丙'], skills: [] },
    });
    const sets = [['甲'], ['乙'], ['丙']];

    const recommendation = await api.getRecommendation('hero', sets, {
      current_heroes: ['主将'],
      current_skills: ['主战法'],
      support_hero: '支援将',
      support_skills: ['支援战法'],
      round_number: 4,
      round_history: [],
    });

    expect(runLineup).toHaveBeenCalledWith(
      'pick',
      { heroes: ['主将', '支援将'], skills: ['主战法', '支援战法'], options: sets, kind: 'hero' },
      undefined
    );
    expect(recommendation).toMatchObject({
      recommended_set_index: 1,
      recommended_set: ['乙'],
      model_version: '9:0123456789abcdef',
      unknown: { heroes: ['丙'], skills: [] },
      round_info: { round_number: 4, round_type: 'hero' },
    });
    expect(recommendation.analysis.map(({ set_index, gap }) => [set_index, gap])).toEqual([
      [0, -1.5],
      [1, 0],
      [2, -0.5],
    ]);
  });
});
