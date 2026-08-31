import { Box } from '@mui/material';
import UploadLeaderboard from '../components/leaderboard/UploadLeaderboard';
import PageIntro from '../components/common/PageIntro';

const Contributors = () => (
  <Box sx={{ maxWidth: 920, mx: 'auto' }}>
    <PageIntro
      eyebrow="社区战报 · 每日更新"
      title="战报贡献榜"
      description="感谢每位上传演武战报的玩家。贡献榜每日更新，这些社区数据会帮助完善武将、战法与阵容推荐。"
    />
    <UploadLeaderboard />
  </Box>
);

export default Contributors;
