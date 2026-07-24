import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Cookies from 'js-cookie';
import type { DatabaseItems } from '../../types/game';
import { storage } from '../../utils/storage';
import { GameProvider, useGame } from '../GameContext';

vi.mock('../../services/telemetry', () => ({
  initializeTelemetry: vi.fn(),
}));

vi.mock('../../services/telemetryData', () => ({
  preloadTelemetryData: vi.fn(),
}));

const makeDatabaseItems = (maxSeason: number): DatabaseItems => ({
  heroes: ['旧武将', '新武将'],
  heroMetadata: {
    旧武将: { season: 1 },
    新武将: { season: maxSeason },
  },
  skills: ['旧战法', '新战法'],
  skillMetadata: {
    旧战法: { season: 1 },
    新战法: { season: maxSeason },
  },
  regularSkills: ['旧战法', '新战法'],
  orangeRegularSkills: ['旧战法', '新战法'],
  heroSkills: [],
  maxSeason,
});

const StateProbe = () => {
  const { state, dispatch } = useGame();
  return (
    <>
      <output data-testid="season-state">
        {state.databaseLoaded
          ? `${state.maxSeason}:${state.selectedSeason}`
          : 'loading'}
      </output>
      <button type="button" onClick={() => dispatch({ type: 'SET_SEASON', season: 7 })}>
        select seven
      </button>
      <button type="button" onClick={() => dispatch({ type: 'RESET_GAME' })}>
        reset
      </button>
    </>
  );
};

const renderProvider = (databaseItems: DatabaseItems) =>
  render(
    <GameProvider databaseItems={databaseItems}>
      <StateProbe />
    </GameProvider>
  );

describe('GameProvider season persistence', () => {
  beforeEach(() => {
    Cookies.remove('gameProgress', { path: '/' });
    Cookies.remove('selectedSeason', { path: '/' });
  });

  afterEach(() => {
    Cookies.remove('gameProgress', { path: '/' });
    Cookies.remove('selectedSeason', { path: '/' });
  });

  test.each([
    ['missing', null],
    ['malformed', 'not-a-season'],
    ['out of range', '17'],
  ])('falls back to the latest season when the saved value is %s', async (_label, value) => {
    if (value !== null) Cookies.set('selectedSeason', value, { path: '/' });

    renderProvider(makeDatabaseItems(16));

    await waitFor(() => {
      expect(screen.getByTestId('season-state')).toHaveTextContent('16:16');
      expect(Cookies.get('selectedSeason')).toBe('16');
    });
  });

  test('preserves a valid lower season when the catalog maximum increases', async () => {
    storage.saveSelectedSeason(5);
    const view = renderProvider(makeDatabaseItems(12));

    await waitFor(() => {
      expect(screen.getByTestId('season-state')).toHaveTextContent('12:5');
    });

    view.rerender(
      <GameProvider databaseItems={makeDatabaseItems(16)}>
        <StateProbe />
      </GameProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('season-state')).toHaveTextContent('16:5');
      expect(Cookies.get('selectedSeason')).toBe('5');
    });
  });

  test('saves a changed season and RESET_GAME preserves it', async () => {
    storage.saveSelectedSeason(5);
    renderProvider(makeDatabaseItems(16));
    await waitFor(() => {
      expect(screen.getByTestId('season-state')).toHaveTextContent('16:5');
    });

    fireEvent.click(screen.getByRole('button', { name: 'select seven' }));
    await waitFor(() => {
      expect(screen.getByTestId('season-state')).toHaveTextContent('16:7');
      expect(Cookies.get('selectedSeason')).toBe('7');
    });

    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByTestId('season-state')).toHaveTextContent('16:7');
    expect(Cookies.get('selectedSeason')).toBe('7');
  });
});
