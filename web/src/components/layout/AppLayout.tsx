import { useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
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
  const [confirmingReset, setConfirmingReset] = useState(false);

  const resetProgress = () => {
    setConfirmingReset(false);
    dispatch({ type: 'RESET_GAME' });
    navigate('/');
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
        onResetProgress={() => setConfirmingReset(true)}
      />
      <Box sx={{ minWidth: 0 }}>
        <Container component="main" maxWidth="xl" sx={{ py: { xs: 2.5, sm: 4 }, px: { xs: 2, sm: 3, lg: 4 }, minWidth: 0 }}>
          {children}
        </Container>
      </Box>
      <Dialog open={confirmingReset} onClose={() => setConfirmingReset(false)}>
        <DialogTitle>重置全部进度？</DialogTitle>
        <DialogContent>
          <DialogContentText>此操作不可恢复。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingReset(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={resetProgress}>
            重置
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AppLayout;
