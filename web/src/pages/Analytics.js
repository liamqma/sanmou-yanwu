import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import LinkIcon from '@mui/icons-material/Link';
import { api } from '../services/api';

const Analytics = () => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
  } = analyticsData;

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          📊 数据看板
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          战斗统计与表现分析
        </Typography>

        {/* Summary Statistics */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  总对局数
                </Typography>
                <Typography variant="h4">{summary.total_battles}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  武将种类数
                </Typography>
                <Typography variant="h4">{summary.total_heroes}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  战法种类数
                </Typography>
                <Typography variant="h4">{summary.total_skills}</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>


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
                      {(all_heroes || top_heroes).map(([hero, winRate, games, wilson], index) => (
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
                      {(all_skills || top_skills).map(([skill, winRate, games, wilson], index) => (
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
                      {(all_hero_usage || hero_usage).map(([hero, count], index) => (
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
                      {(all_skill_usage || skill_usage).map(([skill, count], index) => (
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
        {hero_synergy && hero_synergy.length > 0 && (
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
                      <TableCell>最佳搭档</TableCell>
                      <TableCell align="right">整体胜率</TableCell>
                      <TableCell align="right">有搭档</TableCell>
                      <TableCell align="right">无搭档</TableCell>
                      <TableCell align="right">增幅</TableCell>
                      <TableCell align="right">占比</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {hero_synergy.map((s, index) => {
                      const boostPct = (s.synergy_boost * 100).toFixed(1);
                      const boostColor = s.synergy_boost > 0.3 ? 'error.main' : s.synergy_boost > 0.15 ? 'warning.main' : 'success.main';
                      return (
                        <TableRow key={s.hero}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Chip label={s.hero} color="primary" size="small" />
                          </TableCell>
                          <TableCell>
                            <Chip label={s.best_partner} color="primary" size="small" variant="outlined" />
                          </TableCell>
                          <TableCell align="right">
                            {(s.hero_wilson * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                            {(s.pair_wilson * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'text.secondary' }}>
                            {(s.without_wilson * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell align="right" sx={{ color: boostColor, fontWeight: 'bold' }}>
                            +{boostPct}%
                          </TableCell>
                          <TableCell align="right">
                            {(s.partner_game_share * 100).toFixed(0)}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                  {(all_winning_combos || winning_combos).map((combo, index) => (
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
