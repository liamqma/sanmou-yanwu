import { Typography, Stepper, Step, StepLabel, Paper, Box, Button } from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import { useNavigate } from 'react-router-dom';
import {
  getRoundType,
  ROUND_NUMBERS,
  TOTAL_ROUNDS,
} from '../../services/gameLogic';

interface RoundInfoProps {
  roundNumber: number;
}

/**
 * Display current round information and progress
 */
const RoundInfo = ({ roundNumber }: RoundInfoProps) => {
  const navigate = useNavigate();
  const roundType = getRoundType(roundNumber);
  const roundTitle = `第 ${roundNumber} 轮：选择${roundType === 'hero' ? '武将' : '战法'}`;
  
  return (
    <Paper
      component="section"
      aria-labelledby={`round-${roundNumber}-title`}
      sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, position: 'relative', borderTop: '3px solid', borderTopColor: 'secondary.main', bgcolor: 'rgba(16,25,24,.9)' }}
    >
      <Typography
        id={`round-${roundNumber}-title`}
        component="h1"
        sx={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          p: 0,
          m: '-1px',
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {roundTitle}
      </Typography>

      <Box sx={{ mb: 1.5 }}>
        <Typography variant="overline">十轮演武 · 当前阶段</Typography>
        <Typography component="p" variant="h4" aria-hidden="true">
          第 {roundNumber} 轮 · {roundType === 'hero' ? '择将' : '选战法'}
        </Typography>
      </Box>

      {roundNumber > 3 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="outlined"
            color="primary"
            size="small"
            startIcon={<AccountTreeOutlinedIcon />}
            onClick={() => navigate('/team-builder')}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            查看队伍推荐
          </Button>
        </Box>
      )}

      <Box
        role="list"
        aria-label={`${TOTAL_ROUNDS} 轮进度`}
        sx={{
          display: { xs: 'grid', sm: 'none' },
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 0.75,
        }}
      >
        {ROUND_NUMBERS.map((round) => {
          const isHero = getRoundType(round) === 'hero';
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
                bgcolor: isActive ? 'rgba(199,98,47,0.18)' : isComplete ? 'rgba(111,155,135,0.12)' : 'transparent',
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
        aria-label={`${TOTAL_ROUNDS} 轮进度，可横向滚动`}
        tabIndex={0}
        sx={{
          display: { xs: 'none', sm: 'block' },
          overflowX: 'auto',
          '&:focus-visible': {
            outline: '3px solid rgba(210,180,116,0.62)',
            outlineOffset: 2,
          },
        }}
      >
      <Stepper activeStep={roundNumber - 1} alternativeLabel sx={{ minWidth: 820 }}>
        {ROUND_NUMBERS.map((round) => {
          const isHero = getRoundType(round) === 'hero';
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
