import { Box, Paper, Typography } from '@mui/material';
import { getRoundType, ROUND_NUMBERS, TOTAL_ROUNDS } from '../../services/gameLogic';

interface RoundInfoProps {
  roundNumber: number;
}

/** Game-board progress modelled after Yanwu's linked campaign plaques. */
const RoundInfo = ({ roundNumber }: RoundInfoProps) => {
  const roundType = getRoundType(roundNumber);
  const typeLabel = roundType === 'hero' ? '武将' : '战法';
  const roundTitle = `第 ${roundNumber} 轮：选择${typeLabel}`;

  return (
    <Paper
      component="section"
      aria-labelledby={`round-${roundNumber}-title`}
      sx={{
        mb: 2.5,
        px: { xs: 1.5, sm: 2.5 },
        py: { xs: 2, sm: 2.5 },
        overflow: 'hidden',
        bgcolor: 'background.paper',
        boxShadow: 'inset 0 -20px 42px rgba(163,129,71,.035)',
      }}
    >
      <Typography
        id={`round-${roundNumber}-title`}
        component="h1"
        sx={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          p: 0,
          m: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {roundTitle}
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="overline" color="error.main" sx={{ display: 'block', lineHeight: 1.2 }}>
            演武参谋 · 十轮选将
          </Typography>
          <Typography component="p" variant="h4" aria-hidden="true" sx={{ mt: 0.5 }}>
            第 {roundNumber} 轮 · {typeLabel}
          </Typography>
        </Box>
      </Box>

      <Box
        role="list"
        aria-label={`${TOTAL_ROUNDS} 轮进度`}
        sx={{
          display: { xs: 'grid', sm: 'none' },
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 0.5,
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
                position: 'relative',
                minWidth: 0,
                minHeight: 48,
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                clipPath: 'polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)',
                color: isActive ? '#fffdf7' : isComplete ? 'primary.dark' : 'text.secondary',
                bgcolor: isActive ? 'error.main' : isComplete ? 'primary.light' : 'background.default',
                backgroundImage: isActive
                  ? 'linear-gradient(135deg, rgba(255,255,255,.14), transparent 55%)'
                  : undefined,
                boxShadow: isActive ? 'inset 0 0 0 2px rgba(126,41,35,.72)' : 'inset 0 0 0 1px #c9c2b1',
              }}
            >
              <Typography component="span" sx={{ fontSize: 13, fontWeight: 850, lineHeight: 1.1 }}>
                {isComplete ? '✓' : round} · {isHero ? '将' : '法'}
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
          pb: 0.5,
          '&:focus-visible': { outline: '3px solid rgba(69,108,95,.34)', outlineOffset: 2 },
        }}
      >
        <Box role="list" sx={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(98px, 1fr))', minWidth: 980, gap: 0.5 }}>
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
                  minHeight: 54,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0.75,
                  px: 1.5,
                  clipPath: 'polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)',
                  color: isActive ? '#fffdf7' : isComplete ? 'primary.dark' : 'text.secondary',
                  bgcolor: isActive ? 'error.main' : isComplete ? 'primary.light' : 'background.default',
                  backgroundImage: isActive ? 'linear-gradient(135deg, rgba(255,255,255,.14), transparent 55%)' : undefined,
                  boxShadow: isActive ? 'inset 0 0 0 2px rgba(126,41,35,.72)' : 'inset 0 0 0 1px #c9c2b1',
                }}
              >
                <Typography component="span" sx={{ fontFamily: 'Georgia, serif', fontSize: 20, lineHeight: 1 }}>
                  {isComplete ? '✓' : round}
                </Typography>
                <Typography component="span" sx={{ fontWeight: 750, whiteSpace: 'nowrap' }}>
                  {isHero ? '武将' : '战法'}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
};

export default RoundInfo;
