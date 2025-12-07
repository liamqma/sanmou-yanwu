import React, { useState } from "react";
import { Container, Box, Button, Alert, CircularProgress } from "@mui/material";
import { useGame } from "../../context/GameContext";
import { api } from "../../services/api";
import { getRoundType, getItemsPerSet } from "../../services/gameLogic";
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

  const {
    gameState,
    currentRoundInputs,
    selectedOptionIndex,
    currentRecommendation,
    availableHeroes,
    availableSkills,
  } = state;

  if (!gameState) {
    return null;
  }

  const roundNumber = gameState.round_number;
  const roundType = getRoundType(roundNumber);
  const itemsPerSet = getItemsPerSet(roundNumber);
  const availableItems =
    roundType === "hero" ? availableHeroes : availableSkills;

  // Check if game is complete
  if (roundNumber > 8) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 4 }}>
          <Alert severity="success" sx={{ mb: 3 }}>
            <strong>🎉 Game Complete!</strong>
            <br />
            You've completed all 6 rounds. Check out your final team
            composition.
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
            Start New Game
          </Button>
        </Box>
      </Container>
    );
  }

  const handleUpdateSet = (setName, items) => {
    dispatch({ type: "UPDATE_ROUND_INPUT", setName, items });
  };

  const handleUpdateTeam = (heroes, skills) => {
    dispatch({ type: "UPDATE_TEAM", heroes, skills });
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
        setError(`All 3 sets must have exactly ${itemsPerSet} items each`);
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
      setError("Failed to get recommendation: " + err.message);
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
      setError("Please select an option set first");
      return;
    }

    const setName = `set${selectedOptionIndex + 1}`;
    const chosenSet = currentRoundInputs[setName];

    if (!chosenSet || chosenSet.length !== itemsPerSet) {
      setError("Invalid selection");
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
          availableSkills={availableSkills}
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
              "🤖 Get AI Recommendation"
            )}
          </Button>
        </Box>

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
              ✅ Confirm Choice & Next Round
            </Button>
          </>
        )}
      </Box>
    </Container>
  );
};

export default GameBoard;
