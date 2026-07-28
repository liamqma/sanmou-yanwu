import { lazy, type ComponentType } from 'react';

export interface RouteComponents {
  Analytics: ComponentType;
  TeamBuilder: ComponentType;
  Contribute: ComponentType;
  Contributors: ComponentType;
  YanwuGuide: ComponentType;
  NotFound: ComponentType;
}

// Keep page-level code splitting in the browser. The build-time renderer
// supplies eager components instead so static HTML never contains a Suspense
// loading fallback that would remain stuck when JavaScript is disabled.
export const clientRouteComponents: RouteComponents = {
  Analytics: lazy(() => import('./pages/Analytics')),
  TeamBuilder: lazy(() => import('./pages/TeamBuilder')),
  Contribute: lazy(() => import('./pages/Contribute')),
  Contributors: lazy(() => import('./pages/Contributors')),
  YanwuGuide: lazy(() => import('./pages/YanwuGuide')),
  NotFound: lazy(() => import('./pages/NotFound')),
};
