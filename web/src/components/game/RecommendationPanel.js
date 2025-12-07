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
          <Typography variant="body2" fontWeight="bold" gutterBottom>
            💡 Analysis:
          </Typography>
          {reasoning.type === 'simple' ? (
            <Typography variant="body2" color="text.secondary">
              {reasoning.text}
            </Typography>
          ) : (
            <Box>
              {reasoning.sections.map((section, sectionIdx) => (
                <Box key={sectionIdx} sx={{ mb: 2 }}>
                  <Typography variant="body2" fontWeight="bold" gutterBottom>
                    {section.title}
                  </Typography>
                  {section.content.map((item, itemIdx) => {
                    if (item.type === 'text') {
                      return (
                        <Typography key={itemIdx} variant="body2" color="text.secondary" component="span">
                          {item.text}
                        </Typography>
                      );
                    }
                    if (item.type === 'bold') {
                      return (
                        <Typography key={itemIdx} variant="body2" color="text.secondary" component="span" fontWeight="bold">
                          {item.text}
                        </Typography>
                      );
                    }
                    if (item.type === 'list') {
                      return (
                        <Box key={itemIdx} component="ul" sx={{ pl: 2, mt: 1, mb: 1 }}>
                          {item.items.map((listItem, listIdx) => (
                            <li key={listIdx}>
                              <Typography variant="body2" color="text.secondary" component="span">
                                <Typography component="span" variant="body2" fontWeight={listItem.highlight ? 'bold' : 'normal'}>
                                  {listItem.label}: {listItem.value} {listItem.unit}
                                </Typography>
                                {listItem.detail && (
                                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                    ({listItem.detail})
                                  </Typography>
                                )}
                              </Typography>
                            </li>
                          ))}
                        </Box>
                      );
                    }
                    return null;
                  })}
                </Box>
              ))}
            </Box>
          )}
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
