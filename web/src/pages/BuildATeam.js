import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Grid,
  Chip,
  Alert,
  Snackbar,
  Divider,
  Stack,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CloseIcon from '@mui/icons-material/Close';
import { useGame } from '../context/GameContext';
import { storage } from '../utils/storage';

const NUM_TEAMS = 3;
const HEROES_PER_TEAM = 3;
const SKILLS_PER_HERO = 2;

// Drag payload mime keys
const DRAG_KIND = 'application/x-sanmou-kind'; // 'hero' | 'skill'
const DRAG_VALUE = 'application/x-sanmou-value';

const createEmptyTeams = () =>
  Array.from({ length: NUM_TEAMS }, () => ({
    heroes: Array.from({ length: HEROES_PER_TEAM }, () => ({
      hero: null,
      skills: Array.from({ length: SKILLS_PER_HERO }, () => null),
    })),
  }));

/**
 * Normalize a possibly-stale cookie payload into the strict
 * 3x3x2 shape so the UI never crashes on malformed data.
 */
const normalizeTeams = (raw) => {
  const base = createEmptyTeams();
  if (!Array.isArray(raw)) return base;
  for (let t = 0; t < NUM_TEAMS; t += 1) {
    const team = raw[t];
    if (!team || !Array.isArray(team.heroes)) continue;
    for (let h = 0; h < HEROES_PER_TEAM; h += 1) {
      const slot = team.heroes[h];
      if (!slot) continue;
      base[t].heroes[h].hero = typeof slot.hero === 'string' ? slot.hero : null;
      if (Array.isArray(slot.skills)) {
        for (let s = 0; s < SKILLS_PER_HERO; s += 1) {
          base[t].heroes[h].skills[s] =
            typeof slot.skills[s] === 'string' ? slot.skills[s] : null;
        }
      }
    }
  }
  return base;
};

const BuildATeam = () => {
  const { state } = useGame();
  const gameState = state.gameState;

  // Full pool from the current gameState (restored from the cookie on mount).
  const allPoolHeroes = useMemo(
    () => (gameState?.current_heroes ? [...new Set(gameState.current_heroes)] : []),
    [gameState]
  );
  const allPoolSkills = useMemo(
    () => (gameState?.current_skills ? [...new Set(gameState.current_skills)] : []),
    [gameState]
  );

  const [teams, setTeams] = useState(createEmptyTeams);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const hydratedRef = useRef(false);

  // Restore saved arrangement once on mount.
  useEffect(() => {
    const saved = storage.loadTeamBuilder();
    if (saved) {
      setTeams(normalizeTeams(saved));
    }
    hydratedRef.current = true;
  }, []);

  // Auto-save whenever the arrangement changes (after the initial hydration).
  useEffect(() => {
    if (!hydratedRef.current) return;
    storage.saveTeamBuilder(teams);
  }, [teams]);

  // Items already placed in a slot are removed from the pool (and returned when cleared).
  const { usedHeroes, usedSkills } = useMemo(() => {
    const heroes = new Set();
    const skills = new Set();
    teams.forEach((team) =>
      team.heroes.forEach((slot) => {
        if (slot.hero) heroes.add(slot.hero);
        slot.skills.forEach((s) => s && skills.add(s));
      })
    );
    return { usedHeroes: heroes, usedSkills: skills };
  }, [teams]);

  const poolHeroes = useMemo(
    () => allPoolHeroes.filter((h) => !usedHeroes.has(h)),
    [allPoolHeroes, usedHeroes]
  );
  const poolSkills = useMemo(
    () => allPoolSkills.filter((s) => !usedSkills.has(s)),
    [allPoolSkills, usedSkills]
  );

  // Display plain names only (no rank/tier label suffix like “（输出核心#3）”).
  const heroLabel = (name) => name;
  const skillLabel = (name) => name;

  // ---- Drag handlers ----
  const handleDragStart = (kind, value) => (e) => {
    e.dataTransfer.setData(DRAG_KIND, kind);
    e.dataTransfer.setData(DRAG_VALUE, value);
    // Fallback for browsers that only expose text/plain during dragover.
    e.dataTransfer.setData('text/plain', value);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const allowDrop = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDropHero = (teamIdx, heroIdx) => (e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData(DRAG_KIND);
    const value = e.dataTransfer.getData(DRAG_VALUE) || e.dataTransfer.getData('text/plain');
    if (kind !== 'hero' || !value) return;
    setTeams((prev) => {
      const next = structuredClone(prev);
      next[teamIdx].heroes[heroIdx].hero = value;
      return next;
    });
  };

  const handleDropSkill = (teamIdx, heroIdx, skillIdx) => (e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData(DRAG_KIND);
    const value = e.dataTransfer.getData(DRAG_VALUE) || e.dataTransfer.getData('text/plain');
    if (kind !== 'skill' || !value) return;
    setTeams((prev) => {
      const next = structuredClone(prev);
      next[teamIdx].heroes[heroIdx].skills[skillIdx] = value;
      return next;
    });
  };

  const clearHero = (teamIdx, heroIdx) => {
    setTeams((prev) => {
      const next = structuredClone(prev);
      next[teamIdx].heroes[heroIdx].hero = null;
      return next;
    });
  };

  const clearSkill = (teamIdx, heroIdx, skillIdx) => {
    setTeams((prev) => {
      const next = structuredClone(prev);
      next[teamIdx].heroes[heroIdx].skills[skillIdx] = null;
      return next;
    });
  };

  const clearAll = () => {
    setTeams(createEmptyTeams());
    setSnackbar({ open: true, message: '已清空所有队伍', severity: 'info' });
  };

  // ---- Copy in team-damage-analysis SKILL.md input format ----
  const buildCopyText = () => {
    const lines = ['team-damage'];
    let hasAny = false;
    teams.forEach((team, tIdx) => {
      const heroLines = [];
      team.heroes.forEach((slot) => {
        if (!slot.hero) return;
        const skills = slot.skills.filter(Boolean);
        const skillText = skills.length ? skills.join('、') : '（未分配战法）';
        heroLines.push(`- ${slot.hero}：${skillText}`);
      });
      if (heroLines.length === 0) return;
      hasAny = true;
      lines.push(`队伍${tIdx + 1}：`);
      lines.push(...heroLines);
    });
    return hasAny ? lines.join('\n') : '';
  };

  const handleCopy = async () => {
    const text = buildCopyText();
    if (!text) {
      setSnackbar({ open: true, message: '请先放入至少一个武将', severity: 'warning' });
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setSnackbar({ open: true, message: '已复制 team-damage 配置', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: '复制失败，请手动复制', severity: 'error' });
    }
  };

  // ---- Renderers ----
  const renderHeroSlot = (teamIdx, heroIdx, slot) => (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, mb: 1.5, bgcolor: 'background.default' }}
    >
      <Box
        data-testid={`hero-slot-${teamIdx}-${heroIdx}`}
        onDragOver={allowDrop}
        onDrop={handleDropHero(teamIdx, heroIdx)}
        sx={{
          minHeight: 40,
          border: '1px dashed',
          borderColor: slot.hero ? 'primary.main' : 'grey.400',
          borderRadius: 1,
          px: 1,
          py: 0.75,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          bgcolor: slot.hero ? 'primary.50' : 'transparent',
        }}
      >
        {slot.hero ? (
          <>
            <Typography variant="body2" fontWeight={700} noWrap>
              {heroLabel(slot.hero)}
            </Typography>
            <CloseIcon
              fontSize="small"
              role="button"
              aria-label={`移除武将 ${slot.hero}`}
              onClick={() => clearHero(teamIdx, heroIdx)}
              sx={{ cursor: 'pointer', color: 'text.secondary' }}
            />
          </>
        ) : (
          <Typography variant="caption" color="text.secondary">
            拖入武将
          </Typography>
        )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        {slot.skills.map((skill, skillIdx) => (
          <Box
            key={skillIdx}
            data-testid={`skill-slot-${teamIdx}-${heroIdx}-${skillIdx}`}
            onDragOver={allowDrop}
            onDrop={handleDropSkill(teamIdx, heroIdx, skillIdx)}
            sx={{
              flex: 1,
              minHeight: 34,
              border: '1px dashed',
              borderColor: skill ? 'secondary.main' : 'grey.300',
              borderRadius: 1,
              px: 1,
              py: 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 0.5,
              bgcolor: skill ? 'secondary.50' : 'transparent',
            }}
          >
            {skill ? (
              <>
                <Typography variant="caption" noWrap title={skill}>
                  {skillLabel(skill)}
                </Typography>
                <CloseIcon
                  sx={{ fontSize: 16, cursor: 'pointer', color: 'text.secondary' }}
                  role="button"
                  aria-label={`移除战法 ${skill}`}
                  onClick={() => clearSkill(teamIdx, heroIdx, skillIdx)}
                />
              </>
            ) : (
              <Typography variant="caption" color="text.secondary">
                战法{skillIdx + 1}
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
    </Paper>
  );

  const noPool = poolHeroes.length === 0 && poolSkills.length === 0;

  return (
    <Box sx={{ p: { xs: 1, sm: 2 } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={800}>
            组队 / Build a Team
          </Typography>
          <Typography variant="body2" color="text.secondary">
            从当前卡池拖拽武将与战法到 3 支队伍（每队 3 武将，每武将 2 战法）。放入后会从卡池移除，清除槽位即可放回。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopy}
          >
            复制 team-damage 配置
          </Button>
          <Button
            variant="contained"
            color="error"
            startIcon={<DeleteSweepIcon />}
            onClick={clearAll}
          >
            清空
          </Button>
        </Stack>
      </Stack>

      {noPool && (
        <Alert severity="info" sx={{ mb: 2 }}>
          当前卡池为空。请先在首页（推荐器）设置并进行选秀，卡池会保存在 Cookie 中后再回到本页。
        </Alert>
      )}

      {/* Pool panel — full width */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          卡池武将（{poolHeroes.length}）
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {poolHeroes.map((hero) => (
            <Chip
              key={hero}
              data-testid={`pool-hero-${hero}`}
              label={heroLabel(hero)}
              size="small"
              color="primary"
              variant="filled"
              draggable
              onDragStart={handleDragStart('hero', hero)}
              sx={{
                cursor: 'grab',
                fontWeight: 600,
                boxShadow: 1,
                border: '1px solid',
                borderColor: 'primary.dark',
                '&:hover': { boxShadow: 3, filter: 'brightness(1.05)' },
                '&:active': { cursor: 'grabbing', boxShadow: 0 },
              }}
            />
          ))}
          {poolHeroes.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              暂无武将
            </Typography>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          卡池战法（{poolSkills.length}）
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {poolSkills.map((skill) => (
            <Chip
              key={skill}
              data-testid={`pool-skill-${skill}`}
              label={skillLabel(skill)}
              size="small"
              color="secondary"
              variant="filled"
              draggable
              onDragStart={handleDragStart('skill', skill)}
              sx={{
                cursor: 'grab',
                fontWeight: 600,
                boxShadow: 1,
                border: '1px solid',
                borderColor: 'secondary.dark',
                '&:hover': { boxShadow: 3, filter: 'brightness(1.05)' },
                '&:active': { cursor: 'grabbing', boxShadow: 0 },
              }}
            />
          ))}
          {poolSkills.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              暂无战法
            </Typography>
          )}
        </Box>
      </Paper>

      {/* Teams — full width, 3 columns */}
      <Grid container spacing={2}>
        {teams.map((team, teamIdx) => (
          <Grid item xs={12} md={4} key={teamIdx}>
            <Paper sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                队伍 {teamIdx + 1}
              </Typography>
              {team.heroes.map((slot, heroIdx) => (
                <React.Fragment key={heroIdx}>
                  {renderHeroSlot(teamIdx, heroIdx, slot)}
                </React.Fragment>
              ))}
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={2500}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default BuildATeam;
