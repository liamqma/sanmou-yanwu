import { describe, expect, test } from 'vitest';
import { labelFeature } from '../recommendationEngine';

describe('team-context evidence labels', () => {
  test.each([
    ['THS|陆逊|烈火张天', '陆逊 · 烈火张天'],
    ['TSP|烈火张天|风助火势', '烈火张天 + 风助火势'],
    ['HC|3', '3人同阵营'],
    ['B|柱石之臣', '缘分 · 柱石之臣'],
    ['MX|火攻', '火攻状态配合'],
    ['HMX|陆逊|火攻', '陆逊 · 火攻状态配合'],
  ])('%s is readable', (featureId, expected) => {
    expect(labelFeature(featureId).label).toBe(expected);
  });
});
