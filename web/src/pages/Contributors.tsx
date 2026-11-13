import { Alert, Box } from '@mui/material';
import UploadLeaderboard from '../components/leaderboard/UploadLeaderboard';
import PageIntro from '../components/common/PageIntro';

const Contributors = () => (
  <Box sx={{ maxWidth: 920, mx: 'auto' }}>
    <PageIntro
      eyebrow="社区战报 · 已停止上传"
      title="战报贡献榜"
      description="感谢每位上传过演武战报的玩家，你们的战报帮助完善了武将、战法与阵容推荐。"
    />
    <Alert severity="info" sx={{ mb: 2 }}>
      战报上传功能已关闭。截图上传的流程比较繁琐，我们正在用神经网络算法开发对局推荐 V2，暂时不再需要玩家上传战报。以往上传的战报会继续用于推荐，再次感谢大家的贡献！
    </Alert>
    <UploadLeaderboard />
  </Box>
);

export default Contributors;
