import React, { useState } from 'react';
import { Paper, Typography, Box, Grid, Button, Collapse, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Chip, List, ListItem, ListItemText, Snackbar } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TagList from '../common/TagList';
import AutocompleteInput from '../common/AutocompleteInput';
import { recommendSingleHero, recommendTwoSkills } from '../../services/recommendationEngine';
import { generateSupportPrompt } from '../../services/promptGenerator';
import battleStatsData from '../../battle_stats.json';

/**
 * Display current team members (heroes and skills) with manual edit capability
 */
const CurrentTeam = ({ heroes, skills, availableHeroes, availableSkills, onUpdateTeam, editable = true }) => {
  const [editMode, setEditMode] = useState(false);
  const [editedHeroes, setEditedHeroes] = useState(heroes);
  const [editedSkills, setEditedSkills] = useState(skills);
  const [heroRecDialog, setHeroRecDialog] = useState(false);
  const [skillRecDialog, setSkillRecDialog] = useState(false);
  const [heroRecResult, setHeroRecResult] = useState(null);
  const [skillRecResult, setSkillRecResult] = useState(null);
  const [selectedRecHero, setSelectedRecHero] = useState(null);
  const [selectedRecSkills, setSelectedRecSkills] = useState([]);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  
  const handleEditToggle = () => {
    if (editMode) {
      // Save changes
      onUpdateTeam?.(editedHeroes, editedSkills);
      setEditMode(false);
    } else {
      // Enter edit mode, reset to current values
      setEditedHeroes([...heroes]);
      setEditedSkills([...skills]);
      setEditMode(true);
    }
  };
  
  const handleCancelEdit = () => {
    setEditedHeroes([...heroes]);
    setEditedSkills([...skills]);
    setEditMode(false);
  };
  
  const handleAddHero = (hero) => {
    if (!editedHeroes.includes(hero)) {
      setEditedHeroes([...editedHeroes, hero]);
    }
  };
  
  const handleRemoveHero = (hero) => {
    setEditedHeroes(editedHeroes.filter(h => h !== hero));
  };
  
  const handleAddSkill = (skill) => {
    if (!editedSkills.includes(skill)) {
      setEditedSkills([...editedSkills, skill]);
    }
  };
  
  const handleRemoveSkill = (skill) => {
    setEditedSkills(editedSkills.filter(s => s !== skill));
  };

  const handleRecommendHero = () => {
    const unchosenHeroes = (availableHeroes || []).filter(h => !heroes.includes(h));
    const result = recommendSingleHero(unchosenHeroes, heroes, skills, battleStatsData);
    setHeroRecResult(result);
    setSelectedRecHero(result.hero || null);
    setHeroRecDialog(true);
  };

  const handleRecommendSkills = () => {
    const unchosenSkills = (availableSkills || []).filter(s => !skills.includes(s));
    const result = recommendTwoSkills(unchosenSkills, heroes, skills, battleStatsData);
    setSkillRecResult(result);
    setSelectedRecSkills(result.skills ? [...result.skills] : []);
    setSkillRecDialog(true);
  };

  const handleToggleRecSkill = (skill) => {
    setSelectedRecSkills(prev => 
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  };

  const handleAddHeroToTeam = () => {
    if (selectedRecHero && onUpdateTeam) {
      onUpdateTeam([...heroes, selectedRecHero], skills);
      setHeroRecDialog(false);
    }
  };

  const handleAddSkillsToTeam = () => {
    if (selectedRecSkills.length > 0 && onUpdateTeam) {
      onUpdateTeam(heroes, [...skills, ...selectedRecSkills]);
      setSkillRecDialog(false);
    }
  };

  const handleCopyPrompt = async () => {
    try {
      const prompt = await generateSupportPrompt(heroes, skills);
      await navigator.clipboard.writeText(prompt);
      setSnackbarMessage('已复制到剪贴板！可粘贴到 ChatGPT 等 LLM 进行分析。');
    } catch {
      const prompt = await generateSupportPrompt(heroes, skills);
      const textArea = document.createElement('textarea');
      textArea.value = prompt;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setSnackbarMessage('已复制到剪贴板！');
    }
    setSnackbarOpen(true);
  };
  
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6">
            📋 当前队伍
          </Typography>
          {heroes.length <= 10 && (
            <Button
              size="small"
              variant="outlined"
              color="primary"
              startIcon={<AutoAwesomeIcon />}
              onClick={handleRecommendHero}
              disabled={!availableHeroes || availableHeroes.length === 0}
            >
              推荐自选武将
            </Button>
          )}
          {skills.length <= 20 && (
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<AutoAwesomeIcon />}
              onClick={handleRecommendSkills}
              disabled={!availableSkills || availableSkills.length === 0}
            >
              推荐自选战法
            </Button>
          )}
        </Box>
        
        {editable && availableHeroes && availableSkills && onUpdateTeam && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            {editMode && (
              <Button
                size="small"
                variant="outlined"
                onClick={handleCancelEdit}
              >
                取消
              </Button>
            )}
            <Button
              size="small"
              variant={editMode ? "contained" : "outlined"}
              startIcon={editMode ? <CheckIcon /> : <EditIcon />}
              onClick={handleEditToggle}
            >
              {editMode ? '保存修改' : '编辑队伍'}
            </Button>
          </Box>
        )}
      </Box>
      
      <Collapse in={editMode}>
        <Alert severity="info" sx={{ mb: 2 }}>
          可手动添加或移除队伍中的武将和战法。点击「保存修改」后生效。
        </Alert>
      </Collapse>
      
      <Grid container spacing={3}>
        <Grid item size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom>
            武将 ({editMode ? editedHeroes.length : heroes.length})
          </Typography>
          
          {editMode ? (
            <>
              <AutocompleteInput
                items={availableHeroes.filter(h => !editedHeroes.includes(h))}
                selectedItems={editedHeroes}
                onAdd={handleAddHero}
                label="添加武将..."
                placeholder="搜索武将..."
              />
              <TagList 
                items={editedHeroes} 
                onRemove={handleRemoveHero}
                color="primary" 
              />
            </>
          ) : (
            <TagList 
              items={heroes} 
              color="primary" 
              editable={false}
            />
          )}
        </Grid>
        
        <Grid item size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" gutterBottom>
            战法 ({editMode ? editedSkills.length : skills.length})
          </Typography>
          
          {editMode ? (
            <>
              <AutocompleteInput
                items={availableSkills.filter(s => !editedSkills.includes(s))}
                selectedItems={editedSkills}
                onAdd={handleAddSkill}
                label="添加战法..."
                placeholder="搜索战法..."
              />
              <TagList 
                items={editedSkills} 
                onRemove={handleRemoveSkill}
                color="secondary" 
              />
            </>
          ) : (
            <TagList 
              items={skills} 
              color="secondary" 
              editable={false}
            />
          )}
        </Grid>
      </Grid>

      {/* Hero Recommendation Dialog */}
      <Dialog open={heroRecDialog} onClose={() => setHeroRecDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>🎯 推荐自选武将</DialogTitle>
        <DialogContent>
          {heroRecResult && heroRecResult.hero ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                推荐武将：<strong>{heroRecResult.hero}</strong>
              </Alert>
              <Typography variant="subtitle2" gutterBottom>
                点击选择候选武将：
              </Typography>
              <List dense>
                {heroRecResult.analysis.map((candidate, idx) => {
                  const isSelected = selectedRecHero === candidate.hero;
                  return (
                    <ListItem
                      key={idx}
                      sx={{
                        py: 0.5,
                        cursor: 'pointer',
                        borderRadius: 1,
                        border: isSelected ? '2px solid' : '2px solid transparent',
                        borderColor: isSelected ? 'primary.main' : 'transparent',
                        bgcolor: isSelected ? 'primary.50' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                        mb: 0.5,
                      }}
                      onClick={() => setSelectedRecHero(candidate.hero)}
                    >
                      <Chip
                        label={candidate.hero}
                        color={isSelected ? 'primary' : 'default'}
                        size="small"
                        sx={{ mr: 1, minWidth: 80 }}
                      />
                      <ListItemText
                        primary={`综合评分：${candidate.finalScore.toFixed(1)}`}
                        secondary={[
                          candidate.details.individualScore != null && `个人胜率：${candidate.details.individualScore.toFixed(1)}`,
                          candidate.details.pairScore != null && `武将配合：${candidate.details.pairScore.toFixed(1)}`,
                          candidate.details.skillHeroScore != null && `战法配合：${candidate.details.skillHeroScore.toFixed(1)}`,
                        ].filter(Boolean).join(' | ')}
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{ variant: 'caption' }}
                      />
                    </ListItem>
                  );
                })}
              </List>
            </>
          ) : (
            <Alert severity="info">暂无可推荐的武将。</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHeroRecDialog(false)}>关闭</Button>
          {heroes.length >= 3 && (
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopyPrompt}
            >
              生成AI提示词
            </Button>
          )}
          {heroRecResult && heroRecResult.hero && (
            <Button
              variant="contained"
              onClick={handleAddHeroToTeam}
              disabled={!selectedRecHero}
            >
              加入队伍
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Skill Recommendation Dialog */}
      <Dialog open={skillRecDialog} onClose={() => setSkillRecDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>🎯 推荐自选战法</DialogTitle>
        <DialogContent>
          {skillRecResult && skillRecResult.skills.length > 0 ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                推荐战法：{skillRecResult.skills.map((s, i) => (
                  <Chip key={i} label={s} color="secondary" size="small" sx={{ ml: 0.5 }} />
                ))}
              </Alert>
              {selectedRecSkills.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    已选择 {selectedRecSkills.length} 个战法：
                  </Typography>
                  {selectedRecSkills.map((s, i) => (
                    <Chip key={i} label={s} color="secondary" size="small" sx={{ ml: 0.5 }} onDelete={() => handleToggleRecSkill(s)} />
                  ))}
                </Box>
              )}
              <Typography variant="subtitle2" gutterBottom>
                点击选择候选战法：
              </Typography>
              <List dense>
                {skillRecResult.analysis.map((candidate, idx) => {
                  const isSelected = selectedRecSkills.includes(candidate.skill);
                  return (
                    <ListItem
                      key={idx}
                      sx={{
                        py: 0.5,
                        cursor: 'pointer',
                        borderRadius: 1,
                        border: isSelected ? '2px solid' : '2px solid transparent',
                        borderColor: isSelected ? 'secondary.main' : 'transparent',
                        bgcolor: isSelected ? 'secondary.50' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                        mb: 0.5,
                      }}
                      onClick={() => handleToggleRecSkill(candidate.skill)}
                    >
                      <Chip
                        label={candidate.skill}
                        color={isSelected ? 'secondary' : 'default'}
                        size="small"
                        sx={{ mr: 1, minWidth: 80 }}
                      />
                      <ListItemText
                        primary={`综合评分：${candidate.finalScore.toFixed(1)}`}
                        secondary={[
                          candidate.details.individualScore != null && `个人胜率：${candidate.details.individualScore.toFixed(1)}`,
                          candidate.details.skillHeroScore != null && `武将配合：${candidate.details.skillHeroScore.toFixed(1)}`,
                        ].filter(Boolean).join(' | ')}
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{ variant: 'caption' }}
                      />
                    </ListItem>
                  );
                })}
              </List>
            </>
          ) : (
            <Alert severity="info">暂无可推荐的战法。</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSkillRecDialog(false)}>关闭</Button>
          {heroes.length >= 3 && (
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopyPrompt}
            >
              生成AI提示词
            </Button>
          )}
          {skillRecResult && skillRecResult.skills.length > 0 && (
            <Button
              variant="contained"
              color="secondary"
              onClick={handleAddSkillsToTeam}
              disabled={selectedRecSkills.length === 0}
            >
              加入队伍
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />
    </Paper>
  );
};

export default CurrentTeam;
