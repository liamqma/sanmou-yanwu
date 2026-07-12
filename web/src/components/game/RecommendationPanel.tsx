import { Paper, Typography, Box, Alert } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import type { Recommendation, RoundType } from '../../types/game';

interface RecommendationPanelProps {
  recommendation: Recommendation | null;
  roundType: RoundType;
}

/**
 * Display AI recommendation for current round
 */
const RecommendationPanel = ({ recommendation, roundType }: RecommendationPanelProps) => {
  if (!recommendation) {
    return null;
  }

  const { recommended_set_index, round_info } = recommendation;
  
  return (
    <Paper sx={{ p: 3, mb: 3, bgcolor: 'rgba(223,232,226,0.8)', border: '1px solid', borderColor: 'primary.main', borderLeftWidth: 5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <AutoAwesomeOutlinedIcon sx={{ mr: 1, fontSize: 28, color: 'primary.main' }} />
        <Box>
          <Typography variant="overline" color="primary.dark" sx={{ display: 'block', lineHeight: 1.1 }}>参谋建议</Typography>
          <Typography variant="h6">AI 推荐</Typography>
        </Box>
      </Box>
      
      <Alert severity="success" sx={{ mb: 2 }}>
        <Typography variant="body1" fontWeight="bold">
          推荐：第 {(recommended_set_index as number) + 1} 组
        </Typography>
      </Alert>
      
      {round_info && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            第 {round_info.round_number} 轮 • {round_info.round_type === 'hero' ? '武将' : '战法'}
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

export default RecommendationPanel;
