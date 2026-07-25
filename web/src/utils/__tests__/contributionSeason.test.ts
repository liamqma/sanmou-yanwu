import { database } from '../../data';
import {
  CONTRIBUTION_SEASON_COOKIE,
  loadContributionSeason,
  maxCatalogSeason,
  saveContributionSeason,
} from '../contributionSeason';

const cookieStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn((name: string) => values.get(name)),
    set: vi.fn((name: string, value: string) => {
      values.set(name, value);
    }),
  };
};

describe('contribution season cookie', () => {
  test('derives the latest numeric season from both catalogs', () => {
    const expected = Math.max(
      ...Object.values(database.heroes).map((hero) => hero.season),
      ...Object.values(database.skills).map((skill) => skill.season)
    );

    expect(maxCatalogSeason(database)).toBe(expected);
  });

  test.each([undefined, '0', 'not-a-season', '17'])(
    'defaults an absent or invalid value %j to the latest season',
    (saved) => {
      const store = cookieStore();
      if (saved !== undefined) {
        store.values.set(CONTRIBUTION_SEASON_COOKIE, saved);
      }

      expect(loadContributionSeason(16, store)).toBe(16);
    }
  );

  test('uses a contribution-only cookie and remembers a valid season', () => {
    const store = cookieStore();
    store.values.set('selectedSeason', '3');
    store.values.set(CONTRIBUTION_SEASON_COOKIE, '9');

    expect(loadContributionSeason(16, store)).toBe(9);
    saveContributionSeason(12, store);

    expect(store.set).toHaveBeenCalledWith(
      CONTRIBUTION_SEASON_COOKIE,
      '12',
      {
        expires: 365,
        path: '/',
        sameSite: 'Lax',
      }
    );
    expect(store.values.get('selectedSeason')).toBe('3');
  });
});
