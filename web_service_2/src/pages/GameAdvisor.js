import React from 'react';
import { Box } from '@mui/material';
import { useGame } from '../context/GameContext';
import SetupForm from '../components/setup/SetupForm';
import GameBoard from '../components/game/GameBoard';

const GameAdvisor = () => {
  const { state } = useGame();

  const handleStartGame = () => {
    // Game started, state will update automatically
  };

  return (
    <Box>
      {!state.gameState ? (
        <SetupForm onStartGame={handleStartGame} />
      ) : (
        <GameBoard />
      )}
    </Box>
  );
};

export default GameAdvisor;
