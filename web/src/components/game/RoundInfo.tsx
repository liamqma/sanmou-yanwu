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
  const rounds = [1, 2, 3, 4, 5, 6, 7, 8];
  
  return (
    <Paper sx={{ p: { xs: 2.25, sm: 3 }, mb: 3, position: 'relative', borderTop: '3px solid', borderTopColor: 'text.primary' }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'flex-start' },
          gap: 2,
          mb: 2,
        }}
      >
        <Box sx={{ flex: 1 }}>
          <Chip size="small" color="error" variant="outlined" label={`第 ${roundNumber} / 8 轮`} sx={{ mb: 1.5 }} />
          <Typography component="h1" variant="h4" gutterBottom>
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
            sx={{ ml: { xs: 0, sm: 2 }, flexShrink: 0, width: { xs: '100%', sm: 'auto' } }}
          >
            查看队伍推荐
          </Button>
        )}
      </Box>
      
      <Box
        role="list"
        aria-label="8 轮进度"
        sx={{
          display: { xs: 'grid', sm: 'none' },
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 0.75,
          pt: 1,
        }}
      >
        {rounds.map((round) => {
          const isHero = round === 1 || round === 4 || round === 7;
          const isActive = round === roundNumber;
          const isComplete = round < roundNumber;
          const status = isActive ? '当前' : isComplete ? '已完成' : '未开始';

          return (
            <Box
              key={round}
              role="listitem"
              aria-current={isActive ? 'step' : undefined}
              aria-label={`第 ${round} 轮，${isHero ? '武将' : '战法'}，${status}`}
              sx={{
                minWidth: 0,
                p: 0.75,
                textAlign: 'center',
                borderTop: '3px solid',
                borderColor: isActive ? 'error.main' : isComplete ? 'primary.main' : 'divider',
                bgcolor: isActive ? 'rgba(168,57,47,0.07)' : isComplete ? 'rgba(69,108,95,0.07)' : 'transparent',
              }}
            >
              <Typography component="span" variant="caption" sx={{ display: 'block', fontWeight: 800 }}>
                {isComplete ? '✓' : round}
              </Typography>
              <Typography component="span" variant="caption" sx={{ display: 'block', fontWeight: isActive ? 800 : 600 }}>
                第 {round} 轮
              </Typography>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {isHero ? '武将' : '战法'}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Box
        role="region"
        aria-label="8 轮进度，可横向滚动"
        tabIndex={0}
        sx={{
          display: { xs: 'none', sm: 'block' },
          overflowX: 'auto',
          pt: 1,
          '&:focus-visible': {
            outline: '3px solid rgba(69,108,95,0.42)',
            outlineOffset: 2,
          },
        }}
      >
      <Stepper activeStep={roundNumber - 1} alternativeLabel sx={{ mt: 2, minWidth: 660 }}>
        {rounds.map((round) => {
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
