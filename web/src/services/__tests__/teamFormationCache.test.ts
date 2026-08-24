import { describe, expect, test } from 'vitest';
import { teamFormationCacheKey } from '../teamFormationCache';
import type { RecommendationData } from '../../types/recommendation';

describe('teamFormationCacheKey', () => {
  test('invalidates when the scoring relationship contract changes', () => {
    const data = {
      catalog: {
        catalog_version: 'catalog',
        relationship_version: 'relationships-a',
        mechanics_version: 'mechanics-a',
      },
      model: { scoring_version: 'scoring-a' },
      battle_counts: { corpus_version: 'corpus' },
    } as RecommendationData;
    const teams = [{ id: 'guide-a' }] as never[];

    const first = teamFormationCacheKey('pool', data, teams);
    const second = teamFormationCacheKey(
      'pool',
      {
        ...data,
        catalog: { ...data.catalog, relationship_version: 'relationships-b' },
      },
      teams
    );

    expect(first).not.toBe(second);
  });

  test('invalidates when scoring or mechanics semantics change', () => {
    const data = {
      catalog: {
        catalog_version: 'catalog',
        relationship_version: 'relationships',
        mechanics_version: 'mechanics-a',
      },
      model: { scoring_version: 'scoring-a' },
      battle_counts: { corpus_version: 'corpus' },
    } as RecommendationData;
    const teams = [{ id: 'guide-a' }] as never[];
    const original = teamFormationCacheKey('pool', data, teams);
    const scoringChanged = teamFormationCacheKey(
      'pool',
      { ...data, model: { ...data.model, scoring_version: 'scoring-b' } },
      teams
    );
    const mechanicsChanged = teamFormationCacheKey(
      'pool',
      {
        ...data,
        catalog: { ...data.catalog, mechanics_version: 'mechanics-b' },
      },
      teams
    );

    expect(scoringChanged).not.toBe(original);
    expect(mechanicsChanged).not.toBe(original);
  });
});
