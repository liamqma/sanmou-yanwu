import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Container, Box, Button, Alert, CircularProgress, Typography, Paper, Snackbar } from "@mui/material";
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import { useGame } from "../../context/GameContext";
import { api } from "../../services/api";
import { getRoundType, getItemsPerSet, TOTAL_ROUNDS } from "../../services/gameLogic";
import { generateLLMPrompt } from "../../services/promptGenerator";
import RoundInfo from "./RoundInfo";
import CurrentTeam from "./CurrentTeam";
import RecommendationPanel from "./RecommendationPanel";
import AnalysisGrid from "./AnalysisGrid";
import KnownStrongTeams from "./KnownStrongTeams";
import RoundShareDialog from "./RoundShareDialog";
import ResponsiveDisclosure from "../common/ResponsiveDisclosure";
import GameLoadingPanel from '../common/GameLoadingPanel';
import type { TeamBuilderPanelHandle } from '../teamBuilder/TeamBuilderPanel';
import { copyImageToClipboard, copyToClipboard } from "../../utils/clipboard";
import { renderRoundShareImage } from "../../utils/roundShareImage";
import type { GameState, RoundType, SetName } from "../../types/game";
import { currentRosterScore, type OptionAnalysis } from "../../services/recommendationEngine";
import type { PreferencePrediction } from "../../types/telemetryData";
import { recommendationData } from "../../data";
import { recordRoundTelemetry } from "../../services/telemetry";
import { recordSuccessfulPromptCopy } from "../../services/googleAnalytics";
import {
  buildRoundRecommendationDebugContext,
  registerSanmouDebugContext,
  SANMOU_DEBUG_SCHEMA,
} from "../../services/recommendationDebug";

const TeamBuilderPanel = lazy(
  () => import('../teamBuilder/TeamBuilderPanel')
);

interface QualificationInterstitialProps {
  roundNumber: 7 | 9;
  onContinue: () => void;
  children: ReactNode;
}

interface SharePreview {
  blob: Blob;
  file: File | null;
  url: string;
  downloadFilename: string;
  nativeShareTitle: string;
}

interface GameBoardShellProps {
  children: ReactNode;
  snackbarMessage: string | null;
  shareError: string | null;
  sharePreview: SharePreview | null;
  canNativeShare: boolean;
  onSnackbarClose: () => void;
  onShareErrorClose: () => void;
  onCloseSharePreview: () => void;
  onDownloadShareImage: () => void;
  onNativeShare: () => void;
}

const canShareFile = (file: File | null): boolean => {
  if (
    !file ||
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function'
  ) {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
};

const GameBoardShell = ({
  children,
  snackbarMessage,
  shareError,
  sharePreview,
  canNativeShare,
  onSnackbarClose,
  onShareErrorClose,
  onCloseSharePreview,
  onDownloadShareImage,
  onNativeShare,
}: GameBoardShellProps) => (
  <>
    {children}
    <Snackbar
      open={Boolean(snackbarMessage)}
      autoHideDuration={2000}
      onClose={onSnackbarClose}
      message={snackbarMessage}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    />
    <Snackbar
      open={Boolean(shareError)}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert severity="error" onClose={onShareErrorClose} sx={{ width: '100%' }}>
        {shareError}
      </Alert>
    </Snackbar>
    <RoundShareDialog
      open={sharePreview !== null}
      previewUrl={sharePreview?.url ?? null}
      canNativeShare={canNativeShare}
      onClose={onCloseSharePreview}
      onDownload={onDownloadShareImage}
      onNativeShare={onNativeShare}
    />
  </>
);

const QualificationInterstitial = ({
  roundNumber,
  onContinue,
  children,
}: QualificationInterstitialProps) => (
  <Container maxWidth="xl" disableGutters>
    <Box>
      <RoundInfo roundNumber={roundNumber} />
      <Paper sx={{ p: 3, mb: 3, textAlign: "center" }}>
        <Typography variant="overline" color="error.main">州内小组赛</Typography>
        <Typography component="h2" variant="h4" gutterBottom sx={{ mb: { xs: 0, md: 3 } }}>
          整军再战
        </Typography>
        <Button
          variant="contained"
          color="primary"
          size="large"
          fullWidth
          sx={{
            display: { xs: "flex", md: "none" },
            mt: 2,
            mb: 3,
            maxWidth: 360,
            mx: "auto",
          }}
          onClick={onContinue}
        >
          我赢了，进入下一轮
        </Button>
        {children}
        <Button
          variant="contained"
          color="primary"
          size="large"
          fullWidth
          sx={{
            display: { xs: "none", md: "flex" },
            mt: 3,
            maxWidth: 360,
            mx: "auto",
          }}
          onClick={onContinue}
        >
          我赢了，进入下一轮
        </Button>
      </Paper>
    </Box>
  </Container>
);

/**
 * Main game board component - manages game flow
 */
const GameBoard = () => {
  const { state, dispatch } = useGame();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareImageBusy, setShareImageBusy] = useState(false);
  const [sharePreview, setSharePreview] = useState<SharePreview | null>(null);
  const sharePreviewUrlRef = useRef<string | null>(null);
  const shareExportSequenceRef = useRef(0);
  const mountedRef = useRef(false);
  const teamBuilderRef = useRef<TeamBuilderPanelHandle>(null);

  const {
    gameState,
    currentRoundInputs,
    selectedOptionIndex,
    currentRecommendation,
    rosterRevision,
    recommendationRosterRevision,
    availableHeroes,
    heroMetadata,
    skillMetadata,
    regularSkills,
    orangeRegularSkills,
  } = state;
  const recommendationRequestSequenceRef = useRef(0);
  const pendingRecommendationRequestRef = useRef<{
    id: number;
    rosterRevision: number;
  } | null>(null);
  const latestRosterRevisionRef = useRef(rosterRevision);
  latestRosterRevisionRef.current = rosterRevision;

  const cancelRecommendationRequest = useCallback((requestId: number) => {
    if (pendingRecommendationRequestRef.current?.id !== requestId) return;
    pendingRecommendationRequestRef.current = null;
    setLoading(false);
  }, []);

  const requestRecommendation = useCallback(({
    mode,
    roundType,
    availableSets,
    requestGameState,
    requestRosterRevision,
  }: {
    mode: 'manual' | 'rescore';
    roundType: RoundType;
    availableSets: string[][];
    requestGameState: GameState;
    requestRosterRevision: number;
  }): number => {
    const requestId = ++recommendationRequestSequenceRef.current;
    pendingRecommendationRequestRef.current = {
      id: requestId,
      rosterRevision: requestRosterRevision,
    };
    setLoading(true);
    setError(null);

    const takeCurrentRequest = (): boolean => {
      const pendingRequest = pendingRecommendationRequestRef.current;
      if (
        pendingRequest?.id !== requestId ||
        pendingRequest.rosterRevision !== requestRosterRevision ||
        latestRosterRevisionRef.current !== requestRosterRevision
      ) {
        return false;
      }
      pendingRecommendationRequestRef.current = null;
      return true;
    };

    void Promise.resolve()
      .then(() => api.getRecommendation(roundType, availableSets, requestGameState))
      .then((response) => {
        if (!takeCurrentRequest()) return;
        dispatch({
          type: mode === 'rescore' ? 'RESCORE_RECOMMENDATION' : 'SET_RECOMMENDATION',
          recommendation: response.recommendation || response,
          rosterRevision: requestRosterRevision,
        });
        setLoading(false);
      })
      .catch((requestError: Error) => {
        if (!takeCurrentRequest()) return;
        setLoading(false);
        setError(
          `${mode === 'rescore' ? '重新计算失败' : '获取推荐失败'}：${requestError.message}`
        );
        console.error(requestError);
      });

    return requestId;
  }, [dispatch]);

  useEffect(() => () => {
    pendingRecommendationRequestRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      shareExportSequenceRef.current += 1;
      if (sharePreviewUrlRef.current) {
        URL.revokeObjectURL(sharePreviewUrlRef.current);
        sharePreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(
    () =>
      registerSanmouDebugContext(() => {
        if (!gameState) {
          return {
            schema: SANMOU_DEBUG_SCHEMA,
            page: 'candidate-suggestion',
            status: 'not-ready',
            reason: 'Start a game before requesting recommendation debug context.',
          };
        }
        if (gameState.round_number > TOTAL_ROUNDS) {
          return {
            schema: SANMOU_DEBUG_SCHEMA,
            page: 'candidate-suggestion',
            status: 'not-ready',
            reason: 'The draft is complete and there is no active candidate recommendation.',
          };
        }
        const roundContext = buildRoundRecommendationDebugContext({
          season: state.selectedSeason,
          gameState,
          roundType: getRoundType(gameState.round_number),
          currentRoundInputs,
          recommendation: currentRecommendation,
        });
        return {
          ...roundContext,
          team_builder: teamBuilderRef.current?.getDebugContext() ?? null,
        };
      }),
    [
      currentRecommendation,
      currentRoundInputs,
      gameState,
      state.selectedSeason,
    ]
  );

  const recommendationIsCurrent =
    currentRecommendation !== null &&
    recommendationRosterRevision === rosterRevision;
  const recommendationNeedsRescore =
    currentRecommendation !== null && !recommendationIsCurrent;

  useEffect(() => {
    if (
      gameState &&
      recommendationNeedsRescore &&
      gameState.round_number <= TOTAL_ROUNDS
    ) {
      const currentRoundType = getRoundType(gameState.round_number);
      const requiredItems = getItemsPerSet(gameState.round_number);
      const availableSets = [
        currentRoundInputs.set1 || [],
        currentRoundInputs.set2 || [],
        currentRoundInputs.set3 || [],
      ];
      if (availableSets.every((set) => set.length === requiredItems)) {
        requestRecommendation({
          mode: 'rescore',
          roundType: currentRoundType,
          availableSets,
          requestGameState: gameState,
          requestRosterRevision: rosterRevision,
        });
        return;
      }
    }

    const pendingRequest = pendingRecommendationRequestRef.current;
    if (pendingRequest) cancelRecommendationRequest(pendingRequest.id);
  }, [
    cancelRecommendationRequest,
    currentRoundInputs,
    gameState,
    recommendationNeedsRescore,
    requestRecommendation,
    rosterRevision,
  ]);

  if (!gameState) {
    return null;
  }

  const roundNumber = gameState.round_number;
  const supportHero = gameState.support_hero || null;
  const supportSkillsList = gameState.support_skills || [];

  const handleUpdateTeam = (heroes: string[], skills: string[]) => {
    dispatch({ type: "UPDATE_TEAM", heroes, skills });
  };

  const closeSharePreview = () => {
    if (sharePreviewUrlRef.current) {
      URL.revokeObjectURL(sharePreviewUrlRef.current);
      sharePreviewUrlRef.current = null;
    }
    setSharePreview(null);
  };

  const openSharePreview = (
    blob: Blob,
    metadata: {
      downloadFilename: string;
      nativeShareTitle: string;
    },
    exportId: number
  ) => {
    if (!mountedRef.current || shareExportSequenceRef.current !== exportId) return;

    const url = URL.createObjectURL(blob);
    if (!mountedRef.current || shareExportSequenceRef.current !== exportId) {
      URL.revokeObjectURL(url);
      return;
    }

    if (sharePreviewUrlRef.current) {
      URL.revokeObjectURL(sharePreviewUrlRef.current);
    }
    sharePreviewUrlRef.current = url;
    let file: File | null = null;
    try {
      file = new File([blob], metadata.downloadFilename, {
        type: 'image/png',
      });
    } catch {
      // Older embedded browsers can still preview and download the Blob.
    }
    setSharePreview({ blob, file, url, ...metadata });
  };

  const canNativeShare = canShareFile(sharePreview?.file ?? null);

  const handleNativeShare = async () => {
    if (
      !sharePreview?.file ||
      typeof navigator === 'undefined' ||
      typeof navigator.share !== 'function'
    ) return;
    setShareError(null);
    try {
      await navigator.share({
        files: [sharePreview.file],
        title: sharePreview.nativeShareTitle,
      });
    } catch (nativeShareError) {
      if ((nativeShareError as DOMException).name !== 'AbortError') {
        setShareError('分享图片失败：' + (nativeShareError as Error).message);
      }
    }
  };

  const handleDownloadShareImage = () => {
    if (!sharePreview) return;
    const link = document.createElement('a');
    link.href = sharePreview.url;
    link.download = sharePreview.downloadFilename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const shellProps: Omit<GameBoardShellProps, 'children'> = {
    snackbarMessage,
    shareError,
    sharePreview,
    canNativeShare,
    onSnackbarClose: () => setSnackbarMessage(null),
    onShareErrorClose: () => setShareError(null),
    onCloseSharePreview: closeSharePreview,
    onDownloadShareImage: handleDownloadShareImage,
    onNativeShare: handleNativeShare,
  };

  const qualificationRound =
    roundNumber === 7 && !gameState.round7_interstitial_dismissed
      ? 7
      : roundNumber === 9 && !gameState.round9_interstitial_dismissed
        ? 9
        : null;

  if (qualificationRound) {
    return (
      <GameBoardShell {...shellProps}>
        <QualificationInterstitial
          roundNumber={qualificationRound}
          onContinue={() =>
            dispatch({
              type: "DISMISS_ROUND_INTERSTITIAL",
              roundNumber: qualificationRound,
            })
          }
        >
          <CurrentTeam
            heroes={gameState.current_heroes}
            skills={gameState.current_skills}
            availableHeroes={availableHeroes}
            heroMetadata={heroMetadata}
            skillMetadata={skillMetadata}
            availableSkills={regularSkills}
            onUpdateTeam={handleUpdateTeam}
            editable={true}
            supportHero={supportHero}
            supportSkills={supportSkillsList}
          />
        </QualificationInterstitial>
      </GameBoardShell>
    );
  }

  // Check if game is complete
  if (roundNumber > TOTAL_ROUNDS) {
    return (
      <GameBoardShell {...shellProps}>
        <Container maxWidth="xl" disableGutters>
          <Box>
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography component="h1" variant="h4" gutterBottom>
                对局完成
              </Typography>
              <Typography variant="body1">
                你已完成全部 {TOTAL_ROUNDS} 轮。可查看最终队伍配置。
              </Typography>
              <Typography
                component="p"
                variant="h6"
                sx={{ mt: 1.25, mb: 0, fontWeight: 800, color: "success.dark" }}
              >
                祝你夺冠 🏆
              </Typography>
            </Alert>

            <CurrentTeam
              heroes={gameState.current_heroes}
              skills={gameState.current_skills}
              editable={false}
              supportHero={supportHero}
              supportSkills={supportSkillsList}
            />

            <Button
              variant="outlined"
              fullWidth
              onClick={() => dispatch({ type: "RESET_GAME" })}
            >
              开始新对局
            </Button>
          </Box>
        </Container>
      </GameBoardShell>
    );
  }

  const roundType = getRoundType(roundNumber);
  const itemsPerSet = getItemsPerSet(roundNumber);

  // Filter out already-selected heroes/skills (including support) from the available items
  const selectedHeroes = new Set([...(gameState.current_heroes || []), ...(supportHero ? [supportHero] : [])]);
  const selectedSkills = new Set([...(gameState.current_skills || []), ...supportSkillsList]);

  let availableItems: string[];
  if (roundType === "hero") {
    // Only show heroes not already selected
    availableItems = availableHeroes.filter(h => !selectedHeroes.has(h));
  } else {
    // During rounds, only show orange regular skills (no hero skills, no purple), exclude already-selected
    availableItems = orangeRegularSkills.filter(s => !selectedSkills.has(s));
  }

  const handleUpdateSet = (setName: SetName, items: string[]) => {
    dispatch({ type: "UPDATE_ROUND_INPUT", setName, items });
  };

  const handleGetRecommendation = () => {
    const availableSets = [
      currentRoundInputs.set1 || [],
      currentRoundInputs.set2 || [],
      currentRoundInputs.set3 || [],
    ];

    if (!availableSets.every((set) => set.length === itemsPerSet)) {
      setError(`三组选项每组必须恰好有 ${itemsPerSet} 项`);
      return;
    }

    requestRecommendation({
      mode: 'manual',
      roundType,
      availableSets,
      requestGameState: gameState,
      requestRosterRevision: rosterRevision,
    });
  };

  const handleSelectOption = (index: number) => {
    dispatch({ type: "SELECT_OPTION", index });
  };

  const handleRecordChoice = () => {
    if (selectedOptionIndex === null) {
      setError("请先选择一组选项");
      return;
    }
    if (!recommendationIsCurrent) {
      setError("阵容评分正在更新，请稍候");
      return;
    }

    const setName = `set${selectedOptionIndex + 1}` as SetName;
    const chosenSet = currentRoundInputs[setName];

    if (!chosenSet || chosenSet.length !== itemsPerSet) {
      setError("选择无效");
      return;
    }

    const analysis = currentRecommendation?.analysis as OptionAnalysis[] | undefined;
    const preference = currentRecommendation?.preference as
      | PreferencePrediction
      | null
      | undefined;
    const recommendedIndex = currentRecommendation?.recommended_set_index;
    const pairedScores = [0, 1, 2].map((index) =>
      analysis?.find((option) => option.set_index === index)?.final_score
    );
    if (
      typeof recommendedIndex === 'number' &&
      pairedScores.every((score): score is number => typeof score === 'number')
    ) {
      recordRoundTelemetry({
        roundNumber,
        roundType,
        poolBefore: {
          heroes: [...(gameState.current_heroes || [])],
          skills: [...(gameState.current_skills || [])],
          ...(supportHero ? { heroSupport: supportHero } : {}),
          ...(supportSkillsList.length ? { skillsSupport: supportSkillsList } : {}),
        },
        offeredSets: [
          [...(currentRoundInputs.set1 || [])],
          [...(currentRoundInputs.set2 || [])],
          [...(currentRoundInputs.set3 || [])],
        ],
        pairedScores,
        recommendedIndex,
        chosenIndex: selectedOptionIndex,
        preferenceModelVersion: preference?.version ?? null,
        preferenceProbabilities: preference?.probabilities ?? null,
      });
    }

    dispatch({
      type: "RECORD_CHOICE",
      roundType,
      chosenSet,
      setIndex: selectedOptionIndex,
    });

    setError(null);
  };

  const handleGeneratePrompt = async () => {
    try {
      const prompt = await generateLLMPrompt({
        gameState,
        currentRoundInputs,
        roundType,
      });
      const copied = await copyToClipboard(prompt);
      if (copied) recordSuccessfulPromptCopy('roundAnalysis');
      setSnackbarMessage('提示词已复制到剪贴板');
    } catch (err) {
      setError('生成提示词失败：' + (err as Error).message);
      console.error(err);
    }
  };

  const handleCopyRoundImage = async () => {
    const exportId = ++shareExportSequenceRef.current;
    setShareImageBusy(true);
    setError(null);
    setShareError(null);
    const shareMetadata = {
      downloadFilename: `sanmou-round-${roundNumber}.png`,
      nativeShareTitle: `三谋演武第 ${roundNumber} 轮`,
    };
    const heroesWithSupport = [
      ...(gameState.current_heroes || []),
      ...(supportHero ? [supportHero] : []),
    ];
    const skillsWithSupport = [
      ...(gameState.current_skills || []),
      ...supportSkillsList,
    ];
    const availableSets: [string[], string[], string[]] = [
      [...(currentRoundInputs.set1 || [])],
      [...(currentRoundInputs.set2 || [])],
      [...(currentRoundInputs.set3 || [])],
    ];
    const isValidSetIndex = (value: unknown): value is number =>
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value < availableSets.length;

    try {
      const pngPromise = (async () => {
        let recommendedSetIndex: unknown = recommendationIsCurrent
          ? currentRecommendation?.recommended_set_index
          : undefined;
        if (!isValidSetIndex(recommendedSetIndex)) {
          const response = await api.getRecommendation(roundType, availableSets, gameState);
          recommendedSetIndex = response.recommendation.recommended_set_index;
        }
        if (!isValidSetIndex(recommendedSetIndex)) {
          throw new Error('AI 推荐组无效');
        }
        if (!mountedRef.current || shareExportSequenceRef.current !== exportId) {
          throw new Error('分享图片生成已取消');
        }

        return renderRoundShareImage({
          roundNumber,
          roundType,
          season: state.selectedSeason,
          sets: availableSets,
          recommendedSetIndex,
          heroes: [...(gameState.current_heroes || [])],
          skills: [...(gameState.current_skills || [])],
          supportHero,
          supportSkills: [...supportSkillsList],
          rosterScore: currentRosterScore(
            heroesWithSupport,
            skillsWithSupport,
            recommendationData
          ),
        });
      })();
      const copied = await copyImageToClipboard(pngPromise);
      if (copied) {
        if (!mountedRef.current || shareExportSequenceRef.current !== exportId) return;
        setSnackbarMessage('图片已复制，可粘贴到微信');
      } else {
        const blob = await pngPromise;
        openSharePreview(blob, shareMetadata, exportId);
      }
    } catch (shareImageError) {
      if (!mountedRef.current || shareExportSequenceRef.current !== exportId) return;
      setShareError('生成分享图片失败：' + (shareImageError as Error).message);
      console.error(shareImageError);
    } finally {
      if (mountedRef.current && shareExportSequenceRef.current === exportId) {
        setShareImageBusy(false);
      }
    }
  };

  const allSetsComplete =
    currentRoundInputs.set1?.length === itemsPerSet &&
    currentRoundInputs.set2?.length === itemsPerSet &&
    currentRoundInputs.set3?.length === itemsPerSet;

  return (
    <GameBoardShell {...shellProps}>
      <Container maxWidth="xl" disableGutters>
      <Box>
        <RoundInfo roundNumber={roundNumber} />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 2.25fr) minmax(300px, .75fr)' },
            gap: 2,
            alignItems: 'start',
          }}
        >
          <Box
            component="aside"
            aria-label="当前阵容与仓库"
            sx={{ order: { xs: 2, lg: 2 }, position: { lg: 'sticky' }, top: { lg: 24 }, minWidth: 0 }}
          >
            <ResponsiveDisclosure label="当前阵容与仓库">
              <CurrentTeam
                heroes={gameState.current_heroes}
                skills={gameState.current_skills}
                availableHeroes={availableHeroes}
                heroMetadata={heroMetadata}
                skillMetadata={skillMetadata}
                availableSkills={regularSkills}
                onUpdateTeam={handleUpdateTeam}
                supportHero={supportHero}
                supportSkills={supportSkillsList}
              />
            </ResponsiveDisclosure>
          </Box>

          <Box sx={{ order: { xs: 1, lg: 1 }, minWidth: 0 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <AnalysisGrid
          sets={currentRoundInputs}
          analysis={currentRecommendation?.analysis as OptionAnalysis[] | undefined}
          selectedIndex={selectedOptionIndex}
          recommendedIndex={currentRecommendation?.recommended_set_index}
          preference={
            currentRecommendation?.preference as
              | PreferencePrediction
              | null
              | undefined
          }
          onSelectSet={handleSelectOption}
          roundType={roundType}
          heroMetadata={heroMetadata}
          skillMetadata={skillMetadata}
          availableItems={availableItems}
          onUpdateSet={handleUpdateSet}
          itemsPerSet={itemsPerSet}
          disabled={loading}
          actions={
            <>
              <Button
                variant="contained"
                color="primary"
                size="small"
                onClick={handleGetRecommendation}
                disabled={!allSetsComplete || loading}
              >
                {loading ? (
                  <CircularProgress size={20} color="inherit" />
                ) : currentRecommendation ? (
                  "重新分析"
                ) : (
                  "获取 AI 推荐"
                )}
              </Button>
              <Button
                variant="outlined"
                color="primary"
                size="small"
                onClick={handleGeneratePrompt}
                disabled={!allSetsComplete}
                startIcon={<ContentCopyIcon fontSize="small" />}
              >
                复制 AI 分析提示词
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={handleCopyRoundImage}
                disabled={!allSetsComplete || shareImageBusy}
                startIcon={
                  shareImageBusy ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <ForumOutlinedIcon fontSize="small" />
                  )
                }
                sx={{
                  color: '#067A3D',
                  borderColor: '#067A3D',
                  '&:hover': {
                    color: '#046B35',
                    borderColor: '#046B35',
                    backgroundColor: 'rgba(7, 193, 96, 0.08)',
                  },
                }}
              >
                复制给微信好友
              </Button>
            </>
          }
        />

        <Suspense
          fallback={(
            <GameLoadingPanel
              label="正在载入队伍策案"
              detail="正在展开武将与战法仓库…"
            />
          )}
        >
          <TeamBuilderPanel ref={teamBuilderRef} />
        </Suspense>

        {currentRecommendation && (
          <>
            <KnownStrongTeams
              selectedHeroes={[...selectedHeroes]}
              candidateHeroes={
                roundType === "hero"
                  ? [...new Set(
                      [
                        ...(currentRoundInputs.set1 || []),
                        ...(currentRoundInputs.set2 || []),
                        ...(currentRoundInputs.set3 || []),
                      ]
                    )]
                  : []
              }
              selectedSkills={[...selectedSkills]}
              candidateSkills={
                roundType === "skill"
                  ? [...new Set(
                      [
                        ...(currentRoundInputs.set1 || []),
                        ...(currentRoundInputs.set2 || []),
                        ...(currentRoundInputs.set3 || []),
                      ]
                    )]
                  : []
              }
              roundType={roundType}
            />

            <RecommendationPanel
              recommendation={currentRecommendation}
              roundType={roundType}
            />

            <Button
              variant="contained"
              color="success"
              size="large"
              fullWidth
              onClick={handleRecordChoice}
              disabled={
                selectedOptionIndex === null ||
                !recommendationIsCurrent ||
                loading
              }
            >
              确认选择并进入下一轮
            </Button>
          </>
        )}
          </Box>
        </Box>
      </Box>
      </Container>
    </GameBoardShell>
  );
};

export default GameBoard;
