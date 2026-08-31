import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  Paper,
  Popover,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import CurrentTeam from '../components/game/CurrentTeam';
import FormationWorkbench from '../components/teamBuilder/FormationWorkbench';
import AgentReviewPanel, {
  type TeamAgentRunMode,
} from '../components/teamBuilder/AgentReviewPanel';
import GameLoadingPanel from '../components/common/GameLoadingPanel';
import { useGame } from '../context/GameContext';
import { database, recommendationData } from '../data';
import {
  recommendHybridTeamsCooperatively,
  type FormationRecommendation,
  type HeroMeta,
} from '../services/recommendationEngine';
import {
  getCachedTeamFormation,
  setCachedTeamFormation,
  teamFormationCacheKey,
} from '../services/teamFormationCache';
import type {
  TeamFormationStage,
  TeamFormationWorkerRequest,
  TeamFormationWorkerResponse,
} from '../services/teamFormationWorkerProtocol';
import { generateTeamValidationPrompt } from '../services/promptGenerator';
import { recordSuccessfulPromptCopy } from '../services/googleAnalytics';
import {
  applyTeamBuilderMove,
  cloneTeamBuilderLayout,
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
import { summarizeTeamBuilderRecommendation } from '../services/teamBuilderMessaging';
import {
  buildTeamFormationDebugContext,
  registerSanmouDebugContext,
} from '../services/recommendationDebug';
import {
  LocalTeamAgentError,
  createTeamAgentRequest,
  isTeamBuilderLayoutComplete,
  layoutFromTeamAgentTeams,
  requestLocalTeamRecommendation,
  syncLocalTeamAgentExperiment,
  teamBuilderLayoutFingerprint,
  type TeamAgentResult,
} from '../services/localTeamAgent';
import { copyToClipboard } from '../utils/clipboard';
import { storage } from '../utils/storage';
import { teamBuilderInteractionPolicy } from '../theme/teamBuilderInteractions';

const HERO_META: HeroMeta = Object.fromEntries(
  Object.entries(database.heroes || {}).map(([name, hero]) => [
    name,
    { camp: hero.camp },
  ])
);

const FORMATIONS = Object.keys(database.formations || {});

const sameTeamBuilderLayout = (
  left: TeamBuilderLayout,
  right: TeamBuilderLayout
): boolean =>
  left.every((team, teamIndex) => {
    const otherTeam = right[teamIndex];
    return (
      team.formation === otherTeam.formation &&
      team.heroes.every((slot, heroIndex) => {
        const otherSlot = otherTeam.heroes[heroIndex];
        return (
          slot.hero === otherSlot.hero &&
          slot.row === otherSlot.row &&
          slot.skills.every(
            (skill, skillIndex) => skill === otherSlot.skills[skillIndex]
          )
        );
      })
    );
  });

const TeamBuilder = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useGame();
  const { gameState, availableHeroes, availableSkills, selectedSeason } = state;
  const [formation, setFormation] =
    useState<FormationRecommendation | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [formationStage, setFormationStage] =
    useState<TeamFormationStage>('matching');
  const [layout, setLayout] = useState<TeamBuilderLayout>(
    createEmptyTeamBuilderLayout
  );
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
  });
  const [promptInfoAnchor, setPromptInfoAnchor] =
    useState<HTMLElement | null>(null);
  const [localAgentEnabled] = useState(syncLocalTeamAgentExperiment);
  const [agentPending, setAgentPending] = useState(false);
  const [agentResult, setAgentResult] = useState<{
    result: TeamAgentResult;
    mode: TeamAgentRunMode;
  } | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentUndoLayout, setAgentUndoLayout] =
    useState<TeamBuilderLayout | null>(null);
  const seededPoolKeyRef = useRef<string | null>(null);
  const agentAbortRef = useRef<AbortController | null>(null);

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
  const agentContextFingerprint = `${poolKey}:${selectedSeason}:${teamBuilderLayoutFingerprint(layout)}`;
  const agentContextFingerprintRef = useRef(agentContextFingerprint);
  agentContextFingerprintRef.current = agentContextFingerprint;
  const formationCacheKey = useMemo(
    () =>
      teamFormationCacheKey(
        poolKey,
        recommendationData,
        database.team || []
      ),
    [poolKey]
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
  const recommendationSummary = useMemo(() => {
    if (
      resultKey !== poolKey ||
      !formation ||
      formation.incomplete ||
      formation.options.length === 0
    ) {
      return null;
    }
    return summarizeTeamBuilderRecommendation(formation.options[0].teams);
  }, [formation, poolKey, resultKey]);

  useEffect(() => {
    const normalized = normalizeTeamBuilderLayout(storage.loadTeamBuilder(), {
      allowedHeroes: heroes,
      allowedSkills: skills,
      formations: FORMATIONS,
    });
    const savedMatchesPool =
      (normalized.hasAssignments &&
        (normalized.storedPoolKey === null ||
          normalized.storedPoolKey === poolKey)) ||
      (normalized.hasFormation && normalized.storedPoolKey === poolKey);

    if (savedMatchesPool) {
      setLayout(normalized.layout);
      seededPoolKeyRef.current = poolKey;
    } else {
      setLayout(createEmptyTeamBuilderLayout());
      seededPoolKeyRef.current = null;
    }
    setHydratedKey(poolKey);
    setAgentResult(null);
    setAgentError(null);
    setAgentUndoLayout(null);
  }, [heroes, poolKey, skills]);

  useEffect(() => {
    if (hydratedKey !== poolKey) return;
    storage.saveTeamBuilder(createStoredTeamBuilderLayout(poolKey, layout));
  }, [hydratedKey, layout, poolKey]);

  useEffect(
    () => () => {
      agentAbortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!isEligible) {
      setFormation(null);
      setResultKey(null);
      return;
    }
    if (hydratedKey !== poolKey) return;

    let cancelled = false;
    let worker: Worker | null = null;
    let fallbackStarted = false;

    const applyResult = (result: FormationRecommendation) => {
      if (cancelled) return;
      setCachedTeamFormation(formationCacheKey, result);
      setFormation(result);
      setResultKey(poolKey);

      const bestOption =
        !result.incomplete ? result.options[0] : undefined;
      if (bestOption && seededPoolKeyRef.current !== poolKey) {
        setLayout(layoutFromFormation(bestOption));
        seededPoolKeyRef.current = poolKey;
      }
    };

    const runCooperativeFallback = async () => {
      if (fallbackStarted || cancelled) return;
      fallbackStarted = true;
      worker?.terminate();
      worker = null;
      setFormationStage('optimizing');
      try {
        const result = await recommendHybridTeamsCooperatively(
          heroes,
          skills,
          recommendationData,
          recommendationData.catalog,
          HERO_META,
          database.team || [],
          {
            batchSize: 12,
            shouldCancel: () => cancelled,
            yieldControl: () =>
              new Promise<void>((resolve) =>
                window.setTimeout(resolve, 0)
              ),
          }
        );
        applyResult(result);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to recommend teams:', error);
        setFormation(null);
        setResultKey(poolKey);
      }
    };

    const cached = getCachedTeamFormation(formationCacheKey);
    if (cached) {
      applyResult(cached);
      return () => {
        cancelled = true;
      };
    }

    setFormationStage('matching');
    try {
      worker = new Worker(
        new URL('../workers/teamFormation.worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = ({
        data,
      }: MessageEvent<TeamFormationWorkerResponse>) => {
        if (cancelled || data.requestId !== formationCacheKey) return;
        if (data.type === 'progress') {
          setFormationStage(data.stage);
          return;
        }
        if (data.type === 'result') {
          applyResult(data.recommendation);
          worker?.terminate();
          worker = null;
          return;
        }
        console.error('Formation worker failed:', data.message);
        void runCooperativeFallback();
      };
      worker.onerror = (event) => {
        event.preventDefault();
        console.error('Formation worker failed to load:', event.message);
        void runCooperativeFallback();
      };
      const request: TeamFormationWorkerRequest = {
        requestId: formationCacheKey,
        heroes,
        skills,
      };
      worker.postMessage(request);
    } catch (error) {
      console.error('Formation worker is unavailable:', error);
      void runCooperativeFallback();
    }

    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [
    formationCacheKey,
    heroes,
    hydratedKey,
    isEligible,
    poolKey,
    skills,
  ]);

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
    seededPoolKeyRef.current = poolKey;
    setAgentResult(null);
    setAgentError(null);
    setAgentUndoLayout(null);
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
      const next = cloneTeamBuilderLayout(current);
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
      const next = cloneTeamBuilderLayout(current);
      next[teamIndex].heroes[heroIndex].row = row;
      return next;
    });
    markEdited();
  };

  const handleRestoreRecommendation = () => {
    if (!recommendedLayout) return;
    setLayout(recommendedLayout);
    seededPoolKeyRef.current = poolKey;
    setAgentResult(null);
    setAgentError(null);
    setAgentUndoLayout(null);
    setSnackbar({ open: true, message: '已恢复当前卡池的阵容库推荐' });
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
    if (copied) recordSuccessfulPromptCopy('teamStrengthReview');
    setSnackbar({
      open: true,
      message: copied
        ? '强度复盘提示词已复制'
        : '复制失败，请检查浏览器剪贴板权限',
    });
  };

  const agentMode: TeamAgentRunMode = isTeamBuilderLayoutComplete(layout)
    ? 'review'
    : 'recommend';

  const handleRunAgent = async () => {
    const mode = agentMode;
    const inputLayout = cloneTeamBuilderLayout(layout);
    const inputFingerprint = agentContextFingerprint;
    const controller = new AbortController();
    agentAbortRef.current?.abort();
    agentAbortRef.current = controller;
    setAgentPending(true);
    setAgentError(null);

    try {
      const result = await requestLocalTeamRecommendation(
        createTeamAgentRequest({
          layout: inputLayout,
          heroes,
          skills,
          season: selectedSeason,
        }),
        { signal: controller.signal }
      );
      if (inputFingerprint !== agentContextFingerprintRef.current) {
        setSnackbar({
          open: true,
          message: '等待期间阵容已修改，本次 Agent 结果已忽略',
        });
        return;
      }

      if (mode === 'recommend') {
        const nextLayout = layoutFromTeamAgentTeams(result.teams);
        setAgentUndoLayout(inputLayout);
        setLayout(nextLayout);
        seededPoolKeyRef.current = poolKey;
      } else {
        setAgentUndoLayout(null);
      }
      setAgentResult({ result, mode });
      setSnackbar({
        open: true,
        message:
          mode === 'recommend'
            ? result.status === 'complete'
              ? 'Agent 已补全阵容并完成复盘'
              : 'Agent 已保留通过校验的部分结果'
            : 'Agent 已完成阵容复盘',
      });
    } catch (error) {
      if (error instanceof LocalTeamAgentError && error.code === 'aborted') {
        return;
      }
      const message =
        error instanceof LocalTeamAgentError && error.code === 'unavailable'
          ? '无法连接本地 Agent。请确认 8790 服务已启动，并允许 Chrome 访问本地网络。'
          : error instanceof Error
            ? `本地 Agent 请求失败：${error.message}`
            : '本地 Agent 请求失败';
      setAgentError(message);
    } finally {
      if (agentAbortRef.current === controller) {
        agentAbortRef.current = null;
        setAgentPending(false);
      }
    }
  };

  const handleUndoAgent = () => {
    if (!agentUndoLayout) return;
    setLayout(agentUndoLayout);
    seededPoolKeyRef.current = poolKey;
    setAgentUndoLayout(null);
    setAgentResult(null);
    setSnackbar({ open: true, message: '已撤销本次智能补全' });
  };

  const isSystemRecommendation =
    recommendedLayout !== null &&
    sameTeamBuilderLayout(layout, recommendedLayout);

  useEffect(
    () =>
      registerSanmouDebugContext(() =>
        buildTeamFormationDebugContext({
          season: selectedSeason,
          heroes,
          skills,
          supportItems,
          formation,
          resultReady:
            hydratedKey === poolKey &&
            (!isEligible || resultKey === poolKey),
          currentLayout: layout,
          currentLayoutMatchesRecommendation: isSystemRecommendation,
        })
      ),
    [
      formation,
      heroes,
      hydratedKey,
      isEligible,
      isSystemRecommendation,
      layout,
      poolKey,
      resultKey,
      selectedSeason,
      skills,
      supportItems,
    ]
  );

  return (
    <Container
      maxWidth="xl"
      disableGutters
      sx={teamBuilderInteractionPolicy}
    >
      <Box>
        <Stack
          direction="row"
          alignItems="center"
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
              variant="outlined"
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
              只编入自身与搭配都达到模型最低证据量的武将和战法；权重只影响排序，不阻止填入。
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
            {recommendedLayout && !isSystemRecommendation && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<RestartAltOutlinedIcon />}
                onClick={handleRestoreRecommendation}
              >
                恢复阵容库推荐
              </Button>
            )}
          </Stack>
        </Stack>

        <Accordion
          disableGutters
          elevation={0}
          slotProps={{ heading: { component: 'h2' } }}
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
              <Typography component="span" fontWeight={800}>调整参赛卡池</Typography>
              <Typography variant="caption" color="text.secondary">
                当前 {heroes.length} 名武将、{skills.length} 个战法；支援选择也会进入仓库
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 1 }}>
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

        {heroes.length === 0 ? (
          <Paper
            component="section"
            aria-labelledby="empty-team-builder-title"
            sx={{ py: { xs: 6, sm: 8 }, px: 2, textAlign: 'center' }}
          >
            <Stack alignItems="center" spacing={1.5}>
              <Typography
                id="empty-team-builder-title"
                component="h2"
                variant="h5"
              >
                还没有可编排的卡池
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
                先在对局推荐中创建武将和战法卡池，再回来编排三支队伍。
              </Typography>
              <Button variant="contained" onClick={() => navigate('/')}>
                返回对局推荐
              </Button>
            </Stack>
          </Paper>
        ) : hydratedKey !== poolKey ? (
          <GameLoadingPanel
            label="正在同步卡池"
            detail="正在整理武将与战法仓库…"
          />
        ) : isPending ? (
          <GameLoadingPanel
            label={
              formationStage === 'matching'
                ? '正在查找合适阵容'
                : '正在完善队伍'
            }
            detail="参谋正在推演三军站位与战法搭配…"
          />
        ) : (
          <>
            {!isEligible && heroes.length > 0 && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                自动推荐需要至少 9 名武将和 18 个战法。当前为 {heroes.length}{' '}
                名武将、{skills.length} 个战法；你仍可手动拖动编排。
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
            {isEligible &&
              formation &&
              !formation.incomplete &&
              formation.options.length > 0 &&
              recommendationSummary && (
                <Stack spacing={1} sx={{ mb: 1.5 }} aria-live="polite">
                  {recommendationSummary.successMessage && (
                    <Alert
                      severity="success"
                      data-testid="recommendation-success"
                    >
                      {recommendationSummary.successMessage}
                    </Alert>
                  )}
                  {recommendationSummary.warningMessage && (
                    <Alert
                      severity="warning"
                      data-testid="recommendation-warning"
                      sx={{ fontWeight: 800 }}
                    >
                      {recommendationSummary.warningMessage}
                    </Alert>
                  )}
                </Stack>
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
              actions={
                <Stack
                  data-testid="team-builder-actions"
                  role="group"
                  aria-label="阵容操作"
                  direction="row"
                  spacing={0.75}
                  useFlexGap
                  flexWrap="wrap"
                  justifyContent="flex-end"
                  sx={{ ml: 'auto', maxWidth: '100%' }}
                >
                  {localAgentEnabled && (
                    <Tooltip title="调用本机 Agent；首次使用时 Chrome 会询问本地网络权限">
                      <span>
                        <Button
                          variant="contained"
                          color="primary"
                          startIcon={
                            agentPending ? (
                              <CircularProgress size={18} color="inherit" />
                            ) : (
                              <AutoAwesomeOutlinedIcon />
                            )
                          }
                          onClick={handleRunAgent}
                          disabled={agentPending || heroes.length === 0}
                          sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
                        >
                          {agentPending
                            ? 'Agent 正在处理...'
                            : agentMode === 'recommend'
                              ? '智能补全阵容'
                              : '智能复盘阵容'}
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                  <Stack direction="row" spacing={0.25} alignItems="center">
                    <IconButton
                      aria-label="了解强度复盘提示词"
                      aria-describedby={
                        promptInfoAnchor
                          ? 'team-review-prompt-explainer'
                          : undefined
                      }
                      onClick={(event) =>
                        setPromptInfoAnchor(event.currentTarget)
                      }
                      sx={{ minWidth: 44, minHeight: 44 }}
                    >
                      <InfoOutlinedIcon />
                    </IconButton>
                    <Button
                      variant="contained"
                      color="secondary"
                      startIcon={<ContentCopyIcon />}
                      onClick={handleCopyPrompt}
                      disabled={!hasHero}
                      sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
                    >
                      生成强度复盘提示词
                    </Button>
                  </Stack>
                  <Tooltip title="功能开发中，暂不可用">
                    <span>
                      <Button
                        variant="outlined"
                        startIcon={<ForumOutlinedIcon />}
                        disabled
                        sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
                      >
                        微信好友配将
                        <Box
                          component="span"
                          sx={{
                            ml: 0.75,
                            px: 0.65,
                            py: 0.1,
                            border: '1px solid',
                            borderColor: 'action.disabled',
                            color: 'text.disabled',
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
              }
            />
            {agentError && (
              <Alert
                severity="error"
                data-testid="local-agent-error"
                sx={{ mt: 2 }}
                onClose={() => setAgentError(null)}
              >
                {agentError}
              </Alert>
            )}
            {agentResult && (
              <AgentReviewPanel
                result={agentResult.result}
                mode={agentResult.mode}
                canUndo={agentUndoLayout !== null}
                onUndo={handleUndoAgent}
                onDismiss={() => {
                  setAgentResult(null);
                  setAgentUndoLayout(null);
                }}
              />
            )}
          </>
        )}
      </Box>

      <Popover
        id="team-review-prompt-explainer"
        open={Boolean(promptInfoAnchor)}
        anchorEl={promptInfoAnchor}
        onClose={() => setPromptInfoAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              width: 'min(360px, calc(100vw - 24px))',
              mt: 0.75,
            },
          },
        }}
      >
        <Box
          role="dialog"
          aria-labelledby="team-review-prompt-explainer-title"
          sx={{ p: 2 }}
        >
          <Typography
            id="team-review-prompt-explainer-title"
            component="h2"
            variant="subtitle2"
            fontWeight={900}
            gutterBottom
          >
            强度复盘提示词是什么？
          </Typography>
          <Stack spacing={0.75}>
            <Typography variant="body2">
              它会把当前三队的武将、额外战法、阵型和站位整理成一段可复制的提示词。
            </Typography>
            <Typography variant="body2">
              粘贴到 ChatGPT 或 DeepSeek 后，可让 AI
              检查配置是否合理、分析阵容强弱，并给出当前卡池内可执行的改进建议。
            </Typography>
            <Typography variant="body2" color="text.secondary">
              本页评分是相对阵容强度，不代表胜率；点击按钮只会复制内容，不会上传阵容。
            </Typography>
          </Stack>
        </Box>
      </Popover>

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
