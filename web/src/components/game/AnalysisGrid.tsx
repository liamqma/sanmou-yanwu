import { Grid, Card, CardContent, Typography, Button, Box, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import { HERO_RECOMMEND_OPTIONS, SKILL_RECOMMEND_OPTIONS } from '../../services/recommendationEngine';
import { formatHeroRank, formatSkillTier } from '../../utils/itemMetadata';
import type { CurrentRoundInputs, SetName, RoundType, HeroMeta, SkillMeta } from '../../types/game';

interface AnalysisGridProps {
  sets: CurrentRoundInputs;
  // Branch-loose recommendation analysis payload (see api.getRecommendation).
  analysis?: any;
  selectedIndex: number | null;
  recommendedIndex?: number;
  onSelectSet: (index: number) => void;
  roundType: RoundType;
  heroMetadata?: Record<string, HeroMeta> | null;
  skillMetadata?: Record<string, SkillMeta> | null;
}

/**
 * Display 3 option sets as cards with analysis and selection
 */
const AnalysisGrid = ({
  sets,
  analysis,
  selectedIndex,
  recommendedIndex,
  onSelectSet,
  roundType,
  heroMetadata = null,
  skillMetadata = null,
}: AnalysisGridProps) => {
  const itemColor = roundType === 'hero' ? 'primary' : 'secondary';

  // Append the catalog label (hero: label#rank, skill: tier) to the per-item
  // chips under 武将评分/战法评分. Falls back to the bare name when absent.
  const itemChipLabel = (item: string) => {
    if (roundType === 'hero') {
      const tag = formatHeroRank(heroMetadata?.[item]);
      return tag ? `${item} · ${tag}` : item;
    }
    const tier = formatSkillTier(skillMetadata?.[item]);
    return tier ? `${item} · ${tier}` : item;
  };

  const renderSetCard = (setName: SetName, index: number) => {
    const items = sets[setName] || [];
    // Find the analysis for this set by matching set_index
    const setAnalysis = analysis?.find((a: any) => a.set_index === index);
    const isSelected = selectedIndex === index;
    const isRecommended = recommendedIndex === index;
    
    if (items.length === 0) {
      return null;
    }
    
    return (
      <Grid size={{ xs: 12 }} key={setName}>
        <Card 
          sx={{ 
            height: '100%',
            border: 1,
            borderLeft: '5px solid',
            borderColor: isSelected ? 'success.main' : isRecommended ? 'warning.main' : 'divider',
            position: 'relative',
            bgcolor: isSelected ? 'rgba(223,232,226,0.72)' : isRecommended ? 'rgba(240,229,207,0.4)' : 'background.paper',
            transition: 'transform 160ms ease, background-color 160ms ease',
            '&:hover': {
              transform: 'translateX(3px)',
            }
          }}
        >
          {/* Reserve space for chips with absolute positioning */}
          <Box sx={{ position: 'absolute', top: 8, right: 8, left: 8, height: 32, zIndex: 1 }}>
            {isRecommended && (
              <Chip
                icon={<StarIcon />}
                label="AI 推荐"
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
                label="已选"
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
            <Box>
              <Typography variant="overline" color="text.secondary">OPTION {String.fromCharCode(65 + index)}</Typography>
              <Typography variant="h5" gutterBottom>
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
            </Box>
            
            <Box sx={{ mb: 2, minWidth: 0 }}>
              <Typography variant="subtitle2" gutterBottom>
                {roundType === 'hero' ? '武将评分:' : '战法评分:'}
              </Typography>
              {items.map((item, idx) => {
                // Find the detail for this item (hero or skill)
                const itemDetail = roundType === 'hero' 
                  ? setAnalysis?.hero_details?.find((h: any) => h.hero === item)
                  : setAnalysis?.skill_details?.find((s: any) => s.skill === item);
                
                return (
                  <Box key={idx} sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Chip
                      label={itemChipLabel(item)}
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
                    const pct = (v: number) => (sum > 0 ? Math.round((v / sum) * 100) : 0);
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
                      最佳三人组合:
                    </Typography>
                    {setAnalysis.top_combinations.map((combo: any, idx: number) => (
                      <Box key={idx} sx={{ mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                          {combo.heroes.map((hero: any, heroIdx: number) => (
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
                      最佳武将配对:
                    </Typography>
                    {setAnalysis.top_pairs.map((pair: any, idx: number) => (
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
                      最佳武将-战法组合:
                    </Typography>
                    {setAnalysis.top_skill_hero_pairs.map((pair: any, idx: number) => (
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
                    const pct = (v: number) => (sum > 0 ? Math.round((v / sum) * 100) : 0);
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
                      最佳武将-战法组合:
                    </Typography>
                    {setAnalysis.top_skill_hero_pairs.map((pair: any, idx: number) => (
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
              sx={{ alignSelf: 'center', mt: { xs: 1, lg: 0 } }}
            >
              {isSelected ? '已选' : '选择本组'}
            </Button>
          </CardContent>
        </Card>
      </Grid>
    );
  };
  
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="overline" color="error.main">
        参谋推演
      </Typography>
      <Typography variant="h5" gutterBottom>
        选项分析
      </Typography>
      <Grid container spacing={1.5}>
        {renderSetCard('set1', 0)}
        {renderSetCard('set2', 1)}
        {renderSetCard('set3', 2)}
      </Grid>
    </Box>
  );
};

export default AnalysisGrid;
