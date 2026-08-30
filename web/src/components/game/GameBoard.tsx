import { useEffect, useState, type ReactNode } from "react";
import { Container, Box, Button, Alert, CircularProgress, Typography, Paper, Snackbar } from "@mui/material";
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useGame } from "../../context/GameContext";
import { api } from "../../services/api";
import { getRoundType, getItemsPerSet, TOTAL_ROUNDS } from "../../services/gameLogic";
import { generateLLMPrompt } from "../../services/promptGenerator";
import RoundInfo from "./RoundInfo";
import CurrentTeam from "./CurrentTeam";
import OptionSetInput from "./OptionSetInput";
import RecommendationPanel from "./RecommendationPanel";
import AnalysisGrid from "./AnalysisGrid";
import KnownStrongTeams from "./KnownStrongTeams";
import ResponsiveDisclosure from "../common/ResponsiveDisclosure";
import { copyToClipboard } from "../../utils/clipboard";
import type { SetName } from "../../types/game";
import type { OptionAnalysis } from "../../services/recommendationEngine";
import type { PreferencePrediction } from "../../types/telemetryData";
import { recordRoundTelemetry } from "../../services/telemetry";
import { recordSuccessfulPromptCopy } from "../../services/googleAnalytics";
import {
  buildRoundRecommendationDebugContext,
  registerSanmouDebugContext,
  SANMOU_DEBUG_SCHEMA,
} from "../../services/recommendationDebug";

interface QualificationInterstitialProps {
  roundNumber: 7 | 9;
  onContinue: () => void;
  children: ReactNode;
}

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
  const [snackbarOpen, setSnackbarOpen] = useState(false);

  const {
    gameState,
    currentRoundInputs,
    selectedOptionIndex,
    currentRecommendation,
    availableHeroes,
    heroMetadata,
    skillMetadata,
    regularSkills,
    orangeRegularSkills,
  } = state;

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
        return buildRoundRecommendationDebugContext({
          season: state.selectedSeason,
          gameState,
          roundType: getRoundType(gameState.round_number),
          currentRoundInputs,
          recommendation: currentRecommendation,
        });
      }),
    [
      currentRecommendation,
      currentRoundInputs,
      gameState,
      state.selectedSeason,
    ]
  );

  if (!gameState) {
    return null;
  }

  const roundNumber = gameState.round_number;
  const supportHero = gameState.support_hero || null;
  const supportSkillsList = gameState.support_skills || [];

  const handleUpdateTeam = (heroes: string[], skills: string[]) => {
    dispatch({ type: "UPDATE_TEAM", heroes, skills });
  };

  const qualificationRound =
    roundNumber === 7 && !gameState.round7_interstitial_dismissed
      ? 7
      : roundNumber === 9 && !gameState.round9_interstitial_dismissed
        ? 9
        : null;

  if (qualificationRound) {
    return (
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
    );
  }

  // Check if game is complete
  if (roundNumber > TOTAL_ROUNDS) {
    return (
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
              sx={{ mt: 1.25, mb: 0, fontWeight: 800, color: "success.light" }}
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

  const handleGetRecommendation = async () => {
    try {
      setLoading(true);
      setError(null);

      const availableSets = [
        currentRoundInputs.set1 || [],
        currentRoundInputs.set2 || [],
        currentRoundInputs.set3 || [],
      ];

      // Validate all sets have correct number of items
      if (!availableSets.every((set) => set.length === itemsPerSet)) {
        setError(`三组选项每组必须恰好有 ${itemsPerSet} 项`);
        setLoading(false);
        return;
      }

      const response = await api.getRecommendation(
        roundType,
        availableSets,
        gameState
      );

      // Extract the recommendation object from the response
      const recommendation = response.recommendation || response;

      dispatch({ type: "SET_RECOMMENDATION", recommendation });
    } catch (err) {
      setError("获取推荐失败：" + (err as Error).message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = (index: number) => {
    dispatch({ type: "SELECT_OPTION", index });
  };

  const handleRecordChoice = () => {
    if (selectedOptionIndex === null) {
      setError("请先选择一组选项");
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
      setSnackbarOpen(true);
    } catch (err) {
      setError('生成提示词失败：' + (err as Error).message);
      console.error(err);
    }
  };

  const allSetsComplete =
    currentRoundInputs.set1?.length === itemsPerSet &&
    currentRoundInputs.set2?.length === itemsPerSet &&
    currentRoundInputs.set3?.length === itemsPerSet;

  return (
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
            sx={{ order: { xs: 1, lg: 2 }, position: { lg: 'sticky' }, top: { lg: 82 }, minWidth: 0 }}
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

          <Box sx={{ order: { xs: 2, lg: 1 }, minWidth: 0 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <OptionSetInput
          roundType={roundType}
          availableItems={availableItems}
          sets={currentRoundInputs}
          onUpdateSet={handleUpdateSet}
          disabled={loading}
          itemsPerSet={itemsPerSet}
          heroMetadata={heroMetadata}
          skillMetadata={skillMetadata}
        />

        <Box sx={{ mb: 3 }}>
          <Button
            variant="contained"
            color="primary"
            onClick={handleGetRecommendation}
            disabled={!allSetsComplete || loading}
            fullWidth
          >
            {loading ? (
              <CircularProgress size={24} />
            ) : (
              "获取 AI 推荐"
            )}
          </Button>
          <Button
            variant="outlined"
            color="primary"
            size="small"
            fullWidth
            onClick={handleGeneratePrompt}
            disabled={!allSetsComplete}
            startIcon={<ContentCopyIcon fontSize="small" />}
            sx={{ mt: 0.75 }}
          >
            复制 AI 分析提示词
          </Button>
        </Box>

        <Snackbar
          open={snackbarOpen}
          autoHideDuration={2000}
          onClose={() => setSnackbarOpen(false)}
          message="提示词已复制到剪贴板"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        />

        {currentRecommendation && (
          <>
            <AnalysisGrid
              sets={currentRoundInputs}
              analysis={currentRecommendation.analysis as OptionAnalysis[] | undefined}
              selectedIndex={selectedOptionIndex}
              recommendedIndex={currentRecommendation.recommended_set_index}
              preference={
                currentRecommendation.preference as
                  | PreferencePrediction
                  | null
                  | undefined
              }
              onSelectSet={handleSelectOption}
              roundType={roundType}
              heroMetadata={heroMetadata}
              skillMetadata={skillMetadata}
            />

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
              disabled={selectedOptionIndex === null}
            >
              确认选择并进入下一轮
            </Button>
          </>
        )}
          </Box>
        </Box>
      </Box>
    </Container>
  );
};

export default GameBoard;
