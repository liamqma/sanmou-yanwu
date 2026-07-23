import { database } from '../../data';
import { api } from '../api';
import { clearTelemetryDataCacheForTests } from '../telemetryData';

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
