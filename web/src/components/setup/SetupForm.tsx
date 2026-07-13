import { useState } from 'react';
import { Card, CardContent, Typography, Button, Box, Alert, CircularProgress } from '@mui/material';
import AutocompleteInput from '../common/AutocompleteInput';
import TagList from '../common/TagList';
import { useGame } from '../../context/GameContext';
import { validateGameInput } from '../../services/gameLogic';

interface SetupFormProps {
  onStartGame?: () => void;
}

const SetupForm = ({ onStartGame }: SetupFormProps = {}) => {
  const [heroes, setHeroes] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { state, dispatch } = useGame();
  
  const { availableHeroes, heroMetadata, availableSkills, skillMetadata, heroSkills, databaseLoaded } = state;

  // Hero skills already selected count
  const heroSkillSet = new Set(heroSkills);
  const selectedHeroSkillCount = skills.filter(s => heroSkillSet.has(s)).length;

  // Filter available skills: exclude already-selected, and limit hero skills to 1
  const filteredSkills = availableSkills.filter(s => {
    if (skills.includes(s)) return false; // already selected
    // If it's a hero skill and we already have 1, block more
    if (heroSkillSet.has(s) && selectedHeroSkillCount >= 1) return false;
    return true;
  });

  const handleAddHero = (hero: string) => {
    if (heroes.length < 4) {
      setHeroes([...heroes, hero]);
    }
  };

  const handleRemoveHero = (hero: string) => {
    setHeroes(heroes.filter(h => h !== hero));
  };

  const handleAddSkill = (skill: string) => {
    if (skills.length < 8) {
      setSkills([...skills, skill]);
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setSkills(skills.filter(s => s !== skill));
  };

  const handleStartGame = () => {
    const validation = validateGameInput(heroes, skills);
    if (!validation.valid) {
      setError(validation.error ?? null);
      return;
    }

    dispatch({ type: 'START_GAME', heroes, skills });
    onStartGame?.();
  };

  const canStartGame = heroes.length === 4 && skills.length === 8;

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
    <Card sx={{ maxWidth: 1040, mx: 'auto', borderTop: '3px solid', borderTopColor: 'text.primary' }}>
      <CardContent sx={{ p: { xs: 2.25, sm: 4 }, '&:last-child': { pb: { xs: 2.25, sm: 4 } } }}>
        <Typography variant="overline" color="error.main">
          初始名册 · 演武开局
        </Typography>
        <Typography component="h1" variant="h4" gutterBottom>
          录入当前阵容
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          输入初始 4 个武将和 8 个战法以开始对局。
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Heroes Input */}
        <Box sx={{ mb: 3 }}>
          <Typography component="h2" variant="h6" gutterBottom sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}>
            初始武将 ({heroes.length}/4)
          </Typography>
          <AutocompleteInput
            items={availableHeroes}
            selectedItems={heroes}
            onAdd={handleAddHero}
            label="输入武将名或拼音..."
            placeholder="搜索武将..."
            maxItems={4}
            heroMetadata={heroMetadata}
          />
          <TagList
            items={heroes}
            onRemove={handleRemoveHero}
            color="primary"
            heroMetadata={heroMetadata}
          />
        </Box>

        {/* Skills Input */}
        <Box sx={{ mb: 3 }}>
          <Typography component="h2" variant="h6" gutterBottom sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}>
            初始战法 ({skills.length}/8)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            4个橙色战法和4个紫色战法
          </Typography>
          <AutocompleteInput
            items={filteredSkills}
            selectedItems={skills}
            onAdd={handleAddSkill}
            label="输入战法名或拼音..."
            placeholder="搜索战法..."
            maxItems={8}
            skillMetadata={skillMetadata}
          />
          <TagList
            items={skills}
            onRemove={handleRemoveSkill}
            color="secondary"
            skillMetadata={skillMetadata}
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
            请选择恰好 4 个武将和 8 个战法以开始
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};

export default SetupForm;
