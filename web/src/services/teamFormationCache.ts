import type { FormationRecommendation } from './recommendationEngine';
import type { RecommendationData } from '../types/recommendation';
import type { TeamComp } from '../types/domain';

const cache = new Map<string, FormationRecommendation>();

export function teamFormationCacheKey(
  poolKey: string,
  recommendationData: RecommendationData,
  teamComps: TeamComp[]
): string {
  return JSON.stringify({
    policy: 'positive-evidence-v2',
    poolKey,
    catalog: recommendationData.catalog.catalog_version,
    corpus: recommendationData.battle_counts.corpus_version,
    teams: teamComps.map(({ id }) => id),
  });
}

export const getCachedTeamFormation = (
  key: string
): FormationRecommendation | null => cache.get(key) ?? null;

export const setCachedTeamFormation = (
  key: string,
  recommendation: FormationRecommendation
): void => {
  cache.set(key, recommendation);
};
