import type { ReactNode } from 'react';
import { Box, Container } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import Header from './Header';
import { useGame } from '../../context/GameContext';

interface AppLayoutProps {
  children: ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, dispatch } = useGame();

  const handleResetProgress = () => {
    if (window.confirm('确定要重置全部进度吗？此操作不可恢复。')) {
      dispatch({ type: 'RESET_GAME' });
      navigate('/');
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '116px minmax(0, 1fr)' },
        gridTemplateRows: { xs: 'auto minmax(0, 1fr)', md: 'minmax(0, 1fr)' },
      }}
    >
      <Header
        currentPath={location.pathname}
        hasProgress={Boolean(state.gameState)}
        onResetProgress={handleResetProgress}
      />
      <Box sx={{ minWidth: 0 }}>
        <Container component="main" maxWidth="xl" sx={{ py: { xs: 2.5, sm: 4 }, px: { xs: 2, sm: 3, lg: 4 }, minWidth: 0 }}>
          {children}
        </Container>
      </Box>
    </Box>
  );
};

export default AppLayout;
