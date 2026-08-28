import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import { formatSignedWeight } from '../../services/featureLabels';
import type {
  AnalyticsRelationshipFamily,
  AnalyticsRelationshipRanking,
  AnalyticsRelationshipRankings,
} from '../../services/recommendationEngine';

type RelationshipGroup = 'heroes' | 'skills' | 'special';

export const RELATIONSHIP_PAGE_SIZE = 40;

interface RelationshipMode {
  family: AnalyticsRelationshipFamily;
  label: string;
  emptyLabel: string;
  description: string;
}

interface RelationshipGroupOption {
  value: RelationshipGroup;
  label: string;
  modes: readonly RelationshipMode[];
}

const RELATIONSHIP_GROUPS: readonly RelationshipGroupOption[] = [
  {
    value: 'heroes',
    label: '武将搭配',
    modes: [
      {
        family: 'HP',
        label: '两人同队',
        emptyLabel: '两人同队关系',
        description: '展示两名武将同队时的额外组合分。',
      },
      {
        family: 'HT',
        label: '三人同队',
        emptyLabel: '三人同队关系',
        description: '展示完整三人队伍中三名确切武将共同出现时的额外组合分。',
      },
    ],
  },
  {
    value: 'skills',
    label: '战法搭配',
    modes: [
      {
        family: 'HS',
        label: '自己携带',
        emptyLabel: '武将自己携带战法关系',
        description: '展示某名武将自己携带某个战法时的额外组合分。',
      },
      {
        family: 'THS',
        label: '队内战法',
        emptyLabel: '武将队内存在战法关系',
        description:
          '展示某名武将的确切三人队伍内存在某个战法时的额外组合分；该战法也可以由这名武将自己携带。',
      },
    ],
  },
  {
    value: 'special',
    label: '特殊加成',
    modes: [
      {
        family: 'B',
        label: '缘分',
        emptyLabel: '缘分关系',
        description: '展示目录中的缘分、激活所需人数和所有可参与成员。',
      },
      {
        family: 'M',
        label: '机制联动',
        emptyLabel: '机制联动关系',
        description:
          '展示目录中的汇总机制关系。组合分属于整个机制、联动方式和作用侧，不属于任何一对具体战法。',
      },
    ],
  },
];

const MODE_BY_FAMILY = new Map(
  RELATIONSHIP_GROUPS.flatMap((group) =>
    group.modes.map((mode) => [mode.family, mode] as const)
  )
);

const groupForFamily = (
  family: AnalyticsRelationshipFamily
): RelationshipGroupOption =>
  RELATIONSHIP_GROUPS.find((group) =>
    group.modes.some((mode) => mode.family === family)
  ) ?? RELATIONSHIP_GROUPS[0];

/** Apply only identity filters that have a precise meaning for the active family. */
export function filterRelationshipRankings(
  rows: readonly AnalyticsRelationshipRanking[],
  family: AnalyticsRelationshipFamily,
  selectedHeroes: readonly string[],
  selectedSkills: readonly string[]
): AnalyticsRelationshipRanking[] {
  const heroes = new Set(selectedHeroes);
  const skills = new Set(selectedSkills);
  const matchesHero = (row: AnalyticsRelationshipRanking): boolean =>
    row.heroes.some((hero) => heroes.has(hero));
  const matchesSkill = (row: AnalyticsRelationshipRanking): boolean =>
    row.skills.some((skill) => skills.has(skill));

  if (family === 'M') return [...rows];
  if (family === 'HP' || family === 'HT' || family === 'B') {
    return heroes.size > 0 ? rows.filter(matchesHero) : [...rows];
  }
  if (heroes.size === 0 && skills.size === 0) return [...rows];
  return rows.filter(
    (row) =>
      (heroes.size > 0 && matchesHero(row)) ||
      (skills.size > 0 && matchesSkill(row))
  );
}

const filterStatus = (
  family: AnalyticsRelationshipFamily,
  selectedHeroes: readonly string[],
  selectedSkills: readonly string[],
  visibleCount: number,
  matchingCount: number,
  familyTotal: number
): string => {
  const hasHeroes = selectedHeroes.length > 0;
  const hasSkills = selectedSkills.length > 0;
  const visibleSummary = `当前显示 ${visibleCount} / ${matchingCount}`;
  if (family === 'M') {
    return hasHeroes || hasSkills
      ? `机制联动是汇总机制关系，武将和战法筛选不适用于此榜，未应用；${visibleSummary}。`
      : `${visibleSummary}。`;
  }
  if (family === 'HP' || family === 'HT' || family === 'B') {
    if (hasHeroes) {
      return `所选武将匹配 ${matchingCount} / ${familyTotal} 条全榜关系；${visibleSummary} 条匹配结果，排名保留全榜名次${hasSkills ? '；已选战法不用于此关系类型' : ''}。`;
    }
    return hasSkills
      ? `战法筛选不适用于此关系类型，未应用；${visibleSummary}。`
      : `${visibleSummary}。`;
  }
  return hasHeroes || hasSkills
    ? `所选武将或战法匹配 ${matchingCount} / ${familyTotal} 条全榜关系；${visibleSummary} 条匹配结果，排名保留全榜名次。`
    : `${visibleSummary}。`;
};

const HeroChip = ({ name }: { name: string }) => (
  <Chip
    data-testid="relationship-hero"
    label={name}
    color="primary"
    size="small"
    sx={{ maxWidth: '100%' }}
  />
);

const SkillChip = ({ name }: { name: string }) => (
  <Chip
    data-testid="relationship-skill"
    label={name}
    color="secondary"
    size="small"
    variant="outlined"
    sx={{ maxWidth: '100%' }}
  />
);

const RelationshipWording = ({ row }: { row: AnalyticsRelationshipRanking }) => {
  if (row.family === 'HP') {
    return (
      <Stack direction="row" gap={0.5} flexWrap="wrap" alignItems="center">
        <HeroChip name={row.heroes[0]} />
        <Typography component="span" variant="body2">同队</Typography>
        <HeroChip name={row.heroes[1]} />
      </Stack>
    );
  }
  if (row.family === 'HT') {
    return (
      <Stack gap={0.5}>
        <Typography variant="caption" color="text.secondary">三人同队</Typography>
        <Stack direction="row" gap={0.5} flexWrap="wrap">
          {row.heroes.map((hero) => <HeroChip key={hero} name={hero} />)}
        </Stack>
      </Stack>
    );
  }
  if (row.family === 'HS' || row.family === 'THS') {
    return (
      <Stack direction="row" gap={0.5} flexWrap="wrap" alignItems="center">
        <HeroChip name={row.heroes[0]} />
        <Typography component="span" variant="body2">
          {row.family === 'HS' ? '携带' : '队内存在'}
        </Typography>
        <SkillChip name={row.skills[0]} />
      </Stack>
    );
  }
  if (row.family === 'B' && row.bond) {
    const memberNames = row.bond.members.join('、');
    return (
      <Stack gap={0.5}>
        <Stack direction="row" gap={0.75} flexWrap="wrap" alignItems="center">
          <Typography variant="body2" fontWeight={700}>{row.bond.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            需要 {row.bond.required_members} 名成员激活
          </Typography>
        </Stack>
        <Box
          component="details"
          sx={{ color: 'text.secondary', fontSize: '0.75rem' }}
        >
          <Box
            component="summary"
            aria-label={`查看缘分成员：${memberNames}`}
            sx={{ cursor: 'pointer', width: 'fit-content' }}
          >
            查看 {row.bond.members.length} 位可参与成员
          </Box>
          <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.75 }}>
            {row.bond.members.map((hero) => <HeroChip key={hero} name={hero} />)}
          </Stack>
        </Box>
      </Stack>
    );
  }
  if (row.family === 'M' && row.mechanic) {
    return (
      <Stack gap={0.25}>
        <Typography variant="body2" fontWeight={700}>{row.mechanic.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          联动方式：{row.mechanic.consumerRelationLabel} · 作用侧：{row.mechanic.sideLabel}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          汇总机制关系；该组合分不属于任何一对具体战法
        </Typography>
      </Stack>
    );
  }
  return <Typography variant="body2">{row.label}</Typography>;
};

interface RelationshipRankingPanelProps {
  rankings: AnalyticsRelationshipRankings;
  selectedHeroes: readonly string[];
  selectedSkills: readonly string[];
}

const RelationshipRankingPanel = ({
  rankings,
  selectedHeroes,
  selectedSkills,
}: RelationshipRankingPanelProps) => {
  const [family, setFamily] =
    useState<AnalyticsRelationshipFamily>('HP');
  const group = groupForFamily(family);
  const mode = MODE_BY_FAMILY.get(family) ?? group.modes[0];
  const rows = useMemo(
    () =>
      filterRelationshipRankings(
        rankings[family],
        family,
        selectedHeroes,
        selectedSkills
      ),
    [family, rankings, selectedHeroes, selectedSkills]
  );
  const queryKey = JSON.stringify([family, selectedHeroes, selectedSkills]);
  const [visibility, setVisibility] = useState({
    queryKey,
    limit: RELATIONSHIP_PAGE_SIZE,
  });
  const visibleLimit =
    visibility.queryKey === queryKey
      ? visibility.limit
      : RELATIONSHIP_PAGE_SIZE;
  useEffect(() => {
    setVisibility((current) =>
      current.queryKey === queryKey
        ? current
        : { queryKey, limit: RELATIONSHIP_PAGE_SIZE }
    );
  }, [queryKey]);
  const visibleRows = rows.slice(0, visibleLimit);
  const remainingCount = rows.length - visibleRows.length;
  const nextPageCount = Math.min(RELATIONSHIP_PAGE_SIZE, remainingCount);

  return (
    <Card data-testid="relationship-ranking-panel" sx={{ mb: 4 }}>
      <CardContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
          <LinkIcon sx={{ mr: 1, color: 'info.main' }} />
          <Typography component="h4" variant="h6">关系搭配排名</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          每种关系独立排名，不会混成一个总榜。组合分是关系的额外模型权重，不是单场胜负预测。
        </Typography>

        <Typography component="p" id="relationship-group-label" variant="subtitle2" sx={{ mb: 0.75 }}>
          先选关系分组
        </Typography>
        <ToggleButtonGroup
          value={group.value}
          exclusive
          aria-labelledby="relationship-group-label"
          aria-label="关系排名分组"
          onChange={(_, nextGroup: RelationshipGroup | null) => {
            if (!nextGroup) return;
            const option = RELATIONSHIP_GROUPS.find(
              (candidate) => candidate.value === nextGroup
            );
            if (option) setFamily(option.modes[0].family);
          }}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            width: '100%',
            mb: 1.5,
            '& .MuiToggleButtonGroup-grouped': {
              minWidth: 0,
              minHeight: 40,
              px: { xs: 0.5, sm: 1.5 },
              py: 0.5,
              lineHeight: 1.25,
            },
          }}
        >
          {RELATIONSHIP_GROUPS.map((option) => (
            <ToggleButton
              key={option.value}
              value={option.value}
              data-relationship-group={option.value}
            >
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Typography component="p" id="relationship-mode-label" variant="subtitle2" sx={{ mb: 0.75 }}>
          再选关系类型
        </Typography>
        <ToggleButtonGroup
          value={family}
          exclusive
          aria-labelledby="relationship-mode-label"
          aria-label={`${group.label}关系类型`}
          onChange={(_, nextFamily: AnalyticsRelationshipFamily | null) => {
            if (nextFamily) setFamily(nextFamily);
          }}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            width: '100%',
            mb: 1.5,
            '& .MuiToggleButtonGroup-grouped': {
              minWidth: 0,
              minHeight: 40,
              px: 1,
              py: 0.5,
            },
          }}
        >
          {group.modes.map((option) => (
            <ToggleButton
              key={option.family}
              value={option.family}
              data-relationship-family={option.family}
              aria-controls="relationship-ranking-table"
            >
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Typography
          id="relationship-ranking-title"
          component="h5"
          variant="subtitle1"
          fontWeight={700}
        >
          {mode.label}排名
        </Typography>
        <Typography
          id="relationship-ranking-description"
          variant="body2"
          color="text.secondary"
          sx={{ mb: 0.5 }}
        >
          {mode.description}
        </Typography>
        <Typography
          role="status"
          aria-live="polite"
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 1 }}
        >
          {filterStatus(
            family,
            selectedHeroes,
            selectedSkills,
            visibleRows.length,
            rows.length,
            rankings[family].length
          )}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: { xs: 'block', sm: 'none' }, mb: 0.75 }}
        >
          排名表采用紧凑布局，可聚焦后滚动；缘分成员可按需展开。
        </Typography>

        <TableContainer
          id="relationship-ranking-table"
          role="region"
          aria-label={`${mode.label}关系排名表格，可滚动`}
          aria-describedby="relationship-ranking-description"
          tabIndex={0}
          sx={{ maxHeight: 720, overflowX: 'auto' }}
        >
          <Table
            size="small"
            stickyHeader
            aria-label={`${mode.label}关系排名`}
            sx={{
              width: '100%',
              tableLayout: 'fixed',
              '& .MuiTableCell-root': {
                px: { xs: 0.5, sm: 1.5 },
                py: { xs: 0.75, sm: 1 },
                overflowWrap: 'anywhere',
              },
              '& .MuiTableCell-head': {
                fontSize: { xs: '0.72rem', sm: '0.875rem' },
                lineHeight: 1.2,
              },
              '& .MuiChip-root': {
                height: { xs: 22, sm: 24 },
                maxWidth: '100%',
              },
              '& .MuiChip-label': {
                px: { xs: 0.625, sm: 1 },
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: { xs: '12%', sm: 72 } }}>排名</TableCell>
                <TableCell sx={{ width: { xs: '52%', sm: 'auto' } }}>搭配</TableCell>
                <TableCell align="right" sx={{ width: { xs: '18%', sm: 112 } }}>组合分</TableCell>
                <TableCell align="right" sx={{ width: { xs: '18%', sm: 112 } }}>参考场次</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow
                  key={row.featureId}
                  data-testid="relationship-ranking-row"
                  data-feature-family={row.family}
                >
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {row.rank}
                  </TableCell>
                  <TableCell><RelationshipWording row={row} /></TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color:
                        row.weight > 0
                          ? 'success.main'
                          : row.weight < 0
                            ? 'error.main'
                            : 'text.secondary',
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatSignedWeight(row.weight, 3)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                  >
                    {row.support}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    暂无{mode.emptyLabel}数据
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {remainingCount > 0 && (
          <Button
            type="button"
            variant="outlined"
            data-testid="relationship-show-more"
            aria-controls="relationship-ranking-table"
            aria-label={`显示更多${mode.label}关系：再显示 ${nextPageCount} 条`}
            onClick={() =>
              setVisibility({
                queryKey,
                limit: visibleLimit + RELATIONSHIP_PAGE_SIZE,
              })
            }
            sx={{ mt: 1.5, minHeight: 40 }}
          >
            显示更多（再显示 {nextPageCount} 条）
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default RelationshipRankingPanel;
