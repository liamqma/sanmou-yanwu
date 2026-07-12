import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from './theme/theme';
import { GameProvider } from './context/GameContext';
import AppLayout from './components/layout/AppLayout';
import GameAdvisor from './pages/GameAdvisor';
import Analytics from './pages/Analytics';
import TeamBuilder from './pages/TeamBuilder';
import BuildATeam from './pages/BuildATeam';
import ErrorBoundary from './components/common/ErrorBoundary';

function App({ databaseItems }) {
  return (
    <ErrorBoundary>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GameProvider databaseItems={databaseItems}>
          <Router>
            <AppLayout>
              <Routes>
                <Route path="/" element={<GameAdvisor />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/team-builder" element={<TeamBuilder />} />
                {/* Internal-only page; intentionally not linked in the nav */}
                <Route path="/build-a-team" element={<BuildATeam />} />
              </Routes>
            </AppLayout>
          </Router>
        </GameProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
