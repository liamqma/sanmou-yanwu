import { describe, expect, test } from 'vitest';
import { recommendationData, validateRecommendationData } from '../../data';

describe('recommendation artifact validation boundary', () => {
  test('accepts the generated schema-v6 reviewed mechanics artifact', () => {
    expect(recommendationData.schema.version).toBe(6);
    expect(recommendationData.catalog.mechanics_version).toMatch(/^[0-9a-f]{16}$/);
    expect(recommendationData.catalog.bonds?.length).toBeGreaterThan(0);
  });

  test('fails closed when mechanics metadata is missing or stale-shaped', () => {
    const missing = structuredClone(recommendationData) as unknown as Record<string, any>;
    delete missing.catalog.mechanics_version;
    expect(() => validateRecommendationData(missing)).toThrow(/mechanics metadata/);

    const malformed = structuredClone(recommendationData) as unknown as Record<string, any>;
    malformed.catalog.skill_mechanics['火烧连营'].provides = '火攻';
    expect(() => validateRecommendationData(malformed)).toThrow(/reviewed mechanics/);
  });
});
