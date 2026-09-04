import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import Groups2OutlinedIcon from '@mui/icons-material/Groups2Outlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import { alpha, useTheme } from '@mui/material/styles';
import type { CurrentRoundInputs, RoundType } from '../../types/game';
import type { PairedModel } from '../../types/recommendation';
import {
  buildCandidateRelationshipEdges,
  candidateRelationshipNodeKey,
  CANDIDATE_RELATIONSHIP_LABELS,
  formatCandidateRelationshipWeight,
  selectCandidateRelationshipEdges,
  type CandidateRelationshipEdge,
  type CandidateRelationshipMode,
  type CandidateRelationshipNode,
} from '../../services/candidateRelationships';

interface CandidateRelationshipGraphProps {
  sets: CurrentRoundInputs;
  roundType: RoundType;
  currentHeroes: readonly string[];
  currentSkills: readonly string[];
  model: PairedModel;
}

interface PositionedNode extends CandidateRelationshipNode {
  x: number;
  y: number;
  focus: boolean;
  shared: boolean;
}

const FOCUS_LIMIT = 4;
const GRAPH_WIDTH = 760;
const GRAPH_HEIGHT = 460;
const FOCUS_X = GRAPH_WIDTH / 2;
const LEFT_X = 92;
const RIGHT_X = GRAPH_WIDTH - LEFT_X;
const NODE_HALF_WIDTH = 44;
const NODE_HALF_HEIGHT = 28;
const HERO_RADIUS = 36;
const DRAG_MIME = 'application/x-sanmou-relationship-node';

const unique = (items: readonly string[]): string[] => [...new Set(items)];

const optionItems = (sets: CurrentRoundInputs): string[] =>
  unique([...(sets.set1 ?? []), ...(sets.set2 ?? []), ...(sets.set3 ?? [])]);

const initialFocus = (
  sets: CurrentRoundInputs,
  roundType: RoundType
): string[] => {
  const crossOptionItems = [sets.set1?.[0], sets.set2?.[0]].filter(
    (item): item is string => Boolean(item)
  );
  const fallback = optionItems(sets);
  return unique([...crossOptionItems, ...fallback])
    .slice(0, 2)
    .map((name) => candidateRelationshipNodeKey(roundType, name));
};

const graphNodes = (
  sets: CurrentRoundInputs,
  roundType: RoundType,
  currentHeroes: readonly string[],
  currentSkills: readonly string[]
): CandidateRelationshipNode[] => {
  const result = new Map<string, CandidateRelationshipNode>();
  const add = (
    names: readonly string[],
    kind: CandidateRelationshipNode['kind'],
    source: CandidateRelationshipNode['source']
  ) => {
    unique(names).forEach((name) => {
      const key = candidateRelationshipNodeKey(kind, name);
      result.set(key, { key, name, kind, source });
    });
  };

  add(currentHeroes, 'hero', 'pool');
  add(currentSkills, 'skill', 'pool');
  add(optionItems(sets), roundType, 'candidate');
  return [...result.values()];
};

const edgeTouches = (edge: CandidateRelationshipEdge, key: string): boolean =>
  edge.sourceKey === key || edge.targetKey === key;

const otherNodeKey = (
  edge: CandidateRelationshipEdge,
  key: string
): string => (edge.sourceKey === key ? edge.targetKey : edge.sourceKey);

const distribute = <T extends { desiredY: number }>(items: T[]): Map<T, number> => {
  const result = new Map<T, number>();
  const sorted = [...items].sort((left, right) => left.desiredY - right.desiredY);
  const top = 54;
  const bottom = GRAPH_HEIGHT - 54;
  sorted.forEach((item, index) => {
    result.set(
      item,
      sorted.length === 1
        ? GRAPH_HEIGHT / 2
        : top + index * ((bottom - top) / (sorted.length - 1))
    );
  });
  return result;
};

const layoutNodes = (
  nodes: readonly CandidateRelationshipNode[],
  edges: readonly CandidateRelationshipEdge[],
  focusKeys: readonly string[]
): PositionedNode[] => {
  const nodesByKey = new Map(nodes.map((node) => [node.key, node]));
  const focus = new Set(focusKeys);
  const focusPositions = new Map<string, { x: number; y: number }>();
  const top = 66;
  const bottom = GRAPH_HEIGHT - 66;
  focusKeys.forEach((key, index) => {
    focusPositions.set(key, {
      x: FOCUS_X,
      y:
        focusKeys.length === 1
          ? GRAPH_HEIGHT / 2
          : top + index * ((bottom - top) / (focusKeys.length - 1)),
    });
  });

  const externalKeys = unique(
    edges
      .flatMap((edge) => [edge.sourceKey, edge.targetKey])
      .filter((key) => !focus.has(key))
  );
  const external = externalKeys.flatMap((key) => {
    const node = nodesByKey.get(key);
    if (!node) return [];
    const connected = edges.filter(
      (edge) => edgeTouches(edge, key) && focus.has(otherNodeKey(edge, key))
    );
    if (!connected.length) return [];
    const desiredY =
      connected.reduce(
        (total, edge) =>
          total + (focusPositions.get(otherNodeKey(edge, key))?.y ?? GRAPH_HEIGHT / 2),
        0
      ) / connected.length;
    const averageWeight =
      connected.reduce((total, edge) => total + edge.weight, 0) /
      connected.length;
    return [
      {
        node,
        desiredY,
        positive: averageWeight >= 0,
        shared: connected.length >= 2,
      },
    ];
  });

  const positive = external.filter((entry) => entry.positive);
  const negative = external.filter((entry) => !entry.positive);
  const positiveY = distribute(positive);
  const negativeY = distribute(negative);

  const positionedFocus = focusKeys.flatMap((key) => {
    const node = nodesByKey.get(key);
    const position = focusPositions.get(key);
    return node && position
      ? [{ ...node, ...position, focus: true, shared: false }]
      : [];
  });
  const positionedExternal = external.map((entry) => ({
    ...entry.node,
    x: entry.positive ? RIGHT_X : LEFT_X,
    y: (entry.positive ? positiveY : negativeY).get(entry) ?? GRAPH_HEIGHT / 2,
    focus: false,
    shared: entry.shared,
  }));
  return [...positionedFocus, ...positionedExternal];
};

const edgePath = (
  start: PositionedNode,
  end: PositionedNode,
  internal: boolean,
  index: number
): string => {
  if (internal) {
    const bend = index % 2 === 0 ? 38 : -38;
    return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y + 36}, ${end.x + bend} ${end.y - 36}, ${end.x} ${end.y}`;
  }
  const direction = end.x > start.x ? 1 : -1;
  const control = Math.max(70, Math.abs(end.x - start.x) * 0.46);
  return `M ${start.x} ${start.y} C ${start.x + direction * control} ${start.y}, ${end.x - direction * control} ${end.y}, ${end.x} ${end.y}`;
};

const labelPosition = (
  start: PositionedNode,
  end: PositionedNode,
  internal: boolean,
  index: number
): { x: number; y: number } => ({
  x: internal
    ? start.x + (index % 2 === 0 ? 34 : -34)
    : (start.x + end.x) / 2,
  y: (start.y + end.y) / 2,
});

const CandidateRelationshipGraph = ({
  sets,
  roundType,
  currentHeroes,
  currentSkills,
  model,
}: CandidateRelationshipGraphProps) => {
  const theme = useTheme();
  const nodes = useMemo(
    () => graphNodes(sets, roundType, currentHeroes, currentSkills),
    [sets, roundType, currentHeroes, currentSkills]
  );
  const nodesByKey = useMemo(
    () => new Map(nodes.map((node) => [node.key, node])),
    [nodes]
  );
  const edges = useMemo(
    () => buildCandidateRelationshipEdges(nodes, model),
    [nodes, model]
  );
  const scopeKey = useMemo(
    () =>
      `${roundType}:${optionItems(sets).join('|')}:${currentHeroes.join('|')}:${currentSkills.join('|')}`,
    [sets, roundType, currentHeroes, currentSkills]
  );
  const defaultFocus = useMemo(
    () => initialFocus(sets, roundType),
    [sets, roundType]
  );
  const previousScopeRef = useRef(scopeKey);
  const [focusKeys, setFocusKeys] = useState<string[]>(defaultFocus);
  const [mode, setMode] = useState<CandidateRelationshipMode>('compact');
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(
    defaultFocus.length
      ? '已从不同候选组各取一个起始焦点，可继续拖入或点按添加。'
      : '从候选集或当前阵容添加一个武将或战法。'
  );

  useEffect(() => {
    if (previousScopeRef.current === scopeKey) return;
    previousScopeRef.current = scopeKey;
    setFocusKeys(defaultFocus);
    setInspectedKey(null);
    setMode('compact');
    setStatus(
      defaultFocus.length
        ? '候选或阵容已更新，关系图已载入新的起始焦点。'
        : '从候选集或当前阵容添加一个武将或战法。'
    );
  }, [defaultFocus, scopeKey]);

  const focusSet = useMemo(() => new Set(focusKeys), [focusKeys]);
  const visibleEdges = useMemo(
    () => selectCandidateRelationshipEdges(edges, focusKeys, mode),
    [edges, focusKeys, mode]
  );
  const positionedNodes = useMemo(
    () => layoutNodes(nodes, visibleEdges, focusKeys),
    [nodes, visibleEdges, focusKeys]
  );
  const positionsByKey = useMemo(
    () => new Map(positionedNodes.map((node) => [node.key, node])),
    [positionedNodes]
  );
  const candidateNodes = nodes.filter((node) => node.source === 'candidate');
  const poolNodes = nodes.filter((node) => node.source === 'pool');

  const addFocus = (key: string) => {
    const node = nodesByKey.get(key);
    if (!node || focusSet.has(key)) return;
    if (focusKeys.length >= FOCUS_LIMIT) {
      setStatus(`最多同时聚焦 ${FOCUS_LIMIT} 个节点，请先移除一个。`);
      return;
    }
    setFocusKeys((current) => [...current, key]);
    setInspectedKey(null);
    setStatus(`已添加${node.name}，现在同时比较 ${focusKeys.length + 1} 个焦点。`);
  };

  const removeFocus = (key: string) => {
    const node = nodesByKey.get(key);
    setFocusKeys((current) => current.filter((candidate) => candidate !== key));
    setInspectedKey((current) => (current === key ? null : current));
    if (node) setStatus(`已移除${node.name}。`);
  };

  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    node: CandidateRelationshipNode
  ) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(DRAG_MIME, node.key);
    event.dataTransfer.setData('text/plain', node.key);
    setStatus(`正在拖动${node.name}，放到聚焦区即可添加。`);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    addFocus(
      event.dataTransfer.getData(DRAG_MIME) ||
        event.dataTransfer.getData('text/plain')
    );
  };

  const edgeDescription = (edge: CandidateRelationshipEdge): string => {
    const source = nodesByKey.get(edge.sourceKey);
    const target = nodesByKey.get(edge.targetKey);
    const names = `${source?.name ?? edge.sourceKey}与${target?.name ?? edge.targetKey}`;
    const meaning =
      edge.family === 'HP'
        ? `${names}同队`
        : `${names}形成武将直接携带战法关系`;
    return `${meaning}，影响评分 ${formatCandidateRelationshipWeight(edge.weight)}，参考 ${edge.support} 场`;
  };

  const renderPalette = (
    title: string,
    paletteNodes: readonly CandidateRelationshipNode[]
  ) => (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        {paletteNodes.map((node) => {
          const selected = focusSet.has(node.key);
          return (
            <Button
              key={node.key}
              type="button"
              size="small"
              variant={selected ? 'contained' : 'outlined'}
              color={node.kind === 'hero' ? 'primary' : 'secondary'}
              aria-pressed={selected}
              draggable={!selected}
              onDragStart={(event) => handleDragStart(event, node)}
              onClick={() => addFocus(node.key)}
              startIcon={
                node.kind === 'hero' ? (
                  <PersonOutlineIcon />
                ) : (
                  <AutoAwesomeOutlinedIcon />
                )
              }
              endIcon={!selected ? <AddCircleOutlineIcon /> : undefined}
              sx={{ minHeight: 40 }}
            >
              {node.name}
            </Button>
          );
        })}
      </Stack>
    </Box>
  );

  const positiveColor =
    theme.palette.mode === 'dark'
      ? theme.palette.success.light
      : theme.palette.success.dark;
  const negativeColor =
    theme.palette.mode === 'dark'
      ? theme.palette.error.light
      : theme.palette.error.dark;

  return (
    <Box
      component="section"
      aria-labelledby="candidate-relationship-title"
      data-testid="candidate-relationship-workbench"
      sx={{ mt: 4 }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 1.5,
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="overline" color="error.main">
            自己查看关系，不自动配队
          </Typography>
          <Typography id="candidate-relationship-title" component="h2" variant="h5">
            多点关系图
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            同时聚焦 1–4 个武将或战法。数值表示对阵容评分的相对影响，不是胜率。
          </Typography>
        </Box>
        <Chip label={`最多 ${FOCUS_LIMIT} 个焦点`} color="primary" variant="outlined" />
      </Box>

      <Stack spacing={3}>
        {renderPalette(roundType === 'hero' ? '候选武将' : '候选战法', candidateNodes)}
        {poolNodes.length > 0 && renderPalette('当前阵容', poolNodes)}

        <Paper
          variant="outlined"
          data-testid="relationship-focus-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragOver(false);
            }
          }}
          onDrop={handleDrop}
          sx={{
            p: { xs: 2, sm: 3 },
            borderStyle: 'dashed',
            borderWidth: 2,
            borderColor: dragOver ? 'secondary.main' : 'divider',
            bgcolor: dragOver ? alpha(theme.palette.secondary.main, 0.08) : 'background.paper',
            transition: theme.transitions.create(['border-color', 'background-color']),
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: { xs: 'flex-start', sm: 'center' },
              justifyContent: 'space-between',
              flexDirection: { xs: 'column', sm: 'row' },
              gap: 1,
              mb: 2,
            }}
          >
            <Box>
              <Typography component="h3" variant="h6">
                聚焦区
              </Typography>
              <Typography variant="body2" color="text.secondary">
                拖到这里，或直接点按上方节点。点焦点名称可临时强调它的关系。
              </Typography>
            </Box>
            <Chip
              label={`${focusKeys.length} / ${FOCUS_LIMIT}`}
              color={focusKeys.length === FOCUS_LIMIT ? 'secondary' : 'default'}
              size="small"
              data-testid="relationship-focus-count"
            />
          </Box>

          {focusKeys.length ? (
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {focusKeys.map((key) => {
                const node = nodesByKey.get(key);
                if (!node) return null;
                return (
                  <Chip
                    key={key}
                    component="button"
                    clickable
                    color={inspectedKey === key ? 'primary' : 'default'}
                    variant={inspectedKey === key ? 'filled' : 'outlined'}
                    label={`${node.kind === 'hero' ? '武将' : '战法'} · ${node.name}`}
                    aria-pressed={inspectedKey === key}
                    onClick={() => {
                      setInspectedKey((current) => (current === key ? null : key));
                      setStatus(
                        inspectedKey === key
                          ? '已恢复多点总览。'
                          : `已强调${node.name}的关系，其他焦点仍保留。`
                      );
                    }}
                    onDelete={() => removeFocus(key)}
                    deleteIcon={<span aria-hidden="true">×</span>}
                  />
                );
              })}
            </Stack>
          ) : (
            <Typography color="text.secondary" sx={{ py: 1 }}>
              聚焦区为空，先添加一个武将或战法。
            </Typography>
          )}

          <Typography
            role="status"
            aria-live="polite"
            variant="caption"
            color={status.startsWith('最多') ? 'error.main' : 'text.secondary'}
            sx={{ display: 'block', mt: 2 }}
          >
            {status}
          </Typography>
        </Paper>

        <Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: { xs: 'flex-start', sm: 'center' },
              justifyContent: 'space-between',
              flexDirection: { xs: 'column', sm: 'row' },
              gap: 1.5,
              mb: 2,
            }}
          >
            <Box>
              <Typography component="h3" variant="h6">
                关系权重
              </Typography>
              <Typography variant="body2" color="text.secondary">
                右侧是正向关系，左侧是负向关系；共同相关节点用金色描边。
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <ToggleButtonGroup
                value={mode}
                exclusive
                size="small"
                aria-label="关系显示密度"
                onChange={(_event, value: CandidateRelationshipMode | null) => {
                  if (!value) return;
                  setMode(value);
                  setStatus(
                    value === 'compact'
                      ? '只显示每个焦点最重要的关系和共同相关节点。'
                      : '已显示全部达到证据门槛的关系。'
                  );
                }}
              >
                <ToggleButton value="compact">关键关系</ToggleButton>
                <ToggleButton value="all">全部关系</ToggleButton>
              </ToggleButtonGroup>
              <Tooltip title="恢复本轮的两个起始焦点">
                <Button
                  type="button"
                  size="small"
                  variant="text"
                  startIcon={<RestartAltOutlinedIcon />}
                  onClick={() => {
                    setFocusKeys(defaultFocus);
                    setInspectedKey(null);
                    setMode('compact');
                    setStatus('已恢复本轮的两个起始焦点。');
                  }}
                >
                  恢复
                </Button>
              </Tooltip>
            </Stack>
          </Box>

          <Box
            data-testid="relationship-graph-desktop"
            sx={{ display: { xs: 'none', md: 'block' }, minHeight: GRAPH_HEIGHT }}
          >
            {focusKeys.length ? (
              <Box
                component="svg"
                role="img"
                aria-labelledby="candidate-graph-svg-title candidate-graph-svg-description"
                viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                sx={{ display: 'block', width: '100%', maxWidth: GRAPH_WIDTH, mx: 'auto' }}
              >
                <title id="candidate-graph-svg-title">候选与当前阵容的多点关系图</title>
                <desc id="candidate-graph-svg-description">
                  中间是当前焦点，右侧是正向关系，左侧是负向关系。实线代表正向，虚线代表负向。
                </desc>
                <rect
                  x={FOCUS_X - 42}
                  y="18"
                  width="84"
                  height={GRAPH_HEIGHT - 36}
                  rx="28"
                  fill={alpha(theme.palette.primary.main, 0.055)}
                />
                {visibleEdges.map((edge, index) => {
                  const source = positionsByKey.get(edge.sourceKey);
                  const target = positionsByKey.get(edge.targetKey);
                  if (!source || !target) return null;
                  const internal = source.focus && target.focus;
                  const isMuted = Boolean(
                    inspectedKey && !edgeTouches(edge, inspectedKey)
                  );
                  const label = `${edge.family === 'HP' ? '同队' : '携带'} ${formatCandidateRelationshipWeight(edge.weight)}`;
                  const labelAt = labelPosition(source, target, internal, index);
                  const labelWidth = Math.max(66, label.length * 12 + 16);
                  return (
                    <g key={edge.featureId} opacity={isMuted ? 0.14 : 1}>
                      <path
                        d={edgePath(source, target, internal, index)}
                        fill="none"
                        stroke={edge.weight >= 0 ? positiveColor : negativeColor}
                        strokeWidth={Math.min(4, 1.4 + Math.abs(edge.weight) * 6)}
                        strokeDasharray={edge.weight < 0 ? '6 5' : undefined}
                        strokeLinecap="round"
                      >
                        <title>{edgeDescription(edge)}</title>
                      </path>
                      <rect
                        x={labelAt.x - labelWidth / 2}
                        y={labelAt.y - 12}
                        width={labelWidth}
                        height="24"
                        rx="12"
                        fill={theme.palette.background.paper}
                        opacity="0.94"
                      />
                      <text
                        x={labelAt.x}
                        y={labelAt.y + 4}
                        textAnchor="middle"
                        fill={edge.weight >= 0 ? positiveColor : negativeColor}
                        fontSize="12"
                        fontWeight="700"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
                {positionedNodes.map((node) => {
                  const connectedToInspected =
                    !inspectedKey ||
                    node.key === inspectedKey ||
                    visibleEdges.some(
                      (edge) =>
                        edgeTouches(edge, inspectedKey) && edgeTouches(edge, node.key)
                    );
                  const fill = node.focus
                    ? theme.palette.primary.main
                    : node.kind === 'hero'
                      ? alpha(theme.palette.primary.main, 0.14)
                      : alpha(theme.palette.secondary.main, 0.18);
                  const stroke = node.shared
                    ? theme.palette.secondary.dark
                    : node.focus
                      ? theme.palette.primary.dark
                      : node.kind === 'hero'
                        ? theme.palette.primary.main
                        : theme.palette.secondary.main;
                  const textColor = node.focus
                    ? theme.palette.primary.contrastText
                    : theme.palette.text.primary;
                  return (
                    <g key={node.key} opacity={connectedToInspected ? 1 : 0.14}>
                      {node.shared && (
                        <text
                          x={node.x}
                          y={node.y - 46}
                          textAnchor="middle"
                          fill={theme.palette.text.secondary}
                          fontSize="11"
                        >
                          共同相关
                        </text>
                      )}
                      {node.kind === 'hero' ? (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={HERO_RADIUS}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={node.shared ? 3 : 1.5}
                        />
                      ) : (
                        <rect
                          x={node.x - NODE_HALF_WIDTH}
                          y={node.y - NODE_HALF_HEIGHT}
                          width={NODE_HALF_WIDTH * 2}
                          height={NODE_HALF_HEIGHT * 2}
                          rx="14"
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={node.shared ? 3 : 1.5}
                        />
                      )}
                      <title>
                        {node.focus ? '焦点' : node.source === 'candidate' ? '候选' : '当前阵容'}：
                        {node.name}（{node.kind === 'hero' ? '武将' : '战法'}）
                      </title>
                      <text
                        x={node.x}
                        y={node.y - 1}
                        textAnchor="middle"
                        fill={textColor}
                        fontSize="13"
                        fontWeight="700"
                      >
                        {node.name}
                      </text>
                      <text
                        x={node.x}
                        y={node.y + 16}
                        textAnchor="middle"
                        fill={node.focus ? alpha(textColor, 0.78) : theme.palette.text.secondary}
                        fontSize="11"
                      >
                        {node.focus ? '焦点' : node.kind === 'hero' ? '武将' : '战法'}
                      </text>
                    </g>
                  );
                })}
              </Box>
            ) : (
              <Alert severity="info">添加焦点后，这里会显示关系权重。</Alert>
            )}
          </Box>

          <Stack
            data-testid="relationship-graph-mobile"
            spacing={3}
            sx={{ display: { xs: 'flex', md: 'none' } }}
          >
            {focusKeys.length ? (
              focusKeys.map((key) => {
                const node = nodesByKey.get(key);
                if (!node) return null;
                const relationships = visibleEdges
                  .filter((edge) => edgeTouches(edge, key))
                  .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight));
                return (
                  <Box key={key}>
                    <Typography component="h4" variant="subtitle1" sx={{ mb: 1 }}>
                      {node.name}
                    </Typography>
                    {relationships.length ? (
                      <Stack spacing={1}>
                        {relationships.map((edge) => {
                          const target = nodesByKey.get(otherNodeKey(edge, key));
                          return (
                            <Box
                              key={edge.featureId}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 2,
                              }}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2">
                                  {target?.name ?? '未知节点'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {CANDIDATE_RELATIONSHIP_LABELS[edge.family]} · 参考 {edge.support} 场
                                </Typography>
                              </Box>
                              <Typography
                                variant="body2"
                                color={edge.weight >= 0 ? positiveColor : negativeColor}
                                sx={{ flexShrink: 0, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}
                              >
                                {formatCandidateRelationshipWeight(edge.weight)}
                              </Typography>
                            </Box>
                          );
                        })}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        没有达到展示门槛的直接关系。
                      </Typography>
                    )}
                  </Box>
                );
              })
            ) : (
              <Alert severity="info">添加焦点后，这里会按焦点列出关系。</Alert>
            )}
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
            <Chip icon={<Groups2OutlinedIcon />} label="同队：两名武将直接搭配" size="small" />
            <Chip icon={<LinkOutlinedIcon />} label="携带：武将直接携带战法" size="small" />
            <Chip label="实线＋正向 / 虚线−负向" size="small" />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            没有连线表示该直接关系缺少足够战报证据或未达到展示门槛，不代表权重为 0。
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
};

export default CandidateRelationshipGraph;
