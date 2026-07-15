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
} from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import LinkIcon from '@mui/icons-material/Link';
import ClearIcon from '@mui/icons-material/Clear';
import InsightsIcon from '@mui/icons-material/Insights';
import { api } from '../services/api';
import { database } from '../data';
import { tierRank } from '../utils/tiers';
import AutocompleteInput from '../components/common/AutocompleteInput';
import TagList from '../components/common/TagList';
import ResponsiveDisclosure from '../components/common/ResponsiveDisclosure';
import type { HeroMeta, SkillMeta } from '../types/game';
import type { AnalyticsResult } from '../services/recommendationEngine';

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

const Analytics = () => {
  const [data, setData] = useState<AnalyticsResult | null>(null);
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

  const filteredHeroes = hasHeroFilter ? data.heroes.filter((h) => heroFilterSet.has(h.name)) : data.heroes;
  const filteredSkills = hasSkillFilter ? data.skills.filter((s) => skillFilterSet.has(s.name)) : data.skills;
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
          战斗统计与模型表现（共 {data.summary.total_battles} 场对局）
        </Typography>

        {/* Model quality */}
        <Card sx={{ mb: 4, borderTop: '3px solid', borderTopColor: 'info.main' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
              <InsightsIcon sx={{ color: 'info.main' }} />
              <Typography component="h2" variant="h6">模型质量（留出回测）</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              成对（对手感知）逻辑回归模型，在按时间留出的测试集上评估。分数代表相对阵容强度，非对特定对手的胜率。
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="overline" color="text.secondary">准确率</Typography>
                <Typography variant="h5">{pct(mq.accuracy)}</Typography>
                <Typography variant="caption" color="text.secondary">基线 {pct(mq.baseline_accuracy)}</Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="overline" color="text.secondary">对数损失</Typography>
                <Typography variant="h5">{mq.log_loss ?? '-'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="overline" color="text.secondary">Brier 分数</Typography>
                <Typography variant="h5">{mq.brier ?? '-'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="overline" color="text.secondary">测试样本 / 特征数</Typography>
                <Typography variant="h5">{mq.n_test} / {mq.n_features}</Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Filters */}
        <Paper sx={{ p: { xs: 2, sm: 2.5 }, mb: 4, borderTop: '3px solid', borderTopColor: 'text.primary' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
            <Typography component="h2" variant="h6">筛选名册</Typography>
            {(hasHeroFilter || hasSkillFilter) && (
              <IconButton size="small" onClick={() => { setSelectedHeroes([]); setSelectedSkills([]); }} title="清除所有筛选">
                <ClearIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
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

        {/* Rankings */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <EmojiEventsIcon sx={{ mr: 1, color: 'warning.main' }} />
                  <Typography component="h2" variant="h6">全部武将（按平滑胜率排序）</Typography>
                </Box>
                <ResponsiveDisclosure label="全部武将排名">
                <ScrollableAnalyticsTable label="全部武将排名">
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>武将</TableCell>
                        <TableCell align="right">平滑胜率</TableCell>
                        <TableCell align="right">模型权重</TableCell>
                        <TableCell align="right">场次</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredHeroes.map((h, index) => (
                        <TableRow key={h.name}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell><Chip label={h.name} color="primary" size="small" /></TableCell>
                          <TableCell align="right">{pct(h.smoothedWinRate)}</TableCell>
                          <TableCell align="right">{h.strength.toFixed(3)}</TableCell>
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
                  <Typography component="h2" variant="h6">全部战法（按平滑胜率排序）</Typography>
                </Box>
                <ResponsiveDisclosure label="全部战法排名">
                <ScrollableAnalyticsTable label="全部战法排名">
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>战法</TableCell>
                        <TableCell align="right">平滑胜率</TableCell>
                        <TableCell align="right">模型权重</TableCell>
                        <TableCell align="right">场次</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredSkills.map((s, index) => (
                        <TableRow key={s.name}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell><Chip label={s.name} color="secondary" size="small" /></TableCell>
                          <TableCell align="right">{pct(s.smoothedWinRate)}</TableCell>
                          <TableCell align="right">{s.strength.toFixed(3)}</TableCell>
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

        {/* Usage */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography component="h2" variant="h6" gutterBottom>武将使用排行</Typography>
                <ResponsiveDisclosure label="武将使用排行">
                <ScrollableAnalyticsTable label="武将使用排行">
                  <Table size="small" stickyHeader>
                    <TableHead><TableRow><TableCell>排名</TableCell><TableCell>武将</TableCell><TableCell align="right">使用次数</TableCell></TableRow></TableHead>
                    <TableBody>
                      {filteredHeroUsage.map(([hero, count], index) => (
                        <TableRow key={hero}>
                          <TableCell>{index + 1}</TableCell>
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
                <Typography component="h2" variant="h6" gutterBottom>战法使用排行</Typography>
                <ResponsiveDisclosure label="战法使用排行">
                <ScrollableAnalyticsTable label="战法使用排行">
                  <Table size="small" stickyHeader>
                    <TableHead><TableRow><TableCell>排名</TableCell><TableCell>战法</TableCell><TableCell align="right">使用次数</TableCell></TableRow></TableHead>
                    <TableBody>
                      {filteredSkillUsage.map(([skill, count], index) => (
                        <TableRow key={skill}>
                          <TableCell>{index + 1}</TableCell>
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

        {/* Model synergies */}
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <LinkIcon sx={{ mr: 1, color: 'info.main' }} />
              <Typography component="h2" variant="h6">最强武将配对（模型权重）</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              模型学到的武将配对相对强度贡献。权重越高，同队时对整体阵容强度的提升越大。
            </Typography>
            <ResponsiveDisclosure label="最强武将配对">
            <ScrollableAnalyticsTable label="最强武将配对">
              <Table size="small" stickyHeader>
                <TableHead><TableRow><TableCell>排名</TableCell><TableCell>武将配对</TableCell><TableCell align="right">模型权重</TableCell><TableCell align="right">证据(场)</TableCell></TableRow></TableHead>
                <TableBody>
                  {filteredHeroPairs.map((p, index) => (
                    <TableRow key={p.label}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {p.label.split(' + ').map((n, i) => <Chip key={i} label={n} color="primary" size="small" />)}
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>{p.weight.toFixed(3)}</TableCell>
                      <TableCell align="right">{p.support}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableAnalyticsTable>
            </ResponsiveDisclosure>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <LinkIcon sx={{ mr: 1, color: 'secondary.main' }} />
              <Typography component="h2" variant="h6">最强武将-战法组合（模型权重）</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              模型学到的武将携带某战法时的相对强度贡献。
            </Typography>
            <ResponsiveDisclosure label="最强武将战法组合">
            <ScrollableAnalyticsTable label="最强武将战法组合">
              <Table size="small" stickyHeader>
                <TableHead><TableRow><TableCell>排名</TableCell><TableCell>武将</TableCell><TableCell>战法</TableCell><TableCell align="right">模型权重</TableCell><TableCell align="right">证据(场)</TableCell></TableRow></TableHead>
                <TableBody>
                  {filteredHeroSkills.map((p, index) => {
                    const [hero, skill] = p.label.split(' · ');
                    return (
                      <TableRow key={p.label}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell><Chip label={hero} color="primary" size="small" /></TableCell>
                        <TableCell><Chip label={skill} color="secondary" size="small" variant="outlined" /></TableCell>
                        <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>{p.weight.toFixed(3)}</TableCell>
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
      </Box>
    </Container>
  );
};

export default Analytics;
