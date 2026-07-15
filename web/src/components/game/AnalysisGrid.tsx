import { Grid, Card, CardContent, Typography, Button, Box, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
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

/** One-decimal fire score with an explicit sign for gains. */
const fmtScore = (x: number): string => x.toFixed(1);
const fmtGain = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

/**
 * A compact horizontal "fire" bar whose length is proportional to `value` on a
 * scale shared by every bar in the round (`min`..`max`). This lets the player
 * eyeball the current pool against each projected choice directly.
 *
 * Built purely from MUI/CSS + the LocalFireDepartment icon — no image assets.
 * Negative and equal values are handled safely (a tiny minimum fill is always
 * shown so a bar never disappears).
 */
const FireScoreBar = ({
  value,
  min,
  max,
  highlight = false,
  ariaLabel,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  highlight?: boolean;
  ariaLabel: string;
  testId?: string;
}) => {
  const span = max - min;
  const raw = span > 0 ? (value - min) / span : 1;
  // Always keep a sliver visible so equal/negative values still render a bar.
  const pct = Math.max(6, Math.min(100, raw * 100));
  return (
    <Box
      data-testid={testId}
      role="img"
      aria-label={ariaLabel}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', minWidth: 0 }}
    >
      <LocalFireDepartmentIcon
        fontSize="small"
        sx={{ color: highlight ? 'warning.main' : 'error.main', flexShrink: 0 }}
      />
      <Box
        sx={{
          position: 'relative',
          flexGrow: 1,
          height: 10,
          borderRadius: 5,
          bgcolor: 'action.hover',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            borderRadius: 5,
            background: highlight
              ? 'linear-gradient(90deg, #ff9800, #f4511e)'
              : 'linear-gradient(90deg, #ef9a9a, #e53935)',
            transition: 'width 200ms ease',
          }}
        />
      </Box>
      <Typography variant="body2" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>
        {fmtScore(value)}
      </Typography>
    </Box>
  );
};

/**
 * Display 3 option sets as cards, each showing the pool's *fire score* after
 * picking that option, the round's gain, and a comparable fire bar. A full-width
 * baseline bar for the current pool sits above the cards; all four bars share one
 * scale so their lengths are directly comparable within the round.
 *
 * The fire score is only a within-round comparison number — it is not an
 * opponent win probability and no opponent is involved.
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

  // Shared fire-score scale across the current baseline + all projected choices.
  const currentScore = analysis?.[0]?.current_score;
  const projectedScores = (analysis ?? [])
    .map((a) => a.projected_score)
    .filter((v): v is number => typeof v === 'number');
  const scaleValues = [
    ...(typeof currentScore === 'number' ? [currentScore] : []),
    ...projectedScores,
  ];
  const scaleMin = scaleValues.length ? Math.min(...scaleValues) : 0;
  const scaleMax = scaleValues.length ? Math.max(...scaleValues) : 1;

  const itemChipLabel = (item: string) => {
    if (roundType === 'hero') {
      const tag = formatHeroRank(heroMetadata?.[item]);
      return tag ? `${item} · ${tag}` : item;
    }
    const tier = formatSkillTier(skillMetadata?.[item]);
    return tier ? `${item} · ${tier}` : item;
  };

  /** Plain-language evidence line from the weakest supporting feature. */
  const evidenceLine = (minSupport: number): string =>
    minSupport > 0
      ? `数据参考：这些加减分项在历史对局中最少出现 ${minSupport} 场。`
      : '数据参考：可用历史对局数据较少，仅供参考。';

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
              {c.weight >= 0 ? '+' : '−'}{Math.abs(c.weight * 10).toFixed(1)} · 参考 {c.support} 场
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

    const projected = setAnalysis?.projected_score;
    const gain = setAnalysis?.final_score;

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

              {typeof projected === 'number' && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    选择后火力
                  </Typography>
                  <Typography component="p" variant="h4" color="primary">
                    {fmtScore(projected)}
                  </Typography>
                  {typeof gain === 'number' && (
                    <Typography
                      variant="body2"
                      color={gain >= 0 ? 'success.main' : 'error.main'}
                      sx={{ fontWeight: 'bold' }}
                    >
                      本轮增加 {fmtGain(gain)}
                    </Typography>
                  )}
                  <Box sx={{ mt: 1 }}>
                    <FireScoreBar
                      value={projected}
                      min={scaleMin}
                      max={scaleMax}
                      highlight={isRecommended}
                      testId={`fire-bar-option-${index}`}
                      ariaLabel={`第${index + 1}组选择后火力 ${fmtScore(projected)}，本轮增加 ${fmtGain(gain ?? 0)}`}
                    />
                  </Box>
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
              <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                  推荐理由:
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  选择后火力：{typeof projected === 'number' ? fmtScore(projected) : '—'}
                  {typeof gain === 'number' ? `（本轮增加 ${fmtGain(gain)}）` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  {setAnalysis ? evidenceLine(setAnalysis.evidence.minSupport) : '—'}
                </Typography>
              </Box>
              {renderContributions('主要加分项:', setAnalysis?.synergies ?? [])}
              {renderContributions('可能减分项:', setAnalysis?.tradeoffs ?? [])}
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

      {typeof currentScore === 'number' && (
        <Card
          data-testid="fire-baseline-card"
          sx={{ mb: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
        >
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle2" gutterBottom>
              当前阵容火力
            </Typography>
            <FireScoreBar
              value={currentScore}
              min={scaleMin}
              max={scaleMax}
              testId="fire-bar-current"
              ariaLabel={`当前阵容火力 ${fmtScore(currentScore)}`}
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
              火力分只用于比较当前阵容和本轮三个选项，越高越好。
            </Typography>
          </CardContent>
        </Card>
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
