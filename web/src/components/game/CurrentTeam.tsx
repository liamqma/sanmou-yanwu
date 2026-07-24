import { useState } from 'react';
import { Paper, Typography, Box, Grid, Button, Collapse, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Chip, List, ListItem, ListItemText } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import TagList from '../common/TagList';
import AutocompleteInput from '../common/AutocompleteInput';
import {
  recommendSingleHero,
  recommendTwoSkills,
  currentRosterScore,
  type SingleHeroRecommendation,
  type TwoSkillsRecommendation,
  type HeroCandidate,
  type SkillCandidate,
} from '../../services/recommendationEngine';
import { useGame } from '../../context/GameContext';
import { recommendationData } from '../../data';
import type { HeroMeta, SkillMeta } from '../../types/game';

interface CurrentTeamProps {
  heroes: string[];
  skills: string[];
  availableHeroes?: string[];
  heroMetadata?: Record<string, HeroMeta> | null;
  skillMetadata?: Record<string, SkillMeta> | null;
  availableSkills?: string[];
  onUpdateTeam?: (heroes: string[], skills: string[]) => void;
  editable?: boolean;
  supportHero?: string | null;
  supportSkills?: string[];
}

/**
 * Display current team members (heroes and skills) with manual edit capability
 */
const CurrentTeam = ({ heroes, skills, availableHeroes, heroMetadata = null, skillMetadata = null, availableSkills, onUpdateTeam, editable = true, supportHero = null, supportSkills = [] }: CurrentTeamProps) => {
  // Support-team actions dispatch straight to the shared game state instead of
  // requiring every parent to thread `dispatch` down as a prop.
  const { state, dispatch } = useGame();
  const { selectedSeason } = state;
  const seasonHeroMetadata = heroMetadata ?? state.heroMetadata;
  const seasonSkillMetadata = skillMetadata ?? state.skillMetadata;
  const [editMode, setEditMode] = useState(false);
  const [editedHeroes, setEditedHeroes] = useState<string[]>(heroes);
  const [editedSkills, setEditedSkills] = useState<string[]>(skills);
  const [heroRecDialog, setHeroRecDialog] = useState(false);
  const [skillRecDialog, setSkillRecDialog] = useState(false);
  const [heroRecResult, setHeroRecResult] = useState<SingleHeroRecommendation | null>(null);
  const [skillRecResult, setSkillRecResult] = useState<TwoSkillsRecommendation | null>(null);
  const [selectedRecHero, setSelectedRecHero] = useState<string | null>(null);
  const [selectedRecSkills, setSelectedRecSkills] = useState<string[]>([]);

  const hasSupportHero = !!supportHero;
  const hasSupportSkills = (supportSkills || []).length >= 2;
  const isAvailableInSelectedSeason = (season: number | undefined) =>
    selectedSeason === null || season === undefined || season <= selectedSeason;
  const supportAvailableHeroes = (availableHeroes || []).filter((hero) =>
    isAvailableInSelectedSeason(seasonHeroMetadata[hero]?.season)
  );
  const supportAvailableSkills = (availableSkills || []).filter((skill) =>
    isAvailableInSelectedSeason(seasonSkillMetadata[skill]?.season)
  );

  // Current-roster score (display units, one decimal) for the whole pool —
  // main heroes/skills plus any support hero/skills. Uses the same paired-model
  // scoring convention as the option gains. Shown even before any recommendation.
  const rosterHeroes = [...heroes, ...(supportHero ? [supportHero] : [])];
  const rosterSkills = [...skills, ...(supportSkills || [])];
  const rosterScore = currentRosterScore(rosterHeroes, rosterSkills, recommendationData);

  
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
  
  const handleAddHero = (hero: string) => {
    if (!editedHeroes.includes(hero)) {
      setEditedHeroes([...editedHeroes, hero]);
    }
  };

  const handleRemoveHero = (hero: string) => {
    setEditedHeroes(editedHeroes.filter(h => h !== hero));
  };

  const handleAddSkill = (skill: string) => {
    if (!editedSkills.includes(skill)) {
      setEditedSkills([...editedSkills, skill]);
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setEditedSkills(editedSkills.filter(s => s !== skill));
  };

  const handleRecommendHero = () => {
    const allHeroesForRec = [...heroes, ...(supportHero ? [supportHero] : [])];
    const allSkillsForRec = [...skills, ...(supportSkills || [])];
    const unchosenHeroes = supportAvailableHeroes.filter(h => !allHeroesForRec.includes(h));
    const result = recommendSingleHero(
      unchosenHeroes,
      allHeroesForRec,
      allSkillsForRec,
      recommendationData,
      recommendationData.catalog,
    );
    setHeroRecResult(result);
    setSelectedRecHero(result.hero || null);
    setHeroRecDialog(true);
  };

  const handleRecommendSkills = () => {
    const allHeroesForRec = [...heroes, ...(supportHero ? [supportHero] : [])];
    const allSkillsForRec = [...skills, ...(supportSkills || [])];
    const unchosenSkills = supportAvailableSkills.filter(s => !allSkillsForRec.includes(s));
    const result = recommendTwoSkills(unchosenSkills, allHeroesForRec, allSkillsForRec, recommendationData);
    setSkillRecResult(result);
    setSelectedRecSkills(result.skills ? [...result.skills] : []);
    setSkillRecDialog(true);
  };

  const handleToggleRecSkill = (skill: string) => {
    setSelectedRecSkills(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  };

  const handleAddHeroToTeam = () => {
    if (selectedRecHero) {
      dispatch({ type: 'SET_SUPPORT_HERO', hero: selectedRecHero });
      setHeroRecDialog(false);
    }
  };

  const handleAddSkillsToTeam = () => {
    if (selectedRecSkills.length > 0 && selectedRecSkills.length <= 2) {
      dispatch({ type: 'SET_SUPPORT_SKILLS', skills: selectedRecSkills.slice(0, 2) });
      setSkillRecDialog(false);
    }
  };

  const handleRemoveSupportHero = () => {
    dispatch({ type: 'REMOVE_SUPPORT_HERO' });
  };

  const handleRemoveSupportSkill = (skill: string) => {
    dispatch({ type: 'REMOVE_SUPPORT_SKILL', skill });
  };

  return (
    <Paper sx={{ p: { xs: 2.25, sm: 3 }, mb: 3, borderTop: '3px solid', borderTopColor: 'text.primary' }}>
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="error.main" sx={{ display: 'block', lineHeight: 1.2 }}>CURRENT ROSTER</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1, rowGap: 0.5, flexWrap: 'wrap', minWidth: 0 }}>
              <Typography
                component="h2"
                variant="h5"
                sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, lineHeight: 1.25, whiteSpace: 'nowrap' }}
              >
                当前阵容
              </Typography>
              {selectedSeason !== null && (
                <Chip
                  label={`赛季 ${selectedSeason}`}
                  size="small"
                  variant="outlined"
                  color="primary"
                  data-testid="current-season-chip"
                />
              )}
              <Typography
                component="span"
                variant="subtitle1"
                color="text.secondary"
                data-testid="current-roster-score"
                sx={{ fontVariantNumeric: 'tabular-nums', fontSize: { xs: '0.9rem', sm: '1rem' }, whiteSpace: 'nowrap' }}
              >
                评分：{rosterScore.toFixed(1)}
              </Typography>
            </Box>
          </Box>

          {editable && availableHeroes && availableSkills && onUpdateTeam && (
            <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
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

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          {heroes.length <= 10 && !hasSupportHero && (
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
          {skills.length <= 20 && !hasSupportSkills && (
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

        <Alert
          severity="info"
          variant="outlined"
          sx={{ mt: 1.25, py: 0.5, alignItems: 'center' }}
        >
          <Typography variant="body2" fontWeight={600}>
            提示：建议先确认核心武将，再围绕核心挑选其余武将与战法。请尽早确认自选武将，AI 才能据此给出更精准的推荐。
          </Typography>
        </Alert>
      </Box>
      
      <Collapse in={editMode}>
        <Alert severity="info" sx={{ mb: 2 }}>
          可手动添加或移除队伍中的武将和战法。点击「保存修改」后生效。
        </Alert>
      </Collapse>
      
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography component="div" variant="subtitle2" gutterBottom>
            武将 ({editMode ? editedHeroes.length : heroes.length}{supportHero ? ' +1支援' : ''})
          </Typography>
          
          {editMode ? (
            <>
              <AutocompleteInput
                items={(availableHeroes || []).filter(h => !editedHeroes.includes(h))}
                selectedItems={editedHeroes}
                onAdd={handleAddHero}
                label="添加武将..."
                placeholder="搜索武将..."
                heroMetadata={heroMetadata}
              />
              <TagList 
                items={supportHero ? [...editedHeroes, supportHero] : editedHeroes} 
                onRemove={handleRemoveHero}
                color="primary"
                highlightItems={supportHero ? [supportHero] : []}
                onRemoveHighlight={handleRemoveSupportHero}
                heroMetadata={heroMetadata}
              />
            </>
          ) : (
            <TagList 
              items={supportHero ? [...heroes, supportHero] : heroes} 
              color="primary" 
              editable={false}
              highlightItems={supportHero ? [supportHero] : []}
              onRemoveHighlight={handleRemoveSupportHero}
              heroMetadata={heroMetadata}
            />
          )}
        </Grid>
        
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography component="div" variant="subtitle2" gutterBottom>
            战法 ({editMode ? editedSkills.length : skills.length}{(supportSkills || []).length > 0 ? ` +${supportSkills.length}支援` : ''})
          </Typography>
          
          {editMode ? (
            <>
              <AutocompleteInput
                items={(availableSkills || []).filter(s => !editedSkills.includes(s))}
                selectedItems={editedSkills}
                onAdd={handleAddSkill}
                label="添加战法..."
                placeholder="搜索战法..."
                skillMetadata={skillMetadata}
              />
              <TagList 
                items={[...editedSkills, ...(supportSkills || [])]} 
                onRemove={handleRemoveSkill}
                color="secondary"
                highlightItems={supportSkills || []}
                onRemoveHighlight={handleRemoveSupportSkill}
                skillMetadata={skillMetadata}
              />
            </>
          ) : (
            <TagList 
              items={[...skills, ...(supportSkills || [])]} 
              color="secondary" 
              editable={false}
              highlightItems={supportSkills || []}
              onRemoveHighlight={handleRemoveSupportSkill}
              skillMetadata={skillMetadata}
            />
          )}
        </Grid>
      </Grid>

      {/* Hero Recommendation Dialog */}
      <Dialog open={heroRecDialog} onClose={() => setHeroRecDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>推荐支援武将</DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <Typography component="div" variant="subtitle2" gutterBottom>
              手动搜索武将：
            </Typography>
            <AutocompleteInput
              items={supportAvailableHeroes.filter(h => !heroes.includes(h) && h !== supportHero)}
              selectedItems={selectedRecHero ? [selectedRecHero] : []}
              onAdd={(hero) => setSelectedRecHero(hero)}
              label="搜索武将..."
              placeholder="输入武将名..."
              heroMetadata={heroMetadata}
            />
          </Box>
          {heroRecResult && heroRecResult.hero ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                推荐武将：<strong>{heroRecResult.hero}</strong>
              </Alert>
              <Typography component="div" variant="subtitle2" gutterBottom>
                或从推荐列表中选择：
              </Typography>
              <List dense>
                {heroRecResult.analysis.map((candidate: HeroCandidate, idx: number) => {
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
                          candidate.details.individualScore != null && `个体强度：${candidate.details.individualScore.toFixed(1)}`,
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
          <Button
            variant="contained"
            onClick={handleAddHeroToTeam}
            disabled={!selectedRecHero}
          >
            设为支援武将
          </Button>
        </DialogActions>
      </Dialog>

      {/* Skill Recommendation Dialog */}
      <Dialog open={skillRecDialog} onClose={() => setSkillRecDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>推荐支援战法</DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <Typography component="div" variant="subtitle2" gutterBottom>
              手动搜索战法（最多选2个）：
            </Typography>
            <AutocompleteInput
              items={supportAvailableSkills.filter(s => !skills.includes(s) && !(supportSkills || []).includes(s) && !selectedRecSkills.includes(s))}
              selectedItems={selectedRecSkills}
              onAdd={(skill) => {
                if (selectedRecSkills.length < 2 && !selectedRecSkills.includes(skill)) {
                  setSelectedRecSkills([...selectedRecSkills, skill]);
                }
              }}
              label="搜索战法..."
              placeholder="输入战法名..."
              skillMetadata={skillMetadata}
            />
            {selectedRecSkills.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  已选择 {selectedRecSkills.length}/2 个战法：
                </Typography>
                {selectedRecSkills.map((s, i) => (
                  <Chip key={i} label={s} color="secondary" size="small" sx={{ ml: 0.5 }} onDelete={() => handleToggleRecSkill(s)} />
                ))}
              </Box>
            )}
          </Box>
          {skillRecResult && skillRecResult.skills.length > 0 ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                推荐战法：{skillRecResult.skills.map((s: string, i: number) => (
                  <Chip key={i} label={s} color="secondary" size="small" sx={{ ml: 0.5 }} />
                ))}
              </Alert>
              <Typography component="div" variant="subtitle2" gutterBottom>
                或从推荐列表中选择：
              </Typography>
              <List dense>
                {skillRecResult.analysis.map((candidate: SkillCandidate, idx: number) => {
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
                          candidate.details.individualScore != null && `个体强度：${candidate.details.individualScore.toFixed(1)}`,
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
          <Button
            variant="contained"
            color="secondary"
            onClick={handleAddSkillsToTeam}
            disabled={selectedRecSkills.length === 0 || selectedRecSkills.length > 2}
          >
            设为支援战法
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default CurrentTeam;
