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

describe('concrete team context', () => {
  const contextCatalog: RecommendationCatalog = {
    catalog_version: 'context', hero_count: 4, skill_count: 8,
    default_skill: { 甲: '自循环', 乙: '乙签名', 丙: '丙签名', 丁: '丁签名' },
    mechanics_version: 'm1',
    hero_camp: { 甲: '吴', 乙: '吴', 丙: '蜀', 丁: '吴' },
    bonds: [
      { name: '二人缘', required_members: 2, members: ['乙', '甲'] },
      { name: '三人缘', required_members: 3, members: ['丙', '乙', '甲'] },
    ],
    skill_mechanics: {
      自循环: { provides: ['火攻'], benefitsFrom: ['火攻'] },
      供火: { provides: ['火攻'], benefitsFrom: [] },
      乙签名: { provides: [], benefitsFrom: [] },
      丙签名: { provides: [], benefitsFrom: [] },
    },
  };

  test('matches Python identity/camp/bond behavior and carrier movement preserves THS/TSP', () => {
    const first = teamFeatureIds([
      { name: '甲', skills: ['烈火', '甲技'] },
      { name: '乙', skills: ['乙技1', '乙技2'] },
      { name: '丙', skills: ['丙技1', '丙技2'] },
    ], contextCatalog);
    const moved = teamFeatureIds([
      { name: '甲', skills: ['甲技', '乙技1'] },
      { name: '乙', skills: ['烈火', '乙技2'] },
      { name: '丙', skills: ['丙技1', '丙技2'] },
    ], contextCatalog);
    const families = (features: Set<string>, prefixes: string[]) =>
      [...features].filter((feature) => prefixes.some((prefix) => feature.startsWith(`${prefix}|`))).sort();
    expect(families(first, ['THS', 'TSP'])).toEqual(families(moved, ['THS', 'TSP']));
    expect(families(first, ['HS', 'SP'])).not.toEqual(families(moved, ['HS', 'SP']));
    expect(first).toContain('HT|丙|乙|甲');
    expect(first).toContain('HC|2');
    expect(first).not.toContain('HC|3');
    expect(first).toContain('B|二人缘');
    expect(first).toContain('B|三人缘');
    expect([...first].filter((feature) => feature.startsWith('TS3|'))).toHaveLength(20);
    expect([...first].some((feature) => /^TS[456]\|/.test(feature))).toBe(false);
  });

  test('MECH never self-matches, but an external same-team provider activates MX/HMX', () => {
    const self = teamFeatureIds([
      { name: '甲', skills: [] }, { name: '乙', skills: [] }, { name: '丙', skills: [] },
    ], contextCatalog);
    expect(self).not.toContain('MX|火攻');
    expect(self).not.toContain('HMX|甲|火攻');
    const external = teamFeatureIds([
      { name: '甲', skills: [] }, { name: '乙', skills: ['供火'] }, { name: '丙', skills: [] },
    ], contextCatalog);
    expect(external).toContain('MX|火攻');
    expect(external).toContain('HMX|甲|火攻');
    expect(external).not.toContain('S|自循环');
    expect(external).not.toContain('HS|甲|自循环');
  });

  test('partial/global pools defer every concrete-only family', () => {
    const partial = teamFeatureIds([
      { name: '甲', skills: ['供火'] }, { name: '乙', skills: [] },
    ], contextCatalog);
    expect([...partial].some((feature) => /^(THS|TSP|HT|HC|B|MX|HMX|TS3)\|/.test(feature))).toBe(false);
  });

  test('applies enabled-family selection to legacy and context families alike', () => {
    const team = [
      { name: '甲', skills: ['烈火', '甲技'] },
      { name: '乙', skills: ['乙技1'] },
      { name: '丙', skills: [] },
    ];

    expect([...teamFeatureIds(team, contextCatalog, ['H'])].sort()).toEqual([
      'H|丙',
      'H|乙',
      'H|甲',
    ]);
    expect([...teamFeatureIds(team, contextCatalog, ['TSP'])].sort()).toEqual([
      'TSP|乙技1|烈火',
      'TSP|乙技1|甲技',
      'TSP|烈火|甲技',
    ]);
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
