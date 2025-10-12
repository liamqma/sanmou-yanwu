import React from 'react';
import { Grid, Card, CardContent, Typography, Button, Box, Chip, Badge } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';

/**
 * Display 3 option sets as cards with analysis and selection
 */
const AnalysisGrid = ({ 
  sets, 
  analysis, 
  selectedIndex, 
  recommendedIndex,
  onSelectSet,
  roundType 
}) => {
  const itemColor = roundType === 'hero' ? 'primary' : 'secondary';
  
  const renderSetCard = (setName, index) => {
    const items = sets[setName] || [];
    // Find the analysis for this set by matching set_index
    const setAnalysis = analysis?.find(a => a.set_index === index);
    const isSelected = selectedIndex === index;
    const isRecommended = recommendedIndex === index;
    
    if (items.length === 0) {
      return null;
    }
    
    return (
      <Grid item size={{ xs: 12, sm: 6, md:4 }} key={setName}>
        <Card 
          sx={{ 
            height: '100%',
            border: 3,
            borderColor: isSelected ? 'success.main' : isRecommended ? 'warning.main' : 'divider',
            position: 'relative',
            transition: 'all 0.3s',
            '&:hover': {
              boxShadow: 6,
            }
          }}
        >
          {/* Reserve space for chips with absolute positioning */}
          <Box sx={{ position: 'absolute', top: 8, right: 8, left: 8, height: 32, zIndex: 1 }}>
            {isRecommended && (
              <Chip
                icon={<StarIcon />}
                label="AI Recommended"
                color="warning"
                size="small"
                sx={{ 
                  position: 'absolute', 
                  top: 0, 
                  right: 0,
                }}
              />
            )}
            
            {isSelected && (
              <Chip
                icon={<CheckCircleIcon />}
                label="Selected"
                color="success"
                size="small"
                sx={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0,
                }}
              />
            )}
          </Box>
          
          <CardContent sx={{ pt: 5 }}>
            <Typography variant="h6" gutterBottom>
              Option Set {index + 1}
            </Typography>
            
            {setAnalysis?.total_score !== undefined && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="h4" color="primary">
                  {setAnalysis.total_score.toFixed(1)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Total Score
                </Typography>
              </Box>
            )}
            
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Items:
              </Typography>
              {items.map((item, idx) => (
                <Box key={idx} sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Chip 
                    label={item} 
                    color={itemColor}
                    size="small"
                  />
                  {setAnalysis?.individual_scores?.[item] !== undefined && (
                    <Typography variant="body2" color="text.secondary">
                      {setAnalysis.individual_scores[item].toFixed(1)}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
            
            {setAnalysis?.synergy_bonus !== undefined && (
              <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Synergy Bonus:
                </Typography>
                <Typography variant="body2" fontWeight="bold" color="success.main">
                  +{setAnalysis.synergy_bonus.toFixed(1)}
                </Typography>
              </Box>
            )}
            
            {setAnalysis?.hero_synergy !== undefined && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Hero Synergy: {setAnalysis.hero_synergy.toFixed(1)}
                </Typography>
                {setAnalysis?.skill_synergy !== undefined && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Skill Synergy: {setAnalysis.skill_synergy.toFixed(1)}
                  </Typography>
                )}
              </Box>
            )}
            
            <Button
              variant={isSelected ? "contained" : "outlined"}
              color={isSelected ? "success" : "primary"}
              fullWidth
              onClick={() => onSelectSet(index)}
              startIcon={isSelected ? <CheckCircleIcon /> : null}
            >
              {isSelected ? 'Selected' : 'Select This Set'}
            </Button>
          </CardContent>
        </Card>
      </Grid>
    );
  };
  
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        📊 Option Analysis
      </Typography>
      <Grid container spacing={3}>
        {renderSetCard('set1', 0)}
        {renderSetCard('set2', 1)}
        {renderSetCard('set3', 2)}
      </Grid>
    </Box>
  );
};

export default AnalysisGrid;
