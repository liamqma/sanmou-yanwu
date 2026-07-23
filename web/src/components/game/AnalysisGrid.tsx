import { Grid, Card, CardContent, Typography, Button, Box, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import { formatHeroRank, formatSkillTier } from '../../utils/itemMetadata';
import type { OptionAnalysis, Contribution } from '../../services/recommendationEngine';
import type { CurrentRoundInputs, SetName, RoundType, HeroMeta, SkillMeta } from '../../types/game';
import type { PreferencePrediction } from '../../types/telemetryData';
import ResponsiveDisclosure from '../common/ResponsiveDisclosure';

interface AnalysisGridProps {
  sets: CurrentRoundInputs;
  /** Per-option roster-strength analysis (see recommendationEngine.OptionAnalysis). */
  analysis?: OptionAnalysis[];
  selectedIndex: number | null;
  recommendedIndex?: number;
  preference?: PreferencePrediction | null;
  onSelectSet: (index: number) => void;
  roundType: RoundType;
  heroMetadata?: Record<string, HeroMeta> | null;
  skillMetadata?: Record<string, SkillMeta> | null;
}

/** One-decimal score with an explicit sign (+ for nonnegative, − for negative). */
const fmtSigned = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

/**
 * Display 3 option sets as cards. Each card shows the option's per-round score
 * (`评分：±X`, one decimal) — the marginal roster-strength gain that option adds
 * to the current pool. Ranking is by that score; higher is better. This is an
 * opponent-free within-round comparison number, not a win probability.
 */
const AnalysisGrid = ({
  sets,
  analysis,
  selectedIndex,
  recommendedIndex,
  preference = null,
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
              {c.weight >= 0 ? '+' : '−'}{Math.abs(c.weight * 10).toFixed(1)}
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
    const isPreferenceTop = preference?.top_index === index;
    const hasMeaningfulDisagreement =
      preference !== null &&
      preference.top_index !== recommendedIndex &&
      preference.probability_margin >= preference.meaningful_margin;

    if (items.length === 0) {
      return null;
    }

    const gain = setAnalysis?.final_score;
    const comboSynergies = setAnalysis?.combo_synergies ?? [];

    return (
      <Grid size={{ xs: 12, md: 4 }} key={setName} data-testid="analysis-set-card">
        <Card
          sx={{
            height: '100%',
            border: 1,
            borderLeft: '5px solid',
            borderColor: isSelected ? 'success.main' : isRecommended ? 'warning.main' : 'divider',
            outline:
              isPreferenceTop && hasMeaningfulDisagreement
                ? '2px solid'
                : 'none',
            outlineColor: 'info.main',
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

              {typeof gain === 'number' && (
                <Box sx={{ mb: 2 }}>
                  <Typography
                    component="p"
                    variant="h4"
                    color={gain >= 0 ? 'success.main' : 'error.main'}
                    data-testid={`option-score-${index}`}
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    评分：{fmtSigned(gain)}
                  </Typography>
                  {preference && (
                    <Box
                      sx={{
                        mt: 0.75,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Typography
                        variant="body2"
                        color="info.main"
                        data-testid={`option-preference-${index}`}
                        sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                      >
                        玩家选择概率：{(preference.probabilities[index] * 100).toFixed(1)}%
                      </Typography>
                      {isPreferenceTop && (
                        <Chip
                          label="玩家偏好最高"
                          color="info"
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            <Box sx={{ mb: 2, minWidth: 0 }}>
              <Typography component="div" variant="subtitle2" gutterBottom>
                单项加分:
              </Typography>
              {items.map((item, idx) => {
                const itemScore = setAnalysis?.item_scores?.find((s) => s.item === item);
                return (
                  <Box key={idx} sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Chip label={itemChipLabel(item)} color={itemColor} size="small" />
                    {itemScore && (
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                        {itemScore.score >= 0 ? '+' : '−'}{Math.abs(itemScore.score).toFixed(1)}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>

            <ResponsiveDisclosure label={`第${index + 1}组详细分析`}>
              {renderContributions('组合加分项:', comboSynergies) ?? (
                <Typography variant="body2" color="text.secondary">
                  暂无明显加分项。
                </Typography>
              )}
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
      {preference &&
        preference.top_index !== recommendedIndex &&
        preference.probability_margin >= preference.meaningful_margin && (
          <Typography
            variant="body2"
            color="info.main"
            sx={{ mb: 1.5 }}
            data-testid="preference-disagreement"
          >
            AI 评分推荐与玩家偏好模型的首选不同；AI 推荐仍只由阵容评分决定。
          </Typography>
        )}

      <Grid container spacing={1.5}>
        {renderSetCard('set1', 0)}
        {renderSetCard('set2', 1)}
        {renderSetCard('set3', 2)}
      </Grid>
    </Box>
  );
};

export default AnalysisGrid;
