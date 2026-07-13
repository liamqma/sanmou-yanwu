import type { ReactNode } from 'react';
import { Box, Container, Button, Stack, Typography } from '@mui/material';
import SportsEsportsOutlinedIcon from '@mui/icons-material/SportsEsportsOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import QueryStatsOutlinedIcon from '@mui/icons-material/QueryStatsOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from './Header';
import JoinGroupButton from './JoinGroupButton';
import { useGame } from '../../context/GameContext';

interface AppLayoutProps { children: ReactNode; }

const AppLayout = ({ children }: AppLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, dispatch } = useGame();
  const roundNumber = state?.gameState?.round_number || 0;

  const handleResetProgress = () => {
    if (window.confirm('确定要重置全部进度吗？此操作不可恢复。')) {
      dispatch({ type: 'RESET_GAME' });
      navigate('/');
    }
  };

  const navButtonSx = (path: string) => ({
    minHeight: 42,
    px: 1.75,
    color: location.pathname === path ? 'primary.dark' : 'text.secondary',
    border: 0,
    borderBottom: '2px solid',
    borderColor: location.pathname === path ? 'error.main' : 'transparent',
    bgcolor: location.pathname === path ? 'rgba(69,108,95,0.08)' : 'transparent',
    '&:hover': { bgcolor: 'rgba(69,108,95,0.08)', borderColor: location.pathname === path ? 'error.main' : 'divider' },
  });

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '80px minmax(0, 1fr)' } }}>
      <Header />
      <Box sx={{ minWidth: 0 }}>
        <Box
          component="nav"
          aria-label="主要导航"
          sx={{
            position: 'sticky',
            top: { xs: 0, md: 0 },
            zIndex: 15,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'rgba(243,239,227,0.94)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <Container maxWidth="xl" sx={{ py: 1.25 }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
              <Box sx={{ mr: { xs: 0.5, lg: 3 }, minWidth: 0 }}>
                <Typography variant="overline" color="error.main" sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1 }}>
                  三国谋定天下
                </Typography>
                <Typography variant="h6" sx={{ whiteSpace: 'nowrap', fontSize: { xs: 17, sm: 20 } }}>
                  演武参谋
                </Typography>
              </Box>

              <Stack direction="row" gap={0.25} sx={{ overflowX: 'auto', flex: 1, minWidth: 0 }}>
                <Button startIcon={<SportsEsportsOutlinedIcon />} onClick={() => navigate('/')} sx={navButtonSx('/')}>
                  对局推荐
                </Button>
                {roundNumber > 3 && (
                  <Button startIcon={<AccountTreeOutlinedIcon />} onClick={() => navigate('/team-builder')} sx={navButtonSx('/team-builder')}>
                    队伍推荐
                  </Button>
                )}
                <Button startIcon={<QueryStatsOutlinedIcon />} onClick={() => navigate('/analytics')} sx={navButtonSx('/analytics')}>
                  数据洞察
                </Button>
              </Stack>

              <Stack direction="row" gap={0.75} sx={{ display: { xs: 'none', lg: 'flex' } }}>
                <JoinGroupButton />
                <Button color="error" variant="text" startIcon={<RestartAltOutlinedIcon />} onClick={handleResetProgress} title="重置所有已保存进度">
                  重置
                </Button>
              </Stack>
            </Stack>
            <Stack direction="row" gap={1} sx={{ display: { xs: 'flex', lg: 'none' }, mt: 1, justifyContent: 'flex-end' }}>
              <JoinGroupButton />
              <Button color="error" size="small" startIcon={<RestartAltOutlinedIcon />} onClick={handleResetProgress} title="重置所有已保存进度">
                重置
              </Button>
            </Stack>
          </Container>
        </Box>

        <Container component="main" maxWidth="xl" sx={{ py: { xs: 2.5, sm: 4 }, minWidth: 0 }}>
          {children}
        </Container>
      </Box>
    </Box>
  );
};

export default AppLayout;
