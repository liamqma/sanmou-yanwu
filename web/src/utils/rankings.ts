import type { HeroRanking, TeamRanking } from '../types/domain';

const HERO_RANKING_ORDER: Record<HeroRanking, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
};

const TEAM_RANKING_ORDER: Record<TeamRanking, number> = {
  S: 0,
  A: 1,
  B: 2,
};

/** Unknown or absent values sort after every supported presentation tier. */
export const heroRankingRank = (
  ranking: HeroRanking | string | null | undefined
): number =>
  ranking != null && ranking in HERO_RANKING_ORDER
    ? HERO_RANKING_ORDER[ranking as HeroRanking]
    : Number.MAX_SAFE_INTEGER;

/** Unknown or absent values sort after every supported known-team tier. */
export const teamRankingRank = (
  ranking: TeamRanking | string | null | undefined
): number =>
  ranking != null && ranking in TEAM_RANKING_ORDER
    ? TEAM_RANKING_ORDER[ranking as TeamRanking]
    : Number.MAX_SAFE_INTEGER;
