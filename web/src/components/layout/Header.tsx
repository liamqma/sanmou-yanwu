import { Box, Typography } from '@mui/material';
import UpdateIcon from '@mui/icons-material/Update';
import { battleStats as battleStatsData } from '../../data';

function formatGeneratedAt(isoString: string | undefined | null): string {
  if (!isoString) return '未知';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

const Header = () => {
  const generatedAt = formatGeneratedAt(battleStatsData.generated_at);
  const totalBattles = battleStatsData.total_battles ?? 0;
  const addedBattles = Number.isFinite(battleStatsData.added_battles)
    ? battleStatsData.added_battles
    : 0;

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
        <span>{generatedAt}</span>
        {totalBattles > 0 && <span>· {totalBattles} 场</span>}
        {addedBattles > 0 && <span style={{ color: '#d98a5c' }}>· 新增 {addedBattles}</span>}
      </Box>
    </Box>
  );
};

export default Header;
