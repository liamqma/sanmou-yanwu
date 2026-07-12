import { Typography, Stepper, Step, StepLabel, Paper, Box, Button, Chip } from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import { useNavigate } from 'react-router-dom';
import { getRoundInfo } from '../../services/gameLogic';

interface RoundInfoProps {
  roundNumber: number;
}

/**
 * Display current round information and progress
 */
const RoundInfo = ({ roundNumber }: RoundInfoProps) => {
  const navigate = useNavigate();
  const info = getRoundInfo(roundNumber);
  
  return (
    <Paper sx={{ p: { xs: 2.25, sm: 3 }, mb: 3, position: 'relative', borderTop: '3px solid', borderTopColor: 'text.primary' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Chip size="small" color="error" variant="outlined" label={`第 ${roundNumber} / 8 轮`} sx={{ mb: 1.5 }} />
          <Typography variant="h4" gutterBottom>
            {info.title}
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            {info.description}
          </Typography>
        </Box>
        {roundNumber > 3 && (
          <Button
            variant="outlined"
            color="primary"
            size="small"
            startIcon={<AccountTreeOutlinedIcon />}
            onClick={() => navigate('/team-builder')}
            sx={{ ml: 2, flexShrink: 0 }}
          >
            查看队伍推荐
          </Button>
        )}
      </Box>
      
      <Box sx={{ overflowX: 'auto', pt: 1 }}>
      <Stepper activeStep={roundNumber - 1} alternativeLabel sx={{ mt: 2, minWidth: 660 }}>
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
      </Box>
    </Paper>
  );
};

export default RoundInfo;
