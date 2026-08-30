import { useMemo, useState } from 'react';
import { Paper, Typography, Box, Button, Collapse, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Chip, List, ListItem, ListItemText } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
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

const EMPTY_SUPPORT_SKILLS: string[] = [];

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
const CurrentTeam = ({ heroes, skills, availableHeroes, heroMetadata = null, skillMetadata = null, availableSkills, onUpdateTeam, editable = true, supportHero = null, supportSkills = EMPTY_SUPPORT_SKILLS }: CurrentTeamProps) => {
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

  const normalizedSupportSkills = useMemo(
    () => [...new Set(supportSkills || [])].slice(0, 2),
    [supportSkills],
  );
  const openSupportSkillSlots = 2 - normalizedSupportSkills.length;
  const activeOfferItems = useMemo(
    () => new Set(Object.values(state.currentRoundInputs ?? {}).flat()),
    [state.currentRoundInputs],
  );
  const supportAvailableHeroes = useMemo(
    () => (availableHeroes || []).filter((hero) => {
      const season = seasonHeroMetadata[hero]?.season;
      return (
        !activeOfferItems.has(hero) &&
        (selectedSeason === null || season === undefined || season <= selectedSeason)
      );
    }),
    [activeOfferItems, availableHeroes, seasonHeroMetadata, selectedSeason],
  );
  const supportAvailableSkills = useMemo(
    () => (availableSkills || []).filter((skill) => {
      const season = seasonSkillMetadata[skill]?.season;
      return (
        !activeOfferItems.has(skill) &&
        (selectedSeason === null || season === undefined || season <= selectedSeason)
      );
    }),
    [activeOfferItems, availableSkills, seasonSkillMetadata, selectedSeason],
  );

  const allHeroesForSupport = useMemo(
    () => [...heroes, ...(supportHero ? [supportHero] : [])],
    [heroes, supportHero],
  );
  const allSkillsForSupport = useMemo(
    () => [...skills, ...normalizedSupportSkills],
    [skills, normalizedSupportSkills],
  );

  // Current-roster score (display units, one decimal) for the whole pool —
  // main heroes/skills plus any support hero/skills. Uses the same paired-model
  // scoring convention as the option gains. Shown even before any recommendation.
  const rosterScore = currentRosterScore(allHeroesForSupport, allSkillsForSupport, recommendationData);

  const unchosenSupportHeroes = useMemo(
    () => supportAvailableHeroes.filter((hero) => !allHeroesForSupport.includes(hero)),
    [allHeroesForSupport, supportAvailableHeroes],
  );
  const unchosenSupportSkills = useMemo(
    () => supportAvailableSkills.filter((skill) => !allSkillsForSupport.includes(skill)),
    [allSkillsForSupport, supportAvailableSkills],
  );

  
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
    if (
      !activeOfferItems.has(hero) &&
      hero !== supportHero &&
      !editedHeroes.includes(hero)
    ) {
      setEditedHeroes([...editedHeroes, hero]);
    }
  };

  const handleRemoveHero = (hero: string) => {
    setEditedHeroes(editedHeroes.filter(h => h !== hero));
  };

  const handleAddSkill = (skill: string) => {
    if (
      !activeOfferItems.has(skill) &&
      !normalizedSupportSkills.includes(skill) &&
      !editedSkills.includes(skill)
    ) {
      setEditedSkills([...editedSkills, skill]);
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setEditedSkills(editedSkills.filter(s => s !== skill));
  };

  const handleRecommendHero = () => {
    if (unchosenSupportHeroes.length === 0) return;
    const result = recommendSingleHero(
      unchosenSupportHeroes,
      allHeroesForSupport,
      allSkillsForSupport,
      recommendationData,
      recommendationData.catalog,
    );
    setHeroRecResult(result);
    setSelectedRecHero(result.hero || null);
    setHeroRecDialog(true);
  };

  const handleRecommendSkills = () => {
    if (openSupportSkillSlots === 0 || unchosenSupportSkills.length === 0) return;
    const result = recommendTwoSkills(
      unchosenSupportSkills,
      allHeroesForSupport,
      allSkillsForSupport,
      recommendationData,
      openSupportSkillSlots === 1 ? 1 : 2,
    );
    setSkillRecResult(result);
    setSelectedRecSkills(result.skills ? [...result.skills] : []);
    setSkillRecDialog(true);
  };

  const handleToggleRecSkill = (skill: string) => {
    setSelectedRecSkills(prev =>
      prev.includes(skill)
        ? prev.filter(s => s !== skill)
        : prev.length < openSupportSkillSlots
          ? [...prev, skill]
          : prev
    );
  };

  const handleAddHeroToTeam = () => {
    if (selectedRecHero) {
      dispatch({ type: 'SET_SUPPORT_HERO', hero: selectedRecHero });
      setHeroRecDialog(false);
    }
  };

  const handleAddSkillsToTeam = () => {
    if (selectedRecSkills.length > 0 && selectedRecSkills.length <= openSupportSkillSlots) {
      dispatch({
        type: 'SET_SUPPORT_SKILLS',
        skills: [...new Set([...normalizedSupportSkills, ...selectedRecSkills])].slice(0, 2),
      });
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
    <Paper
      component="section"
      aria-label="当前阵容"
      sx={{ p: { xs: 1.25, sm: 1.5 }, mb: 2, borderTop: '3px solid', borderTopColor: 'secondary.main', bgcolor: 'background.paper' }}
    >
      <Box sx={{ mb: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 0.5, rowGap: 0.5, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
          <Typography
            component="h2"
            variant="subtitle1"
            sx={{ height: 44, display: 'flex', alignItems: 'center', px: 0.25, fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap' }}
          >
            当前阵容
          </Typography>
          <Chip
            label={`评分 ${rosterScore.toFixed(1)}`}
            size="small"
            variant="outlined"
            data-testid="current-roster-score"
            sx={{ height: 44, fontSize: 12, fontWeight: 750, fontVariantNumeric: 'tabular-nums', '& .MuiChip-label': { px: 0.75 } }}
          />
          {editable && availableHeroes && availableSkills && onUpdateTeam && (
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {editMode && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleCancelEdit}
                  sx={{ height: 44, minHeight: 44, px: 0.75, fontSize: 12 }}
                >
                  取消
                </Button>
              )}
              <Button
                size="small"
                variant={editMode ? "contained" : "outlined"}
                startIcon={editMode ? <CheckIcon /> : <EditIcon />}
                onClick={handleEditToggle}
                sx={{ height: 44, minHeight: 44, minWidth: 84, px: 0.75, fontSize: 12, '& .MuiButton-startIcon': { mr: 0.4 }, '& svg': { fontSize: 16 } }}
              >
                {editMode ? '保存修改' : '编辑队伍'}
              </Button>
            </Box>
          )}
          {selectedSeason !== null && (
            <Chip
              label={`赛季 ${selectedSeason}`}
              size="small"
              variant="outlined"
              color="primary"
              data-testid="current-season-chip"
              sx={{ height: 44, fontSize: 12, fontWeight: 700, '& .MuiChip-label': { px: 0.75 } }}
            />
          )}
        </Box>
      </Box>
      
      <Collapse in={editMode}>
        <Alert severity="info" sx={{ mb: 2 }}>
          可手动添加或移除队伍中的武将和战法。点击「保存修改」后生效。
        </Alert>
      </Collapse>
      
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" variant="subtitle2" gutterBottom>
            武将 ({(editMode ? editedHeroes.length : heroes.length) + (supportHero ? 1 : 0)})
          </Typography>
          
          {editMode ? (
            <>
              <AutocompleteInput
                items={supportAvailableHeroes.filter(h => h !== supportHero && !editedHeroes.includes(h))}
                selectedItems={editedHeroes}
                onAdd={handleAddHero}
                label="添加武将..."
                placeholder="搜索武将..."
                heroMetadata={seasonHeroMetadata}
              />
              <TagList 
                prefixItems={supportHero ? [supportHero] : []}
                items={editedHeroes}
                onRemove={handleRemoveHero}
                color="primary"
                highlightItems={supportHero ? [supportHero] : []}
                onRemoveHighlight={editable ? handleRemoveSupportHero : undefined}
                heroMetadata={seasonHeroMetadata}
                horizontal
                prefixActions={!supportHero ? [{
                  label: '推荐支援武将',
                  onClick: handleRecommendHero,
                  disabled: unchosenSupportHeroes.length === 0,
                }] : []}
              />
            </>
          ) : (
            <TagList 
              prefixItems={supportHero ? [supportHero] : []}
              items={heroes}
              color="primary" 
              editable={false}
              highlightItems={supportHero ? [supportHero] : []}
              onRemoveHighlight={editable ? handleRemoveSupportHero : undefined}
              heroMetadata={seasonHeroMetadata}
              horizontal
              prefixActions={editable && !supportHero ? [{
                label: '推荐支援武将',
                onClick: handleRecommendHero,
                disabled: unchosenSupportHeroes.length === 0,
              }] : []}
            />
          )}
        </Box>
        
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" variant="subtitle2" gutterBottom>
            战法 ({(editMode ? editedSkills.length : skills.length) + normalizedSupportSkills.length})
          </Typography>
          
          {editMode ? (
            <>
              <AutocompleteInput
                items={supportAvailableSkills.filter(s => !normalizedSupportSkills.includes(s) && !editedSkills.includes(s))}
                selectedItems={editedSkills}
                onAdd={handleAddSkill}
                label="添加战法..."
                placeholder="搜索战法..."
                skillMetadata={seasonSkillMetadata}
              />
              <TagList 
                prefixItems={normalizedSupportSkills}
                items={editedSkills}
                onRemove={handleRemoveSkill}
                color="secondary"
                highlightItems={normalizedSupportSkills}
                onRemoveHighlight={editable ? handleRemoveSupportSkill : undefined}
                skillMetadata={seasonSkillMetadata}
                horizontal
                prefixActions={Array.from({ length: openSupportSkillSlots }, () => ({
                  label: '推荐支援战法',
                  onClick: handleRecommendSkills,
                  disabled: unchosenSupportSkills.length === 0,
                }))}
              />
            </>
          ) : (
            <TagList 
              prefixItems={normalizedSupportSkills}
              items={skills}
              color="secondary" 
              editable={false}
              highlightItems={normalizedSupportSkills}
              onRemoveHighlight={editable ? handleRemoveSupportSkill : undefined}
              skillMetadata={seasonSkillMetadata}
              horizontal
              prefixActions={editable ? Array.from({ length: openSupportSkillSlots }, () => ({
                label: '推荐支援战法',
                onClick: handleRecommendSkills,
                disabled: unchosenSupportSkills.length === 0,
              })) : []}
            />
          )}
        </Box>
      </Box>

      {/* Hero Recommendation Dialog */}
      <Dialog open={editable && heroRecDialog} onClose={() => setHeroRecDialog(false)} maxWidth="sm" fullWidth>
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
              heroMetadata={seasonHeroMetadata}
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
      <Dialog open={editable && skillRecDialog} onClose={() => setSkillRecDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>推荐支援战法</DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <Typography component="div" variant="subtitle2" gutterBottom>
              手动搜索战法（还可选 {openSupportSkillSlots} 个）：
            </Typography>
            <AutocompleteInput
              items={supportAvailableSkills.filter(s => !skills.includes(s) && !(supportSkills || []).includes(s) && !selectedRecSkills.includes(s))}
              selectedItems={selectedRecSkills}
              onAdd={(skill) => {
                if (selectedRecSkills.length < openSupportSkillSlots && !selectedRecSkills.includes(skill)) {
                  setSelectedRecSkills([...selectedRecSkills, skill]);
                }
              }}
              label="搜索战法..."
              placeholder="输入战法名..."
              skillMetadata={seasonSkillMetadata}
            />
            {selectedRecSkills.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  本次已选 {selectedRecSkills.length}/{openSupportSkillSlots} 个战法：
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
            disabled={selectedRecSkills.length === 0 || selectedRecSkills.length > openSupportSkillSlots}
          >
            设为支援战法
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default CurrentTeam;
