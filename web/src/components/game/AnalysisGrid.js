import React from 'react';
import { Grid, Card, CardContent, Typography, Button, Box, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import { HERO_RECOMMEND_OPTIONS, SKILL_RECOMMEND_OPTIONS } from '../../services/recommendationEngine';

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
              第{index + 1}组
            </Typography>
            
            {setAnalysis?.final_score !== undefined && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="h4" color="primary">
                  {setAnalysis.final_score.toFixed(1)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  综合评分
                </Typography>
              </Box>
            )}
            
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                武将评分:
              </Typography>
              {items.map((item, idx) => {
                // Find the detail for this item (hero or skill)
                const itemDetail = roundType === 'hero' 
                  ? setAnalysis?.hero_details?.find(h => h.hero === item)
                  : setAnalysis?.skill_details?.find(s => s.skill === item);
                
                return (
                  <Box key={idx} sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Chip 
                      label={item} 
                      color={itemColor}
                      size="small"
                    />
                    {itemDetail && (
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                        {itemDetail.score.toFixed(1)}                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
            
            {roundType === 'hero' && (
              <>
                <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                    评分详情:
                  </Typography>
                  {(() => {
                    const w = HERO_RECOMMEND_OPTIONS;
                    const sum = w.weightSetCombination + w.weightFullTeamCombination + w.weightPairStats + w.weightSkillHeroPairs;
                    const pct = (v) => (sum > 0 ? Math.round((v / sum) * 100) : 0);
                    return (
                      <>
                        {setAnalysis?.individual_scores !== undefined && (
                          <Typography variant="body2" color="text.secondary">
                            本组武将平均个人评分: {setAnalysis.individual_scores.toFixed(1)} (权重 {pct(w.weightSetCombination)}%)
                          </Typography>
                        )}
                        {setAnalysis?.score_full_team_combination !== undefined && (
                          <Typography variant="body2" color="text.secondary">
                            与已选武将组成队伍的评分: {setAnalysis.score_full_team_combination.toFixed(1)} (权重 {pct(w.weightFullTeamCombination)}%)
                          </Typography>
                        )}
                        {setAnalysis?.score_pair_stats !== undefined && (
                          <Typography variant="body2" color="text.secondary">
                            与已选武将配对的评分: {setAnalysis.score_pair_stats.toFixed(1)} (权重 {pct(w.weightPairStats)}%)
                          </Typography>
                        )}
                        {setAnalysis?.score_skill_hero_pairs !== undefined && (
                          <Typography variant="body2" color="text.secondary">
                            与已选战法的组合评分: {setAnalysis.score_skill_hero_pairs.toFixed(1)} (权重 {pct(w.weightSkillHeroPairs)}%)
                          </Typography>
                        )}
                      </>
                    );
                  })()}
                </Box>
                {setAnalysis?.top_combinations && setAnalysis.top_combinations.length > 0 && (
                  <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      Top Combinations:
                    </Typography>
                    {setAnalysis.top_combinations.map((combo, idx) => (
                      <Box key={idx} sx={{ mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                          {combo.heroes.map((hero, heroIdx) => (
                            <Chip
                              key={heroIdx}
                              label={hero}
                              color="primary"
                              size="small"
                            />
                          ))}
                          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                            {combo.total > 0
                              ? `${Math.round((combo.wins / combo.total) * 100)}% 胜率 (${combo.wins}胜/${combo.total}场)`
                              : '—'
                            }
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
                {setAnalysis?.top_pairs && setAnalysis.top_pairs.length > 0 && (
                  <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      Top Pairs:
                    </Typography>
                    {setAnalysis.top_pairs.map((pair, idx) => (
                      <Box key={idx} sx={{ mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                          <Chip
                            label={pair.hero1}
                            color="primary"
                            size="small"
                          />
                          <Chip
                            label={pair.hero2}
                            color="primary"
                            size="small"
                          />
                          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                            {pair.total > 0
                              ? `${Math.round((pair.wins / pair.total) * 100)}% 胜率 (${pair.wins}胜/${pair.total}场)`
                              : '—'
                            }
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
                {setAnalysis?.top_skill_hero_pairs && setAnalysis.top_skill_hero_pairs.length > 0 && (
                  <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      Top Skill-Hero Pairs:
                    </Typography>
                    {setAnalysis.top_skill_hero_pairs.map((pair, idx) => (
                      <Box key={idx} sx={{ mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                          <Chip
                            label={pair.hero}
                            color="primary"
                            size="small"
                          />
                          <Chip
                            label={pair.skill}
                            color="secondary"
                            size="small"
                          />
                          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                            {pair.total > 0
                              ? `${Math.round((pair.wins / pair.total) * 100)}% 胜率 (${pair.wins}胜/${pair.total}场)`
                              : '—'
                            }
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </>
            )}
            
            {roundType === 'skill' && (
              <>
                <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                    评分详情:
                  </Typography>
                  {(() => {
                    const w = SKILL_RECOMMEND_OPTIONS;
                    const sum = w.weightIndividualSkills + w.weightSkillHeroPairs;
                    const pct = (v) => (sum > 0 ? Math.round((v / sum) * 100) : 0);
                    return (
                      <>
                        {setAnalysis?.individual_scores !== undefined && (
                          <Typography variant="body2" color="text.secondary">
                            本组战法平均个人评分: {setAnalysis.individual_scores.toFixed(1)} (权重 {pct(w.weightIndividualSkills)}%)
                          </Typography>
                        )}
                        {setAnalysis?.score_skill_hero_pairs !== undefined && (
                          <Typography variant="body2" color="text.secondary">
                            与已选武将/战法的组合评分: {setAnalysis.score_skill_hero_pairs.toFixed(1)} (权重 {pct(w.weightSkillHeroPairs)}%)
                          </Typography>
                        )}
                      </>
                    );
                  })()}
                </Box>
                {setAnalysis?.top_skill_hero_pairs && setAnalysis.top_skill_hero_pairs.length > 0 && (
                  <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                      Top Skill-Hero Pairs:
                    </Typography>
                    {setAnalysis.top_skill_hero_pairs.map((pair, idx) => (
                      <Box key={idx} sx={{ mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                          <Chip
                            label={pair.hero}
                            color="primary"
                            size="small"
                          />
                          <Chip
                            label={pair.skill}
                            color="secondary"
                            size="small"
                          />
                          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                            {pair.total > 0
                              ? `${Math.round((pair.wins / pair.total) * 100)}% 胜率 (${pair.wins}胜/${pair.total}场)`
                              : '—'
                            }
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </>
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
