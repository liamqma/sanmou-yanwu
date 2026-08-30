import { Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { theme } from './theme/theme';
import { GameProvider } from './context/GameContext';
import AppLayout from './components/layout/AppLayout';
import GameAdvisor from './pages/GameAdvisor';
import ErrorBoundary from './components/common/ErrorBoundary';
import type { DatabaseItems } from './types/game';
import RouteSeo from './seo/RouteSeo';
import type { RouteComponents } from './routeComponents';
import GameLoadingPanel from './components/common/GameLoadingPanel';

interface AppProps {
  databaseItems?: DatabaseItems | null;
  routeComponents: RouteComponents;
}

const HydrationCurtainDismissal = () => {
  useEffect(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const page = document.documentElement;
        if (page.getAttribute('data-app-hydration') === 'pending') {
          page.setAttribute('data-app-hydration', 'ready');
          const root = document.getElementById('root');
          root?.removeAttribute('inert');
          root?.removeAttribute('aria-busy');
        }
      });
    });
  }, []);

  return null;
};

function App({ databaseItems, routeComponents }: AppProps) {
  const {
    Analytics,
    TeamBuilder,
    Contribute,
    Contributors,
    YanwuGuide,
    NotFound,
  } = routeComponents;
  const routeFallback = (
    <GameLoadingPanel
      label="正在载入页面"
      detail="正在展开演武案卷…"
      variant="page"
    />
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <GameProvider databaseItems={databaseItems}>
          <RouteSeo />
          <AppLayout>
            <Suspense fallback={routeFallback}>
              <Routes>
                <Route path="/" element={<GameAdvisor />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/team-builder" element={<TeamBuilder />} />
                <Route path="/contribute" element={<Contribute />} />
                <Route path="/contributors" element={<Contributors />} />
                <Route path="/guides/yanwu" element={<YanwuGuide />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              <HydrationCurtainDismissal />
            </Suspense>
          </AppLayout>
        </GameProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
