import { useState, type ComponentType, type PropsWithChildren, type ReactNode } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
} from '@mui/material';
import {
  DragDropProvider,
  PointerSensor,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/react';
import GameCardArt from '../common/GameCardArt';
import type { LayoutEvaluation } from '../../services/teamAllocation';
import type {
  LayoutPosition,
  MoveSource,
  MoveTarget,
  TeamBuilderMode,
  TeamLayout,
} from '../../services/teamLayout';

const TEAM_NAMES = ['队伍一', '队伍二', '队伍三'];

interface DragData {
  source: MoveSource;
}

interface DropData {
  target: MoveTarget;
}

type OnMove = (source: MoveSource, target: MoveTarget) => void;

// @dnd-kit/react 0.5.0's provider props drop `children` under TypeScript 7.
const Provider = DragDropProvider as unknown as ComponentType<
  PropsWithChildren<{ onDragEnd?: (event: DragEndEvent) => void }>
>;

const rosterSensors = [
  PointerSensor.configure({
    preventActivation: (event) =>
      event.target instanceof Element && Boolean(event.target.closest('[aria-label^="移除"]')),
  }),
];

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Drag-and-drop context shared by the team builder and 当前阵容. */
export const TeamBuilderDndProvider = ({ onMove, children }: PropsWithChildren<{ onMove: OnMove }>) => (
  <Provider
    onDragEnd={(event) => {
      const source = (event.operation.source?.data as DragData | undefined)?.source;
      const drop = event.operation.target?.data as DropData | undefined;
      if (event.canceled || !source || !drop) return;
      onMove(source, drop.target);
    }}
  >
    {children}
  </Provider>
);

/** Makes a 当前阵容 card draggable into the team builder. */
export const RosterDragSource = ({
  kind,
  name,
  children,
}: PropsWithChildren<{ kind: MoveSource['kind']; name: string }>) => {
  const { ref, isDragging } = useDraggable<DragData>({
    id: `roster-${kind}-${name}`,
    type: kind,
    data: { source: { kind, name, from: null } },
    sensors: rosterSensors,
  });
  return (
    <Box ref={ref} sx={{ cursor: 'grab', touchAction: 'manipulation', opacity: isDragging ? 0.5 : 1 }}>
      {children}
    </Box>
  );
};

/** Dropping a placed item here returns it to 当前阵容. */
export const RosterDropZone = ({ children }: PropsWithChildren) => {
  const { ref, isDropTarget } = useDroppable<DropData>({
    id: 'roster-return',
    accept: ['hero', 'skill'],
    data: { target: null },
  });
  return (
    <Box ref={ref} sx={{ outline: isDropTarget ? '2px dashed' : 'none', outlineColor: 'primary.main' }}>
      {children}
    </Box>
  );
};

interface SlotProps {
  kind: MoveSource['kind'];
  name: string | null;
  position: LayoutPosition;
  label: string;
  disabled?: boolean;
  support: boolean;
  unseen: boolean;
  onOpen: () => void;
}

const UnseenMark = ({ overlay }: { overlay: boolean }) => (
  <Typography
    component="span"
    aria-label="未见过的组合"
    sx={{
      ...(overlay ? { position: 'absolute', left: 0, right: 0, bottom: 0, textAlign: 'center' } : { ml: 0.5 }),
      px: 0.5,
      fontSize: 10,
      lineHeight: 1.4,
      color: '#fffaf0',
      bgcolor: 'rgba(168,57,47,.9)',
      borderRadius: overlay ? 0 : 0.5,
      flex: 'none',
    }}
  >
    未见
  </Typography>
);

/** A hero portrait slot, or a skill text slot, that accepts drops and opens the picker. */
const Slot = ({ kind, name, position, label, disabled = false, support, unseen, onOpen }: SlotProps) => {
  const { ref: dropRef, isDropTarget } = useDroppable<DropData>({
    id: `slot-${position.team}-${position.slot}-${position.field}`,
    accept: kind,
    data: { target: position },
    disabled,
  });
  const { ref: dragRef, isDragging } = useDraggable<DragData>({
    id: `placed-${position.team}-${position.slot}-${position.field}`,
    type: kind,
    data: name ? { source: { kind, name, from: position } } : undefined,
    disabled: !name,
  });
  const isHero = kind === 'hero';
  return (
    <Box ref={dropRef} sx={{ minWidth: 0 }}>
      <ButtonBase
        ref={name ? dragRef : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={onOpen}
        data-testid={!isHero && name ? `team-slot-skill-${name}` : undefined}
        sx={{
          display: isHero ? 'block' : 'flex',
          alignItems: 'center',
          width: '100%',
          position: 'relative',
          borderRadius: 1,
          opacity: isDragging ? 0.5 : 1,
          outline: isDropTarget ? '3px solid' : 'none',
          outlineColor: 'primary.main',
          '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          ...(isHero
            ? {}
            : {
                minHeight: 32,
                px: { xs: 0.5, sm: 0.75 },
                justifyContent: 'flex-start',
                border: '1px solid',
                borderStyle: name ? 'solid' : 'dashed',
                borderColor: support ? '#456c5f' : name || disabled ? 'divider' : 'secondary.main',
                bgcolor: name ? 'rgba(255,253,247,.9)' : 'transparent',
                color: name ? 'text.primary' : disabled ? 'text.disabled' : 'primary.main',
                fontSize: { xs: 11, sm: 13 },
                fontWeight: name ? 700 : 400,
                whiteSpace: 'nowrap',
              }),
        }}
      >
        {isHero ? (
          name ? (
            <GameCardArt name={name} kind="hero" size="mini" support={support} testIdPrefix="team-slot-card" />
          ) : (
            <Box
              sx={{
                aspectRatio: '160 / 248',
                display: 'grid',
                placeItems: 'center',
                border: '1px dashed',
                borderColor: 'secondary.main',
                borderRadius: 1,
                bgcolor: 'rgba(239,229,207,.6)',
                color: 'primary.main',
                fontSize: 12,
              }}
            >
              ＋武将
            </Box>
          )
        ) : (
          <>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {name ?? '＋战法'}
            </Box>
            {support && (
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, ml: 0.5, px: 0.375, fontSize: 10, color: '#fffaf0', bgcolor: 'rgba(69,108,95,.9)', borderRadius: 0.5, flex: 'none' }}>
                援
              </Box>
            )}
          </>
        )}
        {unseen && <UnseenMark overlay={isHero} />}
      </ButtonBase>
    </Box>
  );
};

interface PickerState {
  kind: MoveSource['kind'];
  position: LayoutPosition;
  current: string | null;
  title: string;
}

interface TeamBuilderProps {
  layout: TeamLayout;
  evaluation: LayoutEvaluation;
  mode: TeamBuilderMode;
  allocating: boolean;
  heroes: string[];
  skills: string[];
  placed: { heroes: Set<string>; skills: Set<string> };
  supportItems: ReadonlySet<string>;
  defaultSkill: Record<string, string>;
  onMove: OnMove;
  onRestoreAuto: () => void;
}

/** Three teams allocated from 当前阵容; drag or tap to adjust. */
const TeamBuilder = ({
  layout,
  evaluation,
  mode,
  allocating,
  heroes,
  skills,
  placed,
  supportItems,
  defaultSkill,
  onMove,
  onRestoreAuto,
}: TeamBuilderProps) => {
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = (next: PickerState) => {
    setPicker(next);
    setPickerOpen(true);
  };

  const choices = picker
    ? picker.kind === 'hero'
      ? heroes.filter((hero) => !placed.heroes.has(hero))
      : skills.filter((skill) => {
          const carrier = layout[picker.position.team][picker.position.slot].hero;
          return !placed.skills.has(skill) && skill !== defaultSkill[carrier ?? ''];
        })
    : [];

  const pick = (name: string | null) => {
    if (!picker) return;
    if (name) onMove({ kind: picker.kind, name, from: null }, picker.position);
    else if (picker.current) onMove({ kind: picker.kind, name: picker.current, from: picker.position }, null);
    setPickerOpen(false);
  };

  const header: ReactNode = (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
      <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 800 }}>
        队伍编排
      </Typography>
      <Chip size="small" variant="outlined" label={mode === 'auto' ? '自动分配' : '已手动调整'} />
      {mode === 'manual' && (
        <Chip size="small" variant="outlined" color="primary" label="恢复自动分配" onClick={onRestoreAuto} />
      )}
      {allocating && <CircularProgress size={16} aria-label="正在分配" />}
    </Box>
  );

  return (
    <Paper component="section" aria-label="队伍编排" sx={{ p: { xs: 1.25, sm: 1.5 }, mb: 2 }}>
      {header}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        当前阵容中的灰色卡片已编入队伍。可把其余卡片拖入队伍，或点击空位选择。
      </Typography>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {layout.map((team, t) => {
          const result = evaluation.teams[t];
          return (
            <Box
              key={TEAM_NAMES[t]}
              data-testid={`team-builder-team-${t + 1}`}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', sm: '64px repeat(3, minmax(0, 1fr))' },
                alignItems: 'center',
                gap: { xs: 0.5, sm: 1 },
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: { xs: 0.75, sm: 1 },
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  gridColumn: { xs: '1 / -1', sm: 'auto' },
                  display: 'flex',
                  flexDirection: { xs: 'row', sm: 'column' },
                  alignItems: { xs: 'baseline', sm: 'flex-start' },
                  gap: { xs: 1, sm: 0.25 },
                }}
              >
                <Typography component="h3" variant="subtitle2" sx={{ fontWeight: 800 }}>
                  {TEAM_NAMES[t]}
                </Typography>
                {result.score === null ? (
                  <Typography variant="caption" color="text.secondary">空</Typography>
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      评分 {(result.score * 10).toFixed(1)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      胜率 {percent(result.winChance)}
                    </Typography>
                  </>
                )}
              </Box>
              {team.map((slot, s) => (
                <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 0.75 }, minWidth: 0 }}>
                  <Box sx={{ width: { xs: 40, sm: 52 }, flex: 'none' }}>
                    <Slot
                      kind="hero"
                      name={slot.hero}
                      position={{ team: t, slot: s, field: 'hero' }}
                      label={`${TEAM_NAMES[t]}第${s + 1}位武将：${slot.hero ?? '空'}`}
                      support={Boolean(slot.hero && supportItems.has(slot.hero))}
                      unseen={Boolean(slot.hero && evaluation.unseenHeroes.has(slot.hero))}
                      onOpen={() =>
                        openPicker({
                          kind: 'hero',
                          position: { team: t, slot: s, field: 'hero' },
                          current: slot.hero,
                          title: `${TEAM_NAMES[t]}：选择武将`,
                        })
                      }
                    />
                  </Box>
                  <Box sx={{ display: 'grid', gap: 0.5, flex: 1, minWidth: 0 }}>
                    {([0, 1] as const).map((field) => {
                      const skill = slot.skills[field];
                      return (
                        <Slot
                          key={field}
                          kind="skill"
                          name={skill}
                          position={{ team: t, slot: s, field }}
                          label={`${TEAM_NAMES[t]}${slot.hero ?? '空位'}战法${field + 1}：${skill ?? '空'}`}
                          disabled={!slot.hero}
                          support={Boolean(skill && supportItems.has(skill))}
                          unseen={Boolean(skill && evaluation.unseenSkills.has(skill))}
                          onOpen={() =>
                            openPicker({
                              kind: 'skill',
                              position: { team: t, slot: s, field },
                              current: skill,
                              title: `${slot.hero}：选择战法`,
                            })
                          }
                        />
                      );
                    })}
                  </Box>
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>

      <Dialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        slotProps={{ transition: { onExited: () => setPicker(null) } }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{picker?.title}</DialogTitle>
        <DialogContent>
          {choices.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              当前阵容中没有未编入的{picker?.kind === 'hero' ? '武将' : '战法'}。
            </Typography>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 1 }}>
              {choices.map((name) => (
                <ButtonBase key={name} aria-label={`选择${name}`} onClick={() => pick(name)} sx={{ display: 'block' }}>
                  <GameCardArt
                    name={name}
                    kind={picker?.kind === 'hero' ? 'hero' : 'tactic'}
                    size="mini"
                    support={supportItems.has(name)}
                    testIdPrefix="team-picker-card"
                  />
                </ButtonBase>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {picker?.current && (
            <Button color="error" onClick={() => pick(null)}>
              移回当前阵容
            </Button>
          )}
          <Button onClick={() => setPickerOpen(false)}>取消</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default TeamBuilder;
