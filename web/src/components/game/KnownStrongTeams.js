import React from 'react';
import {
  Paper, Typography, Box, Chip,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { selectRelevantTeamComps } from '../../services/promptGenerator';

// Display order, strongest first. (No per-tier colors — kept plain.)
const TIER_ORDER = { OP: 0, T0: 1, 'T1+': 2, T1: 3, T2: 4, T3: 5, T4: 6 };
const tierRank = (tier) => TIER_ORDER[tier] ?? Number.MAX_SAFE_INTEGER;

// Ownership status → color carries the meaning: green = owned, blue = obtainable
// this round, faded grey = not owned.
const STATUS = {
  owned:     { color: 'success', variant: 'filled',   icon: <CheckCircleIcon />,      sx: {} },
  candidate: { color: 'primary', variant: 'outlined', icon: <AddCircleOutlineIcon />, sx: {} },
  missing:   { color: 'default', variant: 'outlined', icon: null,                     sx: { opacity: 0.45, border: 0 } },
};

const HeroChip = ({ hero, status }) => {
  const s = STATUS[status];
  return (
    <Chip
      label={hero}
      size="small"
      color={s.color}
      variant={s.variant}
      icon={s.icon || undefined}
      sx={{ fontWeight: status === 'owned' ? 600 : 400, ...s.sx }}
    />
  );
};

/**
 * 已知强力阵容 — surfaces the known strong team comps that overlap the heroes
 * currently in play, mirroring the 【玩家心得】 block in the LLM prompt.
 *
 * Rendered as a table so the three heroes line up in columns. Ownership is shown
 * plainly: ✓ chip = already on the team, dashed ⊕ chip = obtainable this round
 * (pick the matching option set), faded text = not yet owned. Hidden when nothing
 * is relevant.
 */
const KnownStrongTeams = ({ selectedHeroes = [], candidateHeroes = [], isFirstRound = false }) => {
  const relevant = selectRelevantTeamComps(selectedHeroes, candidateHeroes, {
    includeCandidateOnlyComps: isFirstRound,
  });

  if (relevant.length === 0) {
    return null;
  }

  const selectedSet = new Set(selectedHeroes);
  const candidateSet = new Set(candidateHeroes);
  const statusOf = (hero) =>
    selectedSet.has(hero) ? 'owned' : candidateSet.has(hero) ? 'candidate' : 'missing';

  // Strongest tiers first (stable sort keeps the selector's most-actionable order within a tier).
  const sorted = [...relevant].sort((a, b) => tierRank(a.comp.tier) - tierRank(b.comp.tier));
  const maxHeroes = sorted.reduce((m, { comp }) => Math.max(m, comp.heroes.length), 0);

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
        <GroupsIcon sx={{ mr: 1, fontSize: 28 }} color="action" />
        <Typography variant="h6">已知强力阵容</Typography>
      </Box>

      {/* Visual legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <HeroChip hero="已选" status="owned" />
        <HeroChip hero="本轮可选" status="candidate" />
        <HeroChip hero="未拥有" status="missing" />
      </Box>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, width: 64, whiteSpace: 'nowrap' }}>强度</TableCell>
            <TableCell sx={{ fontWeight: 700 }} colSpan={maxHeroes}>武将</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map(({ comp }, idx) => (
            <TableRow key={idx} hover>
              <TableCell sx={{ fontWeight: 700 }}>{comp.tier}</TableCell>
              {comp.heroes.map((hero) => (
                <TableCell key={hero}>
                  <HeroChip hero={hero} status={statusOf(hero)} />
                </TableCell>
              ))}
              {/* pad short comps so columns stay aligned */}
              {Array.from({ length: maxHeroes - comp.heroes.length }).map((_, i) => (
                <TableCell key={`pad-${i}`} />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
};

export default KnownStrongTeams;
