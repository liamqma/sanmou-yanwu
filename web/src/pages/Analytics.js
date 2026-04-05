import React, { useState, useEffect, useMemo } from 'react';
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
import { api } from '../services/api';
import AutocompleteInput from '../components/common/AutocompleteInput';
import TagList from '../components/common/TagList';

const Analytics = () => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedHeroes, setSelectedHeroes] = useState([]);
  const [selectedSkills, setSelectedSkills] = useState([]);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const data = await api.getAnalytics();
      setAnalyticsData(data);
      setError(null);
    } catch (err) {
      setError('加载数据失败：' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // All unique hero and skill names for autocomplete options (must be before early returns)
  const allHeroNames = useMemo(() => {
    if (!analyticsData) return [];
    const { all_heroes, top_heroes, all_hero_usage, hero_usage, hero_synergy, all_winning_combos, winning_combos } = analyticsData;
    const names = new Set();
    (all_heroes || top_heroes || []).forEach(([h]) => names.add(h));
    (all_hero_usage || hero_usage || []).forEach(([h]) => names.add(h));
    (hero_synergy || []).forEach(s => {
      names.add(s.hero);
      s.partners?.forEach(p => names.add(p.partner));
    });
    (all_winning_combos || winning_combos || []).forEach(c => c.heroes?.forEach(h => names.add(h)));
    return [...names].sort();
  }, [analyticsData]);

  const allSkillNames = useMemo(() => {
    if (!analyticsData) return [];
    const { all_skills, top_skills, all_skill_usage, skill_usage, skill_synergy } = analyticsData;
    const names = new Set();
    (all_skills || top_skills || []).forEach(([s]) => names.add(s));
    (all_skill_usage || skill_usage || []).forEach(([s]) => names.add(s));
    (skill_synergy || []).forEach(s => names.add(s.skill));
    return [...names].sort();
  }, [analyticsData]);

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
        <Box sx={{ py: 4 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      </Container>
    );
  }

  if (!analyticsData) {
    return null;
  }

  const {
    summary,
    top_heroes,
    all_heroes,
    top_skills,
    all_skills,
    hero_usage,
    all_hero_usage,
    skill_usage,
    all_skill_usage,
    winning_combos,
    all_winning_combos,
    hero_synergy,
    skill_synergy,
  } = analyticsData;

  // Filtered data
  const heroFilterSet = new Set(selectedHeroes);
  const skillFilterSet = new Set(selectedSkills);
  const hasHeroFilter = selectedHeroes.length > 0;
  const hasSkillFilter = selectedSkills.length > 0;

  const filteredHeroes = hasHeroFilter
    ? (all_heroes || top_heroes || []).filter(([h]) => heroFilterSet.has(h))
    : (all_heroes || top_heroes || []);

  const filteredSkills = hasSkillFilter
    ? (all_skills || top_skills || []).filter(([s]) => skillFilterSet.has(s))
    : (all_skills || top_skills || []);

  const filteredHeroUsage = hasHeroFilter
    ? (all_hero_usage || hero_usage || []).filter(([h]) => heroFilterSet.has(h))
    : (all_hero_usage || hero_usage || []);

  const filteredSkillUsage = hasSkillFilter
    ? (all_skill_usage || skill_usage || []).filter(([s]) => skillFilterSet.has(s))
    : (all_skill_usage || skill_usage || []);

  const filteredWinningCombos = hasHeroFilter
    ? (all_winning_combos || winning_combos || []).filter(c => c.heroes?.some(h => heroFilterSet.has(h)))
    : (all_winning_combos || winning_combos || []);

  const filteredHeroSynergy = hasHeroFilter
    ? (hero_synergy || []).filter(s => heroFilterSet.has(s.hero) || s.partners?.some(p => heroFilterSet.has(p.partner)))
    : (hero_synergy || []);

  const filteredSkillSynergy = (hasSkillFilter || hasHeroFilter)
    ? (skill_synergy || []).filter(s =>
        (hasSkillFilter ? skillFilterSet.has(s.skill) : true) ||
        (hasHeroFilter ? s.heroes?.some(h => heroFilterSet.has(h.hero)) : true)
      )
    : (skill_synergy || []);

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          📊 数据看板
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          战斗统计与表现分析（共 {summary?.total_battles ?? '...'} 场对局）
        </Typography>

        {/* Filters */}
        <Paper sx={{ p: 2, mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
            <Typography variant="h6">🔍 筛选</Typography>
            {(hasHeroFilter || hasSkillFilter) && (
              <IconButton size="small" onClick={() => { setSelectedHeroes([]); setSelectedSkills([]); }} title="清除所有筛选">
                <ClearIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
          <Grid container spacing={2} sx={{ mb: 1 }}>
            <Grid item size={{ xs: 12, md: 6 }}>
              <AutocompleteInput
                items={allHeroNames}
                selectedItems={selectedHeroes}
                onAdd={(hero) => setSelectedHeroes([...selectedHeroes, hero])}
                label="筛选武将"
                placeholder="输入武将名或拼音..."
              />
              {hasHeroFilter && (
                <Box sx={{ mt: 1 }}>
                  <TagList items={selectedHeroes} onRemove={(hero) => setSelectedHeroes(selectedHeroes.filter(h => h !== hero))} color="primary" />
                </Box>
              )}
            </Grid>
            <Grid item size={{ xs: 12, md: 6 }}>
              <AutocompleteInput
                items={allSkillNames}
                selectedItems={selectedSkills}
                onAdd={(skill) => setSelectedSkills([...selectedSkills, skill])}
                label="筛选战法"
                placeholder="输入战法名或拼音..."
              />
              {hasSkillFilter && (
                <Box sx={{ mt: 1 }}>
                  <TagList items={selectedSkills} onRemove={(skill) => setSelectedSkills(selectedSkills.filter(s => s !== skill))} color="secondary" />
                </Box>
              )}
            </Grid>
          </Grid>
        </Paper>

        {/* Top Performers */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <EmojiEventsIcon sx={{ mr: 1, color: 'warning.main' }} />
                  <Typography variant="h6">全部武将（按置信调整胜率排序）</Typography>
                </Box>
                <TableContainer sx={{ maxHeight: 800 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>武将</TableCell>
                        <TableCell align="right">胜率</TableCell>
                        <TableCell align="right">威尔逊</TableCell>
                        <TableCell align="right">场次</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredHeroes.map(([hero, winRate, games, wilson], index) => (
                        <TableRow key={hero}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Chip label={hero} color="primary" size="small" />
                          </TableCell>
                          <TableCell align="right">{winRate}</TableCell>
                          <TableCell align="right">{wilson != null ? `${(wilson * 100).toFixed(1)}%` : '-'}</TableCell>
                          <TableCell align="right">{games}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <EmojiEventsIcon sx={{ mr: 1, color: 'warning.main' }} />
                  <Typography variant="h6">全部战法（按置信调整胜率排序）</Typography>
                </Box>
                <TableContainer sx={{ maxHeight: 800 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>战法</TableCell>
                        <TableCell align="right">胜率</TableCell>
                        <TableCell align="right">威尔逊</TableCell>
                        <TableCell align="right">场次</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredSkills.map(([skill, winRate, games, wilson], index) => (
                        <TableRow key={skill}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Chip label={skill} color="secondary" size="small" />
                          </TableCell>
                          <TableCell align="right">{winRate}</TableCell>
                          <TableCell align="right">{wilson != null ? `${(wilson * 100).toFixed(1)}%` : '-'}</TableCell>
                          <TableCell align="right">{games}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Most Used */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  武将使用排行
                </Typography>
                <TableContainer sx={{ maxHeight: 800 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>武将</TableCell>
                        <TableCell align="right">使用次数</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredHeroUsage.map(([hero, count], index) => (
                        <TableRow key={hero}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Chip label={hero} color="primary" size="small" />
                          </TableCell>
                          <TableCell align="right">{count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  战法使用排行
                </Typography>
                <TableContainer sx={{ maxHeight: 800 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>战法</TableCell>
                        <TableCell align="right">使用次数</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredSkillUsage.map(([skill, count], index) => (
                        <TableRow key={skill}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Chip label={skill} color="secondary" size="small" />
                          </TableCell>
                          <TableCell align="right">{count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Hero Synergy Dependencies */}
        {filteredHeroSynergy && filteredHeroSynergy.length > 0 && (
          <Card sx={{ mb: 4 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <LinkIcon sx={{ mr: 1, color: 'info.main' }} />
                <Typography variant="h6">🤝 武将羁绊依赖分析</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                部分武将的胜率高度依赖特定搭档。"增幅"表示有搭档 vs 无搭档的胜率差值，"占比"表示与该搭档同队的比赛占总场次的百分比。
              </Typography>
              <TableContainer sx={{ maxHeight: 800 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>排名</TableCell>
                      <TableCell>武将</TableCell>
                      <TableCell>整体胜率</TableCell>
                      <TableCell>搭档</TableCell>
                      <TableCell align="right">有搭档</TableCell>
                      <TableCell align="right">无搭档</TableCell>
                      <TableCell align="right">增幅</TableCell>
                      <TableCell align="right">占比</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredHeroSynergy.map((s, index) => 
                      s.partners.map((p, pIdx) => {
                        const boostPct = (p.synergy_boost * 100).toFixed(1);
                        const boostColor = p.synergy_boost > 0.3 ? 'error.main' : p.synergy_boost > 0.15 ? 'warning.main' : 'success.main';
                        return (
                          <TableRow key={`${s.hero}-${p.partner}`} sx={pIdx > 0 ? { '& td': { borderTop: 'none', pt: 0 } } : {}}>
                            <TableCell>{pIdx === 0 ? index + 1 : ''}</TableCell>
                            <TableCell>
                              {pIdx === 0 ? <Chip label={s.hero} color="primary" size="small" /> : ''}
                            </TableCell>
                            <TableCell>
                              {pIdx === 0 ? `${(s.hero_wilson * 100).toFixed(1)}%` : ''}
                            </TableCell>
                            <TableCell>
                              <Chip label={p.partner} color="primary" size="small" variant="outlined" />
                            </TableCell>
                            <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                              {(p.pair_wilson * 100).toFixed(1)}%
                            </TableCell>
                            <TableCell align="right" sx={{ color: 'text.secondary' }}>
                              {(p.without_wilson * 100).toFixed(1)}%
                            </TableCell>
                            <TableCell align="right" sx={{ color: boostColor, fontWeight: 'bold' }}>
                              +{boostPct}%
                            </TableCell>
                            <TableCell align="right">
                              {(p.game_share * 100).toFixed(0)}%
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}

        {/* Skill Synergy Dependencies */}
        {filteredSkillSynergy && filteredSkillSynergy.length > 0 && (
          <Card sx={{ mb: 4 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <LinkIcon sx={{ mr: 1, color: 'secondary.main' }} />
                <Typography variant="h6">⚔️ 战法羁绊依赖分析</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                部分战法的胜率高度依赖特定武将。"增幅"表示有该武将 vs 无该武将时的胜率差值，"占比"表示该战法被该武将使用的比赛占总场次的百分比。
              </Typography>
              <TableContainer sx={{ maxHeight: 800 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>排名</TableCell>
                      <TableCell>战法</TableCell>
                      <TableCell>整体胜率</TableCell>
                      <TableCell>武将</TableCell>
                      <TableCell align="right">有该武将</TableCell>
                      <TableCell align="right">无该武将</TableCell>
                      <TableCell align="right">增幅</TableCell>
                      <TableCell align="right">占比</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredSkillSynergy.map((s, index) =>
                      s.heroes.map((h, hIdx) => {
                        const boostPct = (h.synergy_boost * 100).toFixed(1);
                        const boostColor = h.synergy_boost > 0.3 ? 'error.main' : h.synergy_boost > 0.15 ? 'warning.main' : 'success.main';
                        return (
                          <TableRow key={`${s.skill}-${h.hero}`} sx={hIdx > 0 ? { '& td': { borderTop: 'none', pt: 0 } } : {}}>
                            <TableCell>{hIdx === 0 ? index + 1 : ''}</TableCell>
                            <TableCell>
                              {hIdx === 0 ? <Chip label={s.skill} color="secondary" size="small" /> : ''}
                            </TableCell>
                            <TableCell>
                              {hIdx === 0 ? `${(s.skill_wilson * 100).toFixed(1)}%` : ''}
                            </TableCell>
                            <TableCell>
                              <Chip label={h.hero} color="primary" size="small" variant="outlined" />
                            </TableCell>
                            <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                              {(h.pair_wilson * 100).toFixed(1)}%
                            </TableCell>
                            <TableCell align="right" sx={{ color: 'text.secondary' }}>
                              {(h.without_wilson * 100).toFixed(1)}%
                            </TableCell>
                            <TableCell align="right" sx={{ color: boostColor, fontWeight: 'bold' }}>
                              +{boostPct}%
                            </TableCell>
                            <TableCell align="right">
                              {(h.game_share * 100).toFixed(0)}%
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}

        {/* Winning Combinations */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              🏆 武将三人组合胜率排行（按置信调整胜率排序）
            </Typography>
            <TableContainer sx={{ maxHeight: 800 }}>
              <Table stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>排名</TableCell>
                    <TableCell>武将组合</TableCell>
                    <TableCell align="right">胜</TableCell>
                    <TableCell align="right">负</TableCell>
                    <TableCell align="right">总场次</TableCell>
                    <TableCell align="right">胜率</TableCell>
                    <TableCell align="right">威尔逊</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredWinningCombos.map((combo, index) => (
                    <TableRow key={index}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {combo.heroes.map((hero, idx) => (
                            <Chip key={idx} label={hero} color="primary" size="small" />
                          ))}
                        </Box>
                      </TableCell>
                      <TableCell align="right">{combo.wins}</TableCell>
                      <TableCell align="right">{combo.losses}</TableCell>
                      <TableCell align="right">{combo.total_games}</TableCell>
                      <TableCell align="right">
                        <strong>{(combo.win_rate * 100).toFixed(1)}%</strong>
                      </TableCell>
                      <TableCell align="right">
                        {combo.wilson != null ? `${(combo.wilson * 100).toFixed(1)}%` : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default Analytics;
