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
    <Typography color="text.secondary" sx={{ mb: 3 }}>
      感谢每位上传演武战报的玩家。贡献榜每日更新，这些社区数据会帮助完善武将、战法与阵容推荐。
    </Typography>
    <UploadLeaderboard />
  </Box>
);

export default Contributors;
