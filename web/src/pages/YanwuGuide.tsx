import { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import { database } from '../data';
import { yanwuGuide } from '../guideData';
import ResponsiveDisclosure from '../components/common/ResponsiveDisclosure';

const HERO_RANKINGS = ['S', 'A', 'B', 'C', 'D'] as const;
const SKILL_CATEGORIES = ['兵刃', '谋略', '治疗', '防御', '辅助', '文武'] as const;
const TEAM_RANKINGS = ['S', 'A', 'B'] as const;
const TEAM_TIERS = ['冠军', ...TEAM_RANKINGS] as const;
const CAMP_SECTIONS = [
  { camp: '魏', label: '魏国' },
  { camp: '蜀', label: '蜀国' },
  { camp: '吴', label: '吴国' },
  { camp: '群', label: '群雄' },
] as const;

const OUTCOME: Record<string, { label: string; color: string; background: string }> = {
  largeAdvantage: { label: '大优势', color: '#155b2a', background: '#dcefdc' },
  smallAdvantage: { label: '小优势', color: '#315b23', background: '#e8f2df' },
  even: { label: '均势', color: '#244d6b', background: '#e2eef7' },
  smallDisadvantage: { label: '小劣势', color: '#725d13', background: '#fff4cc' },
  largeDisadvantage: { label: '大劣势', color: '#8e2f20', background: '#fde3dc' },
  self: { label: '同阵容', color: '#4f5653', background: '#e5e7e6' },
};

type GuideTeam = (typeof database.team)[number];

const formatUpdatedAtDate = (updatedAt: string) => {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(updatedAt);
  return match ? match[0] : updatedAt;
};

const isChampionship = (team: GuideTeam) =>
  team.sources.includes('championship');

const teamName = (team: GuideTeam) =>
  team.members.map((member) => member.hero).join(' + ');

const FADAO_SIMA_SKILLS = ['运智铺谋', '谋而后动'] as const;

const matchupTeamName = (team: GuideTeam) =>
  team.members
    .map((member) => {
      const equippedSkills = member.skillSlots.flat();
      const isFadaoSima =
        member.hero === '司马懿' &&
        FADAO_SIMA_SKILLS.every((skill) => equippedSkills.includes(skill));
      return isFadaoSima ? `(法刀) ${member.hero}` : member.hero;
    })
    .join(' + ');

const rankingIndex = (ranking: string) => {
  const index = TEAM_RANKINGS.indexOf(ranking as (typeof TEAM_RANKINGS)[number]);
  return index === -1 ? TEAM_RANKINGS.length : index;
};

const byGuideStrength = (left: GuideTeam, right: GuideTeam) => {
  const championship = Number(isChampionship(right)) - Number(isChampionship(left));
  if (championship !== 0) return championship;
  const ranking = rankingIndex(left.ranking) - rankingIndex(right.ranking);
  if (ranking !== 0) return ranking;
  return teamName(left).localeCompare(teamName(right), 'zh-Hans-CN');
};

const TeamBuildCard = ({ team }: { team: GuideTeam }) => {
  const championship = isChampionship(team);
  return (
    <Paper
      component="article"
      variant="outlined"
      data-testid="guide-team-card"
      sx={{
        overflow: 'hidden',
        borderColor: championship ? '#b58a2c' : 'divider',
        boxShadow: championship ? '0 6px 20px rgba(154,112,24,0.12)' : 'none',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        gap={1}
        sx={{
          px: 2,
          py: 1.25,
          bgcolor: championship ? '#fbf0cf' : 'rgba(36,59,52,0.055)',
          borderBottom: '1px solid',
          borderColor: championship ? '#d6bc75' : 'divider',
        }}
      >
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          {championship ? (
            <Chip
              icon={<EmojiEventsOutlinedIcon />}
              label="冠军"
              size="small"
              data-testid="guide-team-tier"
              sx={{ bgcolor: '#7e5b14', color: '#fffaf0', '& .MuiChip-icon': { color: 'inherit' } }}
            />
          ) : (
            <Chip
              label={team.ranking}
              size="small"
              data-testid="guide-team-tier"
            />
          )}
          {!championship && (
            <Typography variant="caption" color="text.secondary">
              {team.section}
            </Typography>
          )}
        </Stack>
        <Typography variant="body2" sx={{ fontWeight: 750 }}>
          {team.formation}
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
          gap: 1,
          p: 1.5,
        }}
      >
        {team.members.map((member) => (
          <Box
            key={member.hero}
            sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', minWidth: 0 }}
          >
            <Typography sx={{ fontWeight: 800, mb: 0.75 }}>{member.hero}</Typography>
            <Stack spacing={0.5}>
              {member.skillSlots.map((alternatives, slotIndex) => (
                <Typography
                  key={`${member.hero}-${slotIndex}`}
                  variant="body2"
                  color="text.secondary"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  战法 {slotIndex + 1}：{alternatives.join(' / ')}
                </Typography>
              ))}
            </Stack>
          </Box>
        ))}
      </Box>
    </Paper>
  );
};

const YanwuGuide = () => {
  const [tierFilter, setTierFilter] = useState('全部');
  const [selectedMatchupTeam, setSelectedMatchupTeam] = useState(
    yanwuGuide.matchups.buildIds[0] ?? ''
  );

  const teamById = useMemo(
    () => new Map(database.team.map((team) => [team.id, team])),
    []
  );

  const filteredTeams = useMemo(
    () => database.team
      .filter((team) => {
        if (tierFilter === '全部') return true;
        if (tierFilter === '冠军') return isChampionship(team);
        return !isChampionship(team) && team.ranking === tierFilter;
      })
      .sort(byGuideStrength),
    [tierFilter]
  );

  const selectedMatchupIndex = yanwuGuide.matchups.buildIds.indexOf(selectedMatchupTeam);

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="overline" color="error.main">演武攻略资料</Typography>
        <Typography component="h1" variant="h3" sx={{ mt: 0.5 }}>
          三国谋定天下演武武将、战法与阵容指南
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1.25, maxWidth: 820 }}>
          查看武将与战法排行、完整阵容战法、夺冠御三家、阵容克制关系与核心武将解析。
        </Typography>
      </Box>

      <Paper
        component="aside"
        data-testid="yanwu-guide-attribution"
        sx={{ px: { xs: 2, sm: 3 }, py: 2, borderLeft: '4px solid', borderColor: 'warning.main' }}
      >
        <Typography sx={{ fontWeight: 800 }}>{yanwuGuide.source.attribution}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
          数据更新：{formatUpdatedAtDate(yanwuGuide.source.updatedAt)}
        </Typography>
      </Paper>

      <Box component="section" aria-labelledby="hero-ranking-heading">
        <Typography id="hero-ranking-heading" component="h2" variant="h4">
          国家武将排行榜
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
            mt: 2,
          }}
        >
          {CAMP_SECTIONS.map(({ camp, label }) => (
            <Paper key={camp} variant="outlined" sx={{ p: 2 }}>
              <Typography component="h3" variant="h6" sx={{ mb: 1.5 }}>{label}</Typography>
              <Stack spacing={1.25}>
                {HERO_RANKINGS.map((ranking) => {
                  const heroes = Object.entries(database.heroes)
                    .filter(([, hero]) => hero.camp === camp && hero.ranking === ranking)
                    .map(([name]) => name)
                    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
                  return (
                    <Box
                      key={ranking}
                      sx={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', gap: 1 }}
                    >
                      <Typography sx={{ fontWeight: 850, color: ranking === 'S' ? 'error.main' : 'text.primary' }}>
                        {ranking}
                      </Typography>
                      <Stack direction="row" gap={0.75} flexWrap="wrap">
                        {heroes.map((hero) => <Chip key={hero} label={hero} size="small" />)}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Paper>
          ))}
        </Box>
      </Box>

      <Divider />

      <Box component="section" aria-labelledby="skill-ranking-heading" data-testid="guide-skill-rankings">
        <Typography id="skill-ranking-heading" component="h2" variant="h4">
          战法排行榜
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
          按战法定位与档位查看；未出现在源榜单中的战法不显示档位。
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
            mt: 2,
          }}
        >
          {SKILL_CATEGORIES.map((category) => (
            <Paper key={category} variant="outlined" sx={{ p: 2 }}>
              <Typography component="h3" variant="h6" sx={{ mb: 1.5 }}>{category}</Typography>
              <Stack spacing={1.25}>
                {HERO_RANKINGS.map((ranking) => {
                  const skills = Object.entries(database.skills)
                    .filter(([, skill]) => skill.category === category && skill.ranking === ranking)
                    .map(([name]) => name)
                    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
                  return (
                    <Box
                      key={ranking}
                      sx={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', gap: 1 }}
                    >
                      <Typography sx={{ fontWeight: 850, color: ranking === 'S' ? 'error.main' : 'text.primary' }}>
                        {ranking}
                      </Typography>
                      <Stack direction="row" gap={0.75} flexWrap="wrap">
                        {skills.map((skill) => <Chip key={skill} label={skill} size="small" />)}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Paper>
          ))}
        </Box>
      </Box>

      <Divider />

      <Box
        component="section"
        aria-labelledby="team-library-heading"
        data-testid="guide-team-library"
      >
        <Typography id="team-library-heading" component="h2" variant="h4">
          强队阵容
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>
          按冠军、S、A、B档查看阵容；每个战法格中的斜线表示可替换方案。
        </Typography>
        <FormControl size="small" sx={{ minWidth: 150, mb: 2 }}>
          <InputLabel id="guide-tier-filter-label">档位</InputLabel>
          <Select
            labelId="guide-tier-filter-label"
            value={tierFilter}
            label="档位"
            onChange={(event) => setTierFilter(event.target.value)}
          >
            {['全部', ...TEAM_TIERS].map((value) => (
              <MenuItem key={value} value={value}>{value}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <ResponsiveDisclosure label={`${filteredTeams.length}组阵容`}>
          <Stack spacing={1.25}>
            {filteredTeams.map((team) => (
              <TeamBuildCard key={team.id} team={team} />
            ))}
          </Stack>
        </ResponsiveDisclosure>
      </Box>

      <Divider />

      <Box component="section" aria-labelledby="matchup-heading">
        <Typography id="matchup-heading" component="h2" variant="h4">
          阵容克制查询
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>
          选择己方阵容，查看面对表中其他强队时的参考关系。
        </Typography>
        <FormControl fullWidth size="small" sx={{ maxWidth: 680, mb: 2 }}>
          <InputLabel id="matchup-team-label">己方阵容</InputLabel>
          <Select
            labelId="matchup-team-label"
            value={selectedMatchupTeam}
            label="己方阵容"
            onChange={(event) => setSelectedMatchupTeam(event.target.value)}
          >
            {yanwuGuide.matchups.buildIds.map((teamId) => {
              const team = teamById.get(teamId);
              return (
                <MenuItem key={teamId} value={teamId}>
                  {team ? matchupTeamName(team) : teamId}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="阵容克制关系">
            <TableHead>
              <TableRow>
                <TableCell>对手阵容</TableCell>
                <TableCell width={120}>关系</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {yanwuGuide.matchups.buildIds.map((opponentId, rowIndex) => {
                const opponent = teamById.get(opponentId);
                const resultKey = selectedMatchupIndex >= 0
                  ? yanwuGuide.matchups.outcomes[rowIndex]?.[selectedMatchupIndex]
                  : undefined;
                const result = OUTCOME[resultKey ?? 'even'] ?? OUTCOME.even;
                return (
                  <TableRow key={opponentId}>
                    <TableCell>
                      {opponent ? matchupTeamName(opponent) : opponentId}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={result.label}
                        size="small"
                        sx={{ color: result.color, bgcolor: result.background, fontWeight: 750 }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Box component="section" aria-labelledby="analysis-heading">
        <Typography id="analysis-heading" component="h2" variant="h4">
          阵容解析
        </Typography>
        <Stack spacing={2} sx={{ mt: 2 }}>
          {yanwuGuide.analysisSections.map((section) => (
            <Paper key={`${section.section}-${section.subject}`} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="overline" color="error.main">{section.section}</Typography>
              <Typography component="h3" variant="h6">{section.subject}</Typography>
              <Box component="ol" sx={{ pl: 2.5, mb: 0 }}>
                {section.points.map((point) => (
                  <Typography component="li" key={point} sx={{ mt: 1, lineHeight: 1.8 }}>
                    {point}
                  </Typography>
                ))}
              </Box>
            </Paper>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
};

export default YanwuGuide;
