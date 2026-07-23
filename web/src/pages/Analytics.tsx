import { useState, useEffect, useMemo, type ReactNode } from 'react';
import {
  Container,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  CircularProgress,
  Paper,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import LinkIcon from '@mui/icons-material/Link';
import ClearIcon from '@mui/icons-material/Clear';
import InsightsIcon from '@mui/icons-material/Insights';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GroupsIcon from '@mui/icons-material/Groups';
import BarChartIcon from '@mui/icons-material/BarChart';
import { api } from '../services/api';
import { database } from '../data';
import { tierRank } from '../utils/tiers';
import AutocompleteInput from '../components/common/AutocompleteInput';
import TagList from '../components/common/TagList';
import ResponsiveDisclosure from '../components/common/ResponsiveDisclosure';
import type { HeroMeta, SkillMeta } from '../types/game';
import type { AnalyticsResult } from '../services/recommendationEngine';
import type { TelemetryData, TelemetryItemAggregate } from '../types/telemetryData';
import { loadTelemetryData } from '../services/telemetryData';

interface ScrollableAnalyticsTableProps {
  children: ReactNode;
  label: string;
}

const ScrollableAnalyticsTable = ({ children, label }: ScrollableAnalyticsTableProps) => (
  <>
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ display: { xs: 'block', sm: 'none' }, mb: 0.75 }}
    >
      表格可横向滚动，聚焦后也可使用键盘滚动。
    </Typography>
    <TableContainer
      role="region"
      aria-label={`${label}表格，可滚动`}
      tabIndex={0}
      sx={{ maxHeight: 800 }}
    >
      {children}
    </TableContainer>
  </>
);

const pct = (x: number | null | undefined): string =>
  x == null ? '-' : `${(x * 100).toFixed(1)}%`;

/**
 * Format a relative roster-strength contribution (a model coefficient, NOT a
 * percentage). Positive values get a leading '+' so players can read "helps"
 * vs "hurts" at a glance; the underlying value and precision are unchanged.
 */
const fmtStrength = (x: number, dp = 3): string => {
  const s = x.toFixed(dp);
  return x > 0 ? `+${s}` : s;
};

/** Small keyboard/touch-accessible help affordance next to a label. */
const HelpTip = ({ title, label }: { title: string; label: string }) => (
  <Tooltip title={title} enterTouchDelay={0} leaveTouchDelay={4000}>
    <IconButton
      size="small"
      aria-label={label}
      sx={{ ml: 0.5, color: 'text.secondary' }}
    >
      <HelpOutlineIcon fontSize="inherit" />
    </IconButton>
  </Tooltip>
);

const supportedPct = (
  numerator: number,
  denominator: number,
  suppressed: boolean
): string => {
  if (suppressed || denominator === 0) return '样本不足';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
};

type TelemetryItemFamily = 'heroes' | 'skills';
type TelemetryRankingMetric = 'offer_count' | 'picked_count';

const compareTelemetryNames = (
  left: TelemetryItemAggregate,
  right: TelemetryItemAggregate
): number => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

const topTelemetryItems = (
  rows: TelemetryItemAggregate[],
  metric: TelemetryRankingMetric
): TelemetryItemAggregate[] =>
  rows
    .slice()
    .sort(
      (left, right) =>
        right[metric] - left[metric] || compareTelemetryNames(left, right)
    )
    .slice(0, 5);

const TelemetryRankingCard = ({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: TelemetryItemAggregate[];
  metric: TelemetryRankingMetric;
}) => {
  const rankedRows = topTelemetryItems(rows, metric);
  const isOfferRanking = metric === 'offer_count';
  const maximumCount = rankedRows[0]?.[metric] ?? 0;
  const barMaximum = Math.max(maximumCount, 1);

  return (
    <Card
      data-testid={
        isOfferRanking
          ? 'telemetry-ranking-offers'
          : 'telemetry-ranking-picks'
      }
      sx={{ height: '100%' }}
    >
      <CardContent>
        <Typography component="h3" variant="h6" gutterBottom>
          {title}
        </Typography>
        <Box
          component="ol"
          aria-label={`${title}前五名`}
          sx={{ listStyle: 'none', p: 0, m: 0 }}
        >
          {rankedRows.map((row, index) => {
            const count = row[metric];
            const rate = isOfferRanking
              ? supportedPct(
                  row.offer_count,
                  row.opportunity_count,
                  row.rate_suppressed
                )
              : supportedPct(
                  row.picked_count,
                  row.offer_count,
                  row.rate_suppressed
                );
            const rateLabel = isOfferRanking ? '提供率' : '提供后选择率';

            return (
              <Box
                component="li"
                data-testid="telemetry-ranking-row"
                key={row.name}
                sx={{
                  py: 1.25,
                  borderTop: index === 0 ? 0 : '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 1,
                    minWidth: 0,
                  }}
                >
                  <Typography
                    aria-hidden="true"
                    variant="caption"
                    color="text.secondary"
                    sx={{ width: 18, flexShrink: 0, fontWeight: 700 }}
                  >
                    {index + 1}
                  </Typography>
                  <Typography
                    data-testid="telemetry-ranking-name"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.name}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ flexShrink: 0, fontWeight: 800 }}
                  >
                    {count} 次
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', ml: '26px', mt: 0.25 }}
                >
                  {rateLabel} {rate}
                </Typography>
                <Box
                  role="progressbar"
                  aria-label={`${row.name}${isOfferRanking ? '提供' : '选择'}次数相对条`}
                  aria-valuemin={0}
                  aria-valuemax={barMaximum}
                  aria-valuenow={count}
                  sx={{
                    height: 6,
                    mt: 0.75,
                    ml: '26px',
                    overflow: 'hidden',
                    bgcolor: 'action.selected',
                    borderRadius: 999,
                  }}
                >
                  <Box
                    sx={{
                      width: `${(count / barMaximum) * 100}%`,
                      height: '100%',
                      bgcolor: isOfferRanking
                        ? 'primary.main'
                        : 'secondary.main',
                      borderRadius: 'inherit',
                    }}
                  />
                </Box>
              </Box>
            );
          })}
          {rankedRows.length === 0 && (
            <Typography
              component="li"
              variant="body2"
              color="text.secondary"
              sx={{ py: 2 }}
            >
              暂无选择记录
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

const TelemetryAnalyticsSection = ({
  telemetry,
}: {
  telemetry: TelemetryData;
}) => {
  const analytics = telemetry.analytics;
  const [itemFamily, setItemFamily] =
    useState<TelemetryItemFamily>('heroes');

  if (!analytics) return null;

  const rows = analytics.items[itemFamily];

  return (
    <Box sx={{ mb: 5 }} data-testid="player-choice-analytics">
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 0.75,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InsightsIcon sx={{ color: 'info.main' }} />
          <Typography component="h2" variant="h5">
            玩家最关心的选择排行
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={itemFamily}
          exclusive
          size="small"
          aria-label="玩家选择排行类型"
          onChange={(_, nextFamily: TelemetryItemFamily | null) => {
            if (nextFamily) setItemFamily(nextFamily);
          }}
          sx={{
            '& .MuiToggleButton-root': {
              minHeight: 32,
              px: 1.75,
              py: 0.25,
            },
          }}
        >
          <ToggleButton value="heroes" aria-label="武将">
            武将
          </ToggleButton>
          <ToggleButton value="skills" aria-label="战法">
            战法
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        匿名选项记录只描述系统提供了什么、玩家看到后选择了什么；它不是胜率，也不会改变
        AI 的阵容评分推荐。少于 {analytics.minimum_rate_support} 次提供时隐藏百分比，
        但仍显示次数。
      </Typography>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 6 }}>
          <TelemetryRankingCard
            title="系统最常提供"
            rows={rows}
            metric="offer_count"
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TelemetryRankingCard
            title="玩家最常选择"
            rows={rows}
            metric="picked_count"
          />
        </Grid>
      </Grid>
    </Box>
  );
};

const Analytics = () => {
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHeroes, setSelectedHeroes] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  const heroMetadata = useMemo<Record<string, HeroMeta>>(() => Object.fromEntries(
    Object.entries(database.heroes || {}).map(([name, hero]) => [name, { label: hero.label, rank: hero.rank }])
  ), []);
  const skillMetadata = useMemo<Record<string, SkillMeta>>(() => Object.fromEntries(
    Object.entries(database.skills || {}).map(([name, skill]) => [name, { tier: skill.tier, note: skill.note }])
  ), []);

  // A skill shown in 全部战法 is a 影 (transferred/split) skill — i.e. it is
  // being carried by a hero for whom it is *not* an equippable draft skill —
  // in either of two cases:
  //
  //   1. It is an orange hero's innate (自带) skill: database.heroes[*].skill
  //      records these. Its own carrier's usage is already excluded by the data
  //      builder, so any appearance here is a transfer onto another hero.
  //   2. It is not present in database.skills at all. The database only catalogs
  //      orange heroes and their orange skills; a skill missing from the catalog
  //      therefore belongs to a non-orange (uncatalogued) hero, which means it
  //      can only be appearing here as a transferred 影 skill (e.g. 曲辞谄媚,
  //      猿臂善射).
  //
  // We tag these rows with a "影 ·" prefix so it is clear the count reflects
  // only the draftable (non-innate) usage.
  const innateOrangeSkillSet = useMemo<Set<string>>(() => new Set(
    Object.values(database.heroes || {})
      .map((hero) => hero.skill)
      .filter((s): s is string => Boolean(s))
  ), []);
  const isShadowSkill = useMemo(
    () => (name: string): boolean =>
      innateOrangeSkillSet.has(name) || !(name in (database.skills || {})),
    [innateOrangeSkillSet]
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setData(await api.getAnalytics());
        setError(null);
      } catch (err) {
        setError('加载数据失败：' + (err as Error).message);
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
    void loadTelemetryData()
      .then(setTelemetry)
      .catch((telemetryError) => {
        console.warn('Player-choice telemetry is unavailable', telemetryError);
      });
  }, []);

  const allHeroNames = useMemo(() => {
    if (!data) return [];
    return data.heroes.map((h) => h.name).sort((a, b) => {
      const ha = heroMetadata[a] || {};
      const hb = heroMetadata[b] || {};
      const la = ha.label || '未分类';
      const lb = hb.label || '未分类';
      if (la !== lb) return la.localeCompare(lb, 'zh-Hans-CN');
      const ra = typeof ha.rank === 'number' ? ha.rank : Number.MAX_SAFE_INTEGER;
      const rb = typeof hb.rank === 'number' ? hb.rank : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b, 'zh-Hans-CN');
    });
  }, [data, heroMetadata]);

  const allSkillNames = useMemo(() => {
    if (!data) return [];
    return data.skills.map((s) => s.name).sort((a, b) => {
      const ta = tierRank(skillMetadata[a]?.tier);
      const tb = tierRank(skillMetadata[b]?.tier);
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b, 'zh-Hans-CN');
    });
  }, [data, skillMetadata]);

  if (loading) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 4 }}><Alert severity="error">{error}</Alert></Box>
      </Container>
    );
  }

  if (!data) return null;

  const heroFilterSet = new Set(selectedHeroes);
  const skillFilterSet = new Set(selectedSkills);
  const hasHeroFilter = selectedHeroes.length > 0;
  const hasSkillFilter = selectedSkills.length > 0;

  // Rank the individual hero/skill tables by 胜率参考 (smoothed win rate) descending,
  // with deterministic tie-breakers (reference battles desc, then name). This is a
  // display-only ordering; the underlying data.heroes/data.skills stay untouched.
  const byWinRate = <T extends { smoothedWinRate: number; total: number; name: string }>(a: T, b: T): number =>
    b.smoothedWinRate - a.smoothedWinRate || b.total - a.total || a.name.localeCompare(b.name, 'zh-Hans-CN');
  // Ranks (排名) are always computed against the *full* sorted list so that when a
  // search filter is applied the rows keep their true position (e.g. 排名 42) instead
  // of restarting at 1. We build a name/label -> rank lookup from the full ordering,
  // then filter for display without disturbing the rank shown per row.
  const sortedHeroes = data.heroes.slice().sort(byWinRate);
  const sortedSkills = data.skills.slice().sort(byWinRate);
  const heroRankMap = new Map(sortedHeroes.map((h, i) => [h.name, i + 1]));
  const skillRankMap = new Map(sortedSkills.map((s, i) => [s.name, i + 1]));
  const heroUsageRankMap = new Map(data.hero_usage.map(([h], i) => [h, i + 1]));
  const skillUsageRankMap = new Map(data.skill_usage.map(([s], i) => [s, i + 1]));
  const heroPairRankMap = new Map(data.top_hero_pairs.map((p, i) => [p.label, i + 1]));
  const heroSkillRankMap = new Map(data.top_hero_skills.map((p, i) => [p.label, i + 1]));

  const filteredHeroes = hasHeroFilter ? sortedHeroes.filter((h) => heroFilterSet.has(h.name)) : sortedHeroes;
  const filteredSkills = hasSkillFilter ? sortedSkills.filter((s) => skillFilterSet.has(s.name)) : sortedSkills;
  const filteredHeroUsage = hasHeroFilter ? data.hero_usage.filter(([h]) => heroFilterSet.has(h)) : data.hero_usage;
  const filteredSkillUsage = hasSkillFilter ? data.skill_usage.filter(([s]) => skillFilterSet.has(s)) : data.skill_usage;
  const filteredHeroPairs = hasHeroFilter
    ? data.top_hero_pairs.filter((p) => p.label.split(' + ').some((n) => heroFilterSet.has(n)))
    : data.top_hero_pairs;
  const filteredHeroSkills = (hasHeroFilter || hasSkillFilter)
    ? data.top_hero_skills.filter((p) => {
        const [hero, skill] = p.label.split(' · ');
        return (hasHeroFilter && heroFilterSet.has(hero)) || (hasSkillFilter && skillFilterSet.has(skill));
      })
    : data.top_hero_skills;

  const mq = data.model_quality;

  return (
    <Container maxWidth="xl" disableGutters>
      <Box>
        <Typography variant="overline" color="error.main">BATTLE ARCHIVE</Typography>
        <Typography component="h1" variant="h3" gutterBottom>数据洞察</Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          这里帮你回答两个问题：<strong>哪些武将、战法更值得选</strong>，以及<strong>哪些搭配放在一起更好用</strong>。
          所有结论都来自已记录的 {data.summary.total_battles} 场对局，是历史经验的参考，
          <strong>并不保证</strong>在某一场对特定对手时一定获胜。
        </Typography>

        {telemetry?.analytics && (
          <TelemetryAnalyticsSection telemetry={telemetry} />
        )}

        {/* Plain-language guide: how to read the numbers */}
        <Card sx={{ mb: 4, borderTop: '3px solid', borderTopColor: 'primary.main' }}>
          <CardContent>
            <Typography component="h2" variant="h6" gutterBottom>三步看懂这些数字</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" gutterBottom>1. 胜率参考</Typography>
                <Typography variant="body2" color="text.secondary">
                  经过校正、平滑处理后的历史表现，不是直接的胜负计数。场次少时会更贴近整体平均，避免被个别对局误导。
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" gutterBottom>2. 组合分</Typography>
                <Typography variant="body2" color="text.secondary">
                  仅用于下面的搭配榜，表示武将配对、武将战法组合在一起时的额外帮助。它<strong>不是</strong>胜率百分比。
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" gutterBottom>3. 参考场次</Typography>
                <Typography variant="body2" color="text.secondary">
                  这条结论背后有多少场对局。场次越多，通常说明证据越稳、越可信。
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Filters */}
        <Paper sx={{ p: { xs: 2, sm: 2.5 }, mb: 4, borderTop: '3px solid', borderTopColor: 'text.primary' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, gap: 1 }}>
            <Typography component="h2" variant="h6">只看我关心的武将和战法</Typography>
            {(hasHeroFilter || hasSkillFilter) && (
              <IconButton
                size="small"
                onClick={() => { setSelectedHeroes([]); setSelectedSkills([]); }}
                title="清除所有筛选"
                aria-label="清除所有筛选"
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            输入你手上或想了解的武将、战法，下面所有的排名和搭配都会只显示相关内容。
          </Typography>
          <Grid container spacing={2} sx={{ mb: 1 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <AutocompleteInput
                items={allHeroNames}
                selectedItems={selectedHeroes}
                onAdd={(hero) => setSelectedHeroes([...selectedHeroes, hero])}
                label="筛选武将"
                placeholder="输入武将名或拼音..."
                heroMetadata={heroMetadata}
              />
              {hasHeroFilter && (
                <Box sx={{ mt: 1 }}>
                  <TagList items={selectedHeroes} onRemove={(hero) => setSelectedHeroes(selectedHeroes.filter(h => h !== hero))} color="primary" heroMetadata={heroMetadata} />
                </Box>
              )}
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <AutocompleteInput
                items={allSkillNames}
                selectedItems={selectedSkills}
                onAdd={(skill) => setSelectedSkills([...selectedSkills, skill])}
                label="筛选战法"
                placeholder="输入战法名或拼音..."
                skillMetadata={skillMetadata}
              />
              {hasSkillFilter && (
                <Box sx={{ mt: 1 }}>
                  <TagList items={selectedSkills} onRemove={(skill) => setSelectedSkills(selectedSkills.filter(s => s !== skill))} color="secondary" skillMetadata={skillMetadata} />
                </Box>
              )}
            </Grid>
          </Grid>
        </Paper>

        {/* Section 1: who is worth picking */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <TrendingUpIcon sx={{ color: 'warning.main' }} />
          <Typography component="h2" variant="h5">先看谁更值得选</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          单个武将、战法按胜率参考排名。想快速挑人挑战法，从这里开始。
        </Typography>
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <EmojiEventsIcon sx={{ mr: 1, color: 'warning.main' }} />
                  <Typography component="h3" variant="h6">全部武将（按胜率参考排序）</Typography>
                </Box>
                <ResponsiveDisclosure label="全部武将排名">
                <ScrollableAnalyticsTable label="全部武将排名">
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>武将</TableCell>
                        <TableCell align="right">胜率参考</TableCell>
                        <TableCell align="right">参考场次</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredHeroes.map((h) => (
                        <TableRow key={h.name}>
                          <TableCell>{heroRankMap.get(h.name)}</TableCell>
                          <TableCell><Chip label={h.name} color="primary" size="small" /></TableCell>
                          <TableCell align="right">{pct(h.smoothedWinRate)}</TableCell>
                          <TableCell align="right">{h.total}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollableAnalyticsTable>
                </ResponsiveDisclosure>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <EmojiEventsIcon sx={{ mr: 1, color: 'warning.main' }} />
                  <Typography component="h3" variant="h6">全部战法（按胜率参考排序）</Typography>
                </Box>
                <ResponsiveDisclosure label="全部战法排名">
                <ScrollableAnalyticsTable label="全部战法排名">
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>战法</TableCell>
                        <TableCell align="right">胜率参考</TableCell>
                        <TableCell align="right">参考场次</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredSkills.map((s) => (
                        <TableRow key={s.name}>
                          <TableCell>{skillRankMap.get(s.name)}</TableCell>
                          <TableCell>
                            <Chip
                              label={isShadowSkill(s.name) ? `影 · ${s.name}` : s.name}
                              color="secondary"
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="right">{pct(s.smoothedWinRate)}</TableCell>
                          <TableCell align="right">{s.total}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollableAnalyticsTable>
                </ResponsiveDisclosure>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Section 2: which combinations work well */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <GroupsIcon sx={{ color: 'info.main' }} />
          <Typography component="h2" variant="h5">再看哪些搭配效果好</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          放在一起会互相加分的组合。组合分越高，同队时对整体阵容的帮助越大。
        </Typography>
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <LinkIcon sx={{ mr: 1, color: 'info.main' }} />
              <Typography component="h3" variant="h6">最搭的武将组合</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              这些武将同队时，模型给出的额外组合分最高。
            </Typography>
            <ResponsiveDisclosure label="最强武将配对">
            <ScrollableAnalyticsTable label="最强武将配对">
              <Table size="small" stickyHeader>
                <TableHead><TableRow><TableCell>排名</TableCell><TableCell>武将配对</TableCell><TableCell align="right">组合分</TableCell><TableCell align="right">参考场次</TableCell></TableRow></TableHead>
                <TableBody>
                  {filteredHeroPairs.map((p) => (
                    <TableRow key={p.label}>
                      <TableCell>{heroPairRankMap.get(p.label)}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {p.label.split(' + ').map((n, i) => <Chip key={i} label={n} color="primary" size="small" />)}
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>{fmtStrength(p.weight)}</TableCell>
                      <TableCell align="right">{p.support}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableAnalyticsTable>
            </ResponsiveDisclosure>
          </CardContent>
        </Card>

        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <LinkIcon sx={{ mr: 1, color: 'secondary.main' }} />
              <Typography component="h3" variant="h6">最搭的武将与战法</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              某个武将带上某个战法时，模型给出的额外组合分最高。
            </Typography>
            <ResponsiveDisclosure label="最强武将战法组合">
            <ScrollableAnalyticsTable label="最强武将战法组合">
              <Table size="small" stickyHeader>
                <TableHead><TableRow><TableCell>排名</TableCell><TableCell>武将</TableCell><TableCell>战法</TableCell><TableCell align="right">组合分</TableCell><TableCell align="right">参考场次</TableCell></TableRow></TableHead>
                <TableBody>
                  {filteredHeroSkills.map((p) => {
                    const [hero, skill] = p.label.split(' · ');
                    return (
                      <TableRow key={p.label}>
                        <TableCell>{heroSkillRankMap.get(p.label)}</TableCell>
                        <TableCell><Chip label={hero} color="primary" size="small" /></TableCell>
                        <TableCell><Chip label={skill} color="secondary" size="small" variant="outlined" /></TableCell>
                        <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>{fmtStrength(p.weight)}</TableCell>
                        <TableCell align="right">{p.support}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollableAnalyticsTable>
            </ResponsiveDisclosure>
          </CardContent>
        </Card>

        {/* Section 3: what everyone uses */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <BarChartIcon sx={{ color: 'text.secondary' }} />
          <Typography component="h2" variant="h5">看看大家常用什么</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          出场次数最多的武将和战法。常用不一定最强，但能反映当前流行的选择。
        </Typography>
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography component="h3" variant="h6" gutterBottom>武将使用排行</Typography>
                <ResponsiveDisclosure label="武将使用排行">
                <ScrollableAnalyticsTable label="武将使用排行">
                  <Table size="small" stickyHeader>
                    <TableHead><TableRow><TableCell>排名</TableCell><TableCell>武将</TableCell><TableCell align="right">使用次数</TableCell></TableRow></TableHead>
                    <TableBody>
                      {filteredHeroUsage.map(([hero, count]) => (
                        <TableRow key={hero}>
                          <TableCell>{heroUsageRankMap.get(hero)}</TableCell>
                          <TableCell><Chip label={hero} color="primary" size="small" /></TableCell>
                          <TableCell align="right">{count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollableAnalyticsTable>
                </ResponsiveDisclosure>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography component="h3" variant="h6" gutterBottom>战法使用排行</Typography>
                <ResponsiveDisclosure label="战法使用排行">
                <ScrollableAnalyticsTable label="战法使用排行">
                  <Table size="small" stickyHeader>
                    <TableHead><TableRow><TableCell>排名</TableCell><TableCell>战法</TableCell><TableCell align="right">使用次数</TableCell></TableRow></TableHead>
                    <TableBody>
                      {filteredSkillUsage.map(([skill, count]) => (
                        <TableRow key={skill}>
                          <TableCell>{skillUsageRankMap.get(skill)}</TableCell>
                          <TableCell><Chip label={skill} color="secondary" size="small" /></TableCell>
                          <TableCell align="right">{count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollableAnalyticsTable>
                </ResponsiveDisclosure>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Section 4 (optional, collapsed): data & algorithm details */}
        <Accordion defaultExpanded={false} sx={{ mb: 4 }}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="data-algo-details-content"
            id="data-algo-details-header"
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <InsightsIcon sx={{ color: 'info.main' }} />
              <Box>
                <Typography component="h2" variant="h6">数据与算法说明</Typography>
                <Typography variant="body2" color="text.secondary">
                  选看内容：了解这些推荐有多可靠，不影响日常挑人挑战法。
                </Typography>
              </Box>
            </Box>
          </AccordionSummary>
          <AccordionDetails id="data-algo-details-content">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              推荐来自一个成对（对手感知）逻辑回归模型，并在按时间留出的一批对局上做过检验。
              搭配榜里的“组合分”用来横向比较不同组合，<strong>不是</strong>对某个特定对手的胜率。
            </Typography>

            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="subtitle2">预测准确率</Typography>
                <HelpTip
                  label="预测准确率说明"
                  title="在模型没见过的历史对局上，它猜对胜负方的比例。"
                />
              </Box>
              <Typography variant="h5">{pct(mq.accuracy)}</Typography>
              <Typography variant="body2" color="text.secondary">
                作为对照，如果每次都猜更常赢的一方，正确率约为 {pct(mq.baseline_accuracy)}。
                高于这个基线，说明模型确实学到了有用的规律。
              </Typography>
            </Box>

            <Typography variant="overline" color="text.secondary">技术指标</Typography>
            <Grid container spacing={2} sx={{ mt: 0 }}>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="overline" color="text.secondary">对数损失 (log loss)</Typography>
                <Typography variant="h6">{mq.log_loss ?? '-'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="overline" color="text.secondary">Brier 分数</Typography>
                <Typography variant="h6">{mq.brier ?? '-'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="overline" color="text.secondary">测试样本数</Typography>
                <Typography variant="h6">{mq.n_test}</Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="overline" color="text.secondary">特征数</Typography>
                <Typography variant="h6">{mq.n_features}</Typography>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      </Box>
    </Container>
  );
};

export default Analytics;
