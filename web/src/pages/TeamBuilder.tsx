import { useState, useEffect } from 'react';
import { Container, Box, Typography, Button, Card, CardContent, Grid, Chip, Alert, Divider, Snackbar } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import CurrentTeam from '../components/game/CurrentTeam';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import { recommendationData } from '../data';
import { recommendTeams, type FormationRecommendation } from '../services/recommendationEngine';
import { generateTeamBuilderPrompt } from '../services/promptGenerator';
import { copyToClipboard } from '../utils/clipboard';

/**
 * Team Builder page. Shows the current pool and, once the pool is complete
 * (≥9 heroes / ≥18 skills), the globally-optimised three teams: the formation
 * optimiser jointly picks three disjoint 3-hero teams and a unique 18-skill
 * assignment, maximising aggregate relative roster strength with a
 * weakest-team/balance consideration (not a greedy team-one-first build).
 */
const TeamBuilder = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useGame();
  const [formation, setFormation] = useState<FormationRecommendation | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const { gameState, availableHeroes, availableSkills } = state;

  const heroes = [
    ...(gameState?.current_heroes || []),
    ...(gameState?.support_hero ? [gameState.support_hero] : []),
  ];
  const skills = [
    ...(gameState?.current_skills || []),
    ...(gameState?.support_skills || []),
  ];

  const handleUpdateTeam = (updatedHeroes: string[], updatedSkills: string[]) => {
    dispatch({ type: 'UPDATE_TEAM', heroes: updatedHeroes, skills: updatedSkills });
  };

  const handleCopyPrompt = async () => {
    try {
      const prompt = await generateTeamBuilderPrompt(heroes, skills);
      await copyToClipboard(prompt);
      setSnackbarMessage('已复制到剪贴板！可粘贴到 ChatGPT 等 LLM 进行分析。');
    } catch (err) {
      setSnackbarMessage('生成提示词失败：' + (err as Error).message);
      console.error(err);
    }
    setSnackbarOpen(true);
  };

  useEffect(() => {
    if (heroes.length >= 9 && skills.length >= 18) {
      setTeamsLoading(true);
      setFormation(null);
      let cancelled = false;
      // Defer the heavy synchronous optimisation to a later task so the
      // loading state paints first (otherwise the state updates batch in one
      // tick and the spinner never renders). Cancel stale runs on re-entry.
      const handle = setTimeout(() => {
        try {
          const result = recommendTeams(heroes, skills, recommendationData, recommendationData.catalog);
          if (!cancelled) setFormation(result);
        } catch (err) {
          console.error('Failed to recommend teams:', err);
          if (!cancelled) setFormation(null);
        } finally {
          if (!cancelled) setTeamsLoading(false);
        }
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(handle);
      };
    }
    setFormation(null);
    setTeamsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroes.join(','), skills.join(',')]);

  const teamBorder = (i: number) => (i === 0 ? 'success.main' : i === 1 ? 'primary.main' : 'warning.main');

  return (
    <Container maxWidth="xl" disableGutters>
      <Box>
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, borderBottom: '2px solid', borderColor: 'text.primary', pb: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} variant="contained">
            返回
          </Button>
          <Box>
            <Typography variant="overline" color="error.main" sx={{ display: 'block', lineHeight: 1.2 }}>FORMATION DOSSIER</Typography>
            <Typography component="h1" variant="h3">队伍策案</Typography>
          </Box>
          {heroes.length >= 3 && (
            <Button startIcon={<ContentCopyIcon />} onClick={handleCopyPrompt} variant="contained" color="secondary" sx={{ ml: 'auto' }}>
              复制LLM提示词
            </Button>
          )}
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body1" color="text.secondary" paragraph>
            查看与管理当前队伍配置。填满 9 名武将与 18 个战法后，将自动给出全局最优的三队编排。
          </Typography>
        </Box>

        <CurrentTeam
          heroes={gameState?.current_heroes || []}
          skills={gameState?.current_skills || []}
          availableHeroes={availableHeroes}
          availableSkills={availableSkills}
          editable={true}
          onUpdateTeam={handleUpdateTeam}
          supportHero={gameState?.support_hero || null}
          supportSkills={gameState?.support_skills || []}
        />

        {/* Globally-optimised formation */}
        {heroes.length >= 9 && skills.length >= 18 && (
          <Card sx={{ mt: 4 }}>
            <CardContent>
              <Typography component="h2" variant="h6" gutterBottom>
                全局最优编排
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                同时优化三支互不重叠的队伍与 18 个战法的唯一分配，最大化整体相对阵容强度，并兼顾各队均衡（避免最弱一队过弱）。分数为相对强度，非对特定对手的胜率。
              </Typography>

              {teamsLoading ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>正在优化...</Typography>
                </Box>
              ) : formation && !formation.incomplete ? (
                <>
                  <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    <Chip label={`整体强度 ${formation.aggregateStrength.toFixed(1)}`} color="primary" />
                    <Chip label={`最弱一队 ${formation.weakestTeamStrength.toFixed(1)}`} color="warning" variant="outlined" />
                    <Chip label={`均衡差 ${formation.balanceSpread.toFixed(1)}`} variant="outlined" />
                    <Chip label={`目标值 ${formation.objective.toFixed(1)}`} variant="outlined" />
                  </Box>
                  <Grid container spacing={3}>
                    {formation.teams.map((team, teamIdx) => (
                      <Grid size={{ xs: 12, md: 4 }} key={teamIdx}>
                        <Card variant="outlined" sx={{ height: '100%', borderColor: teamBorder(teamIdx), borderWidth: 2 }}>
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                              <Typography component="h3" variant="subtitle1" fontWeight="bold">
                                队伍 {teamIdx + 1}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                强度 <strong>{team.strength.toFixed(1)}</strong>
                              </Typography>
                            </Box>
                            <Divider sx={{ mb: 2 }} />
                            {team.heroes.map((hero, heroIdx) => (
                              <Box key={heroIdx} sx={{ mb: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                  <Chip label={hero.name} color="primary" size="small" sx={{ fontWeight: 'bold' }} />
                                </Box>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {hero.skills.length > 0 ? hero.skills.map((skill, skillIdx) => (
                                    <Chip key={skillIdx} label={skill} color="secondary" size="small" variant="outlined" />
                                  )) : (
                                    <Typography variant="caption" color="text.secondary">暂无匹配战法</Typography>
                                  )}
                                </Box>
                              </Box>
                            ))}
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                </>
              ) : (
                <Alert severity="info">
                  当前武将和战法池不足以推荐完整的编排。需要至少 9 名武将和 18 个战法。
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {heroes.length > 0 && (heroes.length < 9 || skills.length < 18) && (
          <Alert severity="info" sx={{ mt: 4 }}>
            全局编排需要至少 9 名武将和 18 个战法。当前：{heroes.length} 名武将、{skills.length} 个战法。
          </Alert>
        )}

        {heroes.length === 0 && (
          <Alert severity="info" sx={{ mt: 4 }}>
            请先录入当前阵容。
          </Alert>
        )}
      </Box>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />
    </Container>
  );
};

export default TeamBuilder;
