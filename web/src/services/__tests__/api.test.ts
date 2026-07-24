import { database } from '../../data';
import { api } from '../api';
import { clearTelemetryDataCacheForTests } from '../telemetryData';

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
    }
    for (const name of skillNames) {
      expect(items.skillMetadata[name]?.season).toBe(database.skills[name].season);
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
