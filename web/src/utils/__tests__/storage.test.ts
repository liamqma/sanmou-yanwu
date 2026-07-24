import Cookies from 'js-cookie';
import { storage } from '../storage';

const emptyInputs = { set1: [], set2: [], set3: [] };
const gameState = {
  current_heroes: [],
  current_skills: [],
  support_hero: null,
  support_skills: [],
  round_number: 1,
  round_history: [],
};

describe('storage season preference', () => {
  beforeEach(() => {
    Cookies.remove('gameProgress', { path: '/' });
    Cookies.remove('selectedSeason', { path: '/' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Cookies.remove('gameProgress', { path: '/' });
    Cookies.remove('selectedSeason', { path: '/' });
  });

  test('uses the same persistent cookie options as other saved state', () => {
    const setCookie = vi.spyOn(Cookies, 'set');

    storage.saveSelectedSeason(7);

    expect(setCookie).toHaveBeenCalledWith('selectedSeason', '7', {
      expires: 365,
      path: '/',
      sameSite: 'Lax',
    });
    expect(storage.loadSelectedSeason()).toBe(7);
  });

  test.each(['not-a-season', '0', '-1', '2.5'])(
    'treats %s as an invalid saved season',
    (value) => {
      Cookies.set('selectedSeason', value, { path: '/' });
      expect(storage.loadSelectedSeason()).toBeNull();
    }
  );

  test('clearing game progress does not remove the season preference', () => {
    storage.saveGameProgress(gameState, emptyInputs);
    storage.saveSelectedSeason(5);

    storage.clearGameProgress();

    expect(storage.loadGameProgress()).toBeNull();
    expect(storage.loadSelectedSeason()).toBe(5);
  });
});
