import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { Box, CircularProgress, CssBaseline } from '@mui/material';
import { theme } from './theme/theme';
import { GameProvider } from './context/GameContext';
import AppLayout from './components/layout/AppLayout';
import GameAdvisor from './pages/GameAdvisor';
import ErrorBoundary from './components/common/ErrorBoundary';
import type { DatabaseItems } from './types/game';
import RouteSeo from './seo/RouteSeo';

const Analytics = lazy(() => import('./pages/Analytics'));
const TeamBuilder = lazy(() => import('./pages/TeamBuilder'));
const Contribute = lazy(() => import('./pages/Contribute'));
const Contributors = lazy(() => import('./pages/Contributors'));
const YanwuGuide = lazy(() => import('./pages/YanwuGuide'));
const NotFound = lazy(() => import('./pages/NotFound'));

interface AppProps {
  databaseItems?: DatabaseItems | null;
}

function App({ databaseItems }: AppProps) {
  const routeFallback = (
    <Box
      role="status"
      aria-label="正在载入页面"
      sx={{ display: 'grid', placeItems: 'center', py: 10 }}
    >
      <CircularProgress />
    </Box>
  );

  return (
    <ErrorBoundary>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GameProvider databaseItems={databaseItems}>
          <Router>
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
              </Suspense>
            </AppLayout>
          </Router>
        </GameProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
