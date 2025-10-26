import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from './theme/theme';
import { GameProvider } from './context/GameContext';
import AppLayout from './components/layout/AppLayout';
import GameAdvisor from './pages/GameAdvisor';
import Analytics from './pages/Analytics';
import ErrorBoundary from './components/common/ErrorBoundary';
import { initGA, logPageView } from './utils/analytics';

// Component to track page views
function AnalyticsTracker() {
  const location = useLocation();

  useEffect(() => {
    logPageView();
  }, [location]);

  return null;
}

function App({ databaseItems }) {
  useEffect(() => {
    // Initialize Google Analytics
    initGA();
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GameProvider databaseItems={databaseItems}>
          <Router>
            <AnalyticsTracker />
            <AppLayout>
              <Routes>
                <Route path="/" element={<GameAdvisor />} />
                <Route path="/analytics" element={<Analytics />} />
              </Routes>
            </AppLayout>
          </Router>
        </GameProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
