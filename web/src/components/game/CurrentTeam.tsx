import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Paper, Typography, Box, Button, Collapse, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Chip, LinearProgress, List, ListItem, ListItemText } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import TagList from '../common/TagList';
import AutocompleteInput from '../common/AutocompleteInput';
import { LineupSuperseded, runLineup } from '../../services/lineupClient';
import type { SupportRanking } from '../../services/lineupProtocol';
import type { CardKind } from '../../services/lineupSearch';
import { useGame } from '../../context/GameContext';
import type { HeroMeta, SkillMeta } from '../../types/game';
import { teamBuilderInteractionPolicy } from '../../theme/teamBuilderInteractions';

const EMPTY_SUPPORT_SKILLS: string[] = [];
const SUPPORT_LIST_LENGTH = 10;
const signed = (value: number): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;

/** A running or finished support recommendation. */
interface SupportRequest {
  progress: number;
  result: SupportRanking | null;
  error: string | null;
}

const SupportProgress = ({ request, label }: { request: SupportRequest; label: string }) =>
  request.error ? (
    <Alert severity="error">推荐失败：{request.error}</Alert>
  ) : (
    <Box role="status" sx={{ py: 1 }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        正在逐个比较{label}… {Math.round(request.progress * 100)}%
      </Typography>
      <LinearProgress variant="determinate" value={request.progress * 100} />
    </Box>
  );

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
  /** Items placed in the team builder; shown greyed out. */
  allocatedHeroes?: ReadonlySet<string>;
  allocatedSkills?: ReadonlySet<string>;
  /** Wraps each roster card, e.g. to drag it into the team builder. */
  wrapCard?: (kind: 'hero' | 'skill', item: string, card: ReactNode) => ReactNode;
}

/**
 * Display current team members (heroes and skills) with manual edit capability
 */
const CurrentTeam = ({ heroes, skills, availableHeroes, heroMetadata = null, skillMetadata = null, availableSkills, onUpdateTeam, editable = true, supportHero = null, supportSkills = EMPTY_SUPPORT_SKILLS, allocatedHeroes, allocatedSkills, wrapCard }: CurrentTeamProps) => {
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
  const [heroRec, setHeroRec] = useState<SupportRequest | null>(null);
  const [skillRec, setSkillRec] = useState<SupportRequest | null>(null);
  const [selectedRecHero, setSelectedRecHero] = useState<string | null>(null);
  const [selectedRecSkills, setSelectedRecSkills] = useState<string[]>([]);
  const supportRequestRef = useRef(0);
  useEffect(
    () => () => {
      supportRequestRef.current++;
    },
    []
  );

  const normalizedSupportSkills = useMemo(
    () => [...new Set(supportSkills || [])].slice(0, 2),
    [supportSkills],
  );
  const openSupportSkillSlots = 2 - normalizedSupportSkills.length;
  const activeOfferItems = useMemo(
    () => new Set(Object.values(state.currentRoundInputs ?? {}).flat()),
    [state.currentRoundInputs],
  );
  // Intentionally shared by roster additions, support recommendations,
  // and manual support search.
  const supportAvailableHeroes = useMemo(
    () => (availableHeroes || []).filter((hero) => {
      const season = seasonHeroMetadata[hero]?.season;
      return (
        !activeOfferItems.has(hero) &&
        (selectedSeason === null || selectedSeason >= 4 || season === undefined || season <= selectedSeason)
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

  /** Rank the candidates in the worker; only the latest request reports back. */
  const requestSupport = (
    kind: CardKind,
    count: number,
    candidates: string[],
    update: (request: SupportRequest) => void,
    done: (recommended: string[]) => void
  ) => {
    const requestId = ++supportRequestRef.current;
    const current = () => requestId === supportRequestRef.current;
    update({ progress: 0, result: null, error: null });
    runLineup(
      'support',
      { heroes: allHeroesForSupport, skills: allSkillsForSupport, kind, count, candidates },
      (progress) => current() && update({ progress, result: null, error: null })
    ).then(
      (result) => {
        if (!current()) return;
        update({ progress: 1, result, error: null });
        done(result.recommended);
      },
      (failure: Error) => {
        if (current() && !(failure instanceof LineupSuperseded)) {
          update({ progress: 0, result: null, error: failure.message });
        }
      }
    );
  };

  const handleRecommendHero = () => {
    if (unchosenSupportHeroes.length === 0) return;
    setSelectedRecHero(null);
    setHeroRecDialog(true);
    // A hero the player searched for meanwhile stays selected.
    requestSupport('hero', 1, unchosenSupportHeroes, setHeroRec, ([hero]) =>
      setSelectedRecHero((current) => current ?? hero ?? null)
    );
  };

  const handleRecommendSkills = () => {
    if (openSupportSkillSlots === 0 || unchosenSupportSkills.length === 0) return;
    setSelectedRecSkills([]);
    setSkillRecDialog(true);
    requestSupport('skill', openSupportSkillSlots, unchosenSupportSkills, setSkillRec, (skills) =>
      setSelectedRecSkills((current) => (current.length ? current : skills))
    );
  };

  const closeSupportDialogs = () => {
    supportRequestRef.current++;
    setHeroRecDialog(false);
    setSkillRecDialog(false);
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
      closeSupportDialogs();
    }
  };

  const handleAddSkillsToTeam = () => {
    if (selectedRecSkills.length > 0 && selectedRecSkills.length <= openSupportSkillSlots) {
      dispatch({
        type: 'SET_SUPPORT_SKILLS',
        skills: [...new Set([...normalizedSupportSkills, ...selectedRecSkills])].slice(0, 2),
      });
      closeSupportDialogs();
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
        <Box
          data-testid="current-roster-header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flexWrap: 'nowrap',
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          <Typography
            component="h2"
            variant="subtitle1"
            sx={{ height: 44, display: 'flex', alignItems: 'center', px: 0.25, fontSize: { xs: 13, sm: 14 }, fontWeight: 800, whiteSpace: 'nowrap' }}
          >
            当前阵容
          </Typography>
          {editable && availableHeroes && availableSkills && onUpdateTeam && (
            <Box sx={{ display: 'flex', gap: 0.5, minWidth: 0 }}>
              {editMode && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleCancelEdit}
                  sx={{ height: 44, minHeight: 44, minWidth: 44, px: 0.5, fontSize: 12 }}
                >
                  取消
                </Button>
              )}
              <Button
                size="small"
                variant={editMode ? "contained" : "outlined"}
                startIcon={editMode ? <CheckIcon /> : <EditIcon />}
                aria-label={editMode ? '保存修改' : '编辑队伍'}
                onClick={handleEditToggle}
                sx={{
                  height: 44,
                  minHeight: 44,
                  minWidth: { xs: 44, sm: 84 },
                  width: { xs: 44, sm: 'auto' },
                  px: { xs: 0, sm: 0.75 },
                  fontSize: 12,
                  '& .MuiButton-startIcon': { m: 0, mr: { sm: 0.4 } },
                  '& svg': { fontSize: 16 },
                }}
              >
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                  {editMode ? '保存修改' : '编辑队伍'}
                </Box>
              </Button>
            </Box>
          )}
          {selectedSeason !== null && (
            <Chip
              label={
                <>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    赛季 {selectedSeason}
                  </Box>
                  <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
                    S{selectedSeason}
                  </Box>
                </>
              }
              size="small"
              variant="outlined"
              color="primary"
              data-testid="current-season-chip"
              sx={{ height: 44, minWidth: 0, fontSize: 12, fontWeight: 700, '& .MuiChip-label': { px: { xs: 0.5, sm: 0.75 } } }}
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
              dimmedItems={allocatedHeroes}
              wrapCard={wrapCard && ((item, card) => wrapCard('hero', item, card))}
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
              dimmedItems={allocatedSkills}
              wrapCard={wrapCard && ((item, card) => wrapCard('skill', item, card))}
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
      <Dialog
        open={editable && heroRecDialog}
        onClose={closeSupportDialogs}
        maxWidth="sm"
        fullWidth
        sx={teamBuilderInteractionPolicy}
      >
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
          {!heroRec?.result ? (
            heroRec && <SupportProgress request={heroRec} label="候选武将" />
          ) : heroRec.result.single.length > 0 ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                推荐武将：<strong>{heroRec.result.recommended[0]}</strong>
              </Alert>
              <Typography component="div" variant="subtitle2" gutterBottom>
                或从推荐列表中选择（分数为带上后阵容评分的变化）：
              </Typography>
              <List dense>
                {heroRec.result.single.slice(0, SUPPORT_LIST_LENGTH).map(({ cards: [hero], lineup }) => {
                  const isSelected = selectedRecHero === hero;
                  return (
                    <ListItem
                      key={hero}
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
                      onClick={() => setSelectedRecHero(hero)}
                    >
                      <Chip
                        label={hero}
                        color={isSelected ? 'primary' : 'default'}
                        size="small"
                        sx={{ mr: 1, minWidth: 80 }}
                      />
                      <ListItemText
                        primary={`阵容评分 ${signed(lineup.score - heroRec.result!.base)}`}
                        primaryTypographyProps={{ variant: 'body2' }}
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
          <Button onClick={closeSupportDialogs}>关闭</Button>
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
      <Dialog
        open={editable && skillRecDialog}
        onClose={closeSupportDialogs}
        maxWidth="sm"
        fullWidth
        sx={teamBuilderInteractionPolicy}
      >
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
          {!skillRec?.result ? (
            skillRec && <SupportProgress request={skillRec} label="候选战法" />
          ) : skillRec.result.single.length > 0 ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                推荐战法：{skillRec.result.recommended.map((skill) => (
                  <Chip key={skill} label={skill} color="secondary" size="small" sx={{ ml: 0.5 }} />
                ))}
              </Alert>
              <Typography component="div" variant="subtitle2" gutterBottom>
                或从推荐列表中选择（分数为单独带上后阵容评分的变化）：
              </Typography>
              <List dense>
                {skillRec.result.single.slice(0, SUPPORT_LIST_LENGTH).map(({ cards: [skill], lineup }) => {
                  const isSelected = selectedRecSkills.includes(skill);
                  return (
                    <ListItem
                      key={skill}
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
                      onClick={() => handleToggleRecSkill(skill)}
                    >
                      <Chip
                        label={skill}
                        color={isSelected ? 'secondary' : 'default'}
                        size="small"
                        sx={{ mr: 1, minWidth: 80 }}
                      />
                      <ListItemText
                        primary={`阵容评分 ${signed(lineup.score - skillRec.result!.base)}`}
                        primaryTypographyProps={{ variant: 'body2' }}
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
          <Button onClick={closeSupportDialogs}>关闭</Button>
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
