import { Grid, Card, CardContent, Typography, Button, Box, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import { formatHeroRank, formatSkillTier } from '../../utils/itemMetadata';
import type { OptionAnalysis, Contribution } from '../../services/recommendationEngine';
import type { CurrentRoundInputs, SetName, RoundType, HeroMeta, SkillMeta } from '../../types/game';
import ResponsiveDisclosure from '../common/ResponsiveDisclosure';

interface AnalysisGridProps {
  sets: CurrentRoundInputs;
  /** Per-option roster-strength analysis (see recommendationEngine.OptionAnalysis). */
  analysis?: OptionAnalysis[];
  selectedIndex: number | null;
  recommendedIndex?: number;
  onSelectSet: (index: number) => void;
  roundType: RoundType;
  heroMetadata?: Record<string, HeroMeta> | null;
  skillMetadata?: Record<string, SkillMeta> | null;
}

/** Qualitative evidence label from the weakest supporting feature. */
const evidenceLabel = (minSupport: number): { text: string; color: 'success' | 'warning' | 'default' } => {
  if (minSupport >= 40) return { text: '证据充分', color: 'success' };
  if (minSupport >= 12) return { text: '证据中等', color: 'warning' };
  return { text: '证据有限', color: 'default' };
};

/**
 * Display 3 option sets as cards. Each card shows the option's *marginal relative
 * roster-strength improvement* over the current pool (not an opponent win
 * probability), plus the key synergies/tradeoffs it unlocks and the evidence
 * behind them.
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

  const itemChipLabel = (item: string) => {
    if (roundType === 'hero') {
      const tag = formatHeroRank(heroMetadata?.[item]);
      return tag ? `${item} · ${tag}` : item;
    }
    const tier = formatSkillTier(skillMetadata?.[item]);
    return tier ? `${item} · ${tier}` : item;
  };

  const renderContributions = (title: string, items: Contribution[]) => {
    if (!items || items.length === 0) return null;
    return (
      <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
          {title}
        </Typography>
        {items.map((c, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
            <Chip label={c.label} size="small" color={c.weight >= 0 ? itemColor : 'default'} variant="outlined" />
            <Typography variant="body2" color={c.weight >= 0 ? 'success.main' : 'error.main'} sx={{ ml: 1 }}>
              {c.weight >= 0 ? '+' : ''}{(c.weight * 10).toFixed(1)} · {c.support}场
            </Typography>
          </Box>
        ))}
      </Box>
    );
  };

  const renderSetCard = (setName: SetName, index: number) => {
    const items = sets[setName] || [];
    const setAnalysis = analysis?.find((a) => a.set_index === index);
    const isSelected = selectedIndex === index;
    const isRecommended = recommendedIndex === index;

    if (items.length === 0) {
      return null;
    }

    const ev = setAnalysis ? evidenceLabel(setAnalysis.evidence.minSupport) : null;

    return (
      <Grid size={{ xs: 12, md: 4 }} key={setName} data-testid="analysis-set-card">
        <Card
          sx={{
            height: '100%',
            border: 1,
            borderLeft: '5px solid',
            borderColor: isSelected ? 'success.main' : isRecommended ? 'warning.main' : 'divider',
            position: 'relative',
            bgcolor: isSelected ? 'rgba(223,232,226,0.72)' : isRecommended ? 'rgba(240,229,207,0.4)' : 'background.paper',
            transition: 'transform 160ms ease, background-color 160ms ease',
            '&:hover': { transform: 'translateY(-3px)' },
          }}
        >
          <Box sx={{ position: 'absolute', top: 8, right: 8, left: 8, height: 32, zIndex: 1 }}>
            {isRecommended && (
              <Chip icon={<StarIcon />} label="AI 推荐" color="warning" size="small" sx={{ position: 'absolute', top: 0, right: 0 }} />
            )}
            {isSelected && (
              <Chip icon={<CheckCircleIcon />} label="已选" color="success" size="small" sx={{ position: 'absolute', top: 0, left: 0 }} />
            )}
          </Box>

          <CardContent sx={{ pt: 5 }}>
            <Box>
              <Typography variant="overline" color="text.secondary">OPTION {String.fromCharCode(65 + index)}</Typography>
              <Typography component="h3" variant="h5" gutterBottom>
                第{index + 1}组
              </Typography>

              {setAnalysis?.final_score !== undefined && (
                <Box sx={{ mb: 2 }}>
                  <Typography component="p" variant="h4" color="primary">
                    {setAnalysis.final_score >= 0 ? '+' : ''}{setAnalysis.final_score.toFixed(1)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    阵容强度提升
                  </Typography>
                  {ev && (
                    <Box sx={{ mt: 0.5 }}>
                      <Chip label={ev.text} color={ev.color} size="small" variant="outlined" />
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            <Box sx={{ mb: 2, minWidth: 0 }}>
              <Typography component="div" variant="subtitle2" gutterBottom>
                {roundType === 'hero' ? '武将评分:' : '战法评分:'}
              </Typography>
              {items.map((item, idx) => {
                const itemScore = setAnalysis?.item_scores?.find((s) => s.item === item);
                return (
                  <Box key={idx} sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Chip label={itemChipLabel(item)} color={itemColor} size="small" />
                    {itemScore && (
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                        {itemScore.score >= 0 ? '+' : ''}{itemScore.score.toFixed(1)}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>

            <ResponsiveDisclosure label={`第${index + 1}组详细分析`}>
              <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                  评分详情:
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  相对阵容强度提升：{setAnalysis ? (setAnalysis.final_score >= 0 ? '+' : '') + setAnalysis.final_score.toFixed(1) : '—'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  证据：{setAnalysis ? `${setAnalysis.evidence.featureCount} 项特征 · 最低 ${setAnalysis.evidence.minSupport} 场` : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  分数为相对当前阵容的强度提升，非对特定对手的胜率。
                </Typography>
              </Box>
              {renderContributions('关键协同:', setAnalysis?.synergies ?? [])}
              {renderContributions('潜在取舍:', setAnalysis?.tradeoffs ?? [])}
            </ResponsiveDisclosure>

            <Button
              variant={isSelected ? 'contained' : 'outlined'}
              color={isSelected ? 'success' : 'primary'}
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
      <Typography component="h2" variant="h5" gutterBottom>
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
