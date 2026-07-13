import { Paper, Typography, Box, type SxProps } from '@mui/material';
import { selectRelevantTeamComps } from '../../services/promptGenerator';
import { tierRank } from '../../utils/tiers';
import ResponsiveDisclosure from '../common/ResponsiveDisclosure';

type OwnershipStatus = 'owned' | 'candidate' | 'missing';

interface StatusStyle {
  label: string;
  sx: SxProps;
}

// Ownership is expressed with typography and a colored rule, avoiding the
// icon-heavy chip language used elsewhere in the app.
const STATUS: Record<OwnershipStatus, StatusStyle> = {
  owned: {
    label: '已在阵中',
    sx: { borderColor: 'primary.main', bgcolor: 'rgba(69,108,95,0.10)' },
  },
  candidate: {
    label: '本轮可取',
    sx: { borderColor: 'error.main', bgcolor: 'rgba(168,57,47,0.07)' },
  },
  missing: {
    label: '尚未拥有',
    sx: {
      borderColor: 'divider',
      borderStyle: 'dashed',
      bgcolor: 'rgba(29,36,33,0.035)',
      color: 'text.secondary',
    },
  },
};

interface HeroChipProps {
  hero: string;
  status: OwnershipStatus;
}

const HeroChip = ({ hero, status }: HeroChipProps) => {
  const s = STATUS[status];
  return (
    <Box
      sx={{
        minWidth: 0,
        px: 1.25,
        py: 1,
        borderTop: '3px solid',
        ...s.sx,
      }}
    >
      <Typography
        variant="body2"
        sx={{ fontWeight: status === 'missing' ? 500 : 750, lineHeight: 1.3 }}
      >
        {hero}
      </Typography>
      <Typography
        variant="caption"
        color={status === 'candidate' ? 'error.dark' : 'text.secondary'}
        sx={{ display: 'block', mt: 0.35, letterSpacing: '0.06em' }}
      >
        {s.label}
      </Typography>
    </Box>
  );
};

/**
 * 已知强力阵容 — surfaces the known strong team comps that overlap the heroes
 * currently in play, mirroring the 【玩家心得】 block in the LLM prompt.
 *
 * Rendered as a compact field-guide of formations. Each formation is a card with
 * a tier marker and text-only ownership states. Hidden when nothing is relevant.
 */
interface KnownStrongTeamsProps {
  selectedHeroes?: string[];
  candidateHeroes?: string[];
  isFirstRound?: boolean;
}

const KnownStrongTeams = ({ selectedHeroes = [], candidateHeroes = [], isFirstRound = false }: KnownStrongTeamsProps) => {
  const relevant = selectRelevantTeamComps(selectedHeroes, candidateHeroes, {
    includeCandidateOnlyComps: isFirstRound,
  });

  if (relevant.length === 0) {
    return null;
  }

  const selectedSet = new Set(selectedHeroes);
  const candidateSet = new Set(candidateHeroes);
  const statusOf = (hero: string): OwnershipStatus =>
    selectedSet.has(hero) ? 'owned' : candidateSet.has(hero) ? 'candidate' : 'missing';

  // Strongest tiers first (stable sort keeps the selector's most-actionable order within a tier).
  const sorted = [...relevant].sort((a, b) => tierRank(a.comp.tier) - tierRank(b.comp.tier));
  return (
    <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3, overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'flex-end' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 1,
          mb: 2.25,
        }}
      >
        <Box>
          <Typography variant="overline" color="error.main">阵容情报</Typography>
          <Typography component="h2" variant="h6">已知强力阵容</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            根据当前武将与本轮选项，找出可衔接的成型队伍。
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          共 {sorted.length} 组
        </Typography>
      </Box>

      <Box
        aria-label="阵容状态图例"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2.25 }}
      >
        {(Object.keys(STATUS) as OwnershipStatus[]).map((status) => (
          <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 20, borderTop: '3px solid', ...STATUS[status].sx, bgcolor: 'transparent' }} />
            <Typography variant="caption" color="text.secondary">{STATUS[status].label}</Typography>
          </Box>
        ))}
      </Box>

      <ResponsiveDisclosure label={`${sorted.length}组强力阵容`}>
        <Box
          component="ol"
          sx={{
            listStyle: 'none',
            m: 0,
            p: 0,
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', xl: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.25,
          }}
        >
          {sorted.map(({ comp }, idx) => (
            <Box
              component="li"
              data-testid="strong-team-row"
              key={`${comp.tier}-${comp.heroes.join('-')}-${idx}`}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '52px minmax(0, 1fr)', sm: '64px minmax(0, 1fr)' },
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'rgba(251,248,239,0.72)',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: idx === 0 ? '#243b34' : '#e7dfcc',
                  color: idx === 0 ? '#fff8e9' : 'text.primary',
                  borderRight: '1px solid',
                  borderColor: idx === 0 ? '#243b34' : 'divider',
                  px: 0.75,
                }}
              >
                <Typography data-testid="team-tier" sx={{ fontFamily: 'Georgia, serif', fontWeight: 800, fontSize: 18 }}>
                  {comp.tier}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.7, fontSize: 10 }}>强度</Typography>
              </Box>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${comp.heroes.length}, minmax(0, 1fr))`,
                  gap: 0.75,
                  p: 0.75,
                }}
              >
                {comp.heroes.map((hero) => (
                  <Box key={hero}>
                    <HeroChip hero={hero} status={statusOf(hero)} />
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </ResponsiveDisclosure>
    </Paper>
  );
};

export default KnownStrongTeams;
