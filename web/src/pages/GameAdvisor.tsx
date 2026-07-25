import { Box } from '@mui/material';
import { useGame } from '../context/GameContext';
import SetupForm from '../components/setup/SetupForm';
import GameBoard from '../components/game/GameBoard';

const GameAdvisor = () => {
  const { state } = useGame();

  return (
    <Box sx={{ minWidth: 0 }}>
      {!state.gameState ? <SetupForm /> : <GameBoard />}
    </Box>
  );
};

export default GameAdvisor;
