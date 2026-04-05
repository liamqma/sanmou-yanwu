import React, { useState } from 'react';
import { Paper, Typography, Box, Grid, Button, Collapse, Alert, Snackbar } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TagList from '../common/TagList';
import AutocompleteInput from '../common/AutocompleteInput';
import { generateSupportPrompt } from '../../services/promptGenerator';

/**
 * Display current team members (heroes and skills) with manual edit capability
 */
const CurrentTeam = ({ heroes, skills, availableHeroes, availableSkills, onUpdateTeam, editable = true }) => {
  const [editMode, setEditMode] = useState(false);
  const [editedHeroes, setEditedHeroes] = useState(heroes);
  const [editedSkills, setEditedSkills] = useState(skills);
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
          {heroes.length >= 3 && (
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopyPrompt}
            >
              为支援武将和战法创建LLM提示词
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
