import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import type { RouteComponents } from './routeComponents';

vi.mock('./context/GameContext', () => ({
  GameProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('./components/layout/AppLayout', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('./seo/RouteSeo', () => ({ default: () => null }));
vi.mock('./pages/GameAdvisor', () => ({ default: () => <div>draft</div> }));

import App from './App';

const EmptyRoute = () => null;
const routeComponents: RouteComponents = {
  Analytics: EmptyRoute,
  Contribute: EmptyRoute,
  Contributors: EmptyRoute,
  YanwuGuide: EmptyRoute,
  NotFound: EmptyRoute,
};

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
};

describe('legacy Team Builder route', () => {
  test.each(['?local-agent=1', '?local-agent=0'])(
    'redirects to the embedded builder while preserving %s',
    async (search) => {
      render(
        <MemoryRouter initialEntries={[`/team-builder${search}`]}>
          <App routeComponents={routeComponents} />
          <LocationProbe />
        </MemoryRouter>
      );

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(`/${search}`)
      );
      expect(screen.getByText('draft')).toBeVisible();
    }
  );
});
