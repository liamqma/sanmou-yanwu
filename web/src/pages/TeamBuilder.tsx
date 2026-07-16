import { useState, useEffect } from 'react';
import { Container, Box, Typography, Button, Card, CardContent, Grid, Chip, Alert, Divider, Snackbar, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import CurrentTeam from '../components/game/CurrentTeam';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import { recommendationData, database } from '../data';
import {
  recommendTeams,
  type FormationRecommendation,
  type HeroMeta,
  type TeamEvidence,
} from '../services/recommendationEngine';
import { generateTeamBuilderPrompt } from '../services/promptGenerator';
import { copyToClipboard } from '../utils/clipboard';

// Soft 阵营/定位 metadata for the optimiser, sourced cleanly from the database.
// Derived once at module load; passed to recommendTeams so the deterministic
// recommendation can apply its best-effort role/camp preferences.
const HERO_META: HeroMeta = Object.fromEntries(
  Object.entries(database.heroes || {}).map(([name, hero]) => [
    name,
    { camp: hero.camp, label: hero.label },
  ])
);

/**
 * Compact positive paired-model evidence under a team. Groups are shown with
 * plain wording (武将配合 / 武将与战法 / 战法搭配); each non-empty group shows its
 * top rows as `加分 +N.N · 参考 K 场`. No win probabilities or deductions.
 */
const TeamEvidenceView = ({ evidence }: { evidence: TeamEvidence }) => {
  const groups: { title: string; rows: TeamEvidence['heroSynergy'] }[] = [
    { title: '武将配合', rows: evidence.heroSynergy },
    { title: '武将与战法', rows: evidence.heroSkill },
    { title: '战法搭配', rows: evidence.skillSynergy },
  ].filter((g) => g.rows.length > 0);

  if (groups.length === 0) return null;

  return (
    <>
      <Divider sx={{ my: 1.5 }} />
      {groups.map((group) => (
        <Box key={group.title} sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', display: 'block' }}>
            {group.title}
          </Typography>
          {group.rows.map((row, i) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="caption" color="text.primary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.label}
              </Typography>
              <Typography variant="caption" color="success.main" sx={{ whiteSpace: 'nowrap' }}>
                加分 +{row.gain.toFixed(1)} · 参考 {row.support} 场
              </Typography>
            </Box>
          ))}
        </Box>
      ))}
    </>
  );
};

/**
 * Team Builder page. Shows the current pool and, once the pool is complete
 * (≥9 heroes / ≥18 skills), up to three recommended formation options
 * (方案一（推荐）/方案二/方案三). A compact segmented selector switches between
 * options; each shows three disjoint 3-hero teams, and every team card header
 * carries its own 评分 (relative roster strength). No aggregate score or
 * optimiser internals are surfaced.
 */
const TeamBuilder = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useGame();
  const [formation, setFormation] = useState<FormationRecommendation | null>(null);
  // The pool key that `formation` was computed for (null while nothing has been
  // computed yet). Lets render synchronously tell whether the current eligible
  // pool's optimisation has completed — see `isPending` below.
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  // Which formation option (方案) is currently displayed. Reset to the
  // recommended option (index 0) whenever a fresh formation is computed.
  const [selectedOption, setSelectedOption] = useState(0);

  const { gameState, availableHeroes, availableSkills } = state;

  const heroes = [
    ...(gameState?.current_heroes || []),
    ...(gameState?.support_hero ? [gameState.support_hero] : []),
  ];
  const skills = [
    ...(gameState?.current_skills || []),
    ...(gameState?.support_skills || []),
  ];

  // Whether the current pool is eligible for a full 3-team optimisation.
  const isEligible = heroes.length >= 9 && skills.length >= 18;
  // A pool-identity key computed synchronously every render. Only meaningful
  // for eligible pools. Changing heroes/skills changes this key immediately.
  const poolKey = isEligible ? JSON.stringify([heroes, skills]) : null;
  // The current eligible pool is pending whenever its result has not yet been
  // computed (resultKey !== poolKey). This is known synchronously on the very
  // first paint — before the useEffect runs — so no false insufficient warning
  // can flash while optimisation is in flight.
  const isPending = isEligible && resultKey !== poolKey;

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
    if (isEligible && poolKey) {
      let cancelled = false;
      // Defer the heavy synchronous optimisation to a later task so the
      // loading state paints first (otherwise the state updates batch in one
      // tick and the spinner never renders). Cancel stale runs on re-entry.
      // `isPending` (derived synchronously from resultKey !== poolKey) already
      // guarantees the loading state renders on the very first paint, so we
      // only need to publish the result and mark this pool key as completed.
      const handle = setTimeout(() => {
        let result: FormationRecommendation | null = null;
        try {
          result = recommendTeams(
            heroes,
            skills,
            recommendationData,
            recommendationData.catalog,
            HERO_META,
          );
        } catch (err) {
          console.error('Failed to recommend teams:', err);
          result = null;
        }
        if (!cancelled) {
          setFormation(result);
          setSelectedOption(0);
          // Mark this pool key as completed (even on failure) so the render
          // switches from loading to either the formation or the incomplete
          // warning. Stale runs are ignored via the `cancelled` guard.
          setResultKey(poolKey);
        }
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(handle);
      };
    }
    // Ineligible pool: drop any stale result so re-eligibility recomputes.
    setFormation(null);
    setResultKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey]);

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
            查看与管理当前队伍配置。填满 9 名武将与 18 个战法后，将自动给出至多三套推荐编排。
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
        {isEligible && (
          <Card sx={{ mt: 4 }}>
            <CardContent>
              <Typography component="h2" variant="h6" gutterBottom>
                推荐编排
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                为当前武将与战法池给出至多三套可选编排。切换方案查看不同的三队组合，每支队伍单独给出评分。
              </Typography>

              {isPending ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography>正在优化...</Typography>
                </Box>
              ) : formation && !formation.incomplete && formation.options.length > 0 ? (
                <>
                  {formation.options.length > 1 && (
                    <Box sx={{ mb: 2 }}>
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        color="primary"
                        value={Math.min(selectedOption, formation.options.length - 1)}
                        onChange={(_e, value) => {
                          if (value !== null) setSelectedOption(value);
                        }}
                        aria-label="方案选择"
                      >
                        {formation.options.map((_opt, i) => (
                          <ToggleButton key={i} value={i}>
                            {i === 0 ? '方案一（推荐）' : i === 1 ? '方案二' : '方案三'}
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                    </Box>
                  )}
                  <Grid container spacing={3}>
                    {formation.options[Math.min(selectedOption, formation.options.length - 1)].teams.map((team, teamIdx) => (
                      <Grid size={{ xs: 12, md: 4 }} key={teamIdx}>
                        <Card variant="outlined" sx={{ height: '100%', borderColor: teamBorder(teamIdx), borderWidth: 2 }}>
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                              <Typography component="h3" variant="subtitle1" fontWeight="bold">
                                队伍 {teamIdx + 1}
                              </Typography>
                              <Typography variant="subtitle2" color="text.secondary" fontWeight="bold">
                                评分：{team.strength.toFixed(1)}
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
                            <TeamEvidenceView evidence={team.evidence} />
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
