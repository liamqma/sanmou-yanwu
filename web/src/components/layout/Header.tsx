import { Box, Typography } from '@mui/material';
import UpdateIcon from '@mui/icons-material/Update';
import { recommendationData } from '../../data';

const Header = () => {
  const counts = recommendationData.battle_counts;
  const totalBattles = counts.total_battles ?? 0;
  // The artifact is byte-reproducible (no build timestamp); the corpus content
  // hash identifies which battles it was trained on.
  const corpusVersion = counts.corpus_version ?? '';

  return (
    <Box
      component="header"
      sx={{
        position: { xs: 'relative', md: 'sticky' },
        top: 0,
        zIndex: 20,
        minHeight: { xs: 62, md: '100vh' },
        height: { md: '100vh' },
        bgcolor: '#17221e',
        color: '#f4ecdc',
        borderRight: { md: '1px solid #53625c' },
        borderBottom: { xs: '1px solid #53625c', md: 0 },
        px: { xs: 2.25, md: 1.5 },
        py: { xs: 1.25, md: 3 },
        display: 'flex',
        flexDirection: { xs: 'row', md: 'column' },
        alignItems: 'center',
        justifyContent: { xs: 'space-between', md: 'flex-start' },
        gap: { xs: 2, md: 2.5 },
      }}
    >
      <Typography
        component="div"
        sx={{
          writingMode: { xs: 'horizontal-tb', md: 'vertical-rl' },
          fontFamily: '"Songti SC", STSong, Georgia, serif',
          fontSize: { xs: 20, md: 22 },
          fontWeight: 800,
          letterSpacing: { xs: '0.18em', md: '0.28em' },
          whiteSpace: 'nowrap',
        }}
      >
        演武策牒
      </Typography>

      <Box
        sx={{
          writingMode: { xs: 'horizontal-tb', md: 'vertical-rl' },
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          color: '#b8c0ba',
          fontSize: 11,
          letterSpacing: '0.1em',
          whiteSpace: 'nowrap',
        }}
      >
        <UpdateIcon sx={{ fontSize: 14 }} />
        {totalBattles > 0 && <span>{totalBattles} 场</span>}
        {corpusVersion && <span>· {corpusVersion.slice(0, 8)}</span>}
      </Box>
    </Box>
  );
};

export default Header;
