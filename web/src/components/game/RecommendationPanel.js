import React from 'react';
import { Paper, Typography, Box, Alert } from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';

/**
 * Display AI recommendation for current round
 */
const RecommendationPanel = ({ recommendation, roundType }) => {
  if (!recommendation) {
    return null;
  }
  
  const { recommended_set_index, reasoning, round_info } = recommendation;
  
  return (
    <Paper sx={{ p: 3, mb: 3, bgcolor: 'success.light', color: 'success.contrastText' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <EmojiEventsIcon sx={{ mr: 1, fontSize: 32 }} />
        <Typography variant="h6">
          AI Recommendation
        </Typography>
      </Box>
      
      <Alert severity="success" sx={{ mb: 2 }}>
        <Typography variant="body1" fontWeight="bold">
          Recommended: Option Set {recommended_set_index + 1}
        </Typography>
      </Alert>
      
      {reasoning && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            💡 Analysis:
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
            {reasoning}
          </Typography>
        </Box>
      )}
      
      {round_info && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Round {round_info.round_number} • {round_info.round_type}
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

export default RecommendationPanel;
