import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
} from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  type SelectChangeEvent,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import CloseIcon from '@mui/icons-material/Close';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import {
  DragDropProvider,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/react';
import { database, recommendationData } from '../../data';
import {
  activeTeamContributions,
  scoreTeam,
  type AssignedHero,
} from '../../services/recommendationModel';
import {
  TEAM_BUILDER_ROWS,
  collectUsedTeamBuilderItems,
  type TeamBuilderHeroSlot,
  type TeamBuilderLayout,
  type TeamBuilderMoveSource,
  type TeamBuilderMoveTarget,
  type TeamBuilderRow,
} from '../../services/teamBuilderArrangement';

interface FormationWorkbenchProps {
  layout: TeamBuilderLayout;
  heroes: string[];
  skills: string[];
  formations: string[];
  supportItems: Set<string>;
  onMove: (source: TeamBuilderMoveSource, target: TeamBuilderMoveTarget) => void;
  onFormationChange: (teamIndex: number, formation: string) => void;
  onRowChange: (
    teamIndex: number,
    heroIndex: number,
    row: TeamBuilderRow
  ) => void;
}

interface SelectableItem {
  source: TeamBuilderMoveSource;
  label: string;
}

type DragData = TeamBuilderMoveSource & { label: string };

const teamAccent = ['#456c5f', '#a38147', '#a8392f'] as const;

// @dnd-kit/react 0.5.0's generic provider declaration extends
// PropsWithChildren, but TypeScript 7's native preview currently drops that
// inherited property at the JSX boundary. Keep the library API fully typed
// while restoring the declared React children contract locally.
const TeamBuilderDragDropProvider = DragDropProvider as unknown as ComponentType<
  PropsWithChildren<{
    onDragStart?: (event: DragStartEvent) => void;
    onDragEnd?: (event: DragEndEvent) => void;
  }>
>;

const campColors: Record<string, { background: string; foreground: string }> = {
  魏: { background: '#dce8eb', foreground: '#365b66' },
  蜀: { background: '#e3eadc', foreground: '#45633b' },
  吴: { background: '#eee0db', foreground: '#7b4038' },
  群: { background: '#e8e0ed', foreground: '#634d72' },
};

const moveSourceKey = (source: TeamBuilderMoveSource): string =>
  source.origin === 'pool'
    ? `${source.kind}:pool:${source.kind === 'hero' ? source.hero : source.skill}`
    : source.kind === 'hero'
      ? `hero:slot:${source.teamIndex}:${source.heroIndex}`
      : `skill:slot:${source.teamIndex}:${source.heroIndex}:${source.skillIndex}`;

const moveTargetKey = (target: TeamBuilderMoveTarget): string =>
  target.destination === 'pool'
    ? `${target.kind}:pool`
    : target.kind === 'hero'
      ? `hero:slot:${target.teamIndex}:${target.heroIndex}`
      : `skill:slot:${target.teamIndex}:${target.heroIndex}:${target.skillIndex}`;

const isSameSource = (
  left: TeamBuilderMoveSource,
  right: TeamBuilderMoveSource
): boolean => moveSourceKey(left) === moveSourceKey(right);

const compatible = (
  selected: SelectableItem | null,
  target: TeamBuilderMoveTarget
): boolean => selected !== null && selected.source.kind === target.kind;

const toAssignedHeroes = (layout: TeamBuilderLayout[number]): AssignedHero[] =>
  layout.heroes
    .filter(
      (slot): slot is TeamBuilderHeroSlot & { hero: string } =>
        slot.hero !== null
    )
    .map((slot) => ({
      name: slot.hero,
      skills: slot.skills.filter((skill): skill is string => skill !== null),
    }));

const displayFeatureLabel = (featureId: string): string => {
  const [family, ...names] = featureId.split('|');
  if (family === 'HS') return `${names[0]} · ${names[1]}`;
  return names.join(' + ');
};

const TeamScoreAndEvidence = ({
  team,
}: {
  team: TeamBuilderLayout[number];
}) => {
  const assigned = useMemo(() => toAssignedHeroes(team), [team]);
  const score =
    assigned.length > 0
      ? scoreTeam(assigned, recommendationData.model) * 10
      : null;
  const evidence = useMemo(
    () =>
      activeTeamContributions(assigned, recommendationData.model)
        .filter(
          (item) =>
            item.weight > 0 &&
            (item.family === 'HP' ||
              item.family === 'HS' ||
              item.family === 'SP')
        )
        .slice(0, 3),
    [assigned]
  );

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="subtitle2"
        fontWeight={800}
        data-testid="team-strength"
        sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
      >
        评分：{score === null ? '—' : score.toFixed(1)}
      </Typography>
      {evidence.length > 0 && (
        <Stack
          direction="row"
          spacing={1.25}
          useFlexGap
          flexWrap="wrap"
          sx={{ mt: 0.25 }}
        >
          {evidence.map((item) => (
            <Typography
              key={item.featureId}
              variant="caption"
              color="text.secondary"
              title={displayFeatureLabel(item.featureId)}
              sx={{
                maxWidth: { xs: 180, sm: 240 },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayFeatureLabel(item.featureId)} · 加分 +
              {(item.weight * 10).toFixed(1)} · 参考 {item.support} 场
            </Typography>
          ))}
        </Stack>
      )}
    </Box>
  );
};

interface PoolItemProps {
  kind: 'hero' | 'skill';
  value: string;
  selected: boolean;
  support: boolean;
  onSelect: (item: SelectableItem) => void;
}

const PoolItem = ({
  kind,
  value,
  selected,
  support,
  onSelect,
}: PoolItemProps) => {
  const source: TeamBuilderMoveSource =
    kind === 'hero'
      ? { kind: 'hero', origin: 'pool', hero: value }
      : { kind: 'skill', origin: 'pool', skill: value };
  const { ref, handleRef, isDragging } = useDraggable<DragData>({
    id: `pool-${kind}-${value}`,
    type: kind,
    data: { ...source, label: value },
  });
  const hero = kind === 'hero' ? database.heroes[value] : null;
  const skill = kind === 'skill' ? database.skills[value] : null;
  const camp = hero?.camp ? campColors[hero.camp] : null;
  const setDragHandleRefs = (node: HTMLButtonElement | null) => {
    ref(node);
    handleRef(node);
  };

  return (
    <Box
      data-testid={`pool-${kind}-${value}`}
      sx={{
        minHeight: 48,
        minWidth: { xs: 132, sm: 144 },
        maxWidth: 190,
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        opacity: isDragging ? 0.35 : 1,
        border: '1px solid',
        borderColor: selected
          ? kind === 'hero'
            ? 'primary.main'
            : 'secondary.main'
          : support
            ? 'warning.main'
            : 'divider',
        bgcolor: selected
          ? kind === 'hero'
            ? 'primary.main'
            : 'secondary.main'
          : camp
            ? alpha(camp.background, 0.72)
            : 'background.paper',
        color: selected
          ? kind === 'hero'
            ? 'primary.contrastText'
            : 'secondary.contrastText'
          : camp
            ? camp.foreground
            : 'text.primary',
        boxShadow: selected ? 1 : 'none',
        borderRadius: 1,
      }}
    >
      <ButtonBase
        type="button"
        aria-pressed={selected}
        aria-label={`${kind === 'hero' ? '选择武将' : '选择战法'} ${value}${support ? '，支援' : ''}`}
        onClick={() => onSelect({ source, label: value })}
        sx={{
          minWidth: 0,
          flex: 1,
          px: 1.25,
          py: 0.75,
          justifyContent: 'flex-start',
          textAlign: 'left',
          color: 'inherit',
        }}
      >
        <Box sx={{ minWidth: 0, width: '100%' }}>
          <Typography
            component="span"
            variant="body2"
            fontWeight={800}
            sx={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {value}
            {support && ' · 支援'}
          </Typography>
          <Typography
            component="span"
            variant="caption"
            sx={{
              display: 'block',
              opacity: 0.78,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hero
              ? `${hero.camp} · ${hero.troop} · ${hero.label || '武将'}`
              : `${skill?.type || '战法'}${skill?.tier ? ` · ${skill.tier}` : ''}`}
          </Typography>
        </Box>
      </ButtonBase>
      <Tooltip title={`拖动${kind === 'hero' ? '武将' : '战法'} ${value}`}>
        <IconButton
          ref={setDragHandleRefs}
          size="small"
          aria-label={`拖动${kind === 'hero' ? '武将' : '战法'} ${value}`}
          sx={{
            minWidth: 44,
            minHeight: 48,
            borderRadius: 0,
            color: 'inherit',
            touchAction: 'none',
          }}
        >
          <DragIndicatorIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

interface SkillSlotProps {
  teamIndex: number;
  heroIndex: number;
  skillIndex: number;
  skill: string | null;
  heroPresent: boolean;
  selected: SelectableItem | null;
  onSourceSelect: (item: SelectableItem) => void;
  onTargetActivate: (target: TeamBuilderMoveTarget) => void;
  onRemove: (source: TeamBuilderMoveSource) => void;
}

const SkillSlot = ({
  teamIndex,
  heroIndex,
  skillIndex,
  skill,
  heroPresent,
  selected,
  onSourceSelect,
  onTargetActivate,
  onRemove,
}: SkillSlotProps) => {
  const target: TeamBuilderMoveTarget = {
    kind: 'skill',
    destination: 'slot',
    teamIndex,
    heroIndex,
    skillIndex,
  };
  const source: TeamBuilderMoveSource | null =
    skill === null
      ? null
      : {
          kind: 'skill',
          origin: 'slot',
          teamIndex,
          heroIndex,
          skillIndex,
        };
  const interactive = heroPresent || skill !== null;
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `drop-${moveTargetKey(target)}`,
    type: 'skill-slot',
    accept: 'skill',
    data: target,
    disabled: !interactive,
  });
  const {
    ref: dragRef,
    handleRef,
    isDragging,
  } = useDraggable<DragData>({
    id: `drag-skill-slot-${teamIndex}-${heroIndex}-${skillIndex}`,
    type: 'skill',
    data:
      source === null
        ? undefined
        : { ...source, label: skill || '' },
    disabled: source === null,
  });
  const sourceSelected =
    source !== null &&
    selected !== null &&
    isSameSource(selected.source, source);
  const selectedCanDrop = interactive && compatible(selected, target);
  const highlighted = isDropTarget || selectedCanDrop;

  const setDragHandleRefs = (node: HTMLButtonElement | null) => {
    dragRef(node);
    handleRef(node);
  };

  const activate = () => {
    if (selectedCanDrop) {
      onTargetActivate(target);
    } else if (source && skill) {
      onSourceSelect({ source, label: skill });
    }
  };

  return (
    <Box
      ref={(node: HTMLDivElement | null) => dropRef(node)}
      sx={{
        minHeight: 46,
        border: '1px dashed',
        borderColor: highlighted
          ? 'secondary.main'
          : skill
            ? alpha('#a38147', 0.8)
            : 'divider',
        bgcolor: highlighted
          ? alpha('#a38147', 0.16)
          : skill
            ? alpha('#eee2ca', 0.58)
            : alpha('#fffdf7', 0.42),
        display: 'flex',
        alignItems: 'stretch',
        gap: 0.25,
        opacity: !interactive || isDragging ? 0.45 : 1,
      }}
    >
      <ButtonBase
        type="button"
        disabled={!interactive}
        aria-pressed={sourceSelected}
        aria-label={
          skill
            ? `队伍 ${teamIndex + 1}，${heroIndex + 1}号武将，战法${skillIndex + 1}：${skill}`
            : `队伍 ${teamIndex + 1}，${heroIndex + 1}号武将，空战法位${skillIndex + 1}`
        }
        data-testid={`skill-slot-${teamIndex}-${heroIndex}-${skillIndex}`}
        onClick={activate}
        sx={{
          minWidth: 0,
          minHeight: 44,
          flex: 1,
          px: 0.75,
          py: 0.5,
          justifyContent: 'flex-start',
          textAlign: 'left',
          outline: sourceSelected ? '2px solid' : 'none',
          outlineColor: 'secondary.main',
          outlineOffset: -2,
        }}
      >
        <Typography
          variant="caption"
          color={skill ? 'text.primary' : 'text.secondary'}
          title={skill || undefined}
          sx={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {skill || `战法 ${skillIndex + 1}`}
        </Typography>
      </ButtonBase>
      {skill && source && (
        <Stack direction="row" spacing={0} flexShrink={0}>
          <Tooltip title={`拖动战法 ${skill}`}>
            <IconButton
              ref={setDragHandleRefs}
              size="small"
              aria-label={`拖动战法 ${skill}`}
              onClick={(event) => {
                event.stopPropagation();
                onSourceSelect({ source, label: skill });
              }}
              sx={{
                p: 0.25,
                minWidth: 44,
                minHeight: 44,
                touchAction: 'none',
              }}
            >
              <DragIndicatorIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <IconButton
            size="small"
            aria-label={`移除战法 ${skill}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(source);
            }}
            sx={{ p: 0.25, minWidth: 44, minHeight: 44 }}
          >
            <CloseIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Stack>
      )}
    </Box>
  );
};

interface HeroAssignmentCardProps {
  teamIndex: number;
  heroIndex: number;
  slot: TeamBuilderHeroSlot;
  selected: SelectableItem | null;
  onSourceSelect: (item: SelectableItem) => void;
  onTargetActivate: (target: TeamBuilderMoveTarget) => void;
  onRemove: (source: TeamBuilderMoveSource) => void;
  onRowChange: (row: TeamBuilderRow) => void;
}

const HeroAssignmentCard = ({
  teamIndex,
  heroIndex,
  slot,
  selected,
  onSourceSelect,
  onTargetActivate,
  onRemove,
  onRowChange,
}: HeroAssignmentCardProps) => {
  const target: TeamBuilderMoveTarget = {
    kind: 'hero',
    destination: 'slot',
    teamIndex,
    heroIndex,
  };
  const source: TeamBuilderMoveSource | null =
    slot.hero === null
      ? null
      : { kind: 'hero', origin: 'slot', teamIndex, heroIndex };
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `drop-${moveTargetKey(target)}`,
    type: 'hero-slot',
    accept: 'hero',
    data: target,
  });
  const {
    ref: dragRef,
    handleRef,
    isDragging,
  } = useDraggable<DragData>({
    id: `drag-hero-slot-${teamIndex}-${heroIndex}`,
    type: 'hero',
    data:
      source === null
        ? undefined
        : { ...source, label: slot.hero || '' },
    disabled: source === null,
  });
  const sourceSelected =
    source !== null &&
    selected !== null &&
    isSameSource(selected.source, source);
  const highlighted = isDropTarget || compatible(selected, target);
  const hero = slot.hero ? database.heroes[slot.hero] : null;
  const camp = hero?.camp ? campColors[hero.camp] : null;

  const setDragHandleRefs = (node: HTMLButtonElement | null) => {
    dragRef(node);
    handleRef(node);
  };

  const activate = () => {
    if (compatible(selected, target)) {
      onTargetActivate(target);
    } else if (source && slot.hero) {
      onSourceSelect({ source, label: slot.hero });
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 0,
        overflow: 'hidden',
        bgcolor: alpha('#fffdf7', 0.78),
        borderColor: highlighted ? 'primary.main' : 'divider',
        boxShadow: highlighted
          ? `0 0 0 2px ${alpha('#456c5f', 0.18)}`
          : 'none',
      }}
    >
      <Box
        ref={(node: HTMLDivElement | null) => dropRef(node)}
        sx={{
          minHeight: 76,
          display: 'flex',
          gap: 0.75,
          alignItems: 'stretch',
          opacity: isDragging ? 0.35 : 1,
          bgcolor: highlighted
            ? alpha('#456c5f', 0.12)
            : camp
              ? alpha(camp.background, 0.52)
              : alpha('#f3efe3', 0.58),
        }}
      >
        <ButtonBase
          type="button"
          aria-pressed={sourceSelected}
          aria-label={
            slot.hero
              ? `队伍 ${teamIndex + 1}，武将位 ${heroIndex + 1}：${slot.hero}`
              : `队伍 ${teamIndex + 1}，空武将位 ${heroIndex + 1}`
          }
          data-testid={`hero-slot-${teamIndex}-${heroIndex}`}
          onClick={activate}
          sx={{
            minWidth: 0,
            minHeight: 76,
            flex: 1,
            px: 1,
            py: 0.75,
            gap: 0.75,
            justifyContent: 'flex-start',
            textAlign: 'left',
            outline: sourceSelected ? '2px solid' : 'none',
            outlineColor: 'primary.main',
            outlineOffset: -2,
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              width: 38,
              height: 46,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              border: '1px solid',
              borderColor: camp?.foreground || 'divider',
              bgcolor: camp?.background || 'background.default',
              color: camp?.foreground || 'text.secondary',
              fontFamily: '"Songti SC", STSong, serif',
              fontWeight: 900,
              fontSize: 17,
            }}
          >
            {hero?.camp || '将'}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="body2"
              fontWeight={900}
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {slot.hero || '拖入或点选武将'}
            </Typography>
            {hero && (
              <>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block' }}
                >
                  {hero.troop} · {hero.label || '武将'}
                </Typography>
                <Typography
                  variant="caption"
                  color="secondary.dark"
                  title={`自带战法：${hero.skill}`}
                  sx={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  自带 · {hero.skill}
                </Typography>
              </>
            )}
          </Box>
        </ButtonBase>
        {slot.hero && source && (
          <Stack spacing={0} flexShrink={0} justifyContent="center">
            <Tooltip title={`拖动武将 ${slot.hero}`}>
              <IconButton
                ref={setDragHandleRefs}
                size="small"
                aria-label={`拖动武将 ${slot.hero}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSourceSelect({ source, label: slot.hero || '' });
                }}
                sx={{
                  p: 0.4,
                  minWidth: 44,
                  minHeight: 44,
                  touchAction: 'none',
                }}
              >
                <DragIndicatorIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton
              size="small"
              aria-label={`移除武将 ${slot.hero}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(source);
              }}
              sx={{ p: 0.4, minWidth: 44, minHeight: 44 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        )}
      </Box>

      <Box sx={{ px: 0.75, pt: 0.75 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={slot.row}
          onChange={(_event, value: TeamBuilderRow | null) => {
            if (value) onRowChange(value);
          }}
          aria-label={`${slot.hero || `${heroIndex + 1}号武将`}站位`}
          disabled={!slot.hero}
          sx={{
            minHeight: 44,
            '& .MuiToggleButton-root': {
              py: 0.25,
              minHeight: 44,
              fontSize: 12,
            },
          }}
        >
          {TEAM_BUILDER_ROWS.map((row) => (
            <ToggleButton
              key={row}
              value={row}
              aria-label={`${slot.hero || `${heroIndex + 1}号武将`} ${row}`}
            >
              {row}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <Stack spacing={0.6} sx={{ p: 0.75 }}>
        {slot.skills.map((skill, skillIndex) => (
          <SkillSlot
            key={skillIndex}
            teamIndex={teamIndex}
            heroIndex={heroIndex}
            skillIndex={skillIndex}
            skill={skill}
            heroPresent={slot.hero !== null}
            selected={selected}
            onSourceSelect={onSourceSelect}
            onTargetActivate={onTargetActivate}
            onRemove={onRemove}
          />
        ))}
      </Stack>
    </Paper>
  );
};

interface RepositoryProps {
  kind: 'hero' | 'skill';
  items: string[];
  selected: SelectableItem | null;
  supportItems: Set<string>;
  onSourceSelect: (item: SelectableItem) => void;
  onTargetActivate: (target: TeamBuilderMoveTarget) => void;
}

const Repository = ({
  kind,
  items,
  selected,
  supportItems,
  onSourceSelect,
  onTargetActivate,
}: RepositoryProps) => {
  const target: TeamBuilderMoveTarget =
    kind === 'hero'
      ? { kind: 'hero', destination: 'pool' }
      : { kind: 'skill', destination: 'pool' };
  const { ref, isDropTarget } = useDroppable({
    id: `drop-${kind}-repository`,
    type: `${kind}-pool`,
    accept: kind,
    data: target,
  });
  const selectedForPool = compatible(selected, target);

  return (
    <Box
      ref={(node: HTMLElement | null) => ref(node)}
      component="section"
      aria-label={kind === 'hero' ? '武将仓库' : '战法仓库'}
      sx={{
        p: 1.25,
        border: '1px solid',
        borderColor:
          isDropTarget || selectedForPool ? 'primary.main' : 'divider',
        bgcolor:
          isDropTarget || selectedForPool
            ? alpha('#456c5f', 0.1)
            : alpha('#fffdf7', 0.64),
        minHeight: 104,
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Typography component="h3" variant="subtitle2" fontWeight={900}>
          {kind === 'hero' ? '武将仓库' : '战法仓库'}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Chip
            size="small"
            variant="outlined"
            label={`${items.length} 个可用`}
          />
          {selectedForPool && (
            <Button
              size="small"
              variant="contained"
              onClick={() => onTargetActivate(target)}
              sx={{ minHeight: 44, px: 1 }}
            >
              放回{kind === 'hero' ? '武将' : '战法'}仓库
            </Button>
          )}
        </Stack>
      </Stack>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.75,
          alignContent: 'flex-start',
        }}
      >
        {items.map((item) => {
          const itemSource: TeamBuilderMoveSource =
            kind === 'hero'
              ? { kind: 'hero', origin: 'pool', hero: item }
              : { kind: 'skill', origin: 'pool', skill: item };
          return (
            <PoolItem
              key={item}
              kind={kind}
              value={item}
              support={supportItems.has(item)}
              selected={
                selected !== null &&
                isSameSource(selected.source, itemSource)
              }
              onSelect={onSourceSelect}
            />
          );
        })}
        {items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            所有{kind === 'hero' ? '武将' : '战法'}均已编入队伍。拖回此处即可移除。
          </Typography>
        )}
      </Box>
    </Box>
  );
};

const FormationWorkbench = ({
  layout,
  heroes,
  skills,
  formations,
  supportItems,
  onMove,
  onFormationChange,
  onRowChange,
}: FormationWorkbenchProps) => {
  const [selected, setSelected] = useState<SelectableItem | null>(null);
  const [activeLabel, setActiveLabel] = useState('');
  const { heroes: usedHeroes, skills: usedSkills } = useMemo(
    () => collectUsedTeamBuilderItems(layout),
    [layout]
  );
  const poolHeroes = useMemo(
    () => heroes.filter((hero) => !usedHeroes.has(hero)),
    [heroes, usedHeroes]
  );
  const poolSkills = useMemo(
    () => skills.filter((skill) => !usedSkills.has(skill)),
    [skills, usedSkills]
  );

  useEffect(() => {
    setSelected(null);
  }, [layout]);

  const selectSource = (item: SelectableItem) => {
    setSelected((current) =>
      current && isSameSource(current.source, item.source) ? null : item
    );
  };

  const activateTarget = (target: TeamBuilderMoveTarget) => {
    if (!selected || selected.source.kind !== target.kind) return;
    onMove(selected.source, target);
    setSelected(null);
  };

  const removeSource = (source: TeamBuilderMoveSource) => {
    const target: TeamBuilderMoveTarget =
      source.kind === 'hero'
        ? { kind: 'hero', destination: 'pool' }
        : { kind: 'skill', destination: 'pool' };
    onMove(source, target);
    setSelected(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveLabel(String(event.operation.source?.data.label || ''));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const source = event.operation.source?.data as DragData | undefined;
    const target = event.operation.target?.data as
      | TeamBuilderMoveTarget
      | undefined;
    setActiveLabel('');
    if (event.canceled || !source || !target || source.kind !== target.kind) {
      return;
    }
    onMove(source, target);
    setSelected(null);
  };

  return (
    <TeamBuilderDragDropProvider
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <Paper
        component="section"
        aria-labelledby="formation-workbench-title"
        sx={{
          p: { xs: 1, sm: 1.5 },
          borderTop: '3px solid',
          borderTopColor: 'secondary.main',
          bgcolor: '#e7dfcc',
          backgroundImage: `repeating-linear-gradient(0deg, ${alpha('#1d2421', 0.018)} 0, ${alpha('#1d2421', 0.018)} 1px, transparent 1px, transparent 5px)`,
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1}
          sx={{
            px: { xs: 0.5, sm: 1 },
            pb: 1.25,
            pt: { xs: selected ? 0.5 : 0, sm: 0 },
            position: {
              xs: selected ? 'sticky' : 'static',
              sm: 'static',
            },
            top: { xs: 0 },
            zIndex: selected ? 3 : 'auto',
            bgcolor: selected ? '#e7dfcc' : 'transparent',
          }}
        >
          <Box>
            <Typography
              id="formation-workbench-title"
              component="h2"
              variant="h5"
            >
              我的比赛阵容
            </Typography>
            <Typography variant="body2" color="text.secondary">
              拖动武将与战法；触屏也可先点选，再点亮目标位置。
            </Typography>
          </Box>
          {selected && (
            <Alert
              severity="info"
              icon={<DragIndicatorIcon fontSize="inherit" />}
              action={
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => setSelected(null)}
                >
                  取消
                </Button>
              }
              sx={{ py: 0.25 }}
            >
              已选择：{selected.label}
            </Alert>
          )}
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 2fr) minmax(300px, 0.9fr)' },
            gap: 1.5,
            alignItems: 'start',
          }}
        >
          <Stack spacing={1.25} sx={{ order: { xs: 2, lg: 1 } }}>
            {layout.map((team, teamIndex) => (
              <Paper
                component="section"
                aria-labelledby={`team-heading-${teamIndex}`}
                key={teamIndex}
                variant="outlined"
                sx={{
                  p: { xs: 1, sm: 1.25 },
                  borderLeft: '4px solid',
                  borderLeftColor: teamAccent[teamIndex],
                  bgcolor: alpha('#fbf8ef', 0.88),
                }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                  gap={1}
                  sx={{ mb: 1 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography
                        id={`team-heading-${teamIndex}`}
                        component="h3"
                        variant="h6"
                      >
                        队伍 {teamIndex + 1}
                      </Typography>
                      {teamIndex === 0 && (
                        <Chip
                          size="small"
                          color="success"
                          icon={<AutoAwesomeOutlinedIcon />}
                          label="主力"
                        />
                      )}
                    </Stack>
                    <TeamScoreAndEvidence team={team} />
                  </Box>
                  <FormControl size="small" sx={{ minWidth: 132 }}>
                    <InputLabel id={`formation-label-${teamIndex}`}>
                      阵型
                    </InputLabel>
                    <Select
                      labelId={`formation-label-${teamIndex}`}
                      label="阵型"
                      value={team.formation}
                      onChange={(event: SelectChangeEvent) =>
                        onFormationChange(teamIndex, event.target.value)
                      }
                      inputProps={{
                        'data-testid': `formation-select-${teamIndex}`,
                      }}
                    >
                      <MenuItem value="">
                        <em>待选择</em>
                      </MenuItem>
                      {formations.map((formation) => (
                        <MenuItem key={formation} value={formation}>
                          {formation}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>

                <Box
                  role="region"
                  aria-label={`队伍 ${teamIndex + 1} 武将配置`}
                  tabIndex={0}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'repeat(3, minmax(158px, 1fr))',
                      sm: 'repeat(3, minmax(0, 1fr))',
                    },
                    gap: 0.75,
                    overflowX: { xs: 'auto', sm: 'visible' },
                    pb: { xs: 0.5, sm: 0 },
                    scrollSnapType: { xs: 'x proximity', sm: 'none' },
                    '& > *': { scrollSnapAlign: 'start' },
                    '&:focus-visible': {
                      outline: `3px solid ${alpha('#456c5f', 0.34)}`,
                      outlineOffset: 2,
                    },
                  }}
                >
                  {team.heroes.map((slot, heroIndex) => (
                    <HeroAssignmentCard
                      key={heroIndex}
                      teamIndex={teamIndex}
                      heroIndex={heroIndex}
                      slot={slot}
                      selected={selected}
                      onSourceSelect={selectSource}
                      onTargetActivate={activateTarget}
                      onRemove={removeSource}
                      onRowChange={(row) =>
                        onRowChange(teamIndex, heroIndex, row)
                      }
                    />
                  ))}
                </Box>
              </Paper>
            ))}
          </Stack>

          <Stack
            spacing={1}
            sx={{
              position: { lg: 'sticky' },
              top: { lg: 82 },
              maxHeight: { lg: 'calc(100vh - 105px)' },
              overflowY: { lg: 'auto' },
              pr: { lg: 0.25 },
              order: { xs: 1, lg: 2 },
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.25 }}>
              <Inventory2OutlinedIcon color="secondary" />
              <Typography component="h2" variant="h6">
                卡池仓库
              </Typography>
            </Stack>
            <Repository
              kind="hero"
              items={poolHeroes}
              selected={selected}
              supportItems={supportItems}
              onSourceSelect={selectSource}
              onTargetActivate={activateTarget}
            />
            <Repository
              kind="skill"
              items={poolSkills}
              selected={selected}
              supportItems={supportItems}
              onSourceSelect={selectSource}
              onTargetActivate={activateTarget}
            />
          </Stack>
        </Box>
      </Paper>

      <DragOverlay>
        {activeLabel ? (
          <Paper
            sx={{
              px: 1.5,
              py: 1,
              border: '2px solid',
              borderColor: 'secondary.main',
              bgcolor: 'background.paper',
              boxShadow: 3,
            }}
          >
            <Typography variant="body2" fontWeight={900}>
              {activeLabel}
            </Typography>
          </Paper>
        ) : null}
      </DragOverlay>
    </TeamBuilderDragDropProvider>
  );
};

export default FormationWorkbench;
