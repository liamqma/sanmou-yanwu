import { describe, test, expect } from 'vitest';
import {
  teamFeatureIds,
  teamFeatureValues,
  scoreTeam,
  weightOf,
  supportOf,
  nonDefaultSkillsForHero,
  type AssignedHero,
} from '../recommendationModel';
import type {
  PairedModel,
  RecommendationCatalog,
  RecommendationMechanics,
} from '../../types/recommendation';

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

describe('semantic mechanics', () => {
  const mechanics: RecommendationMechanics = {
    schema_version: 1,
    mechanics_version: 'test',
    default_skill: { carrier: 'none', 陆逊: '火烧连营' },
    statuses: {
      火攻: { family: 'debuff', negative: true, controlling: false },
    },
    skills: {
      烈火张天: {
        probability: 0.5,
        features: { 'TYPE|主动': 1 },
        provides: ['火攻'],
        consumes: [],
        removes: [],
        immunities: [],
      },
      火烧连营: {
        probability: 0.6,
        features: { 'TYPE|主动': 1 },
        provides: ['火攻'],
        consumes: ['火攻'],
        removes: [],
        immunities: [],
      },
    },
  };

  test('attributes external status synergy to the beneficiary, not the carrier', () => {
    const features = teamFeatureValues(
      [
        { name: 'carrier', skills: ['烈火张天'] },
        { name: '陆逊', skills: [] },
      ],
      mechanics
    );

    expect(features.get('MX|火攻')).toBeCloseTo(0.3, 6);
    expect(features.get('HMX|陆逊|火攻')).toBeCloseTo(0.3, 6);
    expect(features.has('HMX|carrier|火攻')).toBe(false);
  });

  test('probability changes scale the contextual feature', () => {
    const changed: RecommendationMechanics = {
      ...mechanics,
      skills: {
        ...mechanics.skills,
        烈火张天: { ...mechanics.skills.烈火张天, probability: 0.4 },
      },
    };
    const features = teamFeatureValues(
      [
        { name: 'carrier', skills: ['烈火张天'] },
        { name: '陆逊', skills: [] },
      ],
      changed
    );
    expect(features.get('HMX|陆逊|火攻')).toBeCloseTo(0.24, 6);
  });
});

describe('scoreTeam', () => {
  const model: PairedModel = {
    intercept: 0.5,
    l2_C: 0.5,
    min_support_single: 5,
    min_support_pair: 8,
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
});

describe('nonDefaultSkillsForHero', () => {
  test('drops the catalog default skill', () => {
    expect(nonDefaultSkillsForHero('A', ['defA', 's1', 's2'], catalog)).toEqual(['s1', 's2']);
  });
});
