import { useState, useEffect, type ReactNode } from 'react';
import {
  Container,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import ResponsiveDisclosure from '../components/common/ResponsiveDisclosure';
import PageIntro from '../components/common/PageIntro';
import type { TelemetryData, TelemetryItemAggregate } from '../types/telemetryData';
import { loadTelemetryData } from '../services/telemetryData';

interface ScrollableAnalyticsTableProps {
  children: ReactNode;
  label: string;
  maxHeight?: number;
}

const ScrollableAnalyticsTable = ({
  children,
  label,
  maxHeight = 800,
}: ScrollableAnalyticsTableProps) => (
  <>
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ display: { xs: 'block', sm: 'none' }, mb: 0.75 }}
    >
      表格可横向滚动，聚焦后也可使用键盘滚动。
    </Typography>
    <TableContainer
      role="region"
      aria-label={`${label}表格，可滚动`}
      tabIndex={0}
      sx={{ maxHeight }}
    >
      {children}
    </TableContainer>
  </>
);

const telemetryPct = (
  numerator: number,
  denominator: number
): string => {
  if (denominator === 0) return '-';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
};

type TelemetryItemFamily = 'heroes' | 'skills';
type TelemetryRankingMetric = 'offer_count' | 'picked_count';

const compareTelemetryNames = (
  left: TelemetryItemAggregate,
  right: TelemetryItemAggregate
): number => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

const rankTelemetryItems = (
  rows: TelemetryItemAggregate[],
  metric: TelemetryRankingMetric
): TelemetryItemAggregate[] =>
  rows
    .slice()
    .sort(
      (left, right) =>
        right[metric] - left[metric] || compareTelemetryNames(left, right)
    );

const TelemetryRankingTable = ({
  title,
  rows,
  metric,
  itemFamily,
}: {
  title: string;
  rows: TelemetryItemAggregate[];
  metric: TelemetryRankingMetric;
  itemFamily: TelemetryItemFamily;
}) => {
  const rankedRows = rankTelemetryItems(rows, metric);
  const isOfferRanking = metric === 'offer_count';
  const itemLabel = itemFamily === 'heroes' ? '武将' : '战法';
  const countLabel = isOfferRanking ? '提供次数' : '选择次数';
  const rateLabel = isOfferRanking ? '提供率' : '提供后选择率';
  const chipColor = itemFamily === 'heroes' ? 'primary' : 'secondary';

  return (
    <Card
      data-testid={
        isOfferRanking
          ? 'telemetry-ranking-offers'
          : 'telemetry-ranking-picks'
      }
      sx={{ height: '100%' }}
    >
      <CardContent>
        <Typography component="h3" variant="h6" gutterBottom>
          {title}
        </Typography>
        <ResponsiveDisclosure label={`${title}${itemLabel}排行`}>
          <ScrollableAnalyticsTable
            label={`${title}${itemLabel}排行`}
            maxHeight={520}
          >
            <Table
              size="small"
              stickyHeader
              aria-label={`${title}全部${itemLabel}排行`}
              sx={{ minWidth: 480 }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>排名</TableCell>
                  <TableCell>{itemLabel}</TableCell>
                  <TableCell align="right">{countLabel}</TableCell>
                  <TableCell align="right">{rateLabel}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rankedRows.map((row, index) => {
                  const count = row[metric];
                  const rate = isOfferRanking
                    ? telemetryPct(
                        row.offer_count,
                        row.opportunity_count
                      )
                    : telemetryPct(
                        row.picked_count,
                        row.offer_count
                      );

                  return (
                    <TableRow
                      data-testid="telemetry-ranking-row"
                      key={row.name}
                    >
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        <Chip
                          data-testid="telemetry-ranking-name"
                          label={row.name}
                          color={chipColor}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">{count} 次</TableCell>
                      <TableCell align="right">{rate}</TableCell>
                    </TableRow>
                  );
                })}
                {rankedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      暂无选择记录
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollableAnalyticsTable>
        </ResponsiveDisclosure>
      </CardContent>
    </Card>
  );
};

const TelemetryAnalyticsSection = ({
  telemetry,
}: {
  telemetry: TelemetryData;
}) => {
  const analytics = telemetry.analytics;
  const [itemFamily, setItemFamily] =
    useState<TelemetryItemFamily>('heroes');

  if (!analytics) return null;

  const rows = analytics.items[itemFamily];

  return (
    <Box
      component="section"
      id="anonymous-choice-analytics"
      aria-labelledby="anonymous-choice-analytics-title"
      sx={{ mb: 4, scrollMarginTop: 24 }}
      data-testid="player-choice-analytics"
    >
      <Typography variant="overline" color="info.main">
        ANONYMOUS CHOICES
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 0.75,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InsightsIcon sx={{ color: 'info.main' }} />
          <Typography
            id="anonymous-choice-analytics-title"
            component="h2"
            variant="h5"
          >
            匿名选项统计
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={itemFamily}
          exclusive
          size="small"
          aria-label="玩家选择排行类型"
          onChange={(_, nextFamily: TelemetryItemFamily | null) => {
            if (nextFamily) setItemFamily(nextFamily);
          }}
          sx={{
            '& .MuiToggleButton-root': {
              minHeight: 40,
              px: 1.75,
              py: 0.25,
            },
          }}
        >
          <ToggleButton value="heroes" aria-label="武将">
            武将
          </ToggleButton>
          <ToggleButton value="skills" aria-label="战法">
            战法
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        匿名选项统计汇总玩家使用本工具时的匿名选择：它只记录游戏每轮三组选项中提供了哪些武将、
        战法，以及玩家最终选择了什么，不重复计算已有阵容。这里展示的是选择次数和倾向，
        不代表武将、战法的模型强度，也不会改变 AI 的阵容评分推荐。
      </Typography>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 6 }}>
          <TelemetryRankingTable
            title="游戏最常提供"
            rows={rows}
            metric="offer_count"
            itemFamily={itemFamily}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TelemetryRankingTable
            title="玩家最常选择"
            rows={rows}
            metric="picked_count"
            itemFamily={itemFamily}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

const Analytics = () => {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    void loadTelemetryData()
      .then(setTelemetry)
      .catch((telemetryError) => {
        console.warn('Player-choice telemetry is unavailable', telemetryError);
        setUnavailable(true);
      });
  }, []);

  return (
    <Container maxWidth="xl" disableGutters>
      <Box>
        <PageIntro
          eyebrow="数据复盘"
          title="数据洞察"
          description="看看游戏最常提供哪些武将、战法，以及玩家最常选择什么。"
        />
        {telemetry?.analytics ? (
          <TelemetryAnalyticsSection telemetry={telemetry} />
        ) : (
          <Typography variant="body2" color="text.secondary" role="status">
            {unavailable || telemetry ? '暂时没有可展示的匿名选项统计。' : '正在载入匿名选项统计…'}
          </Typography>
        )}
      </Box>
    </Container>
  );
};

export default Analytics;
