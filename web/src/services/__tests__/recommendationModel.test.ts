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
    heroes: {},
    bonds: {},
    audit: {
      skill_count: 2,
      token_count: 0,
      reference_only_status_mentions: {},
      unknown_status_terms: {},
      unknown_bond_status_terms: {},
      hero_count: 0,
      bond_count: 0,
    },
    skills: {
      烈火张天: {
        probability: 0.5,
        features: { 'TYPE|主动': 1 },
        provides: ['火攻'],
        consumes: [],
        removes: [],
        immunities: [],
        counters: [],
        references: [],
      },
      火烧连营: {
        probability: 0.6,
        features: { 'TYPE|主动': 1 },
        provides: ['火攻'],
        consumes: ['火攻'],
        removes: [],
        immunities: [],
        counters: [],
        references: [],
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

  test('adds standardized hero, camp, troop-match, scaling, and bond features', () => {
    const extended: RecommendationMechanics = {
      ...mechanics,
      heroes: {
        carrier: {
          signature: 'none',
          camp: '蜀',
          troop: '盾',
          stats: { 武力: 200, 智力: 100, 统率: 180, 先攻: 150 },
          normalized_stats: { 武力: 0.8, 智力: 0.4, 统率: 0.72, 先攻: 0.6 },
        },
        陆逊: {
          signature: '火烧连营',
          camp: '蜀',
          troop: '盾',
          stats: { 武力: 100, 智力: 225, 统率: 180, 先攻: 150 },
          normalized_stats: { 武力: 0.4, 智力: 0.9, 统率: 0.72, 先攻: 0.6 },
        },
      },
      skills: {
        ...mechanics.skills,
        烈火张天: {
          ...mechanics.skills.烈火张天,
          features: {
            ...mechanics.skills.烈火张天.features,
            'SCALES_WITH|武力': 1,
            'TROOP_TARGET|盾': 1,
          },
        },
      },
      bonds: {
        测试缘分: {
          probability: 1,
          required_members: 2,
          members: ['carrier', '陆逊'],
          recipient_scope: 'active_members',
          features: { 'STATUS|provides|火攻': 1 },
          provides: ['火攻'],
          consumes: [],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
      },
    };
    const features = teamFeatureValues(
      [
        { name: 'carrier', skills: ['烈火张天'] },
        { name: '陆逊', skills: [] },
      ],
      extended
    );

    expect(features.get('HM|STAT|武力')).toBeCloseTo(1.2, 6);
    expect(features.get('HC|SAME|2')).toBeCloseTo(0.05, 6);
    expect(features.get('HSM|武力')).toBeCloseTo(0.4, 6);
    expect(features.get('HTM|盾')).toBeCloseTo(1 / 3, 6);
    expect(features.get('B|测试缘分')).toBe(1);
    expect(features.get('BM|STATUS|provides|火攻')).toBeCloseTo(2 / 3, 6);
  });

  test('keeps a member-scoped bond status from benefiting an unrelated hero', () => {
    const scoped: RecommendationMechanics = {
      ...mechanics,
      default_skill: { 关羽: 'none', 关平: 'none', 外将: 'consumer' },
      skills: {
        consumer: {
          probability: 1,
          features: {},
          provides: [],
          consumes: ['火攻'],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
      },
      bonds: {
        义薄云天: {
          probability: 1,
          required_members: 2,
          members: ['关羽', '关平'],
          recipient_scope: 'active_members',
          features: {},
          provides: ['火攻'],
          consumes: [],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
      },
    };

    const unrelated = teamFeatureValues(
      [
        { name: '关羽', skills: [] },
        { name: '关平', skills: [] },
        { name: '外将', skills: [] },
      ],
      scoped
    );
    const member = teamFeatureValues(
      [
        { name: '关羽', skills: ['consumer'] },
        { name: '关平', skills: [] },
      ],
      scoped
    );

    expect(unrelated.has('HMX|外将|火攻')).toBe(false);
    expect(member.get('HMX|关羽|火攻')).toBe(1);
  });

  test('does not match a self-inflicted status to an enemy-status consumer', () => {
    const scoped: RecommendationMechanics = {
      ...mechanics,
      default_skill: { provider: 'self-disarm', consumer: 'enemy-consumer' },
      skills: {
        'self-disarm': {
          probability: 1,
          features: {},
          provides: ['火攻'],
          provides_scopes: { 火攻: ['self'] },
          consumes: [],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
        'enemy-consumer': {
          probability: 1,
          features: {},
          provides: [],
          consumes: ['火攻'],
          consumes_scopes: { 火攻: ['enemy'] },
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
      },
    };

    const features = teamFeatureValues(
      [
        { name: 'provider', skills: [] },
        { name: 'consumer', skills: [] },
      ],
      scoped
    );

    expect(features.has('MX|火攻')).toBe(false);
    expect(features.has('HMX|consumer|火攻')).toBe(false);
  });

  test('matches self providers to team consumers using event probabilities', () => {
    const scoped: RecommendationMechanics = {
      ...mechanics,
      default_skill: { provider: 'self-buff', consumer: 'team-consumer' },
      skills: {
        'self-buff': {
          probability: 1,
          features: {},
          provides: ['火攻'],
          provides_events: [
            { status: '火攻', recipient_scope: 'self', probability: 0.8 },
          ],
          consumes: [],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
        'team-consumer': {
          probability: 1,
          features: {},
          provides: [],
          consumes: ['火攻'],
          consumes_events: [
            { status: '火攻', recipient_scope: 'team', probability: 1 },
          ],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
      },
    };

    const features = teamFeatureValues(
      [
        { name: 'provider', skills: [] },
        { name: 'consumer', skills: [] },
      ],
      scoped
    );

    expect(features.get('MX|火攻')).toBeCloseTo(0.8, 6);
    expect(features.get('HMX|consumer|火攻')).toBeCloseTo(0.8, 6);
  });

  test('counts multiple scopes from one correlated status event once', () => {
    const correlated: RecommendationMechanics = {
      ...mechanics,
      default_skill: { provider: 'mixed-provider' },
      skills: {
        'mixed-provider': {
          probability: 1,
          features: {},
          provides: ['火攻'],
          provides_events: [
            {
              status: '火攻',
              recipient_scope: 'ally',
              probability: 0.9,
              event_id: 'probability:0',
            },
            {
              status: '火攻',
              recipient_scope: 'enemy',
              probability: 0.9,
              event_id: 'probability:0',
            },
          ],
          consumes: [],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
      },
    };

    const features = teamFeatureValues([{ name: 'provider', skills: [] }], correlated);

    expect(features.get('MP|火攻')).toBeCloseTo(0.9, 6);
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
