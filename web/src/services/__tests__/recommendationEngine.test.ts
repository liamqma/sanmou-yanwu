import { describe, test, expect } from 'vitest';
import {
  recommendHeroSet,
  recommendSkillSet,
  recommendSingleHero,
  recommendTwoSkills,
  getAnalytics,
  currentRosterScore,
} from '../recommendationEngine';
import { recommendationData, database } from '../../data';
import { teamFeatureIds } from '../recommendationModel';
import type { RecommendationData } from '../../types/recommendation';

/** A small synthetic artifact so pure scoring/optimization is deterministic. */
function makeData(overrides: Partial<RecommendationData['model']> = {}): RecommendationData {
  return {
    schema: { version: 2, model_type: 'paired-logistic', feature_families: {}, default_skill_index: 0 },
    catalog: {
      catalog_version: 't',
      relationship_version: 'abcdefabcdef',
      mechanics_version: '123456789abc',
      mechanics: {
        certainty_mode: 'all_reviewed',
        mechanic_names: {},
        skills: {},
      },
      hero_count: 9,
      skill_count: 18,
      default_skill: {},
      relationships: { hero_camp: {}, bonds: [] },
    },
    battle_counts: { total_battles: 100, team1_wins: 50, team2_wins: 50, invalid_battles: 0, corpus_version: 'testhash0000' },
    model: {
      intercept: 0,
      reference_team_score: 0,
      l2_C: 0.5,
      min_support_single: 5,
      min_support_pair: 8,
      min_support_team_context: 12,
      min_support_relationship: 12,
      min_support_high_order: 50,
      min_support_mechanic: 30,
      min_mechanic_pair_diversity: 2,
      team_context_shrinkage: 0.5,
      high_order_shrinkage: 0.35,
      mechanic_shrinkage: 0.25,
      mech_certainty_mode: 'all_reviewed',
      scoring_version: 'fedcbafedcba',
      enabled_families: ['H', 'S', 'HP', 'HS', 'SP'],
      n_features: 0,
      weights: {},
      support: {},
      ...overrides,
    },
    analytics: { prior_win_rate: 0.5, heroes: [], skills: [] },
    backtest: { n_test: 10, accuracy: 0.7, log_loss: 0.5, brier: 0.2, holdout_frac: 0.2, baseline_accuracy: 0.5 },
  };
}

describe('recommendHeroSet — marginal roster-strength ranking', () => {
  const data = makeData({
    weights: { 'H|strong': 1.0, 'H|weak': 0.1, 'HP|ally|strong': 0.5 },
    support: { 'H|strong': 100, 'H|weak': 100, 'HP|ally|strong': 40 },
    n_features: 3,
  });

  test('recommends the set with the greatest marginal improvement over the pool', () => {
    const result = recommendHeroSet(
      [['strong', 'x', 'y'], ['weak', 'x', 'y'], ['z', 'x', 'y']],
      ['ally'],
      data,
    );
    // strong + its synergy with ally should win.
    expect(result.recommended_set).toBe(0);
    const set0 = result.analysis.find((a) => a.set_index === 0)!;
    const set1 = result.analysis.find((a) => a.set_index === 1)!;
    expect(set0.final_score).toBeGreaterThan(set1.final_score);
    // Synergy with the current pool is surfaced.
    expect(set0.synergies.some((s) => s.family === 'HP')).toBe(true);
  });

  test('defers exact-team-only context for offered sets', () => {
    const contextOnly = makeData({
      weights: {
        'HT|a|b|c': 100,
        'HC|3': 100,
        'B|offered': 100,
        'M|debuff:huo_gong|benefits_from|enemy': 100,
      },
      support: {
        'HT|a|b|c': 50,
        'HC|3': 50,
        'B|offered': 50,
        'M|debuff:huo_gong|benefits_from|enemy': 50,
      },
      enabled_families: ['H', 'S', 'HP', 'HS', 'SP', 'HT', 'HC', 'B', 'M'],
      n_features: 4,
    });
    contextOnly.catalog.relationships = {
      hero_camp: { a: '吴', b: '吴', c: '吴' },
      bonds: [{ name: 'offered', required_members: 2, members: ['a', 'b'] }],
    };

    const result = recommendHeroSet(
      [['a', 'b', 'c'], ['x', 'y', 'z']],
      [],
      contextOnly
    );

    expect(result.analysis[0].final_score).toBe(0);
    expect(result.analysis[0].debug.evaluatedFeatures).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: expect.stringMatching(/^(HT|HC|B|M)$/) }),
      ])
    );
  });

  test('does not require an opponent argument (relative strength only)', () => {
    // No opponent parameter exists in the signature; calling with pool only works.
    const result = recommendHeroSet([['a', 'b', 'c']], [], data);
    expect(result.analysis).toHaveLength(1);
    expect(result.analysis[0]).toHaveProperty('final_score');
    expect(result.analysis[0]).toHaveProperty('evidence');
  });

  test('produces deterministic output across calls', () => {
    const a = recommendHeroSet([['strong', 'x', 'y'], ['weak', 'x', 'y']], ['ally'], data);
    const b = recommendHeroSet([['strong', 'x', 'y'], ['weak', 'x', 'y']], ['ally'], data);
    expect(a).toEqual(b);
  });

  test('reports evidence only for marginal features, not the existing pool', () => {
    const evidenceData = makeData({
      weights: { 'H|ally': 5, 'H|candidate': 0.2 },
      support: { 'H|ally': 10_000, 'H|candidate': 16 },
      n_features: 2,
    });

    const result = recommendHeroSet([['candidate']], ['ally'], evidenceData);

    expect(result.analysis[0].evidence).toEqual({
      featureCount: 1,
      totalSupport: 16,
      minSupport: 16,
    });
  });

  test('surfaces negative combo evidence separately from atomic tradeoffs', () => {
    const negativeComboData = makeData({
      weights: {
        'H|candidate': 0.2,
        'HP|ally|candidate': -0.6,
      },
      support: {
        'H|candidate': 50,
        'HP|ally|candidate': 20,
      },
      n_features: 2,
    });

    const result = recommendHeroSet([['candidate']], ['ally'], negativeComboData);

    expect(result.analysis[0].combo_tradeoffs).toEqual([
      expect.objectContaining({ family: 'HP', weight: -0.6 }),
    ]);
  });
});

describe('recommendSkillSet — best hero-routing', () => {
  const data = makeData({
    weights: { 'S|fire': 0.2, 'HS|mage|fire': 0.8, 'HS|tank|fire': -0.3 },
    support: { 'S|fire': 60, 'HS|mage|fire': 30, 'HS|tank|fire': 20 },
    n_features: 3,
  });

  test('routes a skill to the current hero maximising its hero-skill weight', () => {
    const result = recommendSkillSet([['fire', 's2', 's3']], ['mage', 'tank'], [], data);
    const set0 = result.analysis[0];
    // fire routed to mage (0.8) not tank (-0.3), plus standalone 0.2.
    const fireScore = set0.item_scores.find((s) => s.item === 'fire')!.score;
    expect(fireScore).toBeCloseTo((0.2 + 0.8) * 10, 5);
    expect(set0.debug.skillRoutes?.find(({ skill }) => skill === 'fire')).toMatchObject({
      chosenHero: 'mage',
      standalone: { featureId: 'S|fire', weight: 0.2, support: 60 },
      chosenRoute: { featureId: 'HS|mage|fire', weight: 0.8, support: 30 },
      alternatives: [
        {
          hero: 'mage',
          currentPoolIndex: 0,
          rank: 1,
          selected: true,
          featureId: 'HS|mage|fire',
          weight: 0.8,
        },
        {
          hero: 'tank',
          currentPoolIndex: 1,
          rank: 2,
          selected: false,
          featureId: 'HS|tank|fire',
          weight: -0.3,
        },
      ],
      displayTotal: 10,
    });
  });

  test('preserves current-pool order and records the tie-break for equal HS weights', () => {
    const result = recommendSkillSet([['equal']], ['乙', '甲'], [], makeData());
    const route = result.analysis[0].debug.skillRoutes?.[0];

    expect(route).toMatchObject({
      chosenHero: '乙',
      selectionReason:
        'highest HS weight tied; earliest hero in current-pool order won',
      tiedBestHeroes: ['乙', '甲'],
      alternatives: [
        { hero: '乙', currentPoolIndex: 0, rank: 1, selected: true },
        { hero: '甲', currentPoolIndex: 1, rank: 2, selected: false },
      ],
    });
  });
});

describe('currentRosterScore — current pool display score', () => {
  test('hero-only pool: sums hero presence + hero-pair weights (display units)', () => {
    const data = makeData({
      weights: { 'H|a': 0.4, 'H|b': 0.3, 'HP|a|b': 0.5 },
      support: { 'H|a': 60, 'H|b': 50, 'HP|a|b': 40 },
      n_features: 3,
    });
    // (0.4 + 0.3 + 0.5) * 10 display units.
    expect(currentRosterScore(['a', 'b'], [], data)).toBeCloseTo(1.2 * 10, 5);
  });

  test('owned skills add standalone S plus best HS routing onto a current hero', () => {
    const data = makeData({
      weights: {
        'H|mage': 0.5,
        'S|owned': 0.3,
        'HS|mage|owned': 0.2,
        'HS|tank|owned': -0.1,
      },
      support: { 'H|mage': 50, 'S|owned': 40, 'HS|mage|owned': 20, 'HS|tank|owned': 10 },
      n_features: 4,
    });
    // H|mage (0.5) + owned standalone (0.3) + best HS routing to mage (0.2) = 1.0 raw.
    expect(currentRosterScore(['mage', 'tank'], ['owned'], data)).toBeCloseTo(1.0 * 10, 5);
  });

  test('includes support hero + support skills when passed in the pool', () => {
    const data = makeData({
      weights: { 'H|main': 0.4, 'H|support': 0.2, 'HP|main|support': 0.1, 'S|sk': 0.3 },
      support: { 'H|main': 50, 'H|support': 30, 'HP|main|support': 20, 'S|sk': 25 },
      n_features: 4,
    });
    // With support hero + skill in the pool: (0.4 + 0.2 + 0.1 + 0.3) * 10 = 10.0.
    expect(currentRosterScore(['main', 'support'], ['sk'], data)).toBeCloseTo(1.0 * 10, 5);
    // Without them: just H|main = 4.0.
    expect(currentRosterScore(['main'], [], data)).toBeCloseTo(0.4 * 10, 5);
  });

  test('is pure and deterministic across calls', () => {
    const data = makeData({
      weights: { 'H|a': 0.4, 'S|s': 0.2 },
      support: { 'H|a': 60, 'S|s': 40 },
      n_features: 2,
    });
    expect(currentRosterScore(['a'], ['s'], data)).toBe(currentRosterScore(['a'], ['s'], data));
  });

  test('empty pool scores zero', () => {
    const data = makeData({ weights: { 'H|a': 0.4 }, support: { 'H|a': 60 }, n_features: 1 });
    expect(currentRosterScore([], [], data)).toBe(0);
  });

  test('option analysis no longer carries current_score / projected_score', () => {
    const data = makeData({
      weights: { 'H|strong': 1.0, 'H|ally': 0.4 },
      support: { 'H|strong': 100, 'H|ally': 60 },
      n_features: 2,
    });
    const result = recommendHeroSet([['strong', 'x', 'y']], ['ally'], data);
    expect(result.analysis[0]).not.toHaveProperty('current_score');
    expect(result.analysis[0]).not.toHaveProperty('projected_score');
    expect(result.analysis[0]).toHaveProperty('final_score');
  });
});

describe('recommendSingleHero / recommendTwoSkills — support picks', () => {
  const data = makeData({
    weights: { 'H|h1': 1.0, 'H|h2': 0.2, 'HP|cur|h1': 0.5, 'S|sk1': 0.9, 'S|sk2': 0.1 },
    support: { 'H|h1': 100, 'H|h2': 50, 'HP|cur|h1': 30, 'S|sk1': 80, 'S|sk2': 20 },
    n_features: 5,
  });

  test('single-hero result exposes finalScore + details fields', () => {
    const result = recommendSingleHero(['h1', 'h2'], ['cur'], [], data, data.catalog);
    expect(result.hero).toBe('h1');
    const top = result.analysis[0];
    expect(top).toHaveProperty('finalScore');
    expect(top.details).toHaveProperty('individualScore');
    expect(top.details).toHaveProperty('pairScore');
    expect(top.details).toHaveProperty('skillHeroScore');
  });

  test('two-skills returns exactly two skills chosen as a joint pair', () => {
    const result = recommendTwoSkills(['sk1', 'sk2', 'sk3'], ['cur'], [], data);
    // Highest joint presence: sk1 (0.9) + sk2 (0.1) beats any pair with sk3 (0).
    expect(new Set(result.skills)).toEqual(new Set(['sk1', 'sk2']));
    expect(result.skills).toHaveLength(2);
    expect(result.pair).not.toBeNull();
    expect(result.analysis[0]).toHaveProperty('finalScore');
  });

  test('one open support slot returns the strongest single skill', () => {
    const result = recommendTwoSkills(
      ['sk1', 'sk2', 'sk3'],
      ['cur'],
      [],
      data,
      1,
    );

    expect(result.skills).toEqual(['sk1']);
    expect(result.pair).toBeNull();
    expect(result.analysis).toHaveLength(3);
  });

  test('M-only weights do not change unpartitioned support picks', () => {
    const withM = makeData({
      ...data.model,
      enabled_families: [...data.model.enabled_families, 'M'],
      weights: {
        ...data.model.weights,
        'M|debuff:huo_gong|benefits_from|enemy': 999,
      },
      support: {
        ...data.model.support,
        'M|debuff:huo_gong|benefits_from|enemy': 999,
      },
    });
    expect(
      recommendSingleHero(['h1', 'h2'], ['cur'], [], withM, withM.catalog)
    ).toEqual(recommendSingleHero(['h1', 'h2'], ['cur'], [], data, data.catalog));
    expect(
      recommendTwoSkills(['sk1', 'sk2', 'sk3'], ['cur'], [], withM)
    ).toEqual(recommendTwoSkills(['sk1', 'sk2', 'sk3'], ['cur'], [], data));
  });

  test('empty pools fall back gracefully', () => {
    expect(recommendSingleHero([], ['cur'], [], data, data.catalog).hero).toBeNull();
    const r = recommendTwoSkills(['only'], ['cur'], [], data);
    expect(r.skills).toEqual([]);
    expect(r.pair).toBeNull();
  });
});

describe('recommendTwoSkills — joint pair selection with same-hero synergy', () => {
  test('a strong same-hero skill-pair synergy pulls a pair together that a per-skill ranking would split', () => {
    // Per single skill, {a, b} look best (highest S| presence). But c+d, routed
    // to the same hero, unlock a large within-hero SP synergy that makes the
    // joint {c, d} pair the strongest overall.
    const data = makeData({
      weights: {
        'S|a': 1.0,
        'S|b': 0.9,
        'S|c': 0.3,
        'S|d': 0.3,
        // c and d individually route weakly, but together on `mage` they combine.
        'HS|mage|c': 0.1,
        'HS|mage|d': 0.1,
        'SP|mage|c|d': 3.0,
      },
      support: { 'S|a': 50, 'S|b': 50, 'S|c': 40, 'S|d': 40, 'SP|mage|c|d': 25 },
      n_features: 7,
    });
    const r = recommendTwoSkills(['a', 'b', 'c', 'd'], ['mage', 'tank'], [], data);
    expect(new Set(r.skills)).toEqual(new Set(['c', 'd']));
    expect(r.pair?.sameHeroSynergy).toBeGreaterThan(0);
  });

  test('without a same-hero synergy the highest joint presence pair wins', () => {
    const data = makeData({
      weights: { 'S|a': 1.0, 'S|b': 0.9, 'S|c': 0.2 },
      support: { 'S|a': 50, 'S|b': 50, 'S|c': 20 },
      n_features: 3,
    });
    const r = recommendTwoSkills(['a', 'b', 'c'], ['mage'], [], data);
    expect(new Set(r.skills)).toEqual(new Set(['a', 'b']));
    expect(r.pair?.sameHeroSynergy).toBe(0);
  });

  test('is deterministic', () => {
    const data = makeData({ weights: { 'S|a': 0.5, 'S|b': 0.5 }, support: {}, n_features: 2 });
    const a = recommendTwoSkills(['a', 'b', 'c', 'd'], ['h'], [], data);
    const b = recommendTwoSkills(['a', 'b', 'c', 'd'], ['h'], [], data);
    expect(a).toEqual(b);
  });
});

describe('getAnalytics — unified relationship rankings', () => {
  test('exposes only the six enabled relationship families with explicit catalog labels', () => {
    const data = makeData({
      enabled_families: [
        'H',
        'S',
        'HP',
        'HT',
        'HS',
        'THS',
        'B',
        'M',
        'HC',
        'SP',
        'TSP',
      ],
      weights: {
        'HP|甲|乙': 0.8,
        'HP|甲|丙': 0.8,
        'HT|甲|乙|丙': 0.7,
        'HS|甲|火攻': 0.6,
        'THS|乙|治疗': 0.5,
        'B|测试缘分': 0.4,
        'M|debuff:internal_mechanic|benefits_from|enemy': 0.3,
        'HC|3': 9,
        'SP|甲|火攻|治疗': 8,
        'TSP|火攻|治疗': 7,
        'TS3|火攻|治疗|增益': 6,
      },
      support: {
        'HP|甲|乙': 80,
        'HP|甲|丙': 70,
        'HT|甲|乙|丙': 60,
        'HS|甲|火攻': 50,
        'THS|乙|治疗': 40,
        'B|测试缘分': 30,
        'M|debuff:internal_mechanic|benefits_from|enemy': 20,
      },
      n_features: 11,
    });
    data.catalog.relationships.bonds = [
      {
        name: '测试缘分',
        required_members: 2,
        members: ['丙', '乙', '甲'].sort(),
      },
    ];
    data.catalog.mechanics.mechanic_names = {
      'debuff:internal_mechanic': '人类可读机制',
    };

    const analytics = getAnalytics(
      data,
      { heroes: {}, skills: {} } as never
    );
    const rankings = analytics.relationshipRankings;

    expect(analytics.enabledRelationshipFamilies).toEqual(['HP', 'HT', 'HS', 'THS', 'B', 'M']);
    expect(Object.keys(rankings)).toEqual(['HP', 'HT', 'HS', 'THS', 'B', 'M']);
    expect(rankings.HP.map(({ featureId, rank }) => [featureId, rank])).toEqual([
      ['HP|甲|丙', 1],
      ['HP|甲|乙', 2],
    ]);
    expect(rankings.HP[1]).toMatchObject({
      label: '甲 同队 乙',
      weight: 0.8,
      support: 80,
      heroes: ['甲', '乙'],
    });
    expect(rankings.HT[0]).toMatchObject({
      label: '甲、乙、丙 三人同队',
      heroes: ['甲', '乙', '丙'],
    });
    expect(rankings.HS[0]).toMatchObject({
      label: '甲 携带 火攻',
      heroes: ['甲'],
      skills: ['火攻'],
    });
    expect(rankings.THS[0]).toMatchObject({
      label: '乙 队内存在 治疗',
      heroes: ['乙'],
      skills: ['治疗'],
    });
    expect(rankings.B[0]).toMatchObject({
      label: '缘分 · 测试缘分',
      bond: {
        name: '测试缘分',
        required_members: 2,
        members: ['丙', '乙', '甲'].sort(),
      },
    });
    expect(rankings.M[0]).toMatchObject({
      label: '机制联动：人类可读机制 · 受益于（敌方）',
      mechanic: {
        name: '人类可读机制',
        consumerRelationLabel: '受益于',
        sideLabel: '敌方',
      },
    });
    expect(rankings.M[0].label).not.toContain('internal_mechanic');
    expect(JSON.stringify(rankings)).not.toContain('HC|3');
    expect(JSON.stringify(rankings)).not.toContain('SP|');
    expect(JSON.stringify(rankings)).not.toContain('TSP|');
    expect(JSON.stringify(rankings)).not.toContain('TS3|');
  });

  test('retains every fitted row beyond 40 and uses stable feature-id ties', () => {
    const weights = Object.fromEntries(
      Array.from({ length: 45 }, (_, index) => [
        `HP|甲${String(index).padStart(2, '0')}|乙`,
        1,
      ])
    );
    const data = makeData({
      enabled_families: ['HP'],
      weights,
      support: Object.fromEntries(
        Object.keys(weights).map((featureId, index) => [featureId, index])
      ),
      n_features: 45,
    });

    const rankings = getAnalytics(
      data,
      { heroes: {}, skills: {} } as never
    ).relationshipRankings;

    expect(rankings.HP).toHaveLength(45);
    expect(rankings.HP[0].featureId).toBe('HP|甲00|乙');
    expect(rankings.HP[44].featureId).toBe('HP|甲44|乙');
    expect(rankings.HP.map(({ rank }) => rank)).toEqual(
      Array.from({ length: 45 }, (_, index) => index + 1)
    );
    expect(rankings.HT).toEqual([]);
    expect(rankings.HS).toEqual([]);
    expect(rankings.THS).toEqual([]);
    expect(rankings.B).toEqual([]);
    expect(rankings.M).toEqual([]);
  });
});

describe('integration with the real generated artifact', () => {
  test('artifact has the expected schema/shape', () => {
    expect(recommendationData.schema.version).toBe(8);
    expect(recommendationData.schema.model_type).toBe('paired-logistic');
    expect(recommendationData.model.weights).toBeTypeOf('object');
    expect(recommendationData.battle_counts.total_battles).toBeGreaterThan(0);
    expect(recommendationData.catalog.default_skill).toBeTypeOf('object');
    expect(recommendationData.catalog.relationship_version).toMatch(/^[0-9a-f]{12}$/);
    expect(recommendationData.catalog.mechanics_version).toMatch(/^[0-9a-f]{12}$/);
    expect(recommendationData.model.scoring_version).toMatch(/^[0-9a-f]{12}$/);
    expect(recommendationData.model.enabled_families).not.toContain('M');
    expect(recommendationData.model.min_support_mechanic).toBeUndefined();
    expect(recommendationData.model.min_mechanic_pair_diversity).toBeUndefined();
    expect(recommendationData.model.mechanic_shrinkage).toBeUndefined();
    expect(recommendationData.model.mech_certainty_mode).toBeUndefined();
    expect(recommendationData.catalog.relationships.bonds.map((bond) => bond.name).sort())
      .toEqual(Object.keys(database.bonds).sort());
  });

  test('real artifact does not activate mechanics features', () => {
    const feature = 'M|debuff:huo_gong|benefits_from|enemy';
    const team = [
      { name: '陆逊', skills: [] },
      { name: '张昭', skills: ['烈火张天'] },
      { name: '孙权', skills: [] },
    ];
    expect(
      teamFeatureIds(
        team,
        recommendationData.catalog,
        true,
        new Set(recommendationData.model.enabled_families)
      )
    ).not.toContain(feature);
    expect(recommendationData.model.support[feature]).toBeUndefined();
  });

  test('contextual families do not become standalone analytics strength', () => {
    const data = makeData({
      weights: { 'THS|A|skill': 99, 'HT|A|B|C': 88, 'H|A': 1 },
      support: { 'THS|A|skill': 20, 'HT|A|B|C': 50, 'H|A': 20 },
      n_features: 3,
    });
    data.analytics.heroes = [
      { name: 'A', wins: 1, losses: 1, total: 2, win_rate: 0.5, smoothed_win_rate: 0.5 },
    ];

    expect(getAnalytics(data, { heroes: { A: {} }, skills: {} } as never).heroes[0].strength).toBe(1);
  });

  test('getAnalytics returns rankings + model quality', () => {
    const a = getAnalytics(recommendationData, database);
    expect(a.heroes.length).toBeGreaterThan(0);
    expect(a.skills.length).toBeGreaterThan(0);
    expect(a.model_quality).toHaveProperty('accuracy');
    expect(a.summary.total_battles).toBe(recommendationData.battle_counts.total_battles);
    expect(a.skills.find((skill) => skill.name === '星罗棋布')?.shadowTotal).toBe(0);
    expect(a.skills.find((skill) => skill.name === '万人之敌')?.shadowTotal).toBeGreaterThan(0);
    expect(a.enabledRelationshipFamilies).toEqual(['HP', 'HT', 'HS', 'THS', 'B']);
    for (const family of ['HP', 'HT', 'HS', 'THS', 'B', 'M'] as const) {
      const fittedCount = Object.keys(recommendationData.model.weights).filter(
        (featureId) => featureId.startsWith(`${family}|`)
      ).length;
      expect(a.relationshipRankings[family]).toHaveLength(fittedCount);
    }
  });

  test('getAnalytics ranks heroes and skills by 强度加成 (strength) descending', () => {
    const a = getAnalytics(recommendationData, database);

    const isNonIncreasing = (xs: number[]) =>
      xs.every((v, i) => i === 0 || xs[i - 1] >= v);
    const heroStrengths = a.heroes.map((h) => h.strength);
    const skillStrengths = a.skills.map((s) => s.strength);
    expect(isNonIncreasing(heroStrengths)).toBe(true);
    expect(isNonIncreasing(skillStrengths)).toBe(true);

    // Not vacuously sorted: the real artifact must actually exercise the
    // ordering, i.e. there is a strictly decreasing step in each list, and the
    // strength order genuinely differs from a smoothed-win-rate ordering.
    expect(heroStrengths.some((v, i) => i > 0 && heroStrengths[i - 1] > v)).toBe(true);
    expect(skillStrengths.some((v, i) => i > 0 && skillStrengths[i - 1] > v)).toBe(true);

    const byWinRateDesc = (
      xs: ReturnType<typeof getAnalytics>['heroes'],
    ) =>
      [...xs]
        .sort(
          (p, q) =>
            q.smoothedWinRate - p.smoothedWinRate ||
            q.total - p.total ||
            p.name.localeCompare(q.name),
        )
        .map((e) => e.name);
    expect(a.heroes.map((h) => h.name)).not.toEqual(byWinRateDesc(a.heroes));
    expect(a.skills.map((s) => s.name)).not.toEqual(byWinRateDesc(a.skills));
  });

  test('recommendHeroSet on the real artifact ranks all three offered sets', () => {
    const r = recommendHeroSet(
      [['孙权', '陆抗', '陆逊'], ['祝融', '孟获', '甘夫人'], ['张宁', '左慈', '孙坚']],
      [],
      recommendationData,
    );
    expect(r.analysis).toHaveLength(3);
    expect([0, 1, 2]).toContain(r.recommended_set);
  });
});
