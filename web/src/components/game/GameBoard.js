import React, { useState } from "react";
import { Container, Box, Button, Alert, CircularProgress, Typography, Paper, Snackbar } from "@mui/material";
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useGame } from "../../context/GameContext";
import { api } from "../../services/api";
import { getRoundType, getItemsPerSet } from "../../services/gameLogic";
import { generateLLMPrompt } from "../../services/promptGenerator";
import RoundInfo from "./RoundInfo";
import CurrentTeam from "./CurrentTeam";
import OptionSetInput from "./OptionSetInput";
import RecommendationPanel from "./RecommendationPanel";
import AnalysisGrid from "./AnalysisGrid";

/**
 * Main game board component - manages game flow
 */
const GameBoard = () => {
  const { state, dispatch } = useGame();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);

  const {
    gameState,
    currentRoundInputs,
    selectedOptionIndex,
    currentRecommendation,
    availableHeroes,
    regularSkills,
    orangeRegularSkills,
  } = state;

  if (!gameState) {
    return null;
  }

  const roundNumber = gameState.round_number;
  const roundType = getRoundType(roundNumber);
  const itemsPerSet = getItemsPerSet(roundNumber);

  // Filter out already-selected heroes/skills from the available items
  const selectedHeroes = new Set(gameState.current_heroes || []);
  const selectedSkills = new Set(gameState.current_skills || []);

  let availableItems;
  if (roundType === "hero") {
    // Only show heroes not already selected
    availableItems = availableHeroes.filter(h => !selectedHeroes.has(h));
  } else {
    // During rounds, only show orange regular skills (no hero skills, no purple), exclude already-selected
    availableItems = orangeRegularSkills.filter(s => !selectedSkills.has(s));
  }

  const handleUpdateTeam = (heroes, skills) => {
    dispatch({ type: "UPDATE_TEAM", heroes, skills });
  };

  // Interstitial page between round 6 and 7 (州内小组赛)
  if (roundNumber === 7 && !gameState.round7_interstitial_dismissed) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 4 }}>
          <RoundInfo roundNumber={7} />
          <Paper sx={{ p: 3, mb: 3, textAlign: "center" }}>
            <Typography variant="h4" gutterBottom sx={{ mb: 3 }}>
              祝好运!
            </Typography>
            <CurrentTeam
              heroes={gameState.current_heroes}
              skills={gameState.current_skills}
              availableHeroes={availableHeroes}
              availableSkills={regularSkills}
              onUpdateTeam={handleUpdateTeam}
              editable={true}
            />
            <Button
              variant="contained"
              color="primary"
              size="large"
              fullWidth
              sx={{ mt: 3, maxWidth: 360, mx: "auto", display: "block" }}
              onClick={() => dispatch({ type: "DISMISS_ROUND7_INTERSTITIAL" })}
            >
              我赢了，进入下一轮
            </Button>
          </Paper>
        </Box>
      </Container>
    );
  }

  // Check if game is complete
  if (roundNumber > 8) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 4 }}>
          <Alert severity="success" sx={{ mb: 3 }}>
            <strong>🎉 对局完成！</strong>
            <br />
            你已完成全部 8 轮。可查看最终队伍配置。
          </Alert>

          <CurrentTeam
            heroes={gameState.current_heroes}
            skills={gameState.current_skills}
            editable={false}
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

  const handleUpdateSet = (setName, items) => {
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
      setError("获取推荐失败：" + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = (index) => {
    dispatch({ type: "SELECT_OPTION", index });
  };

  const handleRecordChoice = () => {
    if (selectedOptionIndex === null) {
      setError("请先选择一组选项");
      return;
    }

    const setName = `set${selectedOptionIndex + 1}`;
    const chosenSet = currentRoundInputs[setName];

    if (!chosenSet || chosenSet.length !== itemsPerSet) {
      setError("选择无效");
      return;
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
    const prompt = await generateLLMPrompt({
      gameState,
      currentRoundInputs,
      recommendation: currentRecommendation,
      roundType,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      setSnackbarOpen(true);
    } catch {
      // Fallback for environments where clipboard API is unavailable
      const textarea = document.createElement('textarea');
      textarea.value = prompt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setSnackbarOpen(true);
    }
  };

  const allSetsComplete =
    currentRoundInputs.set1?.length === itemsPerSet &&
    currentRoundInputs.set2?.length === itemsPerSet &&
    currentRoundInputs.set3?.length === itemsPerSet;

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 4 }}>
        <RoundInfo roundNumber={roundNumber} />

        <CurrentTeam
          heroes={gameState.current_heroes}
          skills={gameState.current_skills}
          availableHeroes={availableHeroes}
          availableSkills={regularSkills}
          onUpdateTeam={handleUpdateTeam}
        />

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
        />

        <Box sx={{ mb: 3, display: "flex", gap: 2 }}>
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
              "🤖 获取 AI 推荐"
            )}
          </Button>
        </Box>

        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={handleGeneratePrompt}
          disabled={!allSetsComplete}
          startIcon={<ContentCopyIcon />}
          sx={{
            mb: 3,
            backgroundColor: '#ffffff',
            color: '#1a1a2e',
            fontWeight: 'bold',
            border: '2px solid #ffd700',
            '&:hover': {
              backgroundColor: '#ffd700',
              color: '#1a1a2e',
            },
            '&.Mui-disabled': {
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: 'rgba(255,255,255,0.4)',
              border: '2px solid rgba(255,215,0,0.3)',
            },
          }}
        >
          复制 AI 分析提示词
        </Button>

        <Snackbar
          open={snackbarOpen}
          autoHideDuration={2000}
          onClose={() => setSnackbarOpen(false)}
          message="✅ 提示词已复制到剪贴板"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        />

        {currentRecommendation && (
          <>
            <AnalysisGrid
              sets={currentRoundInputs}
              analysis={currentRecommendation.analysis}
              selectedIndex={selectedOptionIndex}
              recommendedIndex={currentRecommendation.recommended_set_index}
              onSelectSet={handleSelectOption}
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
              ✅ 确认选择并进入下一轮
            </Button>
          </>
        )}
      </Box>
    </Container>
  );
};

export default GameBoard;
