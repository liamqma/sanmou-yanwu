import { describe, expect, test } from 'vitest';
import { teamFormationCacheKey } from '../teamFormationCache';
import type { RecommendationData } from '../../types/recommendation';

describe('teamFormationCacheKey', () => {
  test('invalidates when the scoring relationship contract changes', () => {
    const data = {
      catalog: {
        catalog_version: 'catalog',
        relationship_version: 'relationships-a',
      },
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
});
