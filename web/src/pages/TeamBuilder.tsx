import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Paper,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import CurrentTeam from '../components/game/CurrentTeam';
import FormationWorkbench from '../components/teamBuilder/FormationWorkbench';
import { useGame } from '../context/GameContext';
import { database, recommendationData } from '../data';
import {
  recommendTeams,
  type FormationRecommendation,
  type HeroMeta,
} from '../services/recommendationEngine';
import {
  generateTeamShareText,
  generateTeamValidationPrompt,
} from '../services/promptGenerator';
import {
  applyTeamBuilderMove,
  createEmptyTeamBuilderLayout,
  createStoredTeamBuilderLayout,
  layoutFromFormation,
  normalizeTeamBuilderLayout,
  teamBuilderLayoutHasHero,
  teamBuilderPoolKey,
  type TeamBuilderLayout,
  type TeamBuilderMoveSource,
  type TeamBuilderMoveTarget,
  type TeamBuilderRow,
} from '../services/teamBuilderArrangement';
import { copyToClipboard } from '../utils/clipboard';
import { storage } from '../utils/storage';

const HERO_META: HeroMeta = Object.fromEntries(
  Object.entries(database.heroes || {}).map(([name, hero]) => [
    name,
    { camp: hero.camp, label: hero.label },
  ])
);

const FORMATIONS = Object.keys(database.formations || {});

type ArrangementStatus = 'empty' | 'recommended' | 'saved' | 'edited';

const arrangementStatusLabel: Record<ArrangementStatus, string> = {
  empty: '尚未编排',
  recommended: '最佳推荐',
  saved: '已恢复保存',
  edited: '已手动调整',
};

const cloneLayout = (layout: TeamBuilderLayout): TeamBuilderLayout =>
  layout.map((team) => ({
    formation: team.formation,
    heroes: team.heroes.map((slot) => ({
      hero: slot.hero,
      row: slot.row,
      skills: [...slot.skills],
    })),
  })) as TeamBuilderLayout;

const TeamBuilder = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useGame();
  const { gameState, availableHeroes, availableSkills } = state;
  const [formation, setFormation] =
    useState<FormationRecommendation | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [layout, setLayout] = useState<TeamBuilderLayout>(
    createEmptyTeamBuilderLayout
  );
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [arrangementStatus, setArrangementStatus] =
    useState<ArrangementStatus>('empty');
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
  });
  const seededPoolKeyRef = useRef<string | null>(null);

  const heroes = useMemo(
    () => [
      ...new Set([
        ...(gameState?.current_heroes || []),
        ...(gameState?.support_hero ? [gameState.support_hero] : []),
      ]),
    ],
    [gameState?.current_heroes, gameState?.support_hero]
  );
  const skills = useMemo(
    () => [
      ...new Set([
        ...(gameState?.current_skills || []),
        ...(gameState?.support_skills || []),
      ]),
    ],
    [gameState?.current_skills, gameState?.support_skills]
  );
  const supportItems = useMemo(
    () =>
      new Set([
        ...(gameState?.support_hero ? [gameState.support_hero] : []),
        ...(gameState?.support_skills || []),
      ]),
    [gameState?.support_hero, gameState?.support_skills]
  );
  const poolKey = useMemo(
    () => teamBuilderPoolKey(heroes, skills),
    [heroes, skills]
  );
  const isEligible = heroes.length >= 9 && skills.length >= 18;
  const isPending = isEligible && resultKey !== poolKey;
  const hasHero = teamBuilderLayoutHasHero(layout);
  const recommendedLayout = useMemo(() => {
    if (
      resultKey !== poolKey ||
      !formation ||
      formation.incomplete ||
      formation.options.length === 0
    ) {
      return null;
    }
    return layoutFromFormation(formation.options[0]);
  }, [formation, poolKey, resultKey]);

  useEffect(() => {
    const normalized = normalizeTeamBuilderLayout(storage.loadTeamBuilder(), {
      allowedHeroes: heroes,
      allowedSkills: skills,
      formations: FORMATIONS,
    });
    const savedMatchesPool =
      normalized.hasAssignments &&
      (normalized.storedPoolKey === null ||
        normalized.storedPoolKey === poolKey);

    if (savedMatchesPool) {
      setLayout(normalized.layout);
      setArrangementStatus('saved');
      seededPoolKeyRef.current = poolKey;
    } else {
      setLayout(createEmptyTeamBuilderLayout());
      setArrangementStatus('empty');
      seededPoolKeyRef.current = null;
    }
    setHydratedKey(poolKey);
  }, [heroes, poolKey, skills]);

  useEffect(() => {
    if (hydratedKey !== poolKey) return;
    storage.saveTeamBuilder(createStoredTeamBuilderLayout(poolKey, layout));
  }, [hydratedKey, layout, poolKey]);

  useEffect(() => {
    if (!isEligible) {
      setFormation(null);
      setResultKey(null);
      return;
    }

    let cancelled = false;
    let handle: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      handle = window.setTimeout(() => {
        let result: FormationRecommendation | null = null;
        try {
          result = recommendTeams(
            heroes,
            skills,
            recommendationData,
            recommendationData.catalog,
            HERO_META
          );
        } catch (error) {
          console.error('Failed to recommend teams:', error);
        }

        if (cancelled) return;
        setFormation(result);
        setResultKey(poolKey);

        const bestOption =
          result && !result.incomplete ? result.options[0] : undefined;
        if (bestOption && seededPoolKeyRef.current !== poolKey) {
          setLayout(layoutFromFormation(bestOption));
          setArrangementStatus('recommended');
          seededPoolKeyRef.current = poolKey;
        }
      }, 0);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (handle !== null) window.clearTimeout(handle);
    };
  }, [heroes, isEligible, poolKey, skills]);

  const handleUpdateTeam = (
    updatedHeroes: string[],
    updatedSkills: string[]
  ) => {
    if (!gameState) return;
    dispatch({
      type: 'UPDATE_TEAM',
      heroes: updatedHeroes,
      skills: updatedSkills,
    });
  };

  const markEdited = () => {
    setArrangementStatus('edited');
    seededPoolKeyRef.current = poolKey;
  };

  const handleMove = (
    source: TeamBuilderMoveSource,
    target: TeamBuilderMoveTarget
  ) => {
    setLayout((current) => applyTeamBuilderMove(current, source, target));
    markEdited();
  };

  const handleFormationChange = (
    teamIndex: number,
    selectedFormation: string
  ) => {
    setLayout((current) => {
      const next = cloneLayout(current);
      next[teamIndex].formation = selectedFormation;
      return next;
    });
    markEdited();
  };

  const handleRowChange = (
    teamIndex: number,
    heroIndex: number,
    row: TeamBuilderRow
  ) => {
    setLayout((current) => {
      const next = cloneLayout(current);
      next[teamIndex].heroes[heroIndex].row = row;
      return next;
    });
    markEdited();
  };

  const handleRestoreRecommendation = () => {
    if (!recommendedLayout) return;
    setLayout(recommendedLayout);
    setArrangementStatus('recommended');
    seededPoolKeyRef.current = poolKey;
    setSnackbar({ open: true, message: '已恢复当前卡池的最佳推荐' });
  };

  const handleClear = () => {
    setLayout(createEmptyTeamBuilderLayout());
    setArrangementStatus('empty');
    seededPoolKeyRef.current = poolKey;
    setSnackbar({ open: true, message: '已清空所有队伍' });
  };

  const promptInput = useMemo(
    () => ({
      teams: layout,
      availableHeroes: heroes,
      availableSkills: skills,
    }),
    [heroes, layout, skills]
  );

  const handleCopyPrompt = async () => {
    const prompt = generateTeamValidationPrompt(promptInput);
    if (!prompt) {
      setSnackbar({ open: true, message: '请先编入至少一名武将' });
      return;
    }
    const copied = await copyToClipboard(prompt);
    setSnackbar({
      open: true,
      message: copied
        ? '强度复盘提示词已复制'
        : '复制失败，请检查浏览器剪贴板权限',
    });
  };

  const handleWechatShare = async () => {
    const text = generateTeamShareText(promptInput);
    if (!text) {
      setSnackbar({ open: true, message: '请先编入至少一名武将' });
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: '我的三国谋定天下演武阵容',
          text,
        });
        setSnackbar({ open: true, message: '已打开系统分享面板' });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    const copied = await copyToClipboard(text);
    setSnackbar({
      open: true,
      message: copied
        ? '阵容已复制，请打开微信粘贴分享（功能开发中）'
        : '暂时无法分享或复制阵容',
    });
  };

  return (
    <Container maxWidth="xl" disableGutters>
      <Box>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ xs: 'stretch', md: 'center' }}
          justifyContent="space-between"
          gap={2}
          sx={{
            mb: 2.5,
            borderBottom: '2px solid',
            borderColor: 'text.primary',
            pb: 2,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate(-1)}
              variant="contained"
              sx={{ flexShrink: 0 }}
            >
              返回
            </Button>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="overline"
                color="error.main"
                sx={{ display: 'block', lineHeight: 1.2 }}
              >
                FORMATION WORKSHOP
              </Typography>
              <Typography component="h1" variant="h3">
                队伍策案
              </Typography>
            </Box>
          </Stack>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ flexShrink: 0 }}
          >
            <Button
              variant="contained"
              color="secondary"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopyPrompt}
              disabled={!hasHero}
              sx={{ minHeight: 44 }}
            >
              生成强度复盘提示词
            </Button>
            <Tooltip title="尝试打开系统分享面板；无法指定微信时会复制阵容供手动粘贴">
              <span>
                <Button
                  variant="outlined"
                  startIcon={<ForumOutlinedIcon />}
                  onClick={handleWechatShare}
                  disabled={!hasHero}
                  fullWidth
                  sx={{ minHeight: 44 }}
                >
                  分享给微信好友
                  <Box
                    component="span"
                    sx={{
                      ml: 0.75,
                      px: 0.65,
                      py: 0.1,
                      border: '1px solid',
                      borderColor: 'warning.main',
                      color: 'warning.dark',
                      fontSize: 11,
                      lineHeight: 1.4,
                    }}
                  >
                    开发中
                  </Box>
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          gap={1}
          sx={{ mb: 1.5 }}
        >
          <Box>
            <Typography variant="body1" fontWeight={700}>
              默认采用当前卡池的一套最佳三队编排，之后可自由拖动调整。
            </Typography>
            <Typography variant="body2" color="text.secondary">
              阵型和前后排由你确认；评分会随武将与战法配置即时更新。
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
            <Chip
              size="small"
              color={
                arrangementStatus === 'recommended'
                  ? 'success'
                  : arrangementStatus === 'edited'
                    ? 'warning'
                    : 'default'
              }
              label={arrangementStatusLabel[arrangementStatus]}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<RestartAltOutlinedIcon />}
              onClick={handleRestoreRecommendation}
              disabled={!recommendedLayout}
            >
              恢复最佳推荐
            </Button>
            <Button
              size="small"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={handleClear}
              disabled={!hasHero}
            >
              清空编排
            </Button>
          </Stack>
        </Stack>

        <Accordion
          disableGutters
          elevation={0}
          sx={{
            mb: 2,
            border: '1px solid',
            borderColor: 'divider',
            '&:before': { display: 'none' },
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="roster-management-content"
            id="roster-management-header"
          >
            <Box>
              <Typography fontWeight={800}>调整参赛卡池</Typography>
              <Typography variant="caption" color="text.secondary">
                当前 {heroes.length} 名武将、{skills.length} 个战法；支援选择也会进入仓库
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails id="roster-management-content" sx={{ p: 1 }}>
            {gameState ? (
              <CurrentTeam
                heroes={gameState.current_heroes}
                skills={gameState.current_skills}
                availableHeroes={availableHeroes}
                availableSkills={availableSkills}
                editable
                onUpdateTeam={handleUpdateTeam}
                supportHero={gameState.support_hero}
                supportSkills={gameState.support_skills}
              />
            ) : (
              <Alert
                severity="info"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => navigate('/')}
                  >
                    返回对局推荐
                  </Button>
                }
              >
                请先创建对局卡池，再回来编排三支队伍。
              </Alert>
            )}
          </AccordionDetails>
        </Accordion>

        {hydratedKey !== poolKey ? (
          <Paper
            aria-live="polite"
            sx={{ py: 8, display: 'grid', placeItems: 'center' }}
          >
            <Stack alignItems="center" spacing={1.5}>
              <CircularProgress size={30} />
              <Typography>正在同步卡池...</Typography>
            </Stack>
          </Paper>
        ) : isPending ? (
          <Paper
            aria-live="polite"
            sx={{ py: 8, display: 'grid', placeItems: 'center' }}
          >
            <Stack alignItems="center" spacing={1.5}>
              <CircularProgress size={30} />
              <Typography>正在优化并生成最佳编排...</Typography>
            </Stack>
          </Paper>
        ) : (
          <>
            {!isEligible && heroes.length > 0 && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                自动推荐需要至少 9 名武将和 18 个战法。当前为 {heroes.length}{' '}
                名武将、{skills.length} 个战法；你仍可手动拖动编排。
              </Alert>
            )}
            {heroes.length === 0 && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                请先返回“对局推荐”创建卡池，再来编排三支队伍。
              </Alert>
            )}
            {isEligible &&
              (!formation ||
                formation.incomplete ||
                formation.options.length === 0) && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  当前卡池未能生成完整推荐，你仍可在下方手动编排。
                </Alert>
              )}
            <FormationWorkbench
              layout={layout}
              heroes={heroes}
              skills={skills}
              formations={FORMATIONS}
              supportItems={supportItems}
              onMove={handleMove}
              onFormationChange={handleFormationChange}
              onRowChange={handleRowChange}
            />
          </>
        )}
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3200}
        onClose={() => setSnackbar((current) => ({ ...current, open: false }))}
        message={snackbar.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Container>
  );
};

export default TeamBuilder;
