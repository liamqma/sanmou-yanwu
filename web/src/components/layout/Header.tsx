import { Box, Typography, Container, Chip } from '@mui/material';
import UpdateIcon from '@mui/icons-material/Update';
import { battleStats as battleStatsData } from '../../data';

/**
 * Format an ISO-8601 timestamp (e.g. "2026-05-09T02:01:36+00:00") into a
 * compact local date string (date only, no time-of-day). Falls back to the
 * raw string on parse error and to "未知" when no timestamp is available.
 */
function formatGeneratedAt(isoString: string | undefined | null): string {
  if (!isoString) return '未知';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const Header = () => {
  const generatedAt = battleStatsData.generated_at;
  const addedBattles = Number.isFinite(battleStatsData.added_battles)
    ? battleStatsData.added_battles
    : 0;
  const totalBattles = battleStatsData.total_battles ?? 0;

  return (
    <Box
      sx={{
        textAlign: 'center',
        color: 'white',
        py: 4,
      }}
    >
      <Container maxWidth="lg">
        <Typography variant="h6">
          基于战斗数据的策略推荐
        </Typography>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            mt: 1.5,
            px: 2,
            py: 1,
            bgcolor: 'rgba(255, 255, 255, 0.18)',
            border: '1px solid rgba(255, 255, 255, 0.35)',
            borderRadius: 2,
            backdropFilter: 'blur(4px)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
          }}
        >
          <UpdateIcon fontSize="small" sx={{ color: 'white' }} />
          <Typography
            variant="subtitle2"
            sx={{ color: 'white', fontWeight: 700, letterSpacing: 0.3 }}
          >
            战报更新时: {formatGeneratedAt(generatedAt)}
          </Typography>
          {addedBattles > 0 && (
            <Chip
              size="small"
              label={`新增 ${addedBattles} 场`}
              sx={{
                bgcolor: '#4caf50',
                color: 'white',
                fontWeight: 700,
              }}
            />
          )}
          {totalBattles > 0 && (
            <Chip
              size="small"
              label={`共 ${totalBattles} 场`}
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.85)',
                color: '#3a2270',
                fontWeight: 700,
              }}
            />
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default Header;
