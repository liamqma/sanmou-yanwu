import { describe, test, expect } from 'vitest';
import {
  recommendHeroSet,
  recommendSkillSet,
  recommendSingleHero,
  recommendTwoSkills,
  recommendTeams,
  recommendHybridTeams,
  recommendHybridTeamsCooperatively,
  enumerateFormationPartitions,
  PARTITION_EVAL_CAP,
  getAnalytics,
  currentRosterScore,
} from '../recommendationEngine';
import { recommendationData, database } from '../../data';
import type { RecommendationData } from '../../types/recommendation';
import type { TeamComp } from '../../types/domain';
import {
  TEN_ROUND_HERO_POOL,
  TEN_ROUND_SKILL_POOL,
} from './fixtures/tenRoundFormationFixture';

/** A small synthetic artifact so pure scoring/optimization is deterministic. */
function makeData(overrides: Partial<RecommendationData['model']> = {}): RecommendationData {
  return {
    schema: { version: 2, model_type: 'paired-logistic', feature_families: {}, default_skill_index: 0 },
    catalog: { catalog_version: 't', hero_count: 9, skill_count: 18, default_skill: {} },
    battle_counts: { total_battles: 100, team1_wins: 50, team2_wins: 50, invalid_battles: 0, corpus_version: 'testhash0000' },
    model: {
      intercept: 0,
      l2_C: 0.5,
      min_support_single: 5,
      min_support_pair: 8,
      n_features: 0,
      weights: {},
      support: {},
      ...overrides,
    },
    analytics: { prior_win_rate: 0.5, heroes: [], skills: [] },
    backtest: { n_test: 10, accuracy: 0.7, log_loss: 0.5, brier: 0.2, holdout_frac: 0.2, baseline_accuracy: 0.5 },
  };
}

const makeTeamComp = (
  id: string,
  heroes: [string, string, string],
  skillSlots: [
    [string[], string[]],
    [string[], string[]],
    [string[], string[]],
  ],
  options: {
    formation?: string;
    ranking?: TeamComp['ranking'];
    sources?: TeamComp['sources'];
  } = {}
): TeamComp => ({
  id,
  ranking: options.ranking ?? 'S',
  sources: options.sources ?? ['strong'],
  section: 'test',
  formation: options.formation ?? '测试阵',
  members: heroes.map((hero, index) => ({
    hero,
    skillSlots: skillSlots[index],
  })) as TeamComp['members'],
});

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
  });

  test('values an external status provider when a current hero signature consumes it', () => {
    const mechanics = {
      schema_version: 1,
      mechanics_version: 'test',
      default_skill: { 陆逊: '火烧连营', carrier: 'none' },
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
        火烧连营: {
          probability: 0.6,
          features: {},
          provides: ['火攻'],
          consumes: ['火攻'],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
        烈火张天: {
          probability: 0.5,
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
    const semanticData = makeData({
      mechanics,
      weights: { 'HMX|陆逊|火攻': 2 },
      support: { 'HMX|陆逊|火攻': 100 },
      n_features: 1,
    });

    const result = recommendSkillSet(
      [['烈火张天'], ['普通战法']],
      ['陆逊', 'carrier'],
      [],
      semanticData
    );

    expect(result.recommended_set).toBe(0);
    expect(result.analysis[0].combo_synergies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'HMX', label: '陆逊 · 火攻状态配合' }),
      ])
    );
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

  test('empty pools fall back gracefully', () => {
    expect(recommendSingleHero([], ['cur'], [], data, data.catalog).hero).toBeNull();
    const r = recommendTwoSkills(['only'], ['cur'], [], data);
    expect(r.skills).toEqual([]);
    expect(r.pair).toBeNull();
  });

  test('still recommends support skills when current hero slots are full', () => {
    const result = recommendTwoSkills(
      ['sk1', 'sk2', 'sk3'],
      ['h1', 'h2'],
      ['owned1', 'owned2', 'owned3', 'owned4'],
      data
    );

    expect(result.skills).toHaveLength(2);
    expect(result.pair).not.toBeNull();
  });
});

describe('skill-set recommendations — shared roster scoring', () => {
  test('scores offered skills together with already-owned status providers', () => {
    const skillRow = (provides: string[], consumes: string[]) => ({
      probability: 1,
      features: {},
      provides,
      consumes,
      provides_scopes: Object.fromEntries(provides.map((status) => [status, ['enemy'] as Array<'enemy'>])),
      consumes_scopes: Object.fromEntries(consumes.map((status) => [status, ['enemy'] as Array<'enemy'>])),
      removes: [],
      immunities: [],
      counters: [],
      references: [],
    });
    const mechanics = {
      schema_version: 5,
      mechanics_version: 'skill-round-context',
      default_skill: { beneficiary: 'none', carrier: 'none' },
      statuses: {
        火攻: { family: 'debuff', negative: true, controlling: false },
      },
      heroes: {},
      bonds: {},
      skills: {
        provider: skillRow(['火攻'], []),
        consumer: skillRow([], ['火攻']),
        fillerA: skillRow([], []),
        fillerB: skillRow([], []),
        strongA: skillRow([], []),
        strongB: skillRow([], []),
      },
      audit: {
        skill_count: 6,
        token_count: 0,
        reference_only_status_mentions: {},
        unknown_status_terms: {},
        unknown_bond_status_terms: {},
        hero_count: 0,
        bond_count: 0,
      },
    };
    const contextual = makeData({
      mechanics,
      weights: {
        'HMX|beneficiary|火攻': 2,
        'S|strongA': 0.6,
        'S|strongB': 0.6,
      },
      support: {
        'HMX|beneficiary|火攻': 30,
        'S|strongA': 20,
        'S|strongB': 20,
      },
      n_features: 3,
    });

    const result = recommendSkillSet(
      [
        ['consumer', 'fillerA', 'fillerB'],
        ['strongA', 'strongB', 'fillerA'],
      ],
      ['beneficiary', 'carrier'],
      ['provider'],
      contextual
    );

    expect(result.recommended_set).toBe(0);
    expect(result.analysis[0].combo_synergies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'HMX', label: 'beneficiary · 火攻状态配合' }),
      ])
    );
  });
  test('globally selects a provider-consumer pair over an earlier filler', () => {
    const skillRow = (provides: string[], consumes: string[]) => ({
      probability: 1,
      features: {},
      provides,
      consumes,
      provides_scopes: Object.fromEntries(
        provides.map((status) => [status, ['enemy' as const]])
      ),
      consumes_scopes: Object.fromEntries(
        consumes.map((status) => [status, ['enemy' as const]])
      ),
      removes: [],
      immunities: [],
      counters: [],
      references: [],
    });
    const contextual = makeData({
      mechanics: {
        schema_version: 6,
        mechanics_version: 'global-routing',
        default_skill: { beneficiary: 'none' },
        statuses: {
          火攻: { family: 'debuff', negative: true, controlling: false },
        },
        heroes: {},
        bonds: {},
        skills: {
          filler: skillRow([], []),
          provider: skillRow(['火攻'], []),
          consumer: skillRow([], ['火攻']),
          strongA: skillRow([], []),
          strongB: skillRow([], []),
          dud: skillRow([], []),
        },
        audit: {
          skill_count: 6,
          token_count: 0,
          reference_only_status_mentions: {},
          unknown_status_terms: {},
          unknown_bond_status_terms: {},
          hero_count: 0,
          bond_count: 0,
        },
      },
      weights: {
        'S|filler': 1,
        'S|strongA': 2,
        'S|strongB': 2,
        'HMX|beneficiary|火攻': 10,
      },
      support: {},
      n_features: 4,
    });

    const result = recommendSkillSet(
      [
        ['provider', 'consumer', 'dud'],
        ['strongA', 'strongB', 'dud'],
      ],
      ['beneficiary'],
      ['filler'],
      contextual
    );

    expect(result.recommended_set).toBe(0);
    expect(result.analysis[0].combo_synergies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'HMX' }),
      ])
    );
  });
});

describe('support picks — comprehensive mechanic scoring', () => {
  test('prefers a hero that activates a bond over a stronger atomic hero', () => {
    const mechanics = {
      schema_version: 3,
      mechanics_version: 'support-bond',
      default_skill: { ally: 'none', bonded: 'none', atomic: 'none' },
      statuses: {},
      heroes: {},
      skills: {},
      bonds: {
        bond: {
          probability: 1,
          required_members: 2,
          members: ['ally', 'bonded'],
          recipient_scope: 'active_members' as const,
          features: {},
          provides: [],
          consumes: [],
          removes: [],
          immunities: [],
          counters: [],
          references: [],
        },
      },
      audit: {
        skill_count: 0,
        token_count: 0,
        reference_only_status_mentions: {},
        unknown_status_terms: {},
        unknown_bond_status_terms: {},
        hero_count: 0,
        bond_count: 1,
      },
    };
    const data = makeData({
      mechanics,
      weights: { 'H|atomic': 0.5, 'B|bond': 1 },
      support: { 'H|atomic': 50, 'B|bond': 30 },
      n_features: 2,
    });

    const result = recommendSingleHero(
      ['atomic', 'bonded'],
      ['ally'],
      [],
      data,
      data.catalog
    );

    expect(result.hero).toBe('bonded');
  });

  test('uses the current skill pool when jointly routing support skills', () => {
    const skillRow = (provides: string[], consumes: string[]) => ({
      probability: 1,
      features: {},
      provides,
      consumes,
      removes: [],
      immunities: [],
      counters: [],
      references: [],
    });
    const mechanics = {
      schema_version: 3,
      mechanics_version: 'support-status',
      default_skill: { beneficiary: 'none', carrier: 'none' },
      statuses: {
        火攻: { family: 'debuff', negative: true, controlling: false },
      },
      heroes: {},
      bonds: {},
      skills: {
        provider: skillRow(['火攻'], []),
        consumer: skillRow([], ['火攻']),
        filler: skillRow([], []),
        strongA: skillRow([], []),
        strongB: skillRow([], []),
      },
      audit: {
        skill_count: 5,
        token_count: 0,
        reference_only_status_mentions: {},
        unknown_status_terms: {},
        unknown_bond_status_terms: {},
        hero_count: 0,
        bond_count: 0,
      },
    };
    const data = makeData({
      mechanics,
      weights: {
        'HMX|beneficiary|火攻': 2,
        'S|strongA': 0.6,
        'S|strongB': 0.6,
      },
      support: {
        'HMX|beneficiary|火攻': 30,
        'S|strongA': 20,
        'S|strongB': 20,
      },
      n_features: 3,
    });

    const result = recommendTwoSkills(
      ['consumer', 'filler', 'strongA', 'strongB'],
      ['beneficiary', 'carrier'],
      ['provider'],
      data
    );

    expect(result.skills).toContain('consumer');
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

describe('recommendTeams — global formation optimization', () => {
  test('returns incomplete for pools smaller than 9 heroes / 18 skills', () => {
    const data = makeData();
    const r = recommendTeams(['a', 'b', 'c'], ['s1', 's2'], data, data.catalog);
    expect(r.incomplete).toBe(true);
    expect(r.options).toHaveLength(0);
  });

  test('is incomplete when skills contain duplicates that leave fewer than 18 unique', () => {
    const data = makeData();
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    // 20 entries but only 17 unique skills → not enough for 18 unique.
    const dupSkills = [
      ...Array.from({ length: 17 }, (_, i) => `s${i}`),
      's0',
      's1',
      's2',
    ];
    const r = recommendTeams(heroes, dupSkills, data, data.catalog);
    expect(r.incomplete).toBe(true);
    expect(r.options).toHaveLength(0);
  });

  test('assigns exactly 9 unique heroes and 18 unique skills, 2 per hero, no signature skill', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    // Every hero has a signature skill in the pool; none may receive its own.
    const data = makeData();
    const catalog = {
      catalog_version: 't',
      hero_count: 9,
      skill_count: 18,
      default_skill: Object.fromEntries(heroes.map((hero, i) => [hero, `s${i}`])),
    };
    const r = recommendTeams(heroes, skills, data, catalog);
    expect(r.incomplete).toBe(false);
    const teams = r.options[0].teams;
    const allHeroes = teams.flatMap((t) => t.heroes.map((h) => h.name));
    expect(new Set(allHeroes).size).toBe(9);
    const allSkills = teams.flatMap((t) => t.heroes.flatMap((h) => h.skills));
    expect(allSkills).toHaveLength(18);
    expect(new Set(allSkills).size).toBe(18);
    teams.forEach((t) => t.heroes.forEach((h) => expect(h.skills).toHaveLength(2)));
    for (const hero of teams.flatMap((t) => t.heroes)) {
      expect(hero.skills).not.toContain(catalog.default_skill[hero.name]);
    }
  });

  test('splits 9 heroes into three disjoint 3-hero teams with unique 18 skills', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    // Give a couple of heroes strong pair weights so partitioning is non-trivial.
    const data = makeData({
      weights: { 'HP|h0|h1': 1.0, 'HS|h0|s0': 0.5 },
      support: { 'HP|h0|h1': 30, 'HS|h0|s0': 20 },
      n_features: 2,
    });
    const r = recommendTeams(heroes, skills, data, data.catalog);
    expect(r.incomplete).toBe(false);
    const teams = r.options[0].teams;
    expect(teams).toHaveLength(3);
    // Disjoint heroes across all teams (9 unique).
    const allHeroes = teams.flatMap((t) => t.heroes.map((h) => h.name));
    expect(new Set(allHeroes).size).toBe(9);
    // Unique 18-skill assignment, 2 per hero.
    const allSkills = teams.flatMap((t) => t.heroes.flatMap((h) => h.skills));
    expect(new Set(allSkills).size).toBe(allSkills.length);
    teams.forEach((t) => t.heroes.forEach((h) => expect(h.skills.length).toBeLessThanOrEqual(2)));
    // Exposes up to three options and no aggregate/optimiser-internal summaries.
    expect(r.options.length).toBeGreaterThanOrEqual(1);
    expect(r.options.length).toBeLessThanOrEqual(3);
    expect(r).not.toHaveProperty('totalScore');
    expect(r).not.toHaveProperty('objective');
    expect(r).not.toHaveProperty('weakestTeamStrength');
    expect(r).not.toHaveProperty('balanceSpread');
    expect(r).not.toHaveProperty('aggregateStrength');
    // Each team carries its own display 评分.
    r.options.forEach((opt) =>
      opt.teams.forEach((t) => expect(typeof t.strength).toBe('number'))
    );
  });

  test('hero-skill and skill-pair affinity influences the skill assignment', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    // s0/s1 pay off strongly specifically on h0 — both via HS and their SP pair.
    const data = makeData({
      weights: {
        'HS|h0|s0': 2.0,
        'HS|h0|s1': 2.0,
        'SP|h0|s0|s1': 3.0,
      },
      support: { 'HS|h0|s0': 30, 'HS|h0|s1': 30, 'SP|h0|s0|s1': 20 },
      n_features: 3,
    });
    const r = recommendTeams(heroes, skills, data, data.catalog);
    const h0 = r.options[0].teams.flatMap((t) => t.heroes).find((h) => h.name === 'h0')!;
    // The strongly-affine pair is routed onto h0.
    expect(new Set(h0.skills)).toEqual(new Set(['s0', 's1']));
  });

  // Shared CI can exceed Vitest's 5s default here; the realistic benchmark
  // below retains its separate 5s performance budget.
  test('positive SP potential keeps an individually weak decisive pair in the 28→18 shortlist', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 28 }, (_, i) => `s${i}`);
    const weights: Record<string, number> = {};
    // A standalone-only shortlist would take exactly s0..s17 and discard both
    // weak pair members. Their joint value on h0 is decisive, so both must
    // survive candidate pruning and be assigned together.
    for (let i = 0; i < 18; i += 1) weights[`S|s${i}`] = 1;
    weights['S|s26'] = -0.5;
    weights['S|s27'] = -0.5;
    weights['SP|h0|s26|s27'] = 4;
    const data = makeData({
      weights,
      support: {},
      n_features: Object.keys(weights).length,
    });

    const r = recommendTeams(heroes, skills, data, data.catalog);
    const h0 = r.options[0].teams
      .flatMap((team) => team.heroes)
      .find((hero) => hero.name === 'h0')!;

    expect(new Set(h0.skills)).toEqual(new Set(['s26', 's27']));
  }, 15000);

  test('skill routing strengthens the top two teams before spending value on the third', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const weights: Record<string, number> = {
      // Force two clearly dominant hero trios and leave h6/h7/h8 as team three.
      'HP|h0|h1': 10,
      'HP|h0|h2': 10,
      'HP|h1|h2': 10,
      'HP|h3|h4': 8,
      'HP|h3|h5': 8,
      'HP|h4|h5': 8,
      // Greedy affinity initially prefers s0 on h6, but doing so only improves
      // team three. Routing it to h0 gives less total gain while making a main
      // team stronger, so the top-two-weighted swap objective must choose h0.
      'HS|h6|s0': 1,
      'HS|h0|s0': 0.6,
    };
    const data = makeData({ weights, support: {}, n_features: Object.keys(weights).length });

    const r = recommendTeams(heroes, skills, data, data.catalog);
    const assigned = new Map(
      r.options[0].teams.flatMap((team) => team.heroes.map((hero) => [hero.name, hero.skills] as const))
    );

    expect(assigned.get('h0')).toContain('s0');
    expect(assigned.get('h6')).not.toContain('s0');
  });

  test('hero-pair affinity changes which heroes team up (selection follows the model)', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    // h0+h1 and h2+h3 are strong pairs → they should end up as teammates.
    const data = makeData({
      weights: { 'HP|h0|h1': 5.0, 'HP|h2|h3': 5.0 },
      support: { 'HP|h0|h1': 40, 'HP|h2|h3': 40 },
      n_features: 2,
    });
    const r = recommendTeams(heroes, skills, data, data.catalog);
    const teamOf = (name: string) =>
      r.options[0].teams.findIndex((t) => t.heroes.some((h) => h.name === name));
    expect(teamOf('h0')).toBe(teamOf('h1'));
    expect(teamOf('h2')).toBe(teamOf('h3'));
  });

  test('exposes at most three options, option one is the recommended winner', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: { 'H|h0': 1.0, 'H|h1': 0.5, 'HP|h0|h1': 0.8, 'HS|h0|s0': 0.4 },
      support: { 'H|h0': 50, 'H|h1': 50, 'HP|h0|h1': 30, 'HS|h0|s0': 20 },
      n_features: 4,
    });
    const r = recommendTeams(heroes, skills, data, data.catalog);
    expect(r.incomplete).toBe(false);
    // At most three options; the recommended one is first.
    expect(r.options.length).toBeGreaterThanOrEqual(1);
    expect(r.options.length).toBeLessThanOrEqual(3);
    // No aggregate total score anywhere in the result.
    expect(r).not.toHaveProperty('totalScore');
  });

  test('options use distinct canonical hero partitions in deterministic order', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: { 'H|h0': 1.0, 'H|h1': 0.5, 'HP|h0|h1': 0.8, 'HS|h0|s0': 0.4 },
      support: { 'H|h0': 50, 'H|h1': 50, 'HP|h0|h1': 30, 'HS|h0|s0': 20 },
      n_features: 4,
    });
    const r = recommendTeams(heroes, skills, data, data.catalog);
    // Canonical partition key for an option: teams as sorted hero-sets, sorted.
    const canonKey = (opt: (typeof r.options)[number]) =>
      opt.teams
        .map((t) => [...t.heroes.map((h) => h.name)].sort().join('|'))
        .sort()
        .join('||');
    const keys = r.options.map(canonKey);
    // One fixed-output assertion covers deterministic option selection without
    // repeating the expensive full formation search in the same test.
    expect(keys).toEqual([
      'h0|h1|h2||h3|h4|h5||h6|h7|h8',
      'h0|h1|h3||h2|h4|h6||h5|h7|h8',
      'h0|h1|h4||h2|h3|h7||h5|h6|h8',
    ]);
    // Every option is a distinct canonical partition.
    expect(new Set(keys).size).toBe(keys.length);
    // With 9 heroes and non-degenerate weights, three distinct options exist.
    expect(r.options.length).toBe(3);
    // Every alternative remains within the same 2.5-point top-two strength
    // band as the recommended option (allowing 0.1 for display rounding).
    const topTwo = r.options.map((opt) =>
      opt.teams
        .map((team) => team.strength)
        .sort((a, b) => b - a)
        .slice(0, 2)
        .reduce((sum, score) => sum + score, 0)
    );
    expect(Math.max(...topTwo) - Math.min(...topTwo)).toBeLessThanOrEqual(2.6);
  });

  test('all options derive from the already-evaluated capped partition set (no extra enumeration)', () => {
    // Every option's canonical hero partition must be one of the partitions the
    // (capped) enumeration produced — options are selected from the already
    // scored candidates, never enumerated or scored afresh.
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: { 'H|h0': 1.0, 'H|h1': 0.5, 'HP|h0|h1': 0.8, 'HS|h0|s0': 0.4 },
      support: { 'H|h0': 50, 'H|h1': 50, 'HP|h0|h1': 30, 'HS|h0|s0': 20 },
      n_features: 4,
    });
    const canonKey = (teams: string[][]) =>
      teams
        .map((t) => [...t].sort().join('|'))
        .sort()
        .join('||');
    const enumerated = new Set(
      enumerateFormationPartitions(heroes, data.model, {}).map((trios) => canonKey(trios))
    );
    const r = recommendTeams(heroes, skills, data, data.catalog);
    for (const opt of r.options) {
      const key = canonKey(opt.teams.map((t) => t.heroes.map((h) => h.name)));
      expect(enumerated.has(key)).toBe(true);
    }
    // The evaluated partition set stays within the performance cap.
    expect(enumerated.size).toBeLessThanOrEqual(PARTITION_EVAL_CAP);
  });

  test('ranks by the two strongest teams (top-two sum), third team secondary', () => {
    // Three tight pairs h0h1, h2h3, h4h5 with descending pair strength, and a
    // weaker option to fill the third team. The optimiser should concentrate
    // strength into the top two teams rather than spreading it evenly.
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: { 'HP|h0|h1': 6.0, 'HP|h2|h3': 5.0, 'HP|h4|h5': 1.0 },
      support: { 'HP|h0|h1': 40, 'HP|h2|h3': 40, 'HP|h4|h5': 20 },
      n_features: 3,
    });
    const r = recommendTeams(heroes, skills, data, data.catalog);
    const teamOf = (name: string) => r.options[0].teams.findIndex((t) => t.heroes.some((h) => h.name === name));
    // The two strongest pairs stay together on the two strongest teams.
    expect(teamOf('h0')).toBe(teamOf('h1'));
    expect(teamOf('h2')).toBe(teamOf('h3'));
    // Those pairs are NOT split into the same (third) team.
    expect(teamOf('h0')).not.toBe(teamOf('h2'));
  });

  test('within the tolerance band prefers same-camp teams', () => {
    // All heroes/pairs are neutral, so every partition ties on strength and the
    // camp preference can group each set of three together.
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData();
    const meta = Object.fromEntries(
      heroes.map((hero, index) => [
        hero,
        { camp: index < 3 ? 'A' : index < 6 ? 'B' : 'C' },
      ])
    );
    const r = recommendTeams(heroes, skills, data, data.catalog, meta);
    expect(
      r.options[0].teams.every(
        (team) =>
          new Set(team.heroes.map((hero) => meta[hero.name].camp)).size === 1
      )
    ).toBe(true);
  });

  test('camp preference never overrides a real strength gap larger than the band', () => {
    // A dominant pair worth far more than 2.5 display points must team up even
    // if that prevents an otherwise possible all-same-camp partition.
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: { 'HP|h0|h1': 5.0 },
      support: { 'HP|h0|h1': 40 },
      n_features: 1,
    });
    const camps = ['A', 'B', 'A', 'A', 'B', 'B', 'C', 'C', 'C'];
    const meta = Object.fromEntries(heroes.map((hero, index) => [
      hero,
      { camp: camps[index] },
    ]));
    const r = recommendTeams(heroes, skills, data, data.catalog, meta);
    const teamOf = (name: string) => r.options[0].teams.findIndex((t) => t.heroes.some((h) => h.name === name));
    expect(teamOf('h0')).toBe(teamOf('h1'));
  });

  test('considers the full 15-hero pool before the bounded partition prune', () => {
    const heroes = Array.from({ length: 15 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 28 }, (_, i) => `s${i}`);
    // h14 is last by individual weight and would have been removed by the old
    // top-12 pre-trim. Its strong HP synergy with h13 makes their trio globally
    // useful, so evaluating the complete pool must keep both as teammates.
    const weights: Record<string, number> = {};
    for (let i = 0; i < 14; i++) weights[`H|h${i}`] = (14 - i) * 0.01;
    weights['HP|h13|h14'] = 4;
    const data = makeData({ weights, support: {}, n_features: Object.keys(weights).length });
    const catalog = {
      ...data.catalog,
      hero_count: heroes.length,
      skill_count: skills.length,
      default_skill: Object.fromEntries(heroes.map((hero, i) => [hero, `s${i}`])),
    };

    const enumeratedHeroes = new Set(
      enumerateFormationPartitions(heroes, data.model, {}).flat(2)
    );
    expect(enumeratedHeroes).toEqual(new Set(heroes));

    const r = recommendTeams(heroes, skills, data, catalog);
    expect(r.incomplete).toBe(false);
    const placed = new Set(r.options[0].teams.flatMap((t) => t.heroes.map((h) => h.name)));
    expect(placed).toContain('h13');
    expect(placed).toContain('h14');
    const teamOf = (name: string) =>
      r.options[0].teams.findIndex((team) =>
        team.heroes.some((hero) => hero.name === name)
      );
    expect(teamOf('h13')).toBe(teamOf('h14'));
    expect(placed.size).toBe(9);

    const assignedSkills = r.options[0].teams.flatMap((team) =>
      team.heroes.flatMap((hero) => hero.skills)
    );
    expect(assignedSkills).toHaveLength(18);
    expect(new Set(assignedSkills).size).toBe(18);

    const r2 = recommendTeams(heroes, skills, data, catalog);
    expect(r2).toEqual(r);
  }, 60000);

  test('fully evaluates a hero whose decisive HS value is invisible to hero-only pruning', () => {
    const heroes = Array.from({ length: 15 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 28 }, (_, i) => `s${i}`);
    const weights: Record<string, number> = {};
    for (let i = 0; i < 14; i += 1) weights[`H|h${i}`] = 2;
    // h14 is far below every other hero in the H/HP-only beam, but becomes the
    // best main-team hero once the full assignment can route s27 onto it.
    weights['H|h14'] = -20;
    weights['HS|h14|s27'] = 30;
    const data = makeData({
      weights,
      support: {},
      n_features: Object.keys(weights).length,
    });
    const catalog = {
      ...data.catalog,
      hero_count: heroes.length,
      skill_count: skills.length,
      default_skill: Object.fromEntries(heroes.map((hero, i) => [hero, `s${i}`])),
    };

    const partitions = enumerateFormationPartitions(heroes, data.model, {});
    expect(
      partitions.some((partition) => partition.flat().includes('h14'))
    ).toBe(true);

    const r = recommendTeams(heroes, skills, data, catalog);
    const placed = r.options[0].teams.flatMap((team) => team.heroes);
    const h14 = placed.find((hero) => hero.name === 'h14');
    expect(h14?.skills).toContain('s27');
  }, 10000);

  test('deterministically caps out-of-contract 16+ hero pools before enumeration', () => {
    const heroes = Array.from({ length: 17 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const weights = Object.fromEntries(
      heroes.map((hero, i) => [`H|${hero}`, heroes.length - i])
    );
    const data = makeData({
      weights,
      support: {},
      n_features: Object.keys(weights).length,
    });
    const catalog = {
      ...data.catalog,
      hero_count: heroes.length,
      default_skill: Object.fromEntries(heroes.map((hero, i) => [hero, `s${i}`])),
    };

    const partitions = enumerateFormationPartitions(heroes, data.model, {});
    const again = enumerateFormationPartitions([...heroes].reverse(), data.model, {});
    const covered = new Set(partitions.flat(2));
    expect(covered).toEqual(new Set(heroes.slice(0, 15)));
    expect(partitions.length).toBeLessThanOrEqual(PARTITION_EVAL_CAP);
    expect(again).toEqual(partitions);

    const r = recommendTeams(heroes, skills, data, catalog);
    const placed = r.options[0].teams.flatMap((team) =>
      team.heroes.map((hero) => hero.name)
    );
    expect(placed.every((hero) => !['h15', 'h16'].includes(hero))).toBe(true);
  }, 10000);

  test('realistic 15-hero / 28-skill round-10 pool stays within the interactive budget', () => {
    const heroMeta = Object.fromEntries(
      TEN_ROUND_HERO_POOL.map((name) => [
        name,
        {
          camp: database.heroes[name].camp,
        },
      ])
    );

    const partitions = enumerateFormationPartitions(
      [...TEN_ROUND_HERO_POOL],
      recommendationData.model,
      heroMeta
    );
    expect(new Set(partitions.flat(2))).toEqual(new Set(TEN_ROUND_HERO_POOL));
    expect(partitions.length).toBeLessThanOrEqual(PARTITION_EVAL_CAP);
    expect(
      enumerateFormationPartitions(
        [...TEN_ROUND_HERO_POOL],
        recommendationData.model,
        heroMeta
      )
    ).toEqual(partitions);

    const startedAt = performance.now();
    const r = recommendTeams(
      [...TEN_ROUND_HERO_POOL],
      [...TEN_ROUND_SKILL_POOL],
      recommendationData,
      recommendationData.catalog,
      heroMeta
    );
    const elapsedMs = performance.now() - startedAt;

    expect(r.incomplete).toBe(false);
    expect(r.options.length).toBeGreaterThan(0);
    for (const option of r.options) {
      const assignedHeroes = option.teams.flatMap((team) => team.heroes);
      expect(assignedHeroes).toHaveLength(9);
      expect(new Set(assignedHeroes.map((hero) => hero.name)).size).toBe(9);
      const assignedSkills = assignedHeroes.flatMap((hero) => hero.skills);
      expect(assignedSkills).toHaveLength(18);
      expect(new Set(assignedSkills).size).toBe(18);
      for (const hero of assignedHeroes) {
        expect(hero.skills).toHaveLength(2);
        expect(hero.skills).not.toContain(
          recommendationData.catalog.default_skill[hero.name]
        );
      }
    }
    // Leave headroom for shared/CI hosts while guarding against an accidental
    // return to unbounded full-partition evaluation. The engineering target on
    // a developer machine is approximately two seconds.
    expect(elapsedMs).toBeLessThan(5_000);
    console.info(`recommendTeams 15 heroes / 28 skills: ${elapsedMs.toFixed(1)} ms`);
  }, 20000);

  test('presentation rankings do not affect recommendation scoring', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData();
    const first = Object.fromEntries(
      heroes.map((hero, index) => [
        hero,
        { camp: index % 2 ? 'A' : 'B', ranking: index < 3 ? 'S' : 'D' },
      ])
    );
    const second = Object.fromEntries(
      heroes.map((hero, index) => [
        hero,
        { camp: index % 2 ? 'A' : 'B', ranking: index < 3 ? 'D' : 'S' },
      ])
    );
    const a = recommendTeams(heroes, skills, data, data.catalog, first);
    const b = recommendTeams(heroes, skills, data, data.catalog, second);
    expect(a).toEqual(b);
  });

  test('bounds the fully-evaluated partition set and keeps a deterministic strength/camp mix', () => {
    // A 12-hero pool is where the beam over-produces: unioning strength- and
    // camp-ranked slices per level can exceed the previous ~1920 search
    // bound. The cap must hold that fully-evaluated set at PARTITION_EVAL_CAP,
    // deterministically, without dropping either flavour of candidate.
    const heroes = Array.from({ length: 12 }, (_, i) => `h${i}`);
    // Varied hero weights make the strength ranking non-degenerate, while four
    // camps of three provide several camp-cohesive partitions.
    const weights: Record<string, number> = {};
    heroes.forEach((h, i) => {
      weights[`H|${h}`] = (12 - i) * 0.1;
    });
    const data = makeData({ weights, support: {}, n_features: heroes.length });
    const meta = Object.fromEntries(
      heroes.map((hero, index) => [
        hero,
        { camp: ['A', 'B', 'C', 'D'][Math.floor(index / 3)] },
      ])
    );

    const parts = enumerateFormationPartitions(heroes, data.model, meta);
    // The camp-only beam can naturally produce slightly fewer candidates than
    // the cap, but the fully evaluated set must never exceed it.
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.length).toBeLessThanOrEqual(PARTITION_EVAL_CAP);

    // Every retained partition is a valid disjoint 3×3 over distinct heroes.
    for (const trios of parts) {
      const flat = trios.flat();
      expect(flat).toHaveLength(9);
      expect(new Set(flat).size).toBe(9);
    }

    // The camp-ranked half of the interleave keeps at least one fully cohesive
    // three-team partition that a pure strength truncation could discard.
    const sameCampTeamCount = (trios: string[][]) =>
      trios.filter(
        (trio) => new Set(trio.map((hero) => meta[hero].camp)).size === 1
      ).length;
    expect(Math.max(...parts.map(sameCampTeamCount))).toBe(3);

    // Deterministic: byte-identical partition sequence across repeated calls
    // (the production pool is always canonically weight-sorted, so the input
    // order the beam sees is itself fixed).
    const again = enumerateFormationPartitions(heroes, data.model, meta);
    expect(again).toEqual(parts);
  }, 30000);

  test('tolerates missing and partial camp metadata', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData();
    // Only some heroes carry metadata; no camp on others. Must still complete.
    const meta = { h0: {}, h1: { camp: 'A' } };
    const r = recommendTeams(heroes, skills, data, data.catalog, meta);
    expect(r.incomplete).toBe(false);
    expect(r.options[0].teams).toHaveLength(3);
    // Same result whether metadata is omitted entirely or empty.
    const noMeta = recommendTeams(heroes, skills, data, data.catalog);
    const emptyMeta = recommendTeams(heroes, skills, data, data.catalog, {});
    expect(noMeta).toEqual(emptyMeta);
  });

  test('surfaces only positive, grouped evidence (no deductions) per team', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: {
        'HP|h0|h1': 0.9,
        'HS|h0|s0': 0.7,
        'SP|h0|s0|s1': 0.6,
        // A negative feature that must never appear in evidence.
        'HP|h0|h2': -0.9,
      },
      support: { 'HP|h0|h1': 40, 'HS|h0|s0': 30, 'SP|h0|s0|s1': 25, 'HP|h0|h2': 40 },
      n_features: 4,
    });
    const r = recommendTeams(heroes, skills, data, data.catalog);
    for (const team of r.options[0].teams) {
      expect(team).toHaveProperty('evidence');
      const { heroSynergy, heroSkill, skillSynergy } = team.evidence;
      for (const group of [heroSynergy, heroSkill, skillSynergy]) {
        expect(group.length).toBeLessThanOrEqual(2);
        for (const row of group) {
          expect(row.gain).toBeGreaterThan(0);
          expect(row).toHaveProperty('label');
          expect(row).toHaveProperty('support');
        }
      }
    }
    // The strong positive HP fires as hero-synergy on h0/h1's team.
    const h0Team = r.options[0].teams.find((t) => t.heroes.some((h) => h.name === 'h0'))!;
    expect(h0Team.evidence.heroSynergy.some((e) => e.label.includes('h0'))).toBe(true);
    // No evidence row anywhere reflects the negative feature.
    const allLabels = r.options[0].teams.flatMap((t) => [
      ...t.evidence.heroSynergy,
      ...t.evidence.heroSkill,
      ...t.evidence.skillSynergy,
    ]);
    expect(allLabels.every((e) => e.gain > 0)).toBe(true);
  });

  test('does not surface a positive contribution that displays as 加分 +0.0', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: { 'HS|h0|s0': 0.004 },
      support: { 'HS|h0|s0': 20 },
      n_features: 1,
    });

    const r = recommendTeams(heroes, skills, data, data.catalog);
    const h0Team = r.options[0].teams.find((team) => team.heroes.some((hero) => hero.name === 'h0'))!;

    expect(h0Team.heroes.find((hero) => hero.name === 'h0')!.skills).toContain('s0');
    expect(h0Team.evidence.heroSkill).toEqual([]);
  });
});

describe('recommendHybridTeams — evidence-only partial placement', () => {
  const heroes = Array.from({ length: 9 }, (_, index) => `h${index}`);
  const skills = Array.from({ length: 18 }, (_, index) => `s${index}`);
  const slotsFor = (offset: number): [
    [string[], string[]],
    [string[], string[]],
    [string[], string[]],
  ] => [
    [[`s${offset}`], [`s${offset + 1}`]],
    [[`s${offset + 2}`], [`s${offset + 3}`]],
    [[`s${offset + 4}`], [`s${offset + 5}`]],
  ];

  test('preserves canonical slots for a confident two-hero guide core', () => {
    const data = makeData({
      weights: {
        'H|h0': 0.4,
        'H|h2': 0.3,
        'HP|h0|h2': 0.5,
        'S|s0': 0.2,
        'HS|h0|s0': 0.4,
        'S|s4': 0.2,
        'HS|h2|s4': 0.3,
      },
      support: {
        'H|h0': 10,
        'H|h2': 10,
        'HP|h0|h2': 16,
        'S|s0': 10,
        'HS|h0|s0': 16,
        'S|s4': 10,
        'HS|h2|s4': 16,
      },
      n_features: 7,
    });
    const partial = makeTeamComp(
      'partial',
      ['h0', 'h1', 'h2'],
      slotsFor(0),
      { formation: '局部阵' }
    );

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [partial]
    );
    const matched = result.options[0].teams[0];

    expect(matched.formation).toBe('局部阵');
    expect(matched.knownTeam).toMatchObject({
      id: 'partial',
      matchedHeroSlots: 2,
      totalHeroSlots: 3,
      matchedSkillSlots: 2,
    });
    expect(matched.heroes.map(({ name, slotIndex }) => [name, slotIndex])).toEqual([
      ['h0', 0],
      ['h2', 2],
    ]);
    expect(matched.heroes[0].skillSlots).toEqual(['s0', null]);
    expect(matched.heroes[1].skillSlots).toEqual(['s4', null]);
  });

  test('reserves qualified guide skills for a partial core before a stronger model pair', () => {
    const data = makeData({
      weights: {
        'H|h0': 0.4,
        'H|h2': 0.3,
        'HP|h0|h2': 0.5,
        'S|s0': 0.1,
        'HS|h0|s0': 0.1,
        'S|s1': 0.1,
        'HS|h0|s1': 0.1,
        'S|s2': 0.5,
        'HS|h0|s2': 0.5,
        'S|s3': 0.5,
        'HS|h0|s3': 0.5,
        'SP|h0|s2|s3': 1,
      },
      support: {
        'H|h0': 10,
        'H|h2': 10,
        'HP|h0|h2': 16,
        'S|s0': 10,
        'HS|h0|s0': 16,
        'S|s1': 10,
        'HS|h0|s1': 16,
        'S|s2': 10,
        'HS|h0|s2': 16,
        'S|s3': 10,
        'HS|h0|s3': 16,
        'SP|h0|s2|s3': 8,
      },
      n_features: 12,
    });
    const partial = makeTeamComp(
      'partial-guide-first',
      ['h0', 'missing-guide-hero', 'h2'],
      [
        [['s0'], ['s1']],
        [['missing-0'], ['missing-1']],
        [['missing-2'], ['missing-3']],
      ]
    );

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [partial]
    );
    const h0 = result.options[0].teams[0].heroes.find(
      ({ name }) => name === 'h0'
    );

    expect(h0?.skillSlots).toEqual(['s0', 's1']);
    expect(h0?.skills).not.toContain('s2');
    expect(h0?.skills).not.toContain('s3');
  });

  test('does not reserve a partial-guide skill that fails S or HS support', () => {
    const data = makeData({
      weights: {
        'H|h0': 0.4,
        'H|h2': 0.3,
        'HP|h0|h2': 0.5,
        'S|s0': 10,
        'HS|h0|s0': 10,
        'S|s1': 0.2,
        'HS|h0|s1': 0.3,
        'S|s2': 10,
        'HS|h0|s2': 10,
      },
      support: {
        'H|h0': 10,
        'H|h2': 10,
        'HP|h0|h2': 16,
        'S|s0': 4,
        'HS|h0|s0': 16,
        'S|s1': 10,
        'HS|h0|s1': 16,
        'S|s2': 10,
        'HS|h0|s2': 7,
      },
      n_features: 9,
    });
    const partial = makeTeamComp(
      'partial-guide-gated',
      ['h0', 'missing-guide-hero', 'h2'],
      [
        [['s0'], ['s2']],
        [['missing-1'], ['missing-2']],
        [['missing-3'], ['missing-4']],
      ]
    );

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [partial]
    );
    const h0 = result.options[0].teams[0].heroes.find(
      ({ name }) => name === 'h0'
    );

    expect(h0?.skills).not.toContain('s0');
    expect(h0?.skills).not.toContain('s2');
    expect(h0?.skills).toContain('s1');
  });

  test('an absent guide hero neither appears nor reserves an otherwise qualified owned skill', () => {
    const data = makeData({
      weights: {
        'H|h0': 0.4,
        'H|h2': 0.3,
        'HP|h0|h2': 0.5,
        'S|s0': 10,
        'HS|missing-guide-hero|s0': 10,
        'S|s1': 0.2,
        'HS|h0|s1': 0.3,
      },
      support: {
        'H|h0': 10,
        'H|h2': 10,
        'HP|h0|h2': 16,
        'S|s0': 10,
        'HS|missing-guide-hero|s0': 16,
        'S|s1': 10,
        'HS|h0|s1': 16,
      },
      n_features: 7,
    });
    const partial = makeTeamComp(
      'absent-guide-hero',
      ['h0', 'missing-guide-hero', 'h2'],
      [
        [['missing-0'], ['missing-1']],
        [['s0'], ['missing-2']],
        [['missing-3'], ['missing-4']],
      ]
    );

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [partial]
    );
    const placed = result.options[0].teams.flatMap(({ heroes: teamHeroes }) =>
      teamHeroes
    );

    expect(placed.map(({ name }) => name)).not.toContain('missing-guide-hero');
    expect(placed.flatMap(({ skills: assignedSkills }) => assignedSkills)).not.toContain('s0');
    expect(placed.find(({ name }) => name === 'h0')?.skills).toContain('s1');
  });

  test('gives an exact guide core priority over a partial core for a shared skill', () => {
    const data = makeData({
      weights: {
        'H|h0': 0.2,
        'H|h1': 0.2,
        'H|h2': 0.2,
        'HP|h0|h1': 0.2,
        'HP|h0|h2': 0.2,
        'HP|h1|h2': 0.2,
        'H|h3': 0.2,
        'H|h4': 0.2,
        'H|h5': 0.2,
        'HP|h3|h4': 0.2,
        'HP|h3|h5': 0.2,
        'HP|h4|h5': 0.2,
        'S|s0': 0.2,
        'HS|h0|s0': 0.2,
        'HS|h3|s0': 10,
      },
      support: {
        'H|h0': 10,
        'H|h1': 10,
        'H|h2': 10,
        'HP|h0|h1': 16,
        'HP|h0|h2': 16,
        'HP|h1|h2': 16,
        'H|h3': 10,
        'H|h4': 10,
        'H|h5': 10,
        'HP|h3|h4': 16,
        'HP|h3|h5': 16,
        'HP|h4|h5': 16,
        'S|s0': 10,
        'HS|h0|s0': 16,
        'HS|h3|s0': 16,
      },
      n_features: 15,
    });
    const exact = makeTeamComp('exact-shared', ['h0', 'h1', 'h2'], [
      [['s0'], ['missing-0']],
      [['missing-1'], ['missing-2']],
      [['missing-3'], ['missing-4']],
    ]);
    const partial = makeTeamComp(
      'partial-shared',
      ['h3', 'h4', 'missing-guide-hero'],
      [
        [['s0'], ['missing-5']],
        [['missing-6'], ['missing-7']],
        [['missing-8'], ['missing-9']],
      ]
    );

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [partial, exact]
    );
    const placed = result.options[0].teams.flatMap(({ heroes: teamHeroes }) =>
      teamHeroes
    );

    expect(placed.find(({ name }) => name === 'h0')?.skills).toContain('s0');
    expect(placed.find(({ name }) => name === 'h3')?.skills).not.toContain('s0');
  });

  test('shows all three canonical slots when the complete guide trio is confident', () => {
    const data = makeData({
      weights: {
        'H|h0': 0.2,
        'H|h1': 0.2,
        'H|h2': 0.2,
        'HP|h0|h1': 0.2,
        'HP|h0|h2': 0.2,
        'HP|h1|h2': 0.2,
      },
      support: {
        'H|h0': 10,
        'H|h1': 10,
        'H|h2': 10,
        'HP|h0|h1': 16,
        'HP|h0|h2': 16,
        'HP|h1|h2': 16,
      },
      n_features: 6,
    });
    const complete = makeTeamComp(
      'complete',
      ['h0', 'h1', 'h2'],
      slotsFor(0),
      { formation: '完整阵' }
    );

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [complete]
    );
    const matched = result.options[0].teams[0];

    expect(matched.formation).toBe('完整阵');
    expect(matched.knownTeam).toMatchObject({
      id: 'complete',
      matchedHeroSlots: 3,
      totalHeroSlots: 3,
      matchedSkillSlots: 0,
    });
    expect(matched.heroes.map(({ name, slotIndex }) => [name, slotIndex])).toEqual([
      ['h0', 0],
      ['h1', 1],
      ['h2', 2],
    ]);
  });

  test('places positive, zero, and negative features at the fitted support floors', () => {
    const data = makeData({
      weights: {
        'H|h0': -0.5,
        'H|h1': 0,
        'H|h2': -0.2,
        'HP|h0|h1': -0.1,
        'HP|h0|h2': 0,
        'HP|h1|h2': -0.2,
        'S|s0': -0.3,
        'HS|h0|s0': -0.2,
        'S|s1': 0,
        'HS|h0|s1': 0,
        'H|h3': 1,
        'H|h4': 1,
        'HP|h3|h4': 1,
      },
      support: {
        'H|h0': 5,
        'H|h1': 5,
        'H|h2': 5,
        'HP|h0|h1': 8,
        'HP|h0|h2': 8,
        'HP|h1|h2': 8,
        'S|s0': 5,
        'HS|h0|s0': 8,
        'S|s1': 5,
        'HS|h0|s1': 8,
        'H|h3': 4,
        'H|h4': 5,
        'HP|h3|h4': 8,
      },
      n_features: 13,
    });

    const supportedGuide = makeTeamComp(
      'supported-signs',
      ['h0', 'h1', 'h2'],
      [
        [['s0'], ['s1']],
        [['missing-0'], ['missing-1']],
        [['missing-2'], ['missing-3']],
      ]
    );
    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [supportedGuide]
    );
    const placedHeroes = result.options[0].teams.flatMap(
      (team) => team.heroes
    );
    const h0 = placedHeroes.find(({ name }) => name === 'h0');

    expect(placedHeroes.map(({ name }) => name).sort()).toEqual([
      'h0',
      'h1',
      'h2',
    ]);
    expect(h0?.skills).toEqual(expect.arrayContaining(['s0', 's1']));
    expect(placedHeroes.map(({ name }) => name)).not.toContain('h3');
    expect(placedHeroes.map(({ name }) => name)).not.toContain('h4');
    expect(
      result.options[0].teams.flatMap(({ evidence }) =>
        Object.values(evidence).flat()
      )
    ).toEqual([]);
  });

  test('uses negative fitted weights for ranking without blocking a supported guide pair', () => {
    const data = makeData({
      weights: {
        'H|h0': 10,
        'H|h1': -0.1,
        'HP|h0|h1': 3,
      },
      support: {
        'H|h0': 100,
        'H|h1': 100,
        'HP|h0|h1': 100,
      },
      n_features: 3,
    });
    const guide = makeTeamComp('masked', ['h0', 'h1', 'h2'], slotsFor(0));

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [guide]
    );

    expect(result.options[0].teams[0].heroes.map(({ name }) => name)).toEqual([
      'h0',
      'h1',
    ]);
    expect(result.options[0].teams[0].knownTeam?.id).toBe('masked');
  });

  test('leaves a hero pair below the fitted support floor out even when its weight is large', () => {
    const data = makeData({
      weights: {
        'H|h3': 0.4,
        'H|h4': 0.4,
        'HP|h3|h4': 10,
      },
      support: {
        'H|h3': 10,
        'H|h4': 10,
        'HP|h3|h4': 7,
      },
      n_features: 3,
    });

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      []
    );

    expect(result.options[0].teams.every(({ heroes }) => heroes.length === 0)).toBe(true);
  });

  test('requires both S and HS support and uses model gain among guide alternatives', () => {
    const data = makeData({
      weights: {
        'H|h0': 0.4,
        'H|h1': 0.4,
        'HP|h0|h1': 0.4,
        'S|s0': 0.3,
        'HS|h0|s0': 0.5,
        'S|s1': -0.2,
        'HS|h0|s1': -0.1,
        'S|s2': 0.3,
        'HS|h0|s2': 0.4,
        'SP|h0|s0|s2': -0.2,
      },
      support: {
        'H|h0': 10,
        'H|h1': 10,
        'HP|h0|h1': 16,
        'S|s0': 10,
        'HS|h0|s0': 16,
        'S|s1': 100,
        'HS|h0|s1': 100,
        'S|s2': 10,
        'HS|h0|s2': 16,
        'SP|h0|s0|s2': 8,
      },
      n_features: 10,
    });
    const guide = makeTeamComp('skills', ['h0', 'h1', 'h2'], [
      [['s0'], ['s1', 's2']],
      [['missing-0'], ['missing-1']],
      [['missing-2'], ['missing-3']],
    ]);

    const result = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      [guide]
    );
    const h0 = result.options[0].teams[0].heroes.find(
      ({ name }) => name === 'h0'
    );

    expect(h0?.skillSlots).toEqual(['s0', 's2']);
    expect(h0?.skills).not.toContain('s1');
  });

  test('prioritizes a usable exact guide core ahead of a stronger model-only trio', () => {
    const exactHeroes = Array.from({ length: 9 }, (_, index) => `e${index}`);
    const exactSkills = Array.from({ length: 18 }, (_, index) => `es${index}`);
    const weights: Record<string, number> = {
      'HP|e0|e1': 0,
      'HP|e0|e2': 0,
      'HP|e1|e2': 0,
      'HP|e0|e3': 5,
      'HP|e0|e4': 5,
      'HP|e3|e4': 5,
      'S|es0': 0,
      'HS|e0|es0': 0,
    };
    const support: Record<string, number> = {
      'HP|e0|e1': 16,
      'HP|e0|e2': 16,
      'HP|e1|e2': 16,
      'HP|e0|e3': 16,
      'HP|e0|e4': 16,
      'HP|e3|e4': 16,
      'S|es0': 10,
      'HS|e0|es0': 16,
    };
    for (const hero of exactHeroes) {
      weights[`H|${hero}`] = 0;
      support[`H|${hero}`] = 10;
    }
    const data = makeData({
      weights,
      support,
      n_features: Object.keys(weights).length,
    });
    const exactGuide = makeTeamComp('usable-exact', ['e0', 'e1', 'e2'], [
      [['es0'], ['missing-0']],
      [['missing-1'], ['missing-2']],
      [['missing-3'], ['missing-4']],
    ]);

    const result = recommendHybridTeams(
      exactHeroes,
      exactSkills,
      data,
      data.catalog,
      {},
      [exactGuide]
    );

    const matched = result.options[0].teams.find(
      ({ knownTeam }) => knownTeam?.id === 'usable-exact'
    );
    expect(matched?.heroes.map(({ name }) => name)).toEqual([
      'e0',
      'e1',
      'e2',
    ]);
  });

  test('ranks total formation gain ahead of the number of complete trios', () => {
    const scoreHeroes = Array.from({ length: 9 }, (_, index) => `g${index}`);
    const scoreSkills = Array.from({ length: 18 }, (_, index) => `gs${index}`);
    const weights: Record<string, number> = {};
    const support: Record<string, number> = {};
    for (const hero of scoreHeroes) {
      weights[`H|${hero}`] = 0;
      support[`H|${hero}`] = 10;
    }
    const supportedPairs: [string, string, number][] = [
      ['g0', 'g1', 2],
      ['g0', 'g2', 2],
      ['g1', 'g2', 2],
      ['g0', 'g3', 0],
      ['g0', 'g4', 0],
      ['g3', 'g4', 0],
      ['g1', 'g5', 0],
      ['g1', 'g6', 0],
      ['g5', 'g6', 0],
      ['g7', 'g8', 0],
    ];
    for (const [first, second, weight] of supportedPairs) {
      weights[`HP|${first}|${second}`] = weight;
      support[`HP|${first}|${second}`] = 16;
    }
    const data = makeData({
      weights,
      support,
      n_features: Object.keys(weights).length,
    });
    const unusableExactGuide = makeTeamComp(
      'unusable-exact',
      ['g0', 'g3', 'g4'],
      [
        [['missing-0'], ['missing-1']],
        [['missing-2'], ['missing-3']],
        [['missing-4'], ['missing-5']],
      ]
    );

    const result = recommendHybridTeams(
      scoreHeroes,
      scoreSkills,
      data,
      data.catalog,
      {},
      [unusableExactGuide]
    );
    const teams = result.options[0].teams;

    expect(
      teams.some(
        ({ heroes: teamHeroes }) =>
          teamHeroes.map(({ name }) => name).sort().join('|') === 'g0|g1|g2'
      )
    ).toBe(true);
    expect(
      teams.filter(({ heroes: teamHeroes }) => teamHeroes.length === 3)
    ).toHaveLength(1);
    expect(
      teams.some(
        ({ heroes: teamHeroes }) =>
          teamHeroes.map(({ name }) => name).sort().join('|') === 'g0|g3|g4'
      )
    ).toBe(false);
  });

  test('keeps the current supported exact 孟获/祝融/木鹿大王 guide core together', () => {
    const currentHeroes = [
      '孟获',
      '贾诩',
      '荀攸',
      '吕布',
      '张宁',
      '木鹿大王',
      '马云禄',
      '赵云',
      '朱儁',
      '张昭',
      '祝融',
    ];
    const currentSkills = [
      '烈火焚营',
      '计袭粮仓',
      '十面埋伏',
      '鸩饮毒弑',
      '避其锐气',
      '屈人之兵',
      '一计决胜',
      '穷追不舍',
      '步步为营',
      '烈火张天',
      '断敌粮道',
      '金城汤池',
      '韬光养晦',
      '惩前毖后',
      '暗渡阴平',
      '千里突袭',
      '黄天惑心',
      '威名显赫',
      '兵贵神速',
      '冲锐巧变',
    ];
    const heroMeta = Object.fromEntries(
      currentHeroes.map((name) => [name, { camp: database.heroes[name].camp }])
    );

    const result = recommendHybridTeams(
      currentHeroes,
      currentSkills,
      recommendationData,
      recommendationData.catalog,
      heroMeta,
      database.team
    );
    const matched = result.options[0].teams.find(
      ({ knownTeam }) =>
        knownTeam?.id === 'yanwu-孟获-祝融-木鹿大王-8506bab2d533d512'
    );

    expect(matched?.formation).toBe('箕形阵');
    expect(matched?.heroes.map(({ name }) => name)).toEqual([
      '孟获',
      '祝融',
      '木鹿大王',
    ]);
    expect(
      matched?.heroes.find(({ name }) => name === '孟获')?.skills
    ).toContain('步步为营');
  });

  test('real model-only fallback never places a relationship below the evidence gate', () => {
    const heroMeta = Object.fromEntries(
      TEN_ROUND_HERO_POOL.map((name) => [
        name,
        { camp: database.heroes[name].camp },
      ])
    );
    const result = recommendHybridTeams(
      [...TEN_ROUND_HERO_POOL],
      [...TEN_ROUND_SKILL_POOL],
      recommendationData,
      recommendationData.catalog,
      heroMeta,
      []
    );
    const isConfident = (featureId: string) => {
      const family = featureId.split('|')[0];
      const minimumSupport =
        family === 'H' || family === 'S'
          ? recommendationData.model.min_support_single
          : recommendationData.model.min_support_pair;
      return (
        (recommendationData.model.support[featureId] ?? 0) >= minimumSupport
      );
    };

    for (const team of result.options[0].teams) {
      const names = team.heroes.map(({ name }) => name);
      for (const name of names) expect(isConfident(`H|${name}`)).toBe(true);
      for (let first = 0; first < names.length; first += 1) {
        for (let second = first + 1; second < names.length; second += 1) {
          const pair = [names[first], names[second]].sort();
          expect(isConfident(`HP|${pair[0]}|${pair[1]}`)).toBe(true);
        }
      }
      for (const hero of team.heroes) {
        for (const skill of hero.skills) {
          expect(isConfident(`S|${skill}`)).toBe(true);
          expect(isConfident(`HS|${hero.name}|${skill}`)).toBe(true);
        }
      }
    }
  });

  test('searches qualified trios beyond the former 320-candidate cutoff', () => {
    const largeHeroes = Array.from({ length: 15 }, (_, index) =>
      `h${index.toString().padStart(2, '0')}`
    );
    const largeSkills = Array.from({ length: 18 }, (_, index) => `s${index}`);
    const weights: Record<string, number> = {};
    const support: Record<string, number> = {};
    for (const [index, hero] of largeHeroes.entries()) {
      weights[`H|${hero}`] = index < 6 ? 1 : 0;
      support[`H|${hero}`] = 10;
    }
    for (let first = 0; first < largeHeroes.length; first += 1) {
      for (let second = first + 1; second < largeHeroes.length; second += 1) {
        const key = `HP|${largeHeroes[first]}|${largeHeroes[second]}`;
        const samePreferredTrio =
          (first < 3 && second < 3) ||
          (first >= 3 && first < 6 && second < 6);
        weights[key] = samePreferredTrio ? 100 : 0;
        support[key] = 16;
      }
    }
    const data = makeData({
      weights,
      support,
      n_features: Object.keys(weights).length,
    });

    const result = recommendHybridTeams(
      largeHeroes,
      largeSkills,
      data,
      data.catalog,
      {},
      []
    );
    const selectedTrios = result.options[0].teams
      .map(({ heroes: teamHeroes }) => teamHeroes.map(({ name }) => name).sort())
      .sort((left, right) => left.join('|').localeCompare(right.join('|')));

    expect(selectedTrios).toEqual([
      ['h00', 'h01', 'h02'],
      ['h03', 'h04', 'h05'],
      ['h06', 'h07', 'h08'],
    ]);
  }, 20_000);

  test('cooperative fallback returns the same deterministic result', async () => {
    const data = makeData();
    const comps = [
      makeTeamComp('known-1', ['h0', 'h1', 'h2'], slotsFor(0)),
      makeTeamComp('known-2', ['h3', 'h4', 'h5'], slotsFor(6)),
      makeTeamComp('known-3', ['h6', 'h7', 'h8'], slotsFor(12)),
    ];
    const expected = recommendHybridTeams(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      comps
    );
    const yields: number[] = [];

    const actual = await recommendHybridTeamsCooperatively(
      heroes,
      skills,
      data,
      data.catalog,
      {},
      comps,
      {
        batchSize: 1,
        yieldControl: async () => {
          yields.push(1);
        },
      }
    );

    expect(actual).toEqual(expected);
    expect(yields.length).toBeGreaterThan(0);
  });
});

describe('integration with the real generated artifact', () => {
  test('artifact has the expected schema/shape', () => {
    expect(recommendationData.schema.model_type).toBe('paired-logistic');
    expect(recommendationData.model.weights).toBeTypeOf('object');
    expect(recommendationData.battle_counts.total_battles).toBeGreaterThan(0);
    expect(recommendationData.catalog.default_skill).toBeTypeOf('object');
  });

  test('getAnalytics returns rankings + model quality', () => {
    const a = getAnalytics(recommendationData, database);
    expect(a.heroes.length).toBeGreaterThan(0);
    expect(a.skills.length).toBeGreaterThan(0);
    expect(a.model_quality).toHaveProperty('accuracy');
    expect(a.summary.total_battles).toBe(recommendationData.battle_counts.total_battles);
    expect(a.skills.find((skill) => skill.name === '星罗棋布')?.shadowTotal).toBe(0);
    expect(a.skills.find((skill) => skill.name === '万人之敌')?.shadowTotal).toBeGreaterThan(0);
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
