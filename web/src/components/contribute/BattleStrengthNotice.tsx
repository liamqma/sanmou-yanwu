import { Alert, Stack, Typography } from '@mui/material';
import type { BattleStrengthComparison } from '../../services/battleStrength';

interface BattleStrengthNoticeProps {
  comparison: BattleStrengthComparison;
}

const BattleStrengthNotice = ({
  comparison,
}: BattleStrengthNoticeProps) => {
  const lowEvidence =
    comparison.team1.lowEvidence || comparison.team2.lowEvidence;

  return (
    <Stack spacing={1}>
      {comparison.upset && (
        <Alert severity="success">
          以弱胜强！阵容评分较低的一方赢下了本场。
        </Alert>
      )}
      <Typography variant="caption" color="text.secondary">
        阵容评分由当前版本模型根据现有战报计算，仅供参考；阵容克制、临场发挥与随机因素也会影响胜负
        {lowEvidence ? '，部分组合的历史参考场次较少。' : '。'}
      </Typography>
    </Stack>
  );
};

export default BattleStrengthNotice;
