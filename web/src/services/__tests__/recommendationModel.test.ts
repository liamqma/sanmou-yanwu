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
  hero_count: 2,
  skill_count: 3,
  default_skill: { A: 'defA', B: 'defB' },
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
});

describe('scoreTeam', () => {
  const model: PairedModel = {
    intercept: 0.5,
    l2_C: 0.5,
    min_support_single: 5,
    min_support_pair: 8,
    n_features: 3,
    unseen_weight_strategy: 'family-median-negative',
    unseen_weight_scale: 0.25,
    unseen_weights: { H: -0.1, S: -0.2, HP: -0.3, HS: -0.4, SP: -0.5 },
    weights: { 'H|A': 1.0, 'H|B': 0.5, 'HP|A|B': 0.25 },
    support: { 'H|A': 100, 'H|B': 50, 'HP|A|B': 30 },
  };

  test('sums fitted weights of active features (excludes intercept)', () => {
    const s = scoreTeam([{ name: 'A', skills: [] }, { name: 'B', skills: [] }], model);
    expect(s).toBeCloseTo(1.75, 6);
  });

  test('unseen features use pessimistic priors for every family', () => {
    const s = scoreTeam([
      { name: 'Z', skills: ['u1', 'u2'] },
      { name: 'Y', skills: [] },
    ], model);
    // 2 H, 2 S, 1 HP, 2 HS, and 1 SP unseen features.
    expect(s).toBeCloseTo(-2.2, 6);
    expect(weightOf(model, 'H|Z')).toBe(-0.1);
    expect(weightOf(model, 'S|u1')).toBe(-0.2);
    expect(weightOf(model, 'HP|Y|Z')).toBe(-0.3);
    expect(weightOf(model, 'HS|Z|u1')).toBe(-0.4);
    expect(weightOf(model, 'SP|Z|u1|u2')).toBe(-0.5);
    expect(supportOf(model, 'H|Z')).toBe(0);
  });
});

describe('nonDefaultSkillsForHero', () => {
  test('drops the catalog default skill', () => {
    expect(nonDefaultSkillsForHero('A', ['defA', 's1', 's2'], catalog)).toEqual(['s1', 's2']);
  });
});
