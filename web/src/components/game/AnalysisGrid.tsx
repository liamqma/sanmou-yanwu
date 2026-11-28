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
import type { UnknownCards } from '../../services/lineupProtocol';
import type {
  CurrentRoundInputs,
  HeroMeta,
  OptionAnalysis,
  RoundType,
  SetName,
  SkillMeta,
} from '../../types/game';
import ResponsiveDisclosure from '../common/ResponsiveDisclosure';
import AutocompleteInput from '../common/AutocompleteInput';
import GameCardArt from '../common/GameCardArt';

interface AnalysisGridProps {
  sets: CurrentRoundInputs;
  /** The best lineup the model finds with each set added to the pool. */
  analysis?: OptionAnalysis[];
  /** Offered or owned cards the model has never seen. */
  unknown?: UnknownCards;
  selectedIndex: number | null;
  recommendedIndex?: number;
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

const TEAM_NAMES = ['队伍一', '队伍二', '队伍三'];
const percent = (value: number): string => `${Math.round(value * 100)}%`;
/** A gap below this rounds to 0.0 and is shown as a tie with the best set. */
const TIE = 0.05;

/**
 * The three round options are both the editor and the analysis surface. Each
 * candidate image is rendered once; recommendation data augments the same card
 * instead of creating a second, duplicated image grid.
 */
const AnalysisGrid = ({
  sets,
  analysis,
  unknown,
  selectedIndex,
  recommendedIndex,
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
  const unknownItems = new Set(roundType === 'hero' ? unknown?.heroes : unknown?.skills);

  const allSelectedItems = [
    ...(sets.set1 || []),
    ...(sets.set2 || []),
    ...(sets.set3 || []),
  ];

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

  /** The three teams the model would field with this set, the set's own cards in bold. */
  const renderLineup = (option: OptionAnalysis, items: string[]) => {
    const mark = (name: string) => (items.includes(name) ? <strong key={name}>{name}</strong> : name);
    return (
      <Box data-testid="option-lineup" sx={{ mb: 1.25, display: 'grid', gap: 0.75 }}>
        {option.teams.map((team, t) => (
          <Box key={TEAM_NAMES[t]}>
            <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              {TEAM_NAMES[t]}
              {team.strength !== null && ` · 胜率 ${percent(team.strength)}`}
            </Typography>
            <Typography variant="caption" component="div" sx={{ lineHeight: 1.5 }}>
              {team.heroes.every((hero) => !hero)
                ? '空'
                : team.heroes.map((hero, slot) => {
                    if (!hero) return null;
                    const skills = team.skills.slice(2 * slot, 2 * slot + 2).filter(Boolean);
                    return (
                      <Box component="span" key={hero} sx={{ display: 'block' }}>
                        {mark(hero)}
                        {skills.length > 0 && '（'}
                        {skills.map((skill, k) => (
                          <span key={skill}>
                            {k > 0 && '、'}
                            {mark(skill)}
                          </span>
                        ))}
                        {skills.length > 0 && '）'}
                      </Box>
                    );
                  })}
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
    const unseen = items.filter((item) => unknownItems.has(item));
    const choices = availableItems.filter(
      (item) => !allSelectedItems.includes(item)
    );

    return (
      <Grid
        size={{ xs: 12, md: 4 }}
        key={setName}
        data-testid="analysis-set-card"
        data-ai-recommended={isRecommended ? 'true' : undefined}
      >
        <Card
          sx={{
            height: '100%',
            border: '1px solid',
            borderColor: isSelected || isRecommended ? 'primary.main' : 'divider',
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

            {unseen.length > 0 && (
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="option-unknown-cards"
                sx={{ mb: 1, display: 'block', textAlign: 'center' }}
              >
                模型没见过{unseen.join('、')}，按未知卡估算
              </Typography>
            )}

            {setAnalysis ? (
              <>
                <Box sx={{ mb: 1.15, textAlign: 'center' }}>
                  <Typography
                    component="p"
                    variant="h4"
                    color={setAnalysis.gap > -TIE ? 'secondary.dark' : 'text.secondary'}
                    data-testid={`option-score-${index}`}
                    sx={{ fontVariantNumeric: 'tabular-nums', fontSize: { xs: 27, lg: 30 } }}
                  >
                    {setAnalysis.gap > -TIE ? (
                      '最优'
                    ) : (
                      <>
                        <Typography component="span" color="text.secondary" sx={{ mr: 0.75, fontSize: 15 }}>
                          比最优低
                        </Typography>
                        {Math.abs(setAnalysis.gap).toFixed(1)}
                      </>
                    )}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    data-testid={`option-strengths-${index}`}
                    sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}
                  >
                    选后三队胜率{' '}
                    {setAnalysis.teams
                      .map((team) => (team.strength === null ? '—' : percent(team.strength)))
                      .join(' / ')}
                  </Typography>
                </Box>

                <ResponsiveDisclosure label={`第${index + 1}组选后阵容`}>
                  {renderLineup(setAnalysis, items)}
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

      <Grid container spacing={1.25} data-testid="three-option-grid">
        {renderSetCard('set1', 0)}
        {renderSetCard('set2', 1)}
        {renderSetCard('set3', 2)}
      </Grid>
    </Box>
  );
};

export default AnalysisGrid;
