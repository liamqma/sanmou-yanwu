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
  Paper,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
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
      setError('Failed to load analytics: ' + err.message);
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

  const { summary, top_heroes, top_skills, hero_usage, skill_usage, winning_combos, win_rate_stats } = analyticsData;

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          📊 Analytics Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          Comprehensive battle statistics and performance analysis
        </Typography>

        {/* Summary Statistics */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Battles
                </Typography>
                <Typography variant="h4">{summary.total_battles}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Unique Heroes
                </Typography>
                <Typography variant="h4">{summary.total_heroes}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Unique Skills
                </Typography>
                <Typography variant="h4">{summary.total_skills}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Win Rate Stats
                </Typography>
                <Typography variant="body2">
                  Heroes &gt;50%: {win_rate_stats.heroes_above_50}
                  <br />
                  Skills &gt;50%: {win_rate_stats.skills_above_50}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Battle Outcomes */}
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Battle Outcomes
            </Typography>
            <Grid container spacing={2}>
              <Grid item size={{ xs: 12, sm: 4 }}>
                <Box sx={{ textAlign: 'center', p: 2 }}>
                  <Typography variant="h5" color="primary">
                    {summary.team1_wins}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Team 1 Wins ({summary.total_battles > 0 ? ((summary.team1_wins / summary.total_battles) * 100).toFixed(1) : 0}%)
                  </Typography>
                </Box>
              </Grid>
              <Grid item size={{ xs: 12, sm: 4 }}>
                <Box sx={{ textAlign: 'center', p: 2 }}>
                  <Typography variant="h5" color="secondary">
                    {summary.team2_wins}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Team 2 Wins ({summary.total_battles > 0 ? ((summary.team2_wins / summary.total_battles) * 100).toFixed(1) : 0}%)
                  </Typography>
                </Box>
              </Grid>
              <Grid item size={{ xs: 12, sm: 4 }}>
                <Box sx={{ textAlign: 'center', p: 2 }}>
                  <Typography variant="h5" color="text.secondary">
                    {summary.unknown_wins}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Unknown ({summary.total_battles > 0 ? ((summary.unknown_wins / summary.total_battles) * 100).toFixed(1) : 0}%)
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Top Performers */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <EmojiEventsIcon sx={{ mr: 1, color: 'warning.main' }} />
                  <Typography variant="h6">Top Heroes by Win Rate</Typography>
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Rank</TableCell>
                        <TableCell>Hero</TableCell>
                        <TableCell align="right">Win Rate</TableCell>
                        <TableCell align="right">Games</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {top_heroes.slice(0, 10).map(([hero, winRate, games], index) => (
                        <TableRow key={hero}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Chip label={hero} color="primary" size="small" />
                          </TableCell>
                          <TableCell align="right">{winRate}</TableCell>
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
                  <Typography variant="h6">Top Skills by Win Rate</Typography>
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Rank</TableCell>
                        <TableCell>Skill</TableCell>
                        <TableCell align="right">Win Rate</TableCell>
                        <TableCell align="right">Games</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {top_skills.slice(0, 10).map(([skill, winRate, games], index) => (
                        <TableRow key={skill}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Chip label={skill} color="secondary" size="small" />
                          </TableCell>
                          <TableCell align="right">{winRate}</TableCell>
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
                  Most Used Heroes
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Rank</TableCell>
                        <TableCell>Hero</TableCell>
                        <TableCell align="right">Usage Count</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {hero_usage.slice(0, 10).map(([hero, count], index) => (
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
                  Most Used Skills
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Rank</TableCell>
                        <TableCell>Skill</TableCell>
                        <TableCell align="right">Usage Count</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {skill_usage.slice(0, 10).map(([skill, count], index) => (
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

        {/* Winning Combinations */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              🏆 Top Winning Hero Combinations
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Rank</TableCell>
                    <TableCell>Hero Combination</TableCell>
                    <TableCell align="right">Wins</TableCell>
                    <TableCell align="right">Losses</TableCell>
                    <TableCell align="right">Total Games</TableCell>
                    <TableCell align="right">Win Rate</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {winning_combos.slice(0, 10).map((combo, index) => (
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
