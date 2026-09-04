import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Groups2OutlinedIcon from '@mui/icons-material/Groups2Outlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { useNavigate } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import PageIntro from '../components/common/PageIntro';
import { useGame } from '../context/GameContext';
import { recommendationData } from '../data';
import {
  ROSTER_RELATIONSHIP_LABELS,
  buildRosterRelationshipEdges,
  formatRosterRelationshipWeight,
  maxRosterRelationshipMagnitude,
  rosterRelationshipNodeKey,
  rosterRelationshipOtherNodeKey,
  rosterRelationshipsForNode,
  type RosterRelationshipEdge,
  type RosterRelationshipLimit,
  type RosterRelationshipNode,
} from '../services/rosterRelationships';

interface RelationshipCardProps {
  node: RosterRelationshipNode;
  nodesByKey: ReadonlyMap<string, RosterRelationshipNode>;
  edges: readonly RosterRelationshipEdge[];
  limit: RosterRelationshipLimit;
  maxMagnitude: number;
  supportItems: ReadonlySet<string>;
}

const RelationshipList = ({
  node,
  nodesByKey,
  edges,
  limit,
  maxMagnitude,
}: Omit<RelationshipCardProps, 'supportItems'>) => {
  const allRelationships = rosterRelationshipsForNode(
    edges,
    node.key,
    'all'
  );
  const relationships = rosterRelationshipsForNode(
    edges,
    node.key,
    limit
  );
  const hiddenCount = allRelationships.length - relationships.length;

  return (
    <Box data-testid={`relationship-list-${node.key}`} sx={{ minWidth: 0 }}>
      {relationships.length === 0 ? (
        <Box
          sx={{
            minHeight: 88,
            display: 'grid',
            placeItems: 'center',
            px: 2,
            py: 2,
            textAlign: 'center',
            color: 'text.secondary',
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="body2" sx={{ maxWidth: 360 }}>
            当前阵容中暂时没有足够战报支持的搭配关系。随着你继续选择，新的关系可能会在这里出现。
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {relationships.map((edge) => {
            const otherNode = nodesByKey.get(
              rosterRelationshipOtherNodeKey(edge, node.key)
            );
            const value = maxMagnitude
              ? (Math.abs(edge.weight) / maxMagnitude) * 100
              : 0;

            return (
              <Box
                key={edge.featureId}
                data-relationship-row="true"
                sx={{ minWidth: 0 }}
              >
                <Stack
                  direction="row"
                  alignItems="baseline"
                  justifyContent="space-between"
                  spacing={1}
                  sx={{ mb: 0.5 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      noWrap
                      title={otherNode?.name}
                      sx={{ fontWeight: 800 }}
                    >
                      {otherNode?.name ?? '未知条目'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {ROSTER_RELATIONSHIP_LABELS[edge.family]} · 参考 {edge.support} 场
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{
                      flexShrink: 0,
                      color: 'success.dark',
                      fontWeight: 900,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatRosterRelationshipWeight(edge.weight)}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={value}
                  aria-label={`${otherNode?.name ?? '未知条目'}关系强度`}
                  sx={{
                    height: 7,
                    bgcolor: 'action.selected',
                    '& .MuiLinearProgress-bar': { bgcolor: '#456c5f' },
                  }}
                />
              </Box>
            );
          })}
        </Stack>
      )}

      {hiddenCount > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1.25 }}
        >
          另有 {hiddenCount} 条，可在上方增加显示数量
        </Typography>
      )}
    </Box>
  );
};

const RelationshipCard = ({
  node,
  nodesByKey,
  edges,
  limit,
  maxMagnitude,
  supportItems,
}: RelationshipCardProps) => (
  <Paper
    component="article"
    variant="outlined"
    data-testid={`relationship-card-${node.kind}-${node.name}`}
    sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }}
  >
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ mb: 2, minWidth: 0 }}
    >
      <Box
        aria-hidden="true"
        sx={{
          width: 38,
          height: 38,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          color: node.kind === 'hero' ? 'primary.dark' : 'warning.dark',
          bgcolor: node.kind === 'hero' ? 'primary.light' : 'warning.light',
          borderRadius: '50%',
        }}
      >
        {node.kind === 'hero' ? <PersonOutlineIcon /> : <AccountTreeOutlinedIcon />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography component="h3" variant="h6" noWrap title={node.name}>
          {node.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {node.kind === 'hero' ? '已选武将' : '已选战法'}
        </Typography>
      </Box>
      {supportItems.has(node.name) && (
        <Chip label="助战" size="small" variant="outlined" />
      )}
    </Stack>

    <RelationshipList
      node={node}
      nodesByKey={nodesByKey}
      edges={edges}
      limit={limit}
      maxMagnitude={maxMagnitude}
    />
  </Paper>
);

const TeamBuilder = () => {
  const navigate = useNavigate();
  const { state } = useGame();
  const { gameState } = state;
  const [limit, setLimit] = useState<RosterRelationshipLimit>(3);

  const heroNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...(gameState?.current_heroes ?? []),
          ...(gameState?.support_hero ? [gameState.support_hero] : []),
        ])
      ),
    [gameState?.current_heroes, gameState?.support_hero]
  );
  const skillNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...(gameState?.current_skills ?? []),
          ...(gameState?.support_skills ?? []),
        ])
      ),
    [gameState?.current_skills, gameState?.support_skills]
  );
  const heroNodes = useMemo<RosterRelationshipNode[]>(
    () =>
      heroNames.map((name) => ({
        key: rosterRelationshipNodeKey('hero', name),
        name,
        kind: 'hero',
      })),
    [heroNames]
  );
  const skillNodes = useMemo<RosterRelationshipNode[]>(
    () =>
      skillNames.map((name) => ({
        key: rosterRelationshipNodeKey('skill', name),
        name,
        kind: 'skill',
      })),
    [skillNames]
  );
  const nodes = useMemo(
    () => [...heroNodes, ...skillNodes],
    [heroNodes, skillNodes]
  );
  const nodesByKey = useMemo(
    () => new Map(nodes.map((node) => [node.key, node])),
    [nodes]
  );
  const supportItems = useMemo(
    () =>
      new Set([
        ...(gameState?.support_hero ? [gameState.support_hero] : []),
        ...(gameState?.support_skills ?? []),
      ]),
    [gameState?.support_hero, gameState?.support_skills]
  );
  const edges = useMemo(
    () => buildRosterRelationshipEdges(nodes, recommendationData.model),
    [nodes]
  );
  const maxMagnitude = useMemo(
    () => maxRosterRelationshipMagnitude(edges),
    [edges]
  );

  const goBack = () => navigate('/');

  return (
    <Box data-testid="current-roster-relationships">
      <PageIntro
        eyebrow="TEAM BUILDER · 关系参考"
        title="当前阵容关系"
        description="查看你已经选中的武将和战法之间，有足够战报证据支持的搭配关系。"
        actions={
          <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={goBack}>
            返回对局选择
          </Button>
        }
      />

      <Alert severity="info" sx={{ mb: { xs: 3, sm: 4 }, alignItems: 'flex-start' }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 850 }}>
          旧版队伍推荐已暂停
        </Typography>
        <Typography variant="body2" color="inherit">
          旧版功能给出的配队建议不够可靠，因此我们先将它取消。等找到更好的方法后，未来可能重新开放真正的队伍推荐；现在这里只展示你已选武将和战法之间的关系，供你自行判断，不会自动配队。
        </Typography>
      </Alert>

      {!gameState || nodes.length === 0 ? (
        <EmptyState
          id="empty-roster-relationships-title"
          icon={<Groups2OutlinedIcon />}
          title="还没有已选阵容"
          description="先开始一局并选择武将或战法，这里会自动显示当前阵容中的关系。"
          action={
            <Button variant="contained" onClick={goBack}>
              开始选择
            </Button>
          }
        />
      ) : (
        <Stack spacing={{ xs: 4, sm: 5 }}>
          <Paper
            component="section"
            variant="outlined"
            sx={{ p: { xs: 2, sm: 2.5 } }}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              justifyContent="space-between"
              spacing={2}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
                  已选 {heroNodes.length} 名武将 · {skillNodes.length} 个战法
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  进度条使用同一刻度；越长代表搭配关联越强，不代表胜率。
                </Typography>
              </Box>
              <Stack spacing={0.75}>
                <Typography variant="caption" color="text.secondary">
                  每项显示数量
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={limit}
                  aria-label="每项显示关系数量"
                  onChange={(_event, value: RosterRelationshipLimit | null) => {
                    if (value !== null) setLimit(value);
                  }}
                >
                  <ToggleButton value={3}>3 条</ToggleButton>
                  <ToggleButton value={5}>5 条</ToggleButton>
                  <ToggleButton value="all">全部</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
            </Stack>
          </Paper>

          {heroNodes.length > 0 && (
            <Box component="section" aria-labelledby="selected-heroes-title">
              <Typography id="selected-heroes-title" component="h2" variant="h4" sx={{ mb: 2 }}>
                已选武将
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                {heroNodes.map((node) => (
                  <RelationshipCard
                    key={node.key}
                    node={node}
                    nodesByKey={nodesByKey}
                    edges={edges}
                    limit={limit}
                    maxMagnitude={maxMagnitude}
                    supportItems={supportItems}
                  />
                ))}
              </Box>
            </Box>
          )}

          {skillNodes.length > 0 && (
            <Box component="section" aria-labelledby="selected-skills-title">
              <Typography id="selected-skills-title" component="h2" variant="h4" sx={{ mb: 2 }}>
                已选战法
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                {skillNodes.map((node) => (
                  <RelationshipCard
                    key={node.key}
                    node={node}
                    nodesByKey={nodesByKey}
                    edges={edges}
                    limit={limit}
                    maxMagnitude={maxMagnitude}
                    supportItems={supportItems}
                  />
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      )}
    </Box>
  );
};

export default TeamBuilder;
