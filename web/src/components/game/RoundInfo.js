import React from 'react';
import { Typography, Stepper, Step, StepLabel, Paper, Box, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getRoundInfo } from '../../services/gameLogic';

/**
 * Display current round information and progress
 */
const RoundInfo = ({ roundNumber }) => {
  const navigate = useNavigate();
  const info = getRoundInfo(roundNumber);
  
  return (
    <Paper sx={{ p: 3, mb: 3, position: 'relative' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" gutterBottom>
            {info.title}
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            {info.description}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          color="primary"
          size="medium"
          onClick={() => navigate('/team-builder')}
          sx={{ ml: 2, flexShrink: 0 }}
        >
          🛠️ 组建队伍
        </Button>
      </Box>
      
      <Stepper activeStep={roundNumber - 1} alternativeLabel sx={{ mt: 2 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((round) => {
          const isHero = round === 1 || round === 4 || round === 7;
          return (
            <Step key={round}>
              <StepLabel>
                第 {round} 轮
                <br />
                <Typography variant="caption" color="text.secondary">
                  {isHero ? '武将' : '战法'}
                </Typography>
              </StepLabel>
            </Step>
          );
        })}
      </Stepper>
    </Paper>
  );
};

export default RoundInfo;
