import type { ReactNode } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  Chip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import { alpha } from '@mui/material/styles';
import { formatHeroRanking, formatSkillRanking } from '../../utils/itemMetadata';
import type { OptionAnalysis, Contribution } from '../../services/recommendationEngine';
import type { CurrentRoundInputs, SetName, RoundType, HeroMeta, SkillMeta } from '../../types/game';
import type { PreferencePrediction } from '../../types/telemetryData';
import ResponsiveDisclosure from '../common/ResponsiveDisclosure';
import AutocompleteInput from '../common/AutocompleteInput';
import GameCardArt from '../common/GameCardArt';

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
  availableItems?: string[];
  onUpdateSet?: (setName: SetName, items: string[]) => void;
  itemsPerSet?: number;
  disabled?: boolean;
  actions?: ReactNode;
}

/** One-decimal score with an explicit sign (+ for nonnegative, − for negative). */
const fmtSigned = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

const isComboContribution = (contribution: Contribution): boolean =>
  contribution.family === 'HP' ||
  contribution.family === 'HS' ||
  contribution.family === 'SP';

/**
 * The three round options are both the editor and the analysis surface. Each
 * candidate image is rendered once; recommendation data augments the same card
 * instead of creating a second, duplicated image grid.
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
  availableItems = [],
  onUpdateSet,
  itemsPerSet = 3,
  disabled = false,
  actions,
}: AnalysisGridProps) => {
  const hasAnalysis = Boolean(analysis?.length);
  const hasRecommendedIndex =
    typeof recommendedIndex === 'number' &&
    Number.isInteger(recommendedIndex) &&
    recommendedIndex >= 0 &&
    recommendedIndex < 3;
  const hasMeaningfulDisagreement =
    preference !== null &&
    hasRecommendedIndex &&
    preference.top_index !== recommendedIndex &&
    preference.probability_margin >= preference.meaningful_margin;
  const optionLetter = (index: number) => String.fromCharCode(65 + index);
  const preferenceExplanation =
    preference &&
    hasMeaningfulDisagreement &&
    typeof recommendedIndex === 'number'
      ? `AI 按当前阵容强度推荐 ${optionLetter(recommendedIndex)}；玩家选择模型认为 ${optionLetter(preference.top_index)} 更常被选（${(preference.probabilities[preference.top_index] * 100).toFixed(1)}%）。${preference.explanation_driver} 这描述玩家偏好，不会改变 AI 推荐。`
      : null;

  const allSelectedItems = [
    ...(sets.set1 || []),
    ...(sets.set2 || []),
    ...(sets.set3 || []),
  ];

  const combinationEvidence = (option?: OptionAnalysis): Contribution[] => {
    if (!option) return [];
    return [...option.combo_synergies, ...option.combo_tradeoffs]
      .filter(isComboContribution)
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 3);
  };

  const itemChipLabel = (item: string) => {
    if (roundType === 'hero') {
      const tag = formatHeroRanking(heroMetadata?.[item]);
      return tag ? `${item} · ${tag}` : item;
    }
    const tag = formatSkillRanking(skillMetadata?.[item]);
    return tag ? `${item} · ${tag}` : item;
  };

  const handleAddItem = (setName: SetName, item: string) => {
    const currentSet = sets[setName] || [];
    if (
      onUpdateSet &&
      currentSet.length < itemsPerSet &&
      !currentSet.includes(item)
    ) {
      onUpdateSet(setName, [...currentSet, item]);
    }
  };

  const handleRemoveItem = (setName: SetName, item: string) => {
    if (!onUpdateSet) return;
    onUpdateSet(
      setName,
      (sets[setName] || []).filter((candidate) => candidate !== item)
    );
  };

  const renderContributions = (items: Contribution[]) => {
    if (!items.length) return null;
    return (
      <Box
        data-testid="combination-evidence"
        sx={{ mb: 1.25, display: 'grid', gap: 0.4 }}
      >
        {items.map((contribution) => (
          <Box
            key={contribution.featureId}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              px: 0.75,
              py: 0.4,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'rgba(255,253,247,.66)',
            }}
          >
            <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
              {contribution.label}
            </Typography>
            <Typography
              variant="caption"
              color={contribution.weight >= 0 ? 'success.dark' : 'error.main'}
              sx={{ flexShrink: 0, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}
            >
              {fmtSigned(contribution.weight * 10)}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  };

  const renderSetCard = (setName: SetName, index: number) => {
    const items = sets[setName] || [];
    const setAnalysis = analysis?.find((option) => option.set_index === index);
    const isSelected = selectedIndex === index;
    const isRecommended = recommendedIndex === index;
    const isPreferenceTop = preference?.top_index === index;
    const gain = setAnalysis?.final_score;
    const comboEvidence = combinationEvidence(setAnalysis);
    const choices = availableItems.filter(
      (item) => !allSelectedItems.includes(item)
    );

    return (
      <Grid
        size={{ xs: 12, md: 4 }}
        key={setName}
        data-testid="analysis-set-card"
        data-ai-recommended={isRecommended ? 'true' : undefined}
        data-player-choice-top={isPreferenceTop ? 'true' : undefined}
      >
        <Card
          sx={{
            height: '100%',
            border: '1px solid',
            borderColor: isSelected || isRecommended ? 'primary.main' : 'divider',
            outline: isPreferenceTop ? '2px solid' : 'none',
            outlineColor: 'info.main',
            outlineOffset: '-2px',
            position: 'relative',
            bgcolor: isSelected
              ? alpha('#456c5f', 0.13)
              : isRecommended
                ? alpha('#456c5f', 0.075)
                : 'background.paper',
            boxShadow: isRecommended
              ? '0 0 0 1px rgba(69,108,95,.2), 0 12px 30px rgba(44,41,30,.09)'
              : '0 8px 22px rgba(44,41,30,.055)',
          }}
        >
          <Box sx={{ position: 'absolute', top: 10, right: 10, left: 10, height: 26, zIndex: 2 }}>
            {isRecommended && (
              <Chip
                icon={<StarIcon />}
                label="AI 推荐"
                color="error"
                variant="outlined"
                size="small"
                sx={{ position: 'absolute', top: 0, right: 0, bgcolor: 'background.paper' }}
              />
            )}
            {isSelected && (
              <Chip
                icon={<CheckCircleIcon />}
                label="已选"
                color="success"
                size="small"
                sx={{ position: 'absolute', top: 0, left: 0 }}
              />
            )}
          </Box>

          <CardContent sx={{ pt: 4.5, px: { xs: 1.5, lg: 1.75 } }}>
            <Typography component="h3" variant="h6" sx={{ mb: 1, textAlign: 'center' }}>
              第 {index + 1} 组{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                ({items.length}/{itemsPerSet})
              </Typography>
            </Typography>

            {onUpdateSet && (
              <Box sx={{ mb: 1.1 }}>
                <AutocompleteInput
                  items={choices}
                  selectedItems={items}
                  onAdd={(item) => handleAddItem(setName, item)}
                  label={roundType === 'hero' ? '输入武将名或拼音搜索武将' : '输入战法名或拼音搜索战法'}
                  placeholder={roundType === 'hero' ? '输入武将名或拼音搜索武将' : '输入战法名或拼音搜索战法'}
                  maxItems={itemsPerSet}
                  disabled={disabled || items.length >= itemsPerSet}
                  heroMetadata={roundType === 'hero' ? heroMetadata : null}
                  skillMetadata={roundType === 'skill' ? skillMetadata : null}
                />
              </Box>
            )}

            <Box
              data-testid="game-card-list"
              data-card-layout="portrait-grid"
              sx={{
                mb: 1.25,
                minHeight: { xs: 150, md: 132 },
                minWidth: 0,
                display: 'grid',
                gridTemplateColumns: `repeat(${itemsPerSet}, minmax(0, 1fr))`,
                alignItems: 'start',
                gap: { xs: 0.75, lg: 0.9 },
                p: 0.75,
                border: '1px dashed',
                borderColor: 'divider',
                bgcolor: 'rgba(255,253,247,.5)',
              }}
            >
              {items.map((item) => {
                const itemScore = setAnalysis?.item_scores?.find((score) => score.item === item);
                const rankingLabel = itemChipLabel(item);
                return (
                  <Box key={item} sx={{ minWidth: 0 }}>
                    <GameCardArt
                      name={item}
                      kind={roundType === 'hero' ? 'hero' : 'tactic'}
                      size="mini"
                      ranking={rankingLabel === item ? null : rankingLabel}
                      onRemove={onUpdateSet ? () => handleRemoveItem(setName, item) : undefined}
                    />
                    {rankingLabel !== item && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mt: 0.35, display: 'block', textAlign: 'center', lineHeight: 1.2 }}
                      >
                        {rankingLabel}
                      </Typography>
                    )}
                    {itemScore && (
                      <Typography
                        variant="caption"
                        color={itemScore.score >= 0 ? 'success.dark' : 'error.main'}
                        sx={{ mt: 0.35, display: 'block', textAlign: 'center', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}
                      >
                        单项 {fmtSigned(itemScore.score)}
                      </Typography>
                    )}
                  </Box>
                );
              })}
              {Array.from({ length: Math.max(0, itemsPerSet - items.length) }).map((_, emptyIndex) => (
                <Box
                  key={`empty-${emptyIndex}`}
                  sx={{
                    aspectRatio: '160 / 248',
                    border: '1px dashed',
                    borderColor: 'divider',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'text.disabled',
                    fontSize: 12,
                    textAlign: 'center',
                    px: 0.5,
                  }}
                >
                  待录入
                </Box>
              ))}
            </Box>

            {typeof gain === 'number' ? (
              <>
                <Box sx={{ mb: 1.15, textAlign: 'center' }}>
                  <Typography
                    component="p"
                    variant="h4"
                    color={gain >= 0 ? 'secondary.dark' : 'error.main'}
                    data-testid={`option-score-${index}`}
                    sx={{ fontVariantNumeric: 'tabular-nums', fontSize: { xs: 27, lg: 30 } }}
                  >
                    <Typography component="span" color="text.secondary" sx={{ mr: 0.75, fontSize: 15 }}>
                      评分：
                    </Typography>
                    {fmtSigned(gain)}
                  </Typography>
                  {preference && (
                    <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                      <Typography
                        variant="body2"
                        color="info.dark"
                        data-testid={`option-preference-${index}`}
                        sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}
                      >
                        玩家选择概率：{(preference.probabilities[index] * 100).toFixed(1)}%
                      </Typography>
                      {isPreferenceTop && <Chip label="玩家选择最高" color="info" size="small" variant="outlined" />}
                    </Box>
                  )}
                </Box>

                <ResponsiveDisclosure label={`第${index + 1}组详细分析`}>
                  {renderContributions(comboEvidence) ?? (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                      暂无关键组合依据。
                    </Typography>
                  )}
                </ResponsiveDisclosure>
              </>
            ) : (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.25, minHeight: 24, textAlign: 'center' }}
              >
                {items.length === itemsPerSet ? '待重新分析' : `还需 ${itemsPerSet - items.length} 项`}
              </Typography>
            )}

            <Button
              variant={isSelected || isRecommended ? 'contained' : 'outlined'}
              color="primary"
              fullWidth
              onClick={() => onSelectSet(index)}
              disabled={!setAnalysis}
              startIcon={isSelected ? <CheckCircleIcon /> : undefined}
            >
              {isSelected ? '已选' : '选择本组'}
            </Button>
          </CardContent>
        </Card>
      </Grid>
    );
  };

  return (
    <Box
      component="section"
      aria-label="本轮三组选项"
      sx={{ mb: 2.5 }}
    >
      <Box
        sx={{
          mb: 1.25,
          display: 'flex',
          alignItems: { xs: 'stretch', sm: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 1,
        }}
      >
        <Box>
          <Typography variant="overline" color="error.main">
            {hasAnalysis ? '选项分析' : '三组选项常驻编辑'}
          </Typography>
          <Typography id="round-options-title" component="h2" variant="h5">
            本轮选择
          </Typography>
        </Box>
        {actions && <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>{actions}</Box>}
      </Box>

      {preferenceExplanation && (
        <Box
          sx={{
            mb: 1.25,
            px: 1.25,
            py: 1,
            bgcolor: 'info.light',
            color: 'info.dark',
            border: '1px solid',
            borderColor: 'info.main',
          }}
          data-testid="preference-disagreement"
        >
          <Typography variant="body2" color="inherit">
            {preferenceExplanation}
          </Typography>
        </Box>
      )}

      <Grid container spacing={1.25} data-testid="three-option-grid">
        {renderSetCard('set1', 0)}
        {renderSetCard('set2', 1)}
        {renderSetCard('set3', 2)}
      </Grid>

    </Box>
  );
};

export default AnalysisGrid;
