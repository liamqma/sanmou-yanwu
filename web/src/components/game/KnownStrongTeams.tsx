import { Fragment } from 'react';
import { Box, Link, Paper, Typography, type SxProps } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  compareKnownTeamStrength,
  isChampionshipTeam,
  selectRelevantTeamComps,
  type RelevantTeamComp,
} from '../../services/promptGenerator';
import type { RoundType } from '../../types/game';
import type { TeamMember } from '../../types/domain';

type OwnershipStatus = 'owned' | 'candidate' | 'missing';

interface StatusStyle {
  label: '已获得' | '本轮可获得' | '尚未获得';
  sx: SxProps;
}

// The same three labels are used for heroes and skill alternatives so resource
// ownership remains explicit without relying on colour alone.
const STATUS: Record<OwnershipStatus, StatusStyle> = {
  owned: {
    label: '已获得',
    sx: { borderColor: 'primary.main', bgcolor: 'rgba(111,155,135,0.14)' },
  },
  candidate: {
    label: '本轮可获得',
    sx: { borderColor: 'warning.main', bgcolor: 'rgba(199,98,47,0.14)' },
  },
  missing: {
    label: '尚未获得',
    sx: {
      borderColor: 'divider',
      borderStyle: 'dashed',
      bgcolor: 'rgba(4,9,8,0.3)',
      color: 'text.secondary',
    },
  },
};

const statusOf = (
  value: string,
  owned: Set<string>,
  candidates: Set<string>
): OwnershipStatus =>
  owned.has(value) ? 'owned' : candidates.has(value) ? 'candidate' : 'missing';

interface HeroStatusProps {
  hero: string;
  status: OwnershipStatus;
}

const HeroStatus = ({ hero, status }: HeroStatusProps) => {
  const presentation = STATUS[status];
  return (
    <Box
      aria-label={`${hero}：${presentation.label}`}
      sx={{
        minWidth: 0,
        px: 1.1,
        py: 0.9,
        borderTop: '3px solid',
        ...presentation.sx,
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontWeight: status === 'missing' ? 550 : 750,
          lineHeight: 1.3,
          overflowWrap: 'anywhere',
        }}
      >
        {hero}
      </Typography>
      <Typography
        data-testid="known-team-hero-status"
        variant="caption"
        color={status === 'candidate' ? 'warning.light' : 'text.secondary'}
        sx={{ display: 'block', mt: 0.35, letterSpacing: '0.04em' }}
      >
        {presentation.label}
      </Typography>
    </Box>
  );
};

interface SkillSlotProps {
  slotIndex: number;
  alternatives: string[];
  ownedSkills: Set<string>;
  candidateSkills: Set<string>;
}

const SkillSlot = ({
  slotIndex,
  alternatives,
  ownedSkills,
  candidateSkills,
}: SkillSlotProps) => (
  <Box
    data-testid="known-team-skill-slot"
    sx={{
      display: 'grid',
      gridTemplateColumns: { xs: '46px minmax(0, 1fr)', sm: '52px minmax(0, 1fr)' },
      alignItems: 'start',
      gap: 0.6,
      pt: 0.75,
      borderTop: '1px solid',
      borderColor: 'divider',
    }}
  >
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ pt: 0.15, whiteSpace: 'nowrap' }}
    >
      战法位{slotIndex + 1}
    </Typography>
    {alternatives.length > 0 ? (
      <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 0.45 }}>
        {alternatives.map((skill, alternativeIndex) => {
          const status = statusOf(skill, ownedSkills, candidateSkills);
          const presentation = STATUS[status];
          return (
            <Fragment key={`${skill}-${alternativeIndex}`}>
              {alternativeIndex > 0 && (
                <Typography
                  component="span"
                  aria-hidden="true"
                  color="text.secondary"
                  sx={{ lineHeight: 1.25 }}
                >
                  /
                </Typography>
              )}
              <Box
                component="span"
                aria-label={`${skill}：${presentation.label}`}
                sx={{ minWidth: 0 }}
              >
                <Typography
                  data-testid="known-team-skill-status"
                  component="span"
                  variant="caption"
                  sx={{
                    display: 'block',
                    color:
                      status === 'candidate'
                        ? 'warning.light'
                        : status === 'missing'
                          ? 'text.secondary'
                          : 'text.primary',
                    fontWeight: status === 'missing' ? 500 : 700,
                    lineHeight: 1.25,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {skill}
                </Typography>
                <Typography
                  component="span"
                  variant="caption"
                  sx={{
                    display: 'block',
                    color: status === 'candidate' ? 'warning.light' : 'text.secondary',
                    fontSize: '0.66rem',
                    lineHeight: 1.25,
                  }}
                >
                  {presentation.label}
                </Typography>
              </Box>
            </Fragment>
          );
        })}
      </Box>
    ) : (
      <Typography variant="caption" color="text.secondary">
        暂无参考
      </Typography>
    )}
  </Box>
);

interface MemberCardProps {
  member: TeamMember;
  showSkills: boolean;
  ownedHeroes: Set<string>;
  candidateHeroes: Set<string>;
  ownedSkills: Set<string>;
  candidateSkills: Set<string>;
}

const MemberCard = ({
  member,
  showSkills,
  ownedHeroes,
  candidateHeroes,
  ownedSkills,
  candidateSkills,
}: MemberCardProps) => (
  <Box sx={{ minWidth: 0 }}>
    <HeroStatus
      hero={member.hero}
      status={statusOf(member.hero, ownedHeroes, candidateHeroes)}
    />
    {showSkills && (
      <Box sx={{ display: 'grid', gap: 0.75, px: 0.8, pb: 0.9, pt: 0.8 }}>
        {[0, 1].map((slotIndex) => (
          <SkillSlot
            key={slotIndex}
            slotIndex={slotIndex}
            alternatives={member.skillSlots[slotIndex] || []}
            ownedSkills={ownedSkills}
            candidateSkills={candidateSkills}
          />
        ))}
      </Box>
    )}
  </Box>
);

const HERO_SHORTLIST_LIMIT = 6;
const SKILL_SHORTLIST_LIMIT = 4;

const distinctHeroRosters = (
  entries: RelevantTeamComp[]
): RelevantTeamComp[] => {
  const seenRosters = new Set<string>();
  return entries.filter(({ comp }) => {
    const rosterKey = comp.members
      .map((member) => member.hero)
      .sort()
      .join('|');
    if (seenRosters.has(rosterKey)) return false;
    seenRosters.add(rosterKey);
    return true;
  });
};

const heroRoundShortlist = (
  relevant: RelevantTeamComp[],
  candidateHeroes: string[]
): RelevantTeamComp[] => {
  if (candidateHeroes.length === 0) {
    return distinctHeroRosters(relevant).slice(0, HERO_SHORTLIST_LIMIT);
  }

  const candidateSet = new Set(candidateHeroes);
  const representedCandidates = new Set<string>();
  const selectedIds = new Set<string>();
  const shortlist: RelevantTeamComp[] = [];
  const actionable = distinctHeroRosters(
    [...relevant].sort(
      (left, right) =>
        right.selectedCount - left.selectedCount ||
        right.candidateCount - left.candidateCount ||
        compareKnownTeamStrength(left, right)
    )
  );

  // Prefer strong entries that introduce a different offered hero, so the
  // shortlist represents multiple current choices instead of repeating one
  // popular hero across every row.
  for (const entry of actionable) {
    const matchedCandidates = entry.comp.members
      .map((member) => member.hero)
      .filter((hero) => candidateSet.has(hero));
    if (
      matchedCandidates.length === 0 ||
      matchedCandidates.every((hero) => representedCandidates.has(hero))
    ) {
      continue;
    }
    shortlist.push(entry);
    selectedIds.add(entry.comp.id);
    matchedCandidates.forEach((hero) => representedCandidates.add(hero));
    if (shortlist.length === HERO_SHORTLIST_LIMIT) return shortlist;
  }

  for (const entry of actionable) {
    if (entry.candidateCount === 0 || selectedIds.has(entry.comp.id)) continue;
    shortlist.push(entry);
    if (shortlist.length === HERO_SHORTLIST_LIMIT) break;
  }
  return shortlist;
};

const skillRoundShortlist = (
  relevant: RelevantTeamComp[]
): RelevantTeamComp[] =>
  relevant
    .filter((entry) => entry.selectedCount > 0 && entry.candidateSkillCount > 0)
    .sort(
      (left, right) =>
        right.selectedCount - left.selectedCount ||
        right.candidateSkillCount - left.candidateSkillCount ||
        right.selectedSkillCount - left.selectedSkillCount ||
        compareKnownTeamStrength(left, right)
    )
    .slice(0, SKILL_SHORTLIST_LIMIT);

/**
 * 本轮阵容方向 — a small, actionable guide-backed shortlist.
 *
 * Hero rounds diversify across offered heroes, hide skills, and collapse build
 * variants that share one roster. Skill rounds keep those variants because
 * their different skill plans are visible, but only show teams where an offered
 * skill fills a recommended slot. The full catalogue remains on the Yanwu guide
 * page.
 */
export interface KnownStrongTeamsProps {
  selectedHeroes?: string[];
  candidateHeroes?: string[];
  selectedSkills?: string[];
  candidateSkills?: string[];
  roundType?: RoundType;
}

const KnownStrongTeams = ({
  selectedHeroes = [],
  candidateHeroes = [],
  selectedSkills = [],
  candidateSkills = [],
  roundType = 'hero',
}: KnownStrongTeamsProps) => {
  const showSkills = roundType === 'skill';
  const allRelevant = selectRelevantTeamComps(selectedHeroes, candidateHeroes, {
    includeCandidateOnlyComps: !showSkills && candidateHeroes.length > 0,
    selectedSkills,
    candidateSkills,
  });
  const relevant = showSkills
    ? skillRoundShortlist(allRelevant)
    : heroRoundShortlist(allRelevant, candidateHeroes);

  if (relevant.length === 0) {
    return null;
  }

  const selectedHeroSet = new Set(selectedHeroes);
  const candidateHeroSet = new Set(candidateHeroes);
  const selectedSkillSet = new Set(selectedSkills);
  const candidateSkillSet = new Set(candidateSkills);

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
          <Typography variant="overline" color="error.main">
            阵容提示
          </Typography>
          <Typography component="h2" variant="h6">
            本轮阵容方向
          </Typography>
          {showSkills && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              仅展示本轮战法能够补强的阵容方向。
            </Typography>
          )}
        </Box>
        <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            推荐 {relevant.length} 组
          </Typography>
          <Link
            component={RouterLink}
            to="/guides/yanwu"
            target="_blank"
            rel="noopener noreferrer"
            variant="caption"
            underline="hover"
            sx={{ display: 'inline-block', mt: 0.35 }}
          >
            查看完整阵容库
          </Link>
        </Box>
      </Box>

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
        {relevant.map(({ comp }) => {
          const championship = isChampionshipTeam(comp);
          return (
            <Box
              component="li"
              data-testid="known-team-card"
              key={comp.id}
              aria-label={`${championship ? '夺冠御三家冠军参考' : `${comp.ranking}级阵容`}，阵型${comp.formation}，${comp.members.map(({ hero }) => hero).join('、')}`}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '62px minmax(0, 1fr)', sm: '76px minmax(0, 1fr)' },
                border: '1px solid',
                borderColor: championship ? '#b89543' : 'divider',
                bgcolor: championship ? 'rgba(181,137,48,0.11)' : 'rgba(14,24,22,0.86)',
                boxShadow: championship ? 'inset 3px 0 0 rgba(181,137,48,0.55)' : 'none',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: championship ? '#4a3b22' : '#202d2a',
                  color: championship ? '#f0d28e' : 'text.primary',
                  borderRight: '1px solid',
                  borderColor: championship ? '#b89543' : 'divider',
                  px: 0.6,
                  py: 1,
                  textAlign: 'center',
                }}
              >
                {championship && (
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 800, lineHeight: 1.2, mb: 0.45 }}
                  >
                    夺冠御三家
                  </Typography>
                )}
                <Typography
                  data-testid="team-ranking"
                  sx={{
                    fontFamily: 'Georgia, serif',
                    fontWeight: 800,
                    fontSize: 19,
                    lineHeight: 1.15,
                  }}
                >
                  {comp.ranking}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ opacity: 0.78, fontSize: 10, lineHeight: 1.2, mt: 0.25 }}
                >
                  {championship ? '冠军参考' : '强度'}
                </Typography>
              </Box>

              <Box sx={{ minWidth: 0 }}>
                <Box
                  sx={{
                    px: 1,
                    py: 0.65,
                    borderBottom: '1px solid',
                    borderColor: championship ? 'rgba(184,149,67,0.45)' : 'divider',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 750,
                      color: championship ? '#e1bf72' : 'text.secondary',
                    }}
                  >
                    阵型 · {comp.formation}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: showSkills
                      ? { xs: 'minmax(0, 1fr)', md: `repeat(${comp.members.length}, minmax(0, 1fr))` }
                      : `repeat(${comp.members.length}, minmax(0, 1fr))`,
                    gap: showSkills ? 0.85 : 0.75,
                    p: 0.75,
                  }}
                >
                  {comp.members.map((member, memberIndex) => (
                    <MemberCard
                      key={`${member.hero}-${memberIndex}`}
                      member={member}
                      showSkills={showSkills}
                      ownedHeroes={selectedHeroSet}
                      candidateHeroes={candidateHeroSet}
                      ownedSkills={selectedSkillSet}
                      candidateSkills={candidateSkillSet}
                    />
                  ))}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
};

export default KnownStrongTeams;
