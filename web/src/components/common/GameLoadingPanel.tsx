import { Box, Typography } from '@mui/material';

interface GameLoadingPanelProps {
  label: string;
  detail?: string;
  variant?: 'page' | 'panel' | 'inline';
}

/**
 * A loading surface that belongs to the same visual world as the Yanwu board.
 * Keeping this shared prevents lazy routes and data-backed panels from briefly
 * falling back to MUI's generic spinner treatment.
 */
const GameLoadingPanel = ({
  label,
  detail = '正在整备演武案牍…',
  variant = 'panel',
}: GameLoadingPanelProps) => {
  const inline = variant === 'inline';
  const page = variant === 'page';

  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="game-loading-panel"
      data-loading-variant={variant}
      sx={{
        position: 'relative',
        isolation: 'isolate',
        display: 'grid',
        placeItems: 'center',
        minHeight: inline ? 112 : page ? { xs: 280, sm: 420 } : 220,
        px: 2,
        py: inline ? 2 : 4,
        overflow: 'hidden',
        color: 'text.primary',
        bgcolor: 'background.default',
        backgroundImage: 'none',
        border: inline ? 0 : '1px solid',
        borderColor: 'divider',
        boxShadow: 'none',
        '&::before, &::after': inline
          ? undefined
          : {
              content: '""',
              position: 'absolute',
              width: 30,
              height: 30,
              borderColor: 'secondary.main',
              opacity: 0.7,
            },
        '&::before': inline
          ? undefined
          : { top: 10, left: 10, borderTop: '1px solid', borderLeft: '1px solid' },
        '&::after': inline
          ? undefined
          : { right: 10, bottom: 10, borderRight: '1px solid', borderBottom: '1px solid' },
      }}
    >
      <Box sx={{ width: 'min(320px, 100%)', textAlign: 'center' }}>
        <Box
          aria-hidden="true"
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: inline ? 42 : 54,
            height: inline ? 42 : 54,
            mx: 'auto',
            mb: 1.5,
            border: '1px solid',
            borderColor: 'error.main',
            outline: '1px solid',
            outlineColor: 'error.light',
            outlineOffset: -5,
            color: 'error.main',
            fontFamily: '"Songti SC", STSong, Georgia, serif',
            fontSize: inline ? 25 : 32,
            fontWeight: 800,
          }}
        >
          谋
        </Box>

        <Typography
          component="p"
          sx={{
            color: 'text.primary',
            fontFamily: '"Songti SC", STSong, Georgia, serif',
            fontSize: inline ? 16 : 19,
            fontWeight: 700,
            letterSpacing: '0.14em',
          }}
        >
          {label}
        </Typography>

        <Box
          aria-hidden="true"
          sx={{
            position: 'relative',
            height: 8,
            width: inline ? 132 : 184,
            mx: 'auto',
            my: 1.25,
            '&::before': {
              content: '""',
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: 1,
              bgcolor: 'primary.light',
            },
          }}
        >
          {[0, 1, 2].map((index) => (
            <Box
              component="span"
              key={index}
              sx={{
                position: 'absolute',
                top: 1,
                left: `${index * 50}%`,
                width: 6,
                height: 6,
                transform: 'rotate(45deg)',
                bgcolor: index === 1 ? 'error.main' : 'primary.main',
                animation: 'yanwu-loading-pulse 1.35s ease-in-out infinite',
                animationDelay: `${index * 180}ms`,
                '@keyframes yanwu-loading-pulse': {
                  '0%, 100%': { opacity: 0.28, transform: 'rotate(45deg) scale(.72)' },
                  '50%': { opacity: 1, transform: 'rotate(45deg) scale(1)' },
                },
              }}
            />
          ))}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
          {detail}
        </Typography>
      </Box>
    </Box>
  );
};

export default GameLoadingPanel;
