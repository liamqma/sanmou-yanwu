import React, { useState } from 'react';
import { Card, CardContent, Typography, Button, Box, Alert, CircularProgress } from '@mui/material';
import AutocompleteInput from '../common/AutocompleteInput';
import TagList from '../common/TagList';
import { useGame } from '../../context/GameContext';
import { validateGameInput } from '../../services/gameLogic';

const SetupForm = ({ onStartGame }) => {
  const [heroes, setHeroes] = useState([]);
  const [skills, setSkills] = useState([]);
  const [error, setError] = useState(null);
  const { state, dispatch } = useGame();
  
  const { availableHeroes, availableSkills, databaseLoaded } = state;

  const handleAddHero = (hero) => {
    if (heroes.length < 4) {
      setHeroes([...heroes, hero]);
    }
  };

  const handleRemoveHero = (hero) => {
    setHeroes(heroes.filter(h => h !== hero));
  };

  const handleAddSkill = (skill) => {
    if (skills.length < 4) {
      setSkills([...skills, skill]);
    }
  };

  const handleRemoveSkill = (skill) => {
    setSkills(skills.filter(s => s !== skill));
  };

  const handleStartGame = () => {
    const validation = validateGameInput(heroes, skills);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    dispatch({ type: 'START_GAME', heroes, skills });
    onStartGame();
  };

  const canStartGame = heroes.length === 4 && skills.length === 4;

  if (!databaseLoaded) {
    return (
      <Card>
        <CardContent sx={{ textAlign: 'center', py: 6 }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Loading database...</Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h5" gutterBottom>
          🎮 Game Setup
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          Enter your initial 4 heroes and 4 skills to begin the game session.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Heroes Input */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Initial Heroes ({heroes.length}/4)
          </Typography>
          <AutocompleteInput
            items={availableHeroes}
            selectedItems={heroes}
            onAdd={handleAddHero}
            label="Type hero name or pinyin..."
            placeholder="Search heroes..."
            maxItems={4}
          />
          <TagList
            items={heroes}
            onRemove={handleRemoveHero}
            color="primary"
          />
        </Box>

        {/* Skills Input */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Initial Skills ({skills.length}/4)
          </Typography>
          <AutocompleteInput
            items={availableSkills}
            selectedItems={skills}
            onAdd={handleAddSkill}
            label="Type skill name or pinyin..."
            placeholder="Search skills..."
            maxItems={4}
          />
          <TagList
            items={skills}
            onRemove={handleRemoveSkill}
            color="secondary"
          />
        </Box>

        {/* Start Button */}
        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={handleStartGame}
          disabled={!canStartGame}
        >
          Start Game Session
        </Button>

        {!canStartGame && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', textAlign: 'center' }}>
            Please select exactly 4 heroes and 4 skills to start
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};

export default SetupForm;
