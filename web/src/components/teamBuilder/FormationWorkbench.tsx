import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  type PropsWithChildren,
  type ReactNode,
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
  Popover,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  type SelectChangeEvent,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import {
  DragDropProvider,
  DragOverlay,
  PointerSensor,
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
import { labelFeature } from '../../services/featureLabels';
import {
  aggregateRelationshipTargetsFor,
  buildContextualRelationshipPreviewIndex,
  buildHeroTrioRelationshipPreviews,
  buildProspectiveContextualRelationshipPreviewIndex,
  buildStaticRelationshipPreviewIndex,
  formatRelationshipPreviewWeight,
  relationshipPreviewItemKey,
  resolveRelationshipPreviewItem,
  type PairRelationshipAggregatePreview,
  type RelationshipPreviewItem,
} from '../../services/relationshipPreview';
import {
  isConfidentDisplayFeature,
  teamBuilderConfidenceSupport,
} from '../../services/recommendationEngine';
import {
  TEAM_BUILDER_ROWS,
  collectUsedTeamBuilderItems,
  type TeamBuilderHeroSlot,
  type TeamBuilderLayout,
  type TeamBuilderMoveSource,
  type TeamBuilderMoveTarget,
  type TeamBuilderRow,
} from '../../services/teamBuilderArrangement';
import { formatHeroRanking } from '../../utils/itemMetadata';
import { teamBuilderInteractionPolicy } from '../../theme/teamBuilderInteractions';
import GameCardArt from '../common/GameCardArt';

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
  actions?: ReactNode;
}

interface SelectableItem {
  source: TeamBuilderMoveSource;
  label: string;
}

type DragData = TeamBuilderMoveSource & { label: string };

const teamAccent = ['#456c5f', '#a38147', '#a8392f'] as const;
const pointerOnlySensors = [
  PointerSensor.configure({
    preventActivation: (event) =>
      event.target instanceof Element &&
      Boolean(
        event.target.closest('[data-team-builder-drop-exclusion="true"]')
      ),
  }),
];
const RELATIONSHIP_RAIL_HEIGHT = 44;
const PRIMARY_PREVIEW_CONTENT_HEIGHT = 44;
const PREVIEW_SURFACE_EDGE_INSET = 1;
const PRIMARY_PREVIEW_SURFACE_HEIGHT =
  PRIMARY_PREVIEW_CONTENT_HEIGHT + PREVIEW_SURFACE_EDGE_INSET * 2;
const HERO_ASSIGNMENT_CARD_MIN_WIDTH = 326;
const HERO_ASSIGNMENT_ART_WIDTH = 142;
const HERO_ASSIGNMENT_CONTROLS_MIN_WIDTH = 164;
const SKILL_DROP_HIGHLIGHT_COLOR = '#174c42';
const RELATIONSHIP_TRANSITION_MS = 150;
const TEAM_EVIDENCE_LIMIT = 3;
const TEAM_EVIDENCE_FAMILIES = new Set(['HP', 'HS', 'SP']);

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
  魏: { background: '#dce8ec', foreground: '#365767' },
  蜀: { background: '#e1eadf', foreground: '#3f6146' },
  吴: { background: '#f0dfdc', foreground: '#7e3932' },
  群: { background: '#e8dfee', foreground: '#604b72' },
};

const tacticQualitySurfaces = {
  orange: {
    background: alpha('#d69a38', 0.22),
    foreground: '#6d4814',
    border: alpha('#99651d', 0.82),
    selectedBackground: '#765d31',
    selectedForeground: '#fffdf7',
  },
  purple: {
    background: alpha('#8b67b8', 0.2),
    foreground: '#5d3f78',
    border: alpha('#725097', 0.82),
    selectedBackground: '#684d82',
    selectedForeground: '#fffdf7',
  },
} as const;

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

const moveTargetFromKey = (key: string): TeamBuilderMoveTarget | null => {
  const [kind, destination, ...indices] = key.split(':');
  if (kind !== 'hero' && kind !== 'skill') return null;
  if (destination === 'pool' && indices.length === 0) {
    return { kind, destination };
  }
  const parsedIndices = indices.map(Number);
  if (
    destination !== 'slot' ||
    parsedIndices.some((index) => !Number.isInteger(index) || index < 0)
  ) {
    return null;
  }
  if (kind === 'hero' && parsedIndices.length === 2) {
    return {
      kind,
      destination,
      teamIndex: parsedIndices[0],
      heroIndex: parsedIndices[1],
    };
  }
  if (kind === 'skill' && parsedIndices.length === 3) {
    return {
      kind,
      destination,
      teamIndex: parsedIndices[0],
      heroIndex: parsedIndices[1],
      skillIndex: parsedIndices[2],
    };
  }
  return null;
};

interface ClientPosition {
  readonly x: number;
  readonly y: number;
}

const clientPositionFromEvent = (event?: Event): ClientPosition | null => {
  if (!event) return null;
  const pointer = event as Event & {
    clientX?: unknown;
    clientY?: unknown;
    changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
  };
  if (
    typeof pointer.clientX === 'number' &&
    typeof pointer.clientY === 'number'
  ) {
    return { x: pointer.clientX, y: pointer.clientY };
  }
  const touch = pointer.changedTouches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
};

const moveTargetAtPosition = (
  position: ClientPosition,
  kind?: TeamBuilderMoveSource['kind']
): TeamBuilderMoveTarget | null => {
  if (typeof document === 'undefined') return null;
  const elements = document.elementsFromPoint(position.x, position.y);
  const topExclusion = elements[0]?.closest(
    '[data-team-builder-drop-exclusion="true"]'
  );
  if (
    topExclusion &&
    !topExclusion.closest('[data-team-builder-drop-through="true"]')
  ) {
    return null;
  }
  for (const element of elements) {
    let candidate: Element | null = element;
    while (candidate) {
      if (candidate instanceof HTMLElement) {
        const key = candidate.dataset.teamBuilderDropTarget;
        if (key) {
          const target = moveTargetFromKey(key);
          if (target && (!kind || target.kind === kind)) return target;
        }
      }
      candidate = candidate.parentElement;
    }
  }
  return null;
};

const resolveMoveTarget = (
  position: ClientPosition | null,
  fallback: TeamBuilderMoveTarget | undefined,
  kind: TeamBuilderMoveSource['kind']
): TeamBuilderMoveTarget | null =>
  position ? moveTargetAtPosition(position, kind) : fallback ?? null;

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

interface HighlightPreviewContextValue {
  activeItem: RelationshipPreviewItem | null;
  targets: ReadonlyMap<string, PairRelationshipAggregatePreview>;
  setHovered: (item: SelectableItem | null) => void;
  setFocused: (item: SelectableItem | null) => void;
  retainActiveFocus: () => void;
}

const HighlightPreviewContext = createContext<HighlightPreviewContextValue | null>(
  null
);

const useCardRelationshipPreview = (
  source: TeamBuilderMoveSource | null,
  label: string | null
) => {
  const context = useContext(HighlightPreviewContext);
  if (!context) throw new Error('Missing Team Builder highlight preview context');
  const item = source
    ? source.kind === 'hero'
      ? { kind: 'hero' as const, name: label || '' }
      : { kind: 'skill' as const, name: label || '' }
    : null;
  const itemKey = item ? relationshipPreviewItemKey(item) : null;
  const activeKey = context.activeItem
    ? relationshipPreviewItemKey(context.activeItem)
    : null;
  const aggregate = itemKey ? context.targets.get(itemKey) ?? null : null;
  const highlighted = itemKey !== null && itemKey === activeKey;
  const selectable = source && label ? { source, label } : null;

  return {
    aggregate,
    highlighted,
    previewState: highlighted
      ? 'selected'
      : aggregate
        ? 'related'
        : activeKey
          ? 'unrelated'
          : undefined,
    ariaSuffix: aggregate ? `。${aggregate.accessibleLabel}` : '',
    onRelationshipFocus: context.retainActiveFocus,
    onPointerMove: selectable
      ? (event: ReactPointerEvent<HTMLElement>) => {
          // Pointer enter/leave can be synthesized when a relationship score is
          // mounted under a stationary pointer. Only physical pointer movement
          // transfers hover ownership between card primaries.
          if (event.pointerType !== 'touch') context.setHovered(selectable);
        }
      : undefined,
    onFocus: selectable
      ? (_event: FocusEvent<HTMLElement>) => context.setFocused(selectable)
      : undefined,
  };
};

type RelationshipTransitionPhase = 'entering' | 'visible' | 'exiting';

const aggregateIdentity = (
  aggregate: PairRelationshipAggregatePreview | null
): string =>
  aggregate
    ? JSON.stringify([
        ...(aggregate.detailHeading
          ? ['team', aggregate.detailHeading]
          : [
              relationshipPreviewItemKey(aggregate.source),
              relationshipPreviewItemKey(aggregate.target),
            ]),
        ...aggregate.components.map(({ featureId }) => featureId),
      ])
    : '';

/** One stable-lane score control with a complete, portal-backed breakdown. */
export const RelationshipAggregateScore = ({
  aggregate,
  onFocus,
  rightOffset = PREVIEW_SURFACE_EDGE_INSET,
}: {
  aggregate: PairRelationshipAggregatePreview | null;
  onFocus?: () => void;
  rightOffset?: number;
}) => {
  const identity = aggregateIdentity(aggregate);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [displayed, setDisplayed] =
    useState<PairRelationshipAggregatePreview | null>(aggregate);
  const [phase, setPhase] = useState<RelationshipTransitionPhase>(
    aggregate ? 'entering' : 'exiting'
  );
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const titleId = useId();
  const detailId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let frame: number | null = null;
    let exitTimer: number | null = null;
    setAnchor(null);

    if (reduceMotion) {
      setDisplayed(aggregate);
      setPhase(aggregate ? 'visible' : 'exiting');
    } else if (!displayed) {
      if (aggregate) {
        setDisplayed(aggregate);
        setPhase('entering');
        frame = window.requestAnimationFrame(() => setPhase('visible'));
      }
    } else if (aggregateIdentity(displayed) === identity && aggregate) {
      setDisplayed(aggregate);
      setPhase('entering');
      frame = window.requestAnimationFrame(() => setPhase('visible'));
    } else {
      setPhase('exiting');
      exitTimer = window.setTimeout(() => {
        setDisplayed(aggregate);
        if (aggregate) {
          setPhase('entering');
          frame = window.requestAnimationFrame(() => setPhase('visible'));
        }
      }, RELATIONSHIP_TRANSITION_MS);
    }

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (exitTimer !== null) window.clearTimeout(exitTimer);
    };
  }, [identity, reduceMotion]);

  useEffect(() => {
    if (!anchor) return;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [anchor]);

  const displayedIdentity = aggregateIdentity(displayed);
  const showingCurrent =
    aggregate !== null && (reduceMotion || displayedIdentity === identity);
  const shown = reduceMotion
    ? aggregate
    : showingCurrent
      ? aggregate
      : displayed;
  if (!shown) return null;
  const renderedPhase = reduceMotion
    ? 'visible'
    : showingCurrent
      ? phase
      : 'exiting';
  const interactive = showingCurrent && renderedPhase !== 'exiting';
  const positive = shown.total > 0;
  const close = () => setAnchor(null);

  return (
    <Box
      data-testid="relationship-score-lane"
      data-team-builder-preview-context={interactive ? 'true' : undefined}
      data-relationship-count={interactive ? shown.components.length : 0}
      data-transition-duration={`${RELATIONSHIP_TRANSITION_MS}ms`}
      data-relationship-transition-state={renderedPhase}
      aria-hidden={interactive ? undefined : 'true'}
      sx={{
        position: 'absolute',
        zIndex: 3,
        insetInline: 0,
        top: PREVIEW_SURFACE_EDGE_INSET,
        minWidth: 0,
        height: RELATIONSHIP_RAIL_HEIGHT,
        minHeight: RELATIONSHIP_RAIL_HEIGHT,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: renderedPhase === 'visible' ? 1 : 0,
        transform:
          renderedPhase === 'visible' ? 'translateY(0)' : 'translateY(2px)',
        transition: `opacity ${RELATIONSHIP_TRANSITION_MS}ms ease, transform ${RELATIONSHIP_TRANSITION_MS}ms ease`,
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          transform: 'none',
        },
      }}
    >
      <ButtonBase
        type="button"
        tabIndex={interactive ? 0 : -1}
        aria-label={shown.accessibleLabel}
        aria-expanded={anchor && interactive ? 'true' : 'false'}
        aria-controls={anchor && interactive ? detailId : undefined}
        data-testid="relationship-score"
        data-relationship-total={shown.total}
        data-team-builder-drop-exclusion="true"
        data-team-builder-drop-through="true"
        data-team-builder-preview-context="true"
        onFocus={onFocus}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor((current) => (current ? null : event.currentTarget));
        }}
        sx={{
          position: 'absolute',
          right: rightOffset,
          top: 0,
          minWidth: 68,
          pointerEvents: interactive ? 'auto' : 'none',
          height: RELATIONSHIP_RAIL_HEIGHT,
          minHeight: RELATIONSHIP_RAIL_HEIGHT,
          px: 0.75,
          border: '1px solid',
          borderColor: positive ? 'success.dark' : 'error.main',
          borderRadius: 0.75,
          bgcolor: positive
            ? alpha('#183522', 0.98)
            : alpha('#3c211d', 0.98),
          color: '#fffdf7',
          fontSize: 11,
          fontWeight: 900,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          '&:focus-visible': {
            outline: '2px solid',
            outlineColor: 'info.main',
            outlineOffset: -2,
          },
        }}
      >
        {shown.compactLabel ? `${shown.compactLabel} ` : ''}
        {formatRelationshipPreviewWeight(shown.total)}
      </ButtonBase>
      <Popover
        open={Boolean(anchor) && interactive}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            className: 'team-builder-relationship-detail-surface',
            sx: {
              width: 'min(300px, calc(100vw - 16px))',
              maxHeight: 'min(360px, calc(100vh - 16px))',
              mt: 0.5,
              overflow: 'auto',
              bgcolor: 'background.paper',
              backgroundImage: 'none',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: 6,
            },
          },
        }}
      >
        <Box
          id={detailId}
          role="dialog"
          aria-labelledby={titleId}
          data-team-builder-relationship-detail="true"
          data-team-builder-drop-exclusion="true"
          sx={{ position: 'relative', p: 1.25, pr: 6.5 }}
        >
          <IconButton
            ref={closeRef}
            size="small"
            aria-label="关闭关系分明细"
            onClick={close}
            sx={{
              position: 'absolute',
              top: 2,
              right: 2,
              width: 44,
              height: 44,
              minWidth: 44,
              minHeight: 44,
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
          <Typography id={titleId} component="h2" variant="subtitle2" fontWeight={900}>
            {shown.detailHeading ?? `${shown.target.name} × ${shown.source.name}`}{' '}
            {formatRelationshipPreviewWeight(shown.total)}
          </Typography>
          <Stack
            component="ul"
            aria-label="全部关系分项"
            spacing={0}
            sx={{ p: 0, mt: 0.75, mb: 0, listStyle: 'none' }}
          >
            {shown.components.map((component) => (
              <Box
                component="li"
                key={component.featureId}
                data-testid="relationship-detail-row"
                data-feature-family={component.family}
                data-feature-id={component.featureId}
                aria-label={component.accessibleLabel}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 1,
                  py: 0.625,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  fontSize: 11,
                }}
              >
                <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  {component.detailLabel}
                </Box>
                <Box
                  component="span"
                  sx={{ flex: '0 0 auto', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatRelationshipPreviewWeight(component.weight)} · 参考{' '}
                  {component.support} 场
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>
      </Popover>
    </Box>
  );
};

const TeamScoreAndEvidence = ({
  team,
}: {
  team: TeamBuilderLayout[number];
}) => {
  const assigned = useMemo(() => toAssignedHeroes(team), [team]);
  const score =
    assigned.length > 0
      ? scoreTeam(
          assigned,
          recommendationData.model,
          recommendationData.catalog
        ) * 10
      : null;
  const evidence = useMemo(
    () =>
      activeTeamContributions(
        assigned,
        recommendationData.model,
        recommendationData.catalog
      )
        .filter(
          (item) =>
            isConfidentDisplayFeature(
              item.weight,
              item.support,
              teamBuilderConfidenceSupport(
                recommendationData.model,
                item.family
              )
            ) && TEAM_EVIDENCE_FAMILIES.has(item.family)
        )
        .slice(0, TEAM_EVIDENCE_LIMIT),
    [assigned]
  );

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        component="p"
        variant="subtitle2"
        fontWeight={800}
        data-testid="team-strength"
        sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
      >
        评分：{score === null ? '—' : score.toFixed(1)}
      </Typography>
      {evidence.length > 0 && (
        <Stack
          data-testid="team-evidence-shell"
          spacing={0.125}
          sx={{ mt: 0.25, minWidth: 0 }}
        >
          {evidence.map((item) => {
            const featureLabel = labelFeature(
              item.featureId,
              recommendationData.catalog
            ).label;
            const label = `${featureLabel} · 加分 +${(item.weight * 10).toFixed(1)} · 参考 ${item.support} 场`;
            return (
              <Typography
                key={item.featureId}
                data-testid="team-evidence"
                variant="caption"
                color="text.secondary"
                title={label}
                sx={{
                  display: 'block',
                  minHeight: '1.5em',
                  lineHeight: 1.5,
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                }}
              >
                {label}
              </Typography>
            );
          })}
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
  const { ref: dragRef, isDragging } = useDraggable<DragData>({
    id: `pool-${kind}-${value}`,
    type: kind,
    data: { ...source, label: value },
    sensors: pointerOnlySensors,
  });
  const hero = kind === 'hero' ? database.heroes[value] : null;
  const camp = hero?.camp ? campColors[hero.camp] : null;
  const skillQuality = kind === 'skill' ? database.skills[value]?.color : null;
  const tacticSurface = skillQuality
    ? tacticQualitySurfaces[skillQuality]
    : null;
  const heroRankLabel = formatHeroRanking(hero);
  const preview = useCardRelationshipPreview(source, value);
  return (
    <Box
      ref={(node: HTMLDivElement | null) => dragRef(node)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${kind === 'hero' ? '选择武将' : '选择战法'} ${value}${
        hero?.camp ? `，${hero.camp}阵营` : ''
      }${heroRankLabel ? `，${heroRankLabel}` : ''}${support ? '，支援' : ''}${preview.ariaSuffix}`}
      data-testid={`pool-${kind}-${value}`}
      data-team-builder-preview-context="true"
      data-preview-state={preview.previewState}
      data-skill-quality={skillQuality ?? undefined}
      onPointerMove={(event) => {
        if (event.target === event.currentTarget) preview.onPointerMove?.(event);
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          preview.onFocus?.(event);
        }
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-team-builder-drop-exclusion="true"]')
        ) {
          return;
        }
        onSelect({ source, label: value });
      }}
      onKeyDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-team-builder-drop-exclusion="true"]')
        ) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect({ source, label: value });
        }
      }}
      sx={{
        position: 'relative',
        height: PRIMARY_PREVIEW_SURFACE_HEIGHT,
        minHeight: PRIMARY_PREVIEW_SURFACE_HEIGHT,
        minWidth: 0,
        width: '100%',
        maxWidth: 'none',
        display: 'grid',
        overflow: 'hidden',
        opacity: isDragging ? 0.65 : 1,
        cursor: 'grab',
        touchAction: 'manipulation',
        border: 0,
        bgcolor: selected
          ? kind === 'hero'
            ? 'primary.main'
            : tacticSurface?.selectedBackground ?? 'secondary.main'
          : camp
            ? alpha(camp.background, 0.72)
            : tacticSurface?.background ?? 'background.paper',
        color: selected
          ? kind === 'hero'
            ? 'primary.contrastText'
            : tacticSurface?.selectedForeground ?? 'secondary.contrastText'
          : camp
            ? camp.foreground
            : tacticSurface?.foreground ?? 'text.primary',
        boxShadow: selected ? 1 : 'none',
        outline: preview.highlighted ? '3px solid' : 'none',
        outlineColor: kind === 'hero' ? 'primary.main' : 'secondary.main',
        outlineOffset: -3,
        borderRadius: 1,
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          boxSizing: 'border-box',
          border: '1px solid',
          borderColor: selected
            ? kind === 'hero'
              ? 'primary.main'
              : tacticSurface?.border ?? 'secondary.main'
            : support
              ? 'warning.main'
              : tacticSurface?.border ?? 'divider',
          borderRadius: 'inherit',
          pointerEvents: 'none',
        },
      }}
    >
      <Box
        data-testid={`pool-${kind}-${value}-primary`}
        data-team-builder-preview-primary="true"
        data-team-builder-preview-context="true"
        data-preview-state={preview.previewState}
        onPointerMove={preview.onPointerMove}
        sx={{
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
          minHeight: PRIMARY_PREVIEW_CONTENT_HEIGHT,
          height: PRIMARY_PREVIEW_CONTENT_HEIGHT,
          boxSizing: 'border-box',
          gridArea: '1 / 1',
          alignSelf: 'start',
          mt: `${PREVIEW_SURFACE_EDGE_INSET}px`,
          pl: 1.25,
          pr: 1.25,
          py: 0.5,
          gap: 0.875,
          justifyContent: 'flex-start',
          textAlign: 'left',
          color: 'inherit',
          cursor: 'grab',
          touchAction: 'manipulation',
        }}
      >
        {kind === 'hero' ? (
          <GameCardArt
            name={value}
            kind="hero"
            size="mini"
            artOnly
            sx={{ width: 26, height: 36, flex: '0 0 26px', boxShadow: 'none' }}
          />
        ) : support ? (
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              width: 32,
              height: 32,
              flex: '0 0 32px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid',
              borderColor: support
                ? 'warning.main'
                : tacticSurface?.border ?? 'secondary.main',
              borderRadius: 0.5,
              bgcolor: tacticSurface?.background ?? alpha('#7c5f94', 0.12),
              color: tacticSurface?.foreground ?? 'secondary.dark',
              fontFamily: '"Songti SC", STSong, serif',
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            ★
          </Box>
        ) : null}
        {hero?.camp && camp && (
          <Box
            component="span"
            data-testid={`pool-hero-camp-${value}`}
            aria-hidden="true"
            sx={{
              width: 28,
              height: 28,
              flex: '0 0 28px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              bgcolor: camp.background,
              color: camp.foreground,
              border: '1px solid',
              borderColor: alpha(camp.foreground, 0.3),
              fontSize: 13,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            {hero.camp}
          </Box>
        )}
        <Box
          data-team-builder-primary-content="true"
          sx={{ minWidth: 0, width: '100%' }}
        >
          <Typography
            component="span"
            variant="body2"
            fontWeight={800}
            data-pool-primary-line="true"
            sx={{
              display: 'block',
              lineHeight: '18px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {value}
            {support && ' · 支援'}
          </Typography>
          {heroRankLabel && (
            <Typography
              component="span"
              variant="caption"
              data-pool-primary-line="true"
              sx={{
                display: 'block',
                lineHeight: '18px',
                opacity: 0.78,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {heroRankLabel}
            </Typography>
          )}
        </Box>
      </Box>
      <Box
        sx={{
          position: 'absolute',
          zIndex: 2,
          inset: 0,
          minWidth: 0,
          pointerEvents: 'none',
        }}
      >
        <RelationshipAggregateScore
          aggregate={preview.aggregate}
          onFocus={preview.onRelationshipFocus}
        />
      </Box>
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
  activeDragTarget: TeamBuilderMoveTarget | null;
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
  activeDragTarget,
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
  const preview = useCardRelationshipPreview(source, skill);
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `drop-${moveTargetKey(target)}`,
    type: 'skill-slot',
    accept: 'skill',
    data: target,
    disabled: !interactive,
  });
  const { ref: dragRef, isDragging } = useDraggable<DragData>({
    id: `drag-skill-slot-${teamIndex}-${heroIndex}-${skillIndex}`,
    type: 'skill',
    data:
      source === null
        ? undefined
        : { ...source, label: skill || '' },
    disabled: source === null,
    sensors: pointerOnlySensors,
  });
  const sourceSelected =
    source !== null &&
    selected !== null &&
    isSameSource(selected.source, source);
  const selectedCanDrop = interactive && compatible(selected, target);
  const physicalDragTarget =
    activeDragTarget !== null &&
    moveTargetKey(activeDragTarget) === moveTargetKey(target);
  const highlighted = isDropTarget || physicalDragTarget || selectedCanDrop;
  const dropHighlighted = highlighted && !sourceSelected;
  const skillQuality = skill ? database.skills[skill]?.color ?? null : null;
  const tacticSurface = skillQuality
    ? tacticQualitySurfaces[skillQuality]
    : null;

  const activate = () => {
    if (selectedCanDrop) {
      onTargetActivate(target);
    } else if (source && skill) {
      onSourceSelect({ source, label: skill });
    }
  };

  return (
    <Box
      ref={(node: HTMLDivElement | null) => {
        dropRef(node);
        if (source) dragRef(node);
      }}
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-disabled={!interactive}
      aria-pressed={sourceSelected}
      aria-label={
        skill
          ? `队伍 ${teamIndex + 1}，${heroIndex + 1}号武将，战法${skillIndex + 1}：${skill}${preview.ariaSuffix}`
          : `队伍 ${teamIndex + 1}，${heroIndex + 1}号武将，空战法位${skillIndex + 1}`
      }
      data-team-builder-drop-target={
        interactive ? moveTargetKey(target) : undefined
      }
      data-team-builder-preview-context={source ? 'true' : undefined}
      data-preview-state={preview.previewState}
      data-skill-quality={skillQuality ?? undefined}
      data-team-builder-drop-highlighted={dropHighlighted ? 'true' : undefined}
      onPointerMove={(event) => {
        if (event.target === event.currentTarget) preview.onPointerMove?.(event);
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          preview.onFocus?.(event);
        }
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-team-builder-drop-exclusion="true"]')
        ) {
          return;
        }
        if (interactive) activate();
      }}
      onKeyDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-team-builder-drop-exclusion="true"]')
        ) {
          return;
        }
        if (interactive && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          activate();
        }
      }}
      sx={{
        position: 'relative',
        height: PRIMARY_PREVIEW_SURFACE_HEIGHT,
        minHeight: PRIMARY_PREVIEW_SURFACE_HEIGHT,
        boxSizing: 'border-box',
        border: 0,
        bgcolor: sourceSelected
          ? tacticSurface?.selectedBackground ?? 'secondary.main'
          : skill
            ? tacticSurface?.background ?? alpha('#7c5f94', 0.18)
            : highlighted
              ? alpha('#b49559', 0.2)
              : alpha('#e7dfcc', 0.62),
        color: sourceSelected
          ? tacticSurface?.selectedForeground ?? 'secondary.contrastText'
          : tacticSurface?.foreground ??
            (skill ? 'text.primary' : 'text.secondary'),
        backgroundImage: dropHighlighted
          ? `linear-gradient(${alpha('#fffdf7', 0.24)}, ${alpha('#fffdf7', 0.24)})`
          : 'none',
        boxShadow: dropHighlighted
          ? `inset 0 0 0 3px ${SKILL_DROP_HIGHLIGHT_COLOR}`
          : 'none',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gridTemplateRows: 'minmax(0, 1fr)',
        alignItems: 'stretch',
        opacity: !interactive || isDragging ? 0.45 : 1,
        cursor: skill ? 'grab' : 'pointer',
        touchAction: 'manipulation',
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          boxSizing: 'border-box',
          border: '1px dashed',
          borderColor: skill
            ? tacticSurface?.border ?? alpha('#a38147', 0.8)
            : highlighted
              ? 'secondary.main'
              : 'divider',
          pointerEvents: 'none',
        },
      }}
    >
      <Box
        data-testid={`skill-slot-${teamIndex}-${heroIndex}-${skillIndex}`}
        data-team-builder-preview-primary={source ? 'true' : undefined}
        data-team-builder-preview-context={source ? 'true' : undefined}
        data-preview-state={preview.previewState}
        onPointerMove={preview.onPointerMove}
        sx={{
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
          minHeight: PRIMARY_PREVIEW_CONTENT_HEIGHT,
          height: PRIMARY_PREVIEW_CONTENT_HEIGHT,
          boxSizing: 'border-box',
          width: '100%',
          alignSelf: 'start',
          mt: `${PREVIEW_SURFACE_EDGE_INSET}px`,
          pl: 0.75,
          pr: 0.75,
          py: 0.5,
          justifyContent: 'flex-start',
          textAlign: 'left',
          outline:
            sourceSelected || preview.highlighted ? '3px solid' : 'none',
          outlineColor: tacticSurface?.border ?? 'secondary.main',
          outlineOffset: -2,
          cursor: skill ? 'grab' : 'pointer',
          touchAction: 'manipulation',
        }}
      >
        <Typography
          variant="caption"
          color={skill ? 'inherit' : 'text.secondary'}
          title={skill || undefined}
          data-team-builder-primary-content="true"
          sx={{
            minWidth: 0,
            fontSize: 12,
            fontWeight: skill ? 800 : 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {skill || '拖入或点选战法'}
        </Typography>
      </Box>
      {skill && source && (
        <IconButton
          size="small"
          aria-label={`移除战法 ${skill}`}
          data-team-builder-drop-exclusion="true"
          data-team-builder-preview-exclusion="true"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(source);
          }}
          sx={{
            position: 'relative',
            zIndex: 2,
            p: 0.25,
            color: 'inherit',
            minWidth: 44,
            minHeight: 44,
            height: 44,
            alignSelf: 'start',
            mt: `${PREVIEW_SURFACE_EDGE_INSET}px`,
            flexShrink: 0,
          }}
        >
          <CloseIcon sx={{ fontSize: 15 }} />
        </IconButton>
      )}
      <Box
        sx={{
          position: 'absolute',
          zIndex: 2,
          inset: 0,
          minWidth: 0,
          pointerEvents: 'none',
        }}
      >
        <RelationshipAggregateScore
          aggregate={preview.aggregate}
          onFocus={preview.onRelationshipFocus}
          rightOffset={skill ? 48 : PREVIEW_SURFACE_EDGE_INSET}
        />
      </Box>
    </Box>
  );
};

interface HeroAssignmentCardProps {
  teamIndex: number;
  heroIndex: number;
  slot: TeamBuilderHeroSlot;
  selected: SelectableItem | null;
  activeDragTarget: TeamBuilderMoveTarget | null;
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
  activeDragTarget,
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
  const preview = useCardRelationshipPreview(source, slot.hero);
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `drop-${moveTargetKey(target)}`,
    type: 'hero-slot',
    accept: 'hero',
    data: target,
  });
  const { ref: dragRef, isDragging } = useDraggable<DragData>({
    id: `drag-hero-slot-${teamIndex}-${heroIndex}`,
    type: 'hero',
    data:
      source === null
        ? undefined
        : { ...source, label: slot.hero || '' },
    disabled: source === null,
    sensors: pointerOnlySensors,
  });
  const sourceSelected =
    source !== null &&
    selected !== null &&
    isSameSource(selected.source, source);
  const highlighted = isDropTarget || compatible(selected, target);
  const hero = slot.hero ? database.heroes[slot.hero] : null;
  const camp = hero?.camp ? campColors[hero.camp] : null;

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
      data-testid={`hero-card-${teamIndex}-${heroIndex}`}
      sx={{
        minWidth: HERO_ASSIGNMENT_CARD_MIN_WIDTH,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        borderColor: highlighted ? 'primary.main' : 'divider',
        boxShadow: highlighted
          ? `0 0 0 2px ${alpha('#456c5f', 0.18)}`
          : 'none',
      }}
    >
      <Box
        ref={(node: HTMLDivElement | null) => {
          dropRef(node);
          if (source) dragRef(node);
        }}
        role="button"
        tabIndex={0}
        aria-pressed={sourceSelected}
        aria-label={
          slot.hero
            ? `队伍 ${teamIndex + 1}，武将位 ${heroIndex + 1}：${slot.hero}，${hero?.camp || ''}阵营${preview.ariaSuffix}`
            : `队伍 ${teamIndex + 1}，空武将位 ${heroIndex + 1}`
        }
        data-team-builder-drop-target={moveTargetKey(target)}
        data-team-builder-preview-context={source ? 'true' : undefined}
        data-preview-state={preview.previewState}
        onPointerMove={(event) => {
          if (event.target === event.currentTarget) preview.onPointerMove?.(event);
        }}
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            preview.onFocus?.(event);
          }
        }}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-team-builder-drop-exclusion="true"]')
          ) {
            return;
          }
          activate();
        }}
        onKeyDown={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-team-builder-drop-exclusion="true"]')
          ) {
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
        }}
        sx={{
          position: 'relative',
          height: PRIMARY_PREVIEW_SURFACE_HEIGHT,
          minHeight: PRIMARY_PREVIEW_SURFACE_HEIGHT,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gridTemplateRows: 'minmax(0, 1fr)',
          alignItems: 'stretch',
          opacity: isDragging ? 0.65 : 1,
          cursor: slot.hero ? 'grab' : 'pointer',
          touchAction: 'manipulation',
          borderLeft: '4px solid',
          borderLeftColor: camp?.foreground || 'transparent',
          bgcolor: highlighted
            ? alpha('#456c5f', 0.12)
            : camp
              ? alpha(camp.background, 0.52)
              : alpha('#e7dfcc', 0.72),
        }}
      >
        <Box
          data-testid={`hero-slot-${teamIndex}-${heroIndex}`}
          data-team-builder-preview-primary={source ? 'true' : undefined}
          data-team-builder-preview-context={source ? 'true' : undefined}
          data-preview-state={preview.previewState}
          onPointerMove={preview.onPointerMove}
          sx={{
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            minHeight: PRIMARY_PREVIEW_CONTENT_HEIGHT,
            height: PRIMARY_PREVIEW_CONTENT_HEIGHT,
            boxSizing: 'border-box',
            width: '100%',
            alignSelf: 'start',
            mt: `${PREVIEW_SURFACE_EDGE_INSET}px`,
            pl: 0.75,
            pr: 0.75,
            py: 0.5,
            gap: 0.75,
            justifyContent: 'flex-start',
            textAlign: 'left',
            outline:
              sourceSelected || preview.highlighted ? '3px solid' : 'none',
            outlineColor: 'primary.main',
            outlineOffset: -2,
            cursor: slot.hero ? 'grab' : 'pointer',
            touchAction: 'manipulation',
          }}
        >
          {hero && camp && (
            <Box
              data-testid={`hero-camp-${teamIndex}-${heroIndex}`}
              aria-hidden="true"
              sx={{
                width: 28,
                height: 28,
                flex: '0 0 28px',
                display: 'grid',
                placeItems: 'center',
                border: '1px solid',
                borderColor: camp.foreground,
                borderRadius: 0.5,
                bgcolor: alpha(camp.background, 0.9),
                color: camp.foreground,
                fontFamily: '"Songti SC", STSong, serif',
                fontWeight: 900,
              }}
            >
              {hero.camp}
            </Box>
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="body2"
              fontWeight={900}
              data-team-builder-primary-content="true"
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {slot.hero || '拖入或点选武将'}
            </Typography>
          </Box>
        </Box>
        {slot.hero && source && (
          <IconButton
            size="small"
            aria-label={`移除武将 ${slot.hero}`}
            data-team-builder-drop-exclusion="true"
            data-team-builder-preview-exclusion="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(source);
            }}
            sx={{
              position: 'relative',
              zIndex: 2,
              p: 0.4,
              minWidth: 44,
              minHeight: 44,
              height: 44,
              alignSelf: 'start',
              mt: `${PREVIEW_SURFACE_EDGE_INSET}px`,
              flexShrink: 0,
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
        <Box
          sx={{
            position: 'absolute',
            zIndex: 2,
            inset: 0,
            minWidth: 0,
            pointerEvents: 'none',
          }}
        >
          <RelationshipAggregateScore
            aggregate={preview.aggregate}
            onFocus={preview.onRelationshipFocus}
            rightOffset={slot.hero ? 48 : PREVIEW_SURFACE_EDGE_INSET}
          />
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `${HERO_ASSIGNMENT_ART_WIDTH}px minmax(${HERO_ASSIGNMENT_CONTROLS_MIN_WIDTH}px, 1fr)`,
          gap: 0.75,
          p: 0.75,
          alignItems: 'stretch',
        }}
      >
        <Box
          data-testid={`hero-art-${teamIndex}-${heroIndex}`}
          sx={{ minWidth: 0, minHeight: 0, display: 'flex' }}
        >
          {slot.hero ? (
            <GameCardArt
              name={slot.hero}
              kind="hero"
              size="compact"
              artOnly
              sx={{
                width: '100%',
                height: '100%',
                minHeight: 0,
                aspectRatio: '160 / 248',
                bgcolor: 'background.default',
                boxShadow: 'none',
              }}
            />
          ) : (
            <Box
              aria-hidden="true"
              sx={{
                width: '100%',
                height: '100%',
                minHeight: 0,
                display: 'grid',
                placeItems: 'center',
                border: '1px dashed',
                borderColor: 'divider',
                bgcolor: alpha('#e7dfcc', 0.35),
                color: 'text.disabled',
                fontSize: 24,
              }}
            >
              ＋
            </Box>
          )}
        </Box>

        <Stack
          data-testid={`hero-controls-${teamIndex}-${heroIndex}`}
          spacing={0.6}
          sx={{ minWidth: 0 }}
        >
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

          {slot.skills.map((skill, skillIndex) => (
            <SkillSlot
              key={skillIndex}
              teamIndex={teamIndex}
              heroIndex={heroIndex}
              skillIndex={skillIndex}
              skill={skill}
              heroPresent={slot.hero !== null}
              selected={selected}
              activeDragTarget={activeDragTarget}
              onSourceSelect={onSourceSelect}
              onTargetActivate={onTargetActivate}
              onRemove={onRemove}
            />
          ))}
        </Stack>
      </Box>
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
      data-team-builder-drop-target={moveTargetKey(target)}
      sx={{
        p: 1.25,
        minWidth: 0,
        border: '1px solid',
        borderColor:
          isDropTarget || selectedForPool ? 'primary.main' : 'divider',
        bgcolor:
          isDropTarget || selectedForPool
            ? alpha('#456c5f', 0.1)
            : alpha('#fbf8ef', 0.82),
        minHeight: 104,
        flexShrink: 0,
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
      <Box
        data-testid={`repository-${kind}-grid`}
        sx={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(144px, 100%), 1fr))',
          gap: 0.75,
          alignContent: 'flex-start',
          minWidth: 0,
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

const DragPreviewCard = ({ item }: { item: SelectableItem }) => {
  const { kind } = item.source;
  const hero = kind === 'hero' ? database.heroes[item.label] : null;
  const camp = hero?.camp ? campColors[hero.camp] : null;
  const skillQuality =
    kind === 'skill' ? database.skills[item.label]?.color ?? null : null;
  const tacticSurface = skillQuality
    ? tacticQualitySurfaces[skillQuality]
    : null;
  const dragBackground =
    skillQuality === 'orange'
      ? '#f5e4c1'
      : skillQuality === 'purple'
        ? '#e9e0ef'
        : '#fbf8ef';

  return (
    <Paper
      data-testid="team-builder-drag-preview"
      data-drag-kind={kind}
      data-skill-quality={skillQuality ?? undefined}
      aria-label={`正在拖动${kind === 'hero' ? '武将' : '战法'} ${item.label}`}
      sx={{
        width: 220,
        minHeight: PRIMARY_PREVIEW_SURFACE_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: 0.875,
        px: 1,
        py: 0.25,
        overflow: 'hidden',
        border: '2px solid',
        borderColor: camp?.foreground ?? tacticSurface?.border ?? 'secondary.main',
        bgcolor: camp ? camp.background : dragBackground,
        backgroundImage: 'none',
        color: camp?.foreground ?? tacticSurface?.foreground ?? 'text.primary',
        boxShadow: 4,
        cursor: 'grabbing',
      }}
    >
      {kind === 'hero' && (
        <GameCardArt
          name={item.label}
          kind="hero"
          size="mini"
          artOnly
          sx={{ width: 32, height: 44, flex: '0 0 32px', boxShadow: 'none' }}
        />
      )}
      {camp && (
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            width: 28,
            height: 28,
            flex: '0 0 28px',
            display: 'grid',
            placeItems: 'center',
            border: '1px solid',
            borderColor: camp.foreground,
            borderRadius: 0.5,
            bgcolor: camp.background,
            color: camp.foreground,
            fontWeight: 900,
          }}
        >
          {hero?.camp}
        </Box>
      )}
      <Typography
        variant="body2"
        fontWeight={900}
        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {item.label}
      </Typography>
    </Paper>
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
  actions,
}: FormationWorkbenchProps) => {
  const [selected, setSelected] = useState<SelectableItem | null>(null);
  const [hovered, setHovered] = useState<SelectableItem | null>(null);
  const [focused, setFocused] = useState<SelectableItem | null>(null);
  const [dragged, setDragged] = useState<SelectableItem | null>(null);
  const [dragTarget, setDragTarget] =
    useState<TeamBuilderMoveTarget | null>(null);
  const pointerPositionRef = useRef<ClientPosition | null>(null);
  const dragKindRef = useRef<TeamBuilderMoveSource['kind'] | null>(null);
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
  const activeHighlight = dragged ?? selected ?? focused ?? hovered;
  const activeItem = useMemo(
    () =>
      activeHighlight
        ? resolveRelationshipPreviewItem(layout, activeHighlight.source)
        : null,
    [activeHighlight, layout]
  );
  const staticRelationshipIndex = useMemo(
    () =>
      buildStaticRelationshipPreviewIndex(
        heroes,
        skills,
        recommendationData.model
      ),
    [heroes, skills]
  );
  const currentContextualRelationshipIndex = useMemo(
    () =>
      buildContextualRelationshipPreviewIndex(layout, recommendationData.model),
    [layout]
  );
  const contextualRelationshipIndex = useMemo(
    () =>
      dragged && dragTarget && compatible(dragged, dragTarget)
        ? buildProspectiveContextualRelationshipPreviewIndex(
            layout,
            dragged.source,
            dragTarget,
            recommendationData.model
          )
        : currentContextualRelationshipIndex,
    [currentContextualRelationshipIndex, dragTarget, dragged, layout]
  );
  const relationshipTargets = useMemo(
    () =>
      activeItem
        ? aggregateRelationshipTargetsFor(
            activeItem,
            staticRelationshipIndex,
            contextualRelationshipIndex
          )
        : new Map<string, PairRelationshipAggregatePreview>(),
    [activeItem, contextualRelationshipIndex, staticRelationshipIndex]
  );
  const heroTrioPreviews = useMemo(
    () =>
      activeHighlight
        ? buildHeroTrioRelationshipPreviews(
            layout,
            activeHighlight.source,
            recommendationData.model,
            dragged && dragTarget && compatible(dragged, dragTarget)
              ? dragTarget
              : null
          )
        : new Map<number, PairRelationshipAggregatePreview>(),
    [activeHighlight, dragTarget, dragged, layout]
  );
  const resetTransientInteraction = useCallback(() => {
    setHovered(null);
    setFocused(null);
  }, []);
  const resetPointerInteraction = useCallback(() => {
    setHovered(null);
  }, []);
  const updateHovered = useCallback((item: SelectableItem | null) => {
    setHovered((current) => {
      if (current === item) return current;
      if (!current || !item) return item;
      return current.label === item.label &&
        isSameSource(current.source, item.source)
        ? current
        : item;
    });
  }, []);
  const retainActiveFocus = useCallback(() => {
    if (activeHighlight) setFocused(activeHighlight);
  }, [activeHighlight]);
  const highlightContext = useMemo<HighlightPreviewContextValue>(
    () => ({
      activeItem,
      targets: relationshipTargets,
      setHovered: updateHovered,
      setFocused,
      retainActiveFocus,
    }),
    [activeItem, relationshipTargets, retainActiveFocus, updateHovered]
  );

  useEffect(() => {
    setSelected(null);
    resetTransientInteraction();
  }, [layout, resetTransientInteraction]);

  useEffect(() => {
    const trackPointer = (event: PointerEvent) => {
      const position = { x: event.clientX, y: event.clientY };
      pointerPositionRef.current = position;
      const dragKind = dragKindRef.current;
      if (!dragKind) return;

      if (event.type !== 'pointermove') return;

      // The pointer sensor queues its drag-over notification on an animation
      // frame. Hit-test the physical pointer in capture phase so a preview
      // re-render cannot make that notification miss a valid target.
      const target = moveTargetAtPosition(position, dragKind);
      setDragTarget((current) => {
        if (!target) return current === null ? current : null;
        return current && moveTargetKey(current) === moveTargetKey(target)
          ? current
          : target;
      });
    };
    window.addEventListener('pointerdown', trackPointer, true);
    window.addEventListener('pointermove', trackPointer, true);
    window.addEventListener('pointerup', trackPointer, true);
    return () => {
      window.removeEventListener('pointerdown', trackPointer, true);
      window.removeEventListener('pointermove', trackPointer, true);
      window.removeEventListener('pointerup', trackPointer, true);
    };
  }, []);

  const selectSource = (item: SelectableItem) => {
    resetTransientInteraction();
    setSelected((current) =>
      current && isSameSource(current.source, item.source) ? null : item
    );
  };

  const activateTarget = (target: TeamBuilderMoveTarget) => {
    if (!selected || selected.source.kind !== target.kind) return;
    onMove(selected.source, target);
    setSelected(null);
    resetTransientInteraction();
  };

  const removeSource = (source: TeamBuilderMoveSource) => {
    const target: TeamBuilderMoveTarget =
      source.kind === 'hero'
        ? { kind: 'hero', destination: 'pool' }
        : { kind: 'skill', destination: 'pool' };
    onMove(source, target);
    setSelected(null);
    resetTransientInteraction();
  };

  const handleDragStart = (event: DragStartEvent) => {
    const source = event.operation.source?.data as DragData | undefined;
    const label = String(source?.label || '');
    const draggedItem = source && label ? { source, label } : null;
    pointerPositionRef.current =
      clientPositionFromEvent(event.nativeEvent) ?? pointerPositionRef.current;
    dragKindRef.current = draggedItem?.source.kind ?? null;
    setDragged(draggedItem);
    setDragTarget(null);
    resetTransientInteraction();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const source = event.operation.source?.data as DragData | undefined;
    const releasePosition =
      clientPositionFromEvent(event.nativeEvent) ?? pointerPositionRef.current;
    const candidate = source
      ? resolveMoveTarget(
          releasePosition,
          event.operation.target?.data as TeamBuilderMoveTarget | undefined,
          source.kind
        )
      : null;
    const target = source?.kind === candidate?.kind ? candidate : null;
    dragKindRef.current = null;
    setDragged(null);
    setDragTarget(null);
    resetTransientInteraction();
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
      <HighlightPreviewContext.Provider value={highlightContext}>
      <Paper
        component="section"
        aria-labelledby="formation-workbench-title"
        onPointerOver={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              '[data-team-builder-trio-preview-context="true"]'
            )
          ) {
            // One HT score belongs to the whole concrete team. Keep it live
            // while a physical pointer crosses sibling heroes, remove controls,
            // or the small card gap on the way to that team-level control.
            return;
          }
          if (
            event.target instanceof Element &&
            event.target.closest('[data-team-builder-preview-exclusion="true"]')
          ) {
            if (hovered) resetPointerInteraction();
            return;
          }
          if (
            event.target instanceof Element &&
            event.target.closest('[data-team-builder-preview-context="true"]')
          ) {
            return;
          }
          if (hovered) resetPointerInteraction();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch' && hovered) {
            resetPointerInteraction();
          }
        }}
        onBlurCapture={(event) => {
          const next = event.relatedTarget;
          if (
            next instanceof Element &&
            (next.closest('[data-testid="relationship-score"]') ||
              next.closest('[data-team-builder-relationship-detail="true"]') ||
              next.closest('.team-builder-relationship-detail-surface'))
          ) {
            return;
          }
          resetTransientInteraction();
        }}
        sx={{
          ...teamBuilderInteractionPolicy,
          p: { xs: 1, sm: 1.5 },
          borderTop: '3px solid',
          borderTopColor: 'secondary.main',
          bgcolor: 'background.paper',
          backgroundImage: `radial-gradient(circle at 85% 0, ${alpha('#a8392f', 0.07)}, transparent 24rem), repeating-linear-gradient(0deg, ${alpha('#1d2421', 0.014)} 0, ${alpha('#1d2421', 0.014)} 1px, transparent 1px, transparent 5px)`,
        }}
      >
        <Stack
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
            bgcolor: selected ? 'background.paper' : 'transparent',
          }}
        >
          <Stack
            data-testid="formation-workbench-header"
            direction="row"
            alignItems="center"
            spacing={1}
            useFlexGap
            flexWrap="wrap"
          >
            <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
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
            {actions && (
              <Box sx={{ ml: 'auto', maxWidth: '100%' }}>{actions}</Box>
            )}
          </Stack>
          {selected && (
            <Alert
              severity="info"
              action={
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    setSelected(null);
                    resetTransientInteraction();
                  }}
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
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 2.5fr) minmax(280px, 0.8fr)' },
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
                data-testid={`team-card-${teamIndex}`}
                data-team-builder-trio-preview-context={
                  heroTrioPreviews.has(teamIndex) ? 'true' : undefined
                }
                sx={{
                  position: 'relative',
                  p: { xs: 1, sm: 1.25 },
                  borderLeft: '4px solid',
                  borderLeftColor: teamAccent[teamIndex],
                  bgcolor: alpha('#fbf8ef', 0.94),
                }}
              >
                <Stack
                  data-testid={`team-summary-${teamIndex}`}
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                  gap={1}
                  sx={{ mb: 0.5 }}
                >
                  <Box
                    sx={{
                      position: 'relative',
                      flex: '1 1 auto',
                      minWidth: 0,
                      minHeight: PRIMARY_PREVIEW_SURFACE_HEIGHT,
                      pr: '124px',
                    }}
                  >
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
                    <Box
                      data-testid={`team-relationship-score-lane-${teamIndex}`}
                      sx={{
                        position: 'absolute',
                        zIndex: 2,
                        right: 0,
                        bottom: 0,
                        width: 120,
                        height: RELATIONSHIP_RAIL_HEIGHT,
                        pointerEvents: 'none',
                      }}
                    >
                      <RelationshipAggregateScore
                        aggregate={heroTrioPreviews.get(teamIndex) ?? null}
                        onFocus={retainActiveFocus}
                      />
                    </Box>
                  </Box>
                  <Box
                    data-testid={`formation-sidecar-${teamIndex}`}
                    sx={{
                      width: { xs: '100%', sm: 'min(360px, 50%)' },
                      minWidth: { sm: 132 },
                      height: PRIMARY_PREVIEW_SURFACE_HEIGHT,
                      minHeight: PRIMARY_PREVIEW_SURFACE_HEIGHT,
                    }}
                  >
                    <FormControl
                      data-testid={`formation-control-${teamIndex}`}
                      size="small"
                      sx={{
                        minWidth: 132,
                        width: '100%',
                        height: PRIMARY_PREVIEW_SURFACE_HEIGHT,
                        minHeight: PRIMARY_PREVIEW_SURFACE_HEIGHT,
                      }}
                    >
                      <InputLabel
                        id={`formation-label-${teamIndex}`}
                        data-testid={`formation-label-${teamIndex}`}
                      >
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
                        sx={{ height: '100%' }}
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
                  </Box>
                </Stack>

                <Typography
                  id={`team-scroll-hint-${teamIndex}`}
                  variant="caption"
                  color="text.secondary"
                  data-testid="team-scroll-hint"
                  sx={{ display: { xs: 'block', xl: 'none' }, mb: 0.5 }}
                >
                  左右滑动查看第 3 名武将
                </Typography>
                <Box
                  role="region"
                  aria-label={`队伍 ${teamIndex + 1} 武将配置`}
                  tabIndex={0}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(3, minmax(${HERO_ASSIGNMENT_CARD_MIN_WIDTH}px, 1fr))`,
                    gap: 0.75,
                    overflowX: 'auto',
                    pb: 0.5,
                    scrollSnapType: 'x proximity',
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
                      activeDragTarget={dragTarget}
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
        {dragged ? <DragPreviewCard item={dragged} /> : null}
      </DragOverlay>
      </HighlightPreviewContext.Provider>
    </TeamBuilderDragDropProvider>
  );
};

export default FormationWorkbench;
