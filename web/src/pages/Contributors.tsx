import { Box, Typography } from '@mui/material';
import UploadLeaderboard from '../components/leaderboard/UploadLeaderboard';

const Contributors = () => (
  <Box sx={{ maxWidth: 920, mx: 'auto' }}>
    <Typography variant="overline" color="error.main">
      社区战报 · 每日更新
    </Typography>
    <Typography component="h1" variant="h4" gutterBottom>
      战报贡献榜
    </Typography>
    <UploadLeaderboard />
  </Box>
);

export default Contributors;
