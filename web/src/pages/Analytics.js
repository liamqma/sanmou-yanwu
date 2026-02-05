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
  } = analyticsData;

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
          <Grid item size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Battles
                </Typography>
                <Typography variant="h4">{summary.total_battles}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Unique Heroes
                </Typography>
                <Typography variant="h4">{summary.total_heroes}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Unique Skills
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
                  <Typography variant="h6">All Heroes by Win Rate</Typography>
                </Box>
                <TableContainer sx={{ maxHeight: 800 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Rank</TableCell>
                        <TableCell>Hero</TableCell>
                        <TableCell align="right">Win Rate</TableCell>
                        <TableCell align="right">Games</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(all_heroes || top_heroes).map(([hero, winRate, games], index) => (
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
                  <Typography variant="h6">All Skills by Win Rate</Typography>
                </Box>
                <TableContainer sx={{ maxHeight: 800 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Rank</TableCell>
                        <TableCell>Skill</TableCell>
                        <TableCell align="right">Win Rate</TableCell>
                        <TableCell align="right">Games</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(all_skills || top_skills).map(([skill, winRate, games], index) => (
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
                  All Most Used Heroes
                </Typography>
                <TableContainer sx={{ maxHeight: 800 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Rank</TableCell>
                        <TableCell>Hero</TableCell>
                        <TableCell align="right">Usage Count</TableCell>
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
                  All Most Used Skills
                </Typography>
                <TableContainer sx={{ maxHeight: 800 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Rank</TableCell>
                        <TableCell>Skill</TableCell>
                        <TableCell align="right">Usage Count</TableCell>
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

        {/* Winning Combinations */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              🏆 All Winning Hero Combinations
            </Typography>
            <TableContainer sx={{ maxHeight: 800 }}>
              <Table stickyHeader>
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
