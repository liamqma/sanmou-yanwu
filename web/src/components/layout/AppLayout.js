import React from 'react';
import { Box, Container, Button, Stack, useMediaQuery, useTheme } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from './Header';
import { useGame } from '../../context/GameContext';
import GoogleAd from '../ads/GoogleAd';

const AppLayout = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, dispatch } = useGame();
  const roundNumber = state?.gameState?.round_number || 0;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const handleResetProgress = () => {
    if (window.confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
      dispatch({ type: 'RESET_GAME' });
      navigate('/');
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        pb: 4,
      }}
    >
      <Header />
      
      {/* Navigation */}
      <Container maxWidth="lg" sx={{ mb: 3 }}>
        <Stack 
          direction="row" 
          spacing={2} 
          justifyContent="center" 
          alignItems="center"
        >
          <Button
            variant={location.pathname === '/' ? 'contained' : 'outlined'}
            onClick={() => navigate('/')}
            sx={{
              bgcolor: location.pathname === '/' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)',
              color: 'white',
              borderColor: 'rgba(255,255,255,0.3)',
              '&:hover': {
                bgcolor: 'rgba(255,255,255,0.4)',
              },
            }}
          >
            🎮 Game Advisor
          </Button>
          {roundNumber > 3 && (
            <Button
              variant={location.pathname === '/team-builder' ? 'contained' : 'outlined'}
              onClick={() => navigate('/team-builder')}
              sx={{
                bgcolor: location.pathname === '/team-builder' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)',
                color: 'white',
                borderColor: 'rgba(255,255,255,0.3)',
                '&:hover': {
                  bgcolor: 'rgba(255,255,255,0.4)',
                },
              }}
            >
              🛠️ Build Your Team
            </Button>
          )}
          <Button
            variant={location.pathname === '/analytics' ? 'contained' : 'outlined'}
            onClick={() => navigate('/analytics')}
            sx={{
              bgcolor: location.pathname === '/analytics' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)',
              color: 'white',
              borderColor: 'rgba(255,255,255,0.3)',
              '&:hover': {
                bgcolor: 'rgba(255,255,255,0.4)',
              },
            }}
          >
            📊 Analytics
          </Button>
          <Button
            variant="outlined"
            onClick={handleResetProgress}
            sx={{
              bgcolor: 'rgba(255,0,0,0.3)',
              color: 'white',
              borderColor: 'rgba(255,255,255,0.3)',
              '&:hover': {
                bgcolor: 'rgba(255,0,0,0.5)',
              },
            }}
            title="Reset all saved progress"
          >
            🔄 Reset Progress
          </Button>
        </Stack>
      </Container>

      {/* Top Banner Ad */}
      <Container maxWidth="lg" sx={{ mb: 3 }}>
        <GoogleAd
          adSlot="3542163259"
          adFormat="auto"
          style={{ 
            margin: '0 auto',
            maxWidth: '728px',
            minHeight: '90px'
          }}
        />
      </Container>

      {/* Main Content with Sidebar */}
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'flex',
            gap: 3,
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: 'flex-start'
          }}
        >
          {/* Main Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {children}
          </Box>

          {/* Sidebar Ad (Desktop only) */}
          {!isMobile && (
            <Box
              sx={{
                width: 300,
                flexShrink: 0,
                position: 'sticky',
                top: 20,
                alignSelf: 'flex-start'
              }}
            >
              <GoogleAd
                adSlot="5476409060"
                adFormat="auto"
                style={{
                  minHeight: '600px'
                }}
              />
            </Box>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default AppLayout;
