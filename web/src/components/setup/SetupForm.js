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
          <Typography sx={{ mt: 2 }}>正在加载数据...</Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h5" gutterBottom>
          🎮 对局设置
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          输入初始 4 个武将和 4 个战法以开始对局。
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Heroes Input */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            初始武将 ({heroes.length}/4)
          </Typography>
          <AutocompleteInput
            items={availableHeroes}
            selectedItems={heroes}
            onAdd={handleAddHero}
            label="输入武将名或拼音..."
            placeholder="搜索武将..."
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
            初始战法 ({skills.length}/4)
          </Typography>
          <AutocompleteInput
            items={availableSkills}
            selectedItems={skills}
            onAdd={handleAddSkill}
            label="输入战法名或拼音..."
            placeholder="搜索战法..."
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
          开始对局
        </Button>

        {!canStartGame && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', textAlign: 'center' }}>
            请选择恰好 4 个武将和 4 个战法以开始
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};

export default SetupForm;
