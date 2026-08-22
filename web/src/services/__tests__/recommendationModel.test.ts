import { describe, test, expect } from 'vitest';
import {
  teamFeatureIds,
  scoreTeam,
  weightOf,
  supportOf,
  nonDefaultSkillsForHero,
  type AssignedHero,
} from '../recommendationModel';
import type { PairedModel, RecommendationCatalog } from '../../types/recommendation';

const catalog: RecommendationCatalog = {
  catalog_version: 'test',
  relationship_version: 'relationships-test',
  hero_count: 2,
  skill_count: 3,
  default_skill: { A: 'defA', B: 'defB' },
  relationships: {
    hero_camp: { A: '吴', B: '吴', C: '蜀' },
    bonds: [
      { name: '测试缘分', required_members: 2, members: ['A', 'B', 'C'] },
    ],
  },
};

describe('teamFeatureIds', () => {
  test('encodes heroes, non-default skills, pairs and hero-skill features (order independent)', () => {
    const team: AssignedHero[] = [
      { name: 'B', skills: ['s2', 's1'] },
      { name: 'A', skills: ['s1'] },
    ];
    const feats = teamFeatureIds(team);
    // Hero presence
    expect(feats.has('H|A')).toBe(true);
    expect(feats.has('H|B')).toBe(true);
    // Hero pair is sorted (order independent)
    expect(feats.has('HP|A|B')).toBe(true);
    expect(feats.has('HP|B|A')).toBe(false);
    // Skill presence + hero-skill assignment
    expect(feats.has('S|s1')).toBe(true);
    expect(feats.has('HS|A|s1')).toBe(true);
    expect(feats.has('HS|B|s2')).toBe(true);
    // Within-hero skill pair (sorted)
    expect(feats.has('SP|B|s1|s2')).toBe(true);
  });

  test('is deterministic regardless of hero/skill ordering', () => {
    const a = teamFeatureIds([{ name: 'A', skills: ['x', 'y'] }, { name: 'B', skills: [] }]);
    const b = teamFeatureIds([{ name: 'B', skills: [] }, { name: 'A', skills: ['y', 'x'] }]);
    expect([...a].sort()).toEqual([...b].sort());
  });

  test('emits concrete team context with readable identity contracts', () => {
    const features = teamFeatureIds(
      [
        { name: 'B', skills: ['fire', 'b'] },
        { name: 'A', skills: ['a'] },
        { name: 'C', skills: ['c'] },
      ],
      catalog.relationships
    );

    expect(features).toContain('THS|A|fire');
    expect(features).toContain('THS|C|fire');
    expect(features).toContain('TSP|a|fire');
    expect(features).toContain('HT|A|B|C');
    expect(features).toContain('TS3|a|b|fire');
    expect(features).toContain('HC|2');
    expect(features).toContain('B|测试缘分');
  });

  test('carrier reassignment preserves THS/TSP while changing HS/SP', () => {
    const first = teamFeatureIds([
      { name: 'A', skills: ['fire', 'a'] },
      { name: 'B', skills: ['b', 'c'] },
      { name: 'C', skills: ['d', 'e'] },
    ]);
    const moved = teamFeatureIds([
      { name: 'A', skills: ['b', 'a'] },
      { name: 'B', skills: ['fire', 'c'] },
      { name: 'C', skills: ['d', 'e'] },
    ]);
    const family = (features: Set<string>, prefix: string) =>
      [...features].filter((feature) => feature.startsWith(`${prefix}|`)).sort();

    expect(family(first, 'THS')).toEqual(family(moved, 'THS'));
    expect(family(first, 'TSP')).toEqual(family(moved, 'TSP'));
    expect(family(first, 'HS')).not.toEqual(family(moved, 'HS'));
    expect(family(first, 'SP')).not.toEqual(family(moved, 'SP'));
  });

  test('does not emit concrete relationships for partial or global pools', () => {
    const offeredSet = teamFeatureIds(
      [
        { name: 'A', skills: ['a'] },
        { name: 'B', skills: ['b'] },
        { name: 'C', skills: ['c'] },
      ],
      catalog.relationships,
      false
    );
    const global = teamFeatureIds(
      [
        { name: 'A', skills: ['a'] },
        { name: 'B', skills: ['b'] },
        { name: 'C', skills: ['c'] },
        { name: 'D', skills: ['d'] },
      ],
      catalog.relationships
    );
    for (const features of [offeredSet, global]) {
      expect(
        [...features].some((feature) => /^(THS|TSP|HT|TS3|HC|B)\|/.test(feature))
      ).toBe(false);
    }
  });
});

describe('scoreTeam', () => {
  const model: PairedModel = {
    intercept: 0.5,
    l2_C: 0.5,
    min_support_single: 5,
    min_support_pair: 8,
    min_support_team_context: 12,
    min_support_relationship: 12,
    min_support_high_order: 50,
    team_context_shrinkage: 0.5,
    high_order_shrinkage: 0.35,
    enabled_families: ['H', 'HP'],
    n_features: 3,
    weights: { 'H|A': 1.0, 'H|B': 0.5, 'HP|A|B': 0.25 },
    support: { 'H|A': 100, 'H|B': 50, 'HP|A|B': 30 },
  };

  test('sums fitted weights of active features (excludes intercept)', () => {
    const s = scoreTeam([{ name: 'A', skills: [] }, { name: 'B', skills: [] }], model);
    expect(s).toBeCloseTo(1.75, 6);
  });

  test('unseen features contribute the neutral prior of 0', () => {
    const s = scoreTeam([{ name: 'Z', skills: ['unknown'] }], model);
    expect(s).toBe(0);
    expect(weightOf(model, 'H|Z')).toBe(0);
    expect(supportOf(model, 'H|Z')).toBe(0);
  });

  test('bonds and tactic pairs never activate across separate formation teams', () => {
    const contextual: PairedModel = {
      ...model,
      enabled_families: ['H', 'S', 'HP', 'HS', 'SP', 'TSP', 'B'],
      weights: { 'TSP|x|y': 2, 'B|测试缘分': 3 },
      support: { 'TSP|x|y': 20, 'B|测试缘分': 20 },
      n_features: 2,
    };
    const first = [
      { name: 'A', skills: ['x'] },
      { name: 'X', skills: [] },
      { name: 'Y', skills: [] },
    ];
    const second = [
      { name: 'B', skills: ['y'] },
      { name: 'M', skills: [] },
      { name: 'N', skills: [] },
    ];
    const together = [
      { name: 'A', skills: ['x'] },
      { name: 'B', skills: ['y'] },
      { name: 'C', skills: [] },
    ];

    expect(
      scoreTeam(first, contextual, catalog.relationships) +
        scoreTeam(second, contextual, catalog.relationships)
    ).toBe(0);
    expect(scoreTeam(together, contextual, catalog.relationships)).toBe(5);
  });

  test('missing context weights preserve existing concrete-team behavior', () => {
    const withContextEnabled: PairedModel = {
      ...model,
      enabled_families: [
        ...model.enabled_families,
        'THS',
        'TSP',
        'HT',
        'TS3',
        'HC',
        'B',
      ],
    };
    const team = [
      { name: 'A', skills: ['s1'] },
      { name: 'B', skills: ['s2'] },
      { name: 'C', skills: ['s3'] },
    ];

    expect(scoreTeam(team, withContextEnabled, catalog.relationships)).toBe(
      scoreTeam(team, model)
    );
  });
});

describe('nonDefaultSkillsForHero', () => {
  test('drops the catalog default skill', () => {
    expect(nonDefaultSkillsForHero('A', ['defA', 's1', 's2'], catalog)).toEqual(['s1', 's2']);
  });
});
