import { database } from '../../data';
import { api } from '../api';
import { clearTelemetryDataCacheForTests } from '../telemetryData';
import { heroRankingRank, skillRankingRank } from '../../utils/rankings';

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

describe('recommendation telemetry isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTelemetryDataCacheForTests();
  });

  test('a stalled telemetry artifact request never blocks the paired recommendation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined))
    );
    clearTelemetryDataCacheForTests();
    const heroes = Object.keys(database.heroes);
    const currentHeroes = heroes.slice(0, 4);
    const candidates = heroes.slice(4, 13);

    const completed = await Promise.race([
      api
        .getRecommendation(
          'hero',
          [
            candidates.slice(0, 3),
            candidates.slice(3, 6),
            candidates.slice(6, 9),
          ],
          {
            current_heroes: currentHeroes,
            current_skills: [],
            support_hero: null,
            support_skills: [],
            round_number: 1,
            round_history: [],
          }
        )
        .then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 100);
      }),
    ]);

    expect(completed).toBe(true);
  });
});
