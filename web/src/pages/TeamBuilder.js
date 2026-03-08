import React, { useState, useEffect } from 'react';
import { Container, Box, Typography, Button, Card, CardContent, Grid, Chip, Alert, Divider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import CurrentTeam from '../components/game/CurrentTeam';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import battleStatsData from '../battle_stats.json';
import { recommendTeams } from '../services/recommendationEngine';

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
  const [recommendedTeams, setRecommendedTeams] = useState(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  
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

  useEffect(() => {
    if (heroes.length >= 9 && skills.length >= 18) {
      setTeamsLoading(true);
      try {
        const result = recommendTeams(heroes, skills, battleStatsData);
        setRecommendedTeams(result);
      } catch (err) {
        console.error('Failed to recommend teams:', err);
        setRecommendedTeams(null);
      } finally {
        setTeamsLoading(false);
      }
    } else {
      setRecommendedTeams(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroes.join(','), skills.join(',')]);

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 4 }}>
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(-1)}
            variant="outlined"
          >
            返回
          </Button>
          <Typography variant="h4">
            🛠️ 查看队伍推荐
          </Typography>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body1" color="text.secondary" paragraph>
            查看与管理当前队伍配置。
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

        {/* Recommend Teams Results */}
        {heroes.length >= 9 && skills.length >= 18 && (
          <Card sx={{ mt: 4 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                🏆 推荐组队
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                根据当前武将和战法池，自动推荐 3 支队伍。每支队伍 3 名武将，每名武将分配 2 个战法。
              </Typography>

              {teamsLoading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>正在推荐...</Typography>
                </Box>
              ) : recommendedTeams && recommendedTeams.teams.length > 0 ? (
                <Grid container spacing={3}>
                  {recommendedTeams.teams.map((team, teamIdx) => (
                    <Grid item size={{ xs: 12, md: 4 }} key={teamIdx}>
                      <Card
                        variant="outlined"
                        sx={{
                          height: '100%',
                          borderColor: teamIdx === 0 ? 'success.main' : teamIdx === 1 ? 'primary.main' : 'warning.main',
                          borderWidth: 2,
                        }}
                      >
                        <CardContent>
                          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            队伍 {teamIdx + 1}
                          </Typography>
                          {team.comboStats && (
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                              组合胜率：<strong>{(team.comboStats.wilson * 100).toFixed(1)}%</strong>
                              {' '}({team.comboStats.wins}胜 / {team.comboStats.total}场)
                            </Typography>
                          )}
                          <Divider sx={{ mb: 2 }} />
                          {team.heroes.map((hero, heroIdx) => (
                            <Box key={heroIdx} sx={{ mb: 2 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <Chip
                                  label={hero.name}
                                  color="primary"
                                  size="small"
                                  sx={{ fontWeight: 'bold' }}
                                />
                              </Box>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {hero.skills.length > 0 ? hero.skills.map((skill, skillIdx) => {
                                  const detail = hero.skillDetails?.[skillIdx];
                                  return (
                                    <Chip
                                      key={skillIdx}
                                      label={
                                        detail?.pairInfo
                                          ? `${skill} (${(detail.pairInfo.wilson * 100).toFixed(0)}%)`
                                          : skill
                                      }
                                      color="secondary"
                                      size="small"
                                      variant="outlined"
                                    />
                                  );
                                }) : (
                                  <Typography variant="caption" color="text.secondary">
                                    暂无匹配战法
                                  </Typography>
                                )}
                              </Box>
                            </Box>
                          ))}
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              ) : recommendedTeams ? (
                <Alert severity="info">
                  当前武将和战法池不足以推荐完整的队伍。需要至少 9 名武将和 6 个战法。
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        )}

        {heroes.length > 0 && (heroes.length < 9 || skills.length < 18) && (
          <Alert severity="info" sx={{ mt: 4 }}>
            推荐组队需要至少 9 名武将和 18 个战法。当前：{heroes.length} 名武将、{skills.length} 个战法。
          </Alert>
        )}

        {/* Recommended Team Combinations */}
        {heroes.length >= 3 && (
          <Card sx={{ mt: 4 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                💡 可能的队伍组合
              </Typography>
              {loading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>正在加载推荐...</Typography>
                </Box>
              ) : recommendedCombos.length === 0 ? (
                <Alert severity="info">
                  当前武将池中暂无历史胜率组合。
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
                            队伍 {idx + 1}
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
                              胜率：<strong>{combo.winRate.toFixed(1)}%</strong>
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                              {combo.wins} 胜 / {combo.total} 场
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
                🎯 每位武将的最佳搭配
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph sx={{ mb: 3 }}>
                根据历史表现，展示当前队伍中每位武将的最佳武将搭档与最佳战法搭配。
              </Typography>

              {loading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>正在加载最佳搭配...</Typography>
                </Box>
              ) : Object.keys(heroBestPairs).length === 0 ? (
                <Alert severity="info">
                  当前武将暂无配对数据。
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
                              最佳武将搭档：
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
                                      胜率：<strong>{heroPairData.winRate.toFixed(1)}%</strong> 
                                      ({heroPairData.wins}胜 / {heroPairData.total}场)
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                暂无数据
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
                                      胜率：<strong>{skillData.winRate.toFixed(1)}%</strong> 
                                      ({skillData.wins}胜 / {skillData.total}场)
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                暂无数据
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
            队伍至少需要 3 名武将才能查看组合推荐。
          </Alert>
        )}
      </Box>
    </Container>
  );
};

export default TeamBuilder;

