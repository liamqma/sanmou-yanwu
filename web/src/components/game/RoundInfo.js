import React from 'react';
import { Typography, Stepper, Step, StepLabel, Paper } from '@mui/material';
import { getRoundInfo } from '../../services/gameLogic';

/**
 * Display current round information and progress
 */
const RoundInfo = ({ roundNumber }) => {
  const info = getRoundInfo(roundNumber);
  
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h5" gutterBottom>
        {info.title}
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        {info.description}
      </Typography>
      
      <Stepper activeStep={roundNumber - 1} alternativeLabel sx={{ mt: 2 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((round) => {
          const isHero = round === 1 || round === 4 || round === 7;
          return (
            <Step key={round}>
              <StepLabel>
                Round {round}
                <br />
                <Typography variant="caption" color="text.secondary">
                  {isHero ? 'Hero' : 'Skill'}
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
