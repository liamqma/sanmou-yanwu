import React, { useState, useEffect } from 'react';
import { Container, Box, Typography, Button, Card, CardContent, Grid, Chip, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import CurrentTeam from '../components/game/CurrentTeam';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import battleStatsData from '../battle_stats.json';

/**
 * Generate all possible 3-hero combinations from a hero pool
 */
function generate3HeroCombinations(heroes) {
  const combinations = [];
  const n = heroes.length;
  if (n < 3) return combinations;
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        combinations.push([heroes[i], heroes[j], heroes[k]].sort());
      }
    }
  }
  return combinations;
}

/**
 * Team Builder page - shows current heroes and skills
 * Recommends teams based on hero combinations from battle stats
 */
/**
 * Find best hero pair for a given hero
 */
function findBestHeroPair(hero, heroPairStats, availableHeroes) {
  const pairs = [];
  
  for (const [pairKey, stats] of Object.entries(heroPairStats)) {
    const [hero1, hero2] = pairKey.split(',');
    if ((hero1 === hero && availableHeroes.includes(hero2)) || 
        (hero2 === hero && availableHeroes.includes(hero1))) {
      const totalGames = stats.wins + stats.losses;
      if (totalGames >= 1) {
        const winRate = stats.wins / totalGames;
        const wilson = stats.wilson ?? 0;
        pairs.push({
          partner: hero1 === hero ? hero2 : hero1,
          wins: stats.wins,
          losses: stats.losses,
          total: totalGames,
          winRate: winRate * 100,
          wilson: wilson * 100,
        });
      }
    }
  }
  
  if (pairs.length === 0) return null;
  
  // Sort by win rate, then by total games
  pairs.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.total - a.total;
  });
  
  return pairs;
}

/**
 * Find best skill pair for a given hero
 */
function findBestSkillPair(hero, skillHeroPairStats, availableSkills) {
  const skills = [];
  
  for (const [pairKey, stats] of Object.entries(skillHeroPairStats)) {
    const [heroName, skill] = pairKey.split(',');
    if (heroName === hero && availableSkills.includes(skill)) {
      const totalGames = stats.wins + stats.losses;
      if (totalGames >= 1) {
        const winRate = stats.wins / totalGames;
        const wilson = stats.wilson ?? 0;
        skills.push({
          skill,
          wins: stats.wins,
          losses: stats.losses,
          total: totalGames,
          winRate: winRate * 100,
          wilson: wilson * 100,
        });
      }
    }
  }
  
  if (skills.length === 0) return null;
  
  // Sort by win rate, then by total games
  skills.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.total - a.total;
  });
  
  return skills;
}

const TeamBuilder = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useGame();
  const [recommendedCombos, setRecommendedCombos] = useState([]);
  const [heroBestPairs, setHeroBestPairs] = useState({});
  const [loading, setLoading] = useState(true);
  
  const { gameState, availableHeroes, availableSkills } = state;

  const heroes = gameState?.current_heroes || [];
  const skills = gameState?.current_skills || [];

  useEffect(() => {
    const findRecommendedCombos = (stats, heroPool) => {
      if (!stats || !stats.hero_combinations || heroPool.length < 3) {
        setRecommendedCombos([]);
        setHeroBestPairs({});
        return;
      }

      const heroCombinations = stats.hero_combinations || {};
      const allCombos = generate3HeroCombinations(heroPool);
      const goodCombos = [];

      for (const combo of allCombos) {
        const comboKey = combo.join(',');
        const comboStats = heroCombinations[comboKey];
        
        if (comboStats) {
          const totalGames = comboStats.wins + comboStats.losses;
          const winRate = comboStats.wins / totalGames;
          
          goodCombos.push({
            heroes: combo,
            wins: comboStats.wins,
            losses: comboStats.losses,
            total: totalGames,
            winRate: winRate * 100,
          });
        }
      }

      // Sort by win rate (descending), then by total games
      goodCombos.sort((a, b) => {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.total - a.total;
      });

      setRecommendedCombos(goodCombos);
    };

    const findBestPairsForHeroes = (stats, heroPool, skillPool) => {
      const pairs = {};
      const heroPairStats = stats.hero_pair_stats || {};
      const skillHeroPairStats = stats.skill_hero_pair_stats || {};
      
      // Find best pairs for ALL heroes in the current hero pool
      for (const hero of heroPool) {
        const bestHeroPair = findBestHeroPair(hero, heroPairStats, heroPool);
        const bestSkillPair = findBestSkillPair(hero, skillHeroPairStats, skillPool || []);
        
        pairs[hero] = {
          bestHeroPair,
          bestSkillPair,
        };
      }
      
      setHeroBestPairs(pairs);
    };

    const loadBattleStats = () => {
      try {
        setLoading(true);
        // Use imported battle stats data
        findRecommendedCombos(battleStatsData, heroes);
        findBestPairsForHeroes(battleStatsData, heroes, skills);
      } catch (err) {
        console.error('Failed to load battle stats:', err);
        setRecommendedCombos([]);
        setHeroBestPairs({});
      } finally {
        setLoading(false);
      }
    };

    if (heroes.length > 0) {
      loadBattleStats();
    } else {
      setRecommendedCombos([]);
      setHeroBestPairs({});
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroes.join(','), skills.join(',')]);

  const handleUpdateTeam = (updatedHeroes, updatedSkills) => {
    dispatch({
      type: 'UPDATE_TEAM',
      heroes: updatedHeroes,
      skills: updatedSkills,
    });
  };

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 4 }}>
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(-1)}
            variant="outlined"
          >
            Back
          </Button>
          <Typography variant="h4">
            🛠️ Build Your Team
          </Typography>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body1" color="text.secondary" paragraph>
            View and manage your current team composition. Hero building features will be available soon.
          </Typography>
        </Box>

        <CurrentTeam
          heroes={heroes}
          skills={skills}
          availableHeroes={availableHeroes}
          availableSkills={availableSkills}
          editable={true}
          onUpdateTeam={handleUpdateTeam}
        />

        {/* Recommended Team Combinations */}
        {heroes.length >= 3 && (
          <Card sx={{ mt: 4 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                💡 可能的队伍组合
              </Typography>
              {loading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>Loading recommendations...</Typography>
                </Box>
              ) : recommendedCombos.length === 0 ? (
                <Alert severity="info">
                  No proven winning combinations found in your current hero pool.
                </Alert>
              ) : (
                <Grid container spacing={2}>
                  {recommendedCombos.map((combo, idx) => (
                    <Grid item size={{ xs: 12, sm: 6, md: 4 }} key={idx}>
                      <Card 
                        variant="outlined"
                        sx={{ 
                          height: '100%',
                          borderColor: combo.winRate >= 60 ? 'success.main' : 'primary.main',
                          borderWidth: 2,
                        }}
                      >
                        <CardContent>
                          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            Team {idx + 1}
                          </Typography>
                          <Box sx={{ mb: 2 }}>
                            {combo.heroes.map((hero, i) => (
                              <Chip
                                key={i}
                                label={hero}
                                color="primary"
                                size="small"
                                sx={{ mr: 0.5, mb: 0.5 }}
                              />
                            ))}
                          </Box>
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              Win Rate: <strong>{combo.winRate.toFixed(1)}%</strong>
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                              {combo.wins} Wins / {combo.total} Games
                            </Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>
        )}

        {/* Hero Best Pairs Section - Show for all heroes */}
        {heroes.length > 0 && (
          <Card sx={{ mt: 4 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                🎯 Best Pairs for Each Hero
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph sx={{ mb: 3 }}>
                For each hero in your current team, here are their best hero partner (from your current hero pool) and best skill pairs (from your current skills) based on historical performance.
              </Typography>

              {loading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>Loading best pairs...</Typography>
                </Box>
              ) : Object.keys(heroBestPairs).length === 0 ? (
                <Alert severity="info">
                  No pair data available for your current heroes.
                </Alert>
              ) : (
                <Grid container spacing={2}>
                  {Object.entries(heroBestPairs).map(([hero, pairs]) => (
                    <Grid item size={{ xs: 12, sm: 6, md: 4 }} key={hero}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            {hero}
                          </Typography>
                          
                          {/* Best Hero Pair */}
                          <Box sx={{ mb: 2 }}>
                            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                              Best Hero Partners:
                            </Typography>
                            {pairs.bestHeroPair && pairs.bestHeroPair.length > 0 ? (
                              <Box>
                                {pairs.bestHeroPair.map((heroPairData, idx) => (
                                  <Box key={idx} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Chip
                                      label={heroPairData.partner}
                                      color="primary"
                                      size="small"
                                    />
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                      Win Rate: <strong>{heroPairData.winRate.toFixed(1)}%</strong> 
                                      ({heroPairData.wins}W / {heroPairData.total}G)
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                No data available
                              </Typography>
                            )}
                          </Box>

                          {/* Best Skill Pair */}
                          <Box>
                            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                              Best Skill Pair:
                            </Typography>
                            {pairs.bestSkillPair && pairs.bestSkillPair.length > 0 ? (
                              <Box>
                                {pairs.bestSkillPair.map((skillData, idx) => (
                                  <Box key={idx} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Chip
                                      label={skillData.skill}
                                      color="secondary"
                                      size="small"
                                    />
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                      Win Rate: <strong>{skillData.winRate.toFixed(1)}%</strong> 
                                      ({skillData.wins}W / {skillData.total}G)
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                No data available
                              </Typography>
                            )}
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>
        )}

        {heroes.length < 3 && (
          <Alert severity="info" sx={{ mt: 4 }}>
            You need at least 3 heroes in your team to see combination recommendations.
          </Alert>
        )}
      </Box>
    </Container>
  );
};

export default TeamBuilder;

