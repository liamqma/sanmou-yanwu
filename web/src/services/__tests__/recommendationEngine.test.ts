import { describe, test, expect } from 'vitest';
import {
  recommendHeroSet,
  recommendSkillSet,
  recommendSingleHero,
  recommendTwoSkills,
  recommendTeams,
  getAnalytics,
  currentRosterScore,
} from '../recommendationEngine';
import { recommendationData, database } from '../../data';
import type { RecommendationData } from '../../types/recommendation';

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
    expect(r.teams).toHaveLength(0);
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
    expect(r.teams).toHaveLength(0);
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
    const allHeroes = r.teams.flatMap((t) => t.heroes.map((h) => h.name));
    expect(new Set(allHeroes).size).toBe(9);
    const allSkills = r.teams.flatMap((t) => t.heroes.flatMap((h) => h.skills));
    expect(allSkills).toHaveLength(18);
    expect(new Set(allSkills).size).toBe(18);
    r.teams.forEach((t) => t.heroes.forEach((h) => expect(h.skills).toHaveLength(2)));
    for (const hero of r.teams.flatMap((t) => t.heroes)) {
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
    expect(r.teams).toHaveLength(3);
    // Disjoint heroes across all teams (9 unique).
    const allHeroes = r.teams.flatMap((t) => t.heroes.map((h) => h.name));
    expect(new Set(allHeroes).size).toBe(9);
    // Unique 18-skill assignment, 2 per hero.
    const allSkills = r.teams.flatMap((t) => t.heroes.flatMap((h) => h.skills));
    expect(new Set(allSkills).size).toBe(allSkills.length);
    r.teams.forEach((t) => t.heroes.forEach((h) => expect(h.skills.length).toBeLessThanOrEqual(2)));
    // Reports a single total-score summary (no balance/weakest/objective fields).
    expect(r).toHaveProperty('totalScore');
    expect(r).not.toHaveProperty('objective');
    expect(r).not.toHaveProperty('weakestTeamStrength');
    expect(r).not.toHaveProperty('balanceSpread');
    expect(r).not.toHaveProperty('aggregateStrength');
  });

  test('is deterministic', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData();
    const a = recommendTeams(heroes, skills, data, data.catalog);
    const b = recommendTeams(heroes, skills, data, data.catalog);
    expect(a).toEqual(b);
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
    const h0 = r.teams.flatMap((t) => t.heroes).find((h) => h.name === 'h0')!;
    // The strongly-affine pair is routed onto h0.
    expect(new Set(h0.skills)).toEqual(new Set(['s0', 's1']));
  });

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
      r.teams.flatMap((team) => team.heroes.map((hero) => [hero.name, hero.skills] as const))
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
      r.teams.findIndex((t) => t.heroes.some((h) => h.name === name));
    expect(teamOf('h0')).toBe(teamOf('h1'));
    expect(teamOf('h2')).toBe(teamOf('h3'));
  });

  test('totalScore equals the summed display strength of all three teams', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: { 'H|h0': 1.0, 'H|h1': 0.5, 'HP|h0|h1': 0.8, 'HS|h0|s0': 0.4 },
      support: { 'H|h0': 50, 'H|h1': 50, 'HP|h0|h1': 30, 'HS|h0|s0': 20 },
      n_features: 4,
    });
    const r = recommendTeams(heroes, skills, data, data.catalog);
    const summed = r.teams.reduce((a, t) => a + t.strength, 0);
    expect(r.totalScore).toBeCloseTo(Math.round(summed * 10) / 10, 5);
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
    const teamOf = (name: string) => r.teams.findIndex((t) => t.heroes.some((h) => h.name === name));
    // The two strongest pairs stay together on the two strongest teams.
    expect(teamOf('h0')).toBe(teamOf('h1'));
    expect(teamOf('h2')).toBe(teamOf('h3'));
    // Those pairs are NOT split into the same (third) team.
    expect(teamOf('h0')).not.toBe(teamOf('h2'));
  });

  test('within the tolerance band prefers exactly one 输出核心 per team (soft role rule)', () => {
    // All heroes/pairs neutral → every partition ties on strength, so the soft
    // role preference decides. Three 输出核心 spread one-per-team beats clustering.
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData();
    const meta = {
      h0: { camp: 'X', label: '输出核心' },
      h1: { camp: 'X', label: '输出核心' },
      h2: { camp: 'X', label: '输出核心' },
      h3: { camp: 'X', label: '功能辅助' },
      h4: { camp: 'X', label: '功能辅助' },
      h5: { camp: 'X', label: '功能辅助' },
      h6: { camp: 'X', label: '功能辅助' },
      h7: { camp: 'X', label: '功能辅助' },
      h8: { camp: 'X', label: '功能辅助' },
    };
    const r = recommendTeams(heroes, skills, data, data.catalog, meta);
    const outputCoresPerTeam = r.teams.map(
      (t) => t.heroes.filter((h) => meta[h.name as keyof typeof meta]?.label === '输出核心').length
    );
    // Exactly one 输出核心 on every team (none clustered, none empty).
    expect(outputCoresPerTeam.every((n) => n === 1)).toBe(true);
  });

  test('role/camp preferences never override a real strength gap larger than the band', () => {
    // A dominant pair worth far more than 2.5 display points must team up even
    // if that produces a worse role/camp structure.
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData({
      weights: { 'HP|h0|h1': 5.0 },
      support: { 'HP|h0|h1': 40 },
      n_features: 1,
    });
    // Meta that would "prefer" splitting h0/h1 (both 输出核心) across teams.
    const meta = Object.fromEntries(
      heroes.map((h, i) => [h, { camp: 'X', label: i < 2 ? '输出核心' : '功能辅助' }])
    );
    const r = recommendTeams(heroes, skills, data, data.catalog, meta);
    const teamOf = (name: string) => r.teams.findIndex((t) => t.heroes.some((h) => h.name === name));
    expect(teamOf('h0')).toBe(teamOf('h1'));
  });

  test('>12 pool trim reserves low-strength 输出核心/体系核心 before filling by strength', () => {
    // 13 heroes so the pool must be trimmed to 12. The three soft cores are the
    // *weakest* by individual H-weight, so a pure top-12-by-strength trim would
    // discard them and no team could then get "exactly one core". The
    // metadata-aware trim must reserve them, letting the soft role rule place
    // exactly one 输出核心 and one 体系核心 on each team.
    const heroes = Array.from({ length: 13 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    // h0..h9 are fillers each with a *small* positive individual weight so they
    // out-rank the cores (which have zero weight and would be trimmed by a pure
    // top-12), yet the weights are tiny enough (≤0.5 display pts) that placing a
    // reserved core in a team stays inside the 2.5-display-point top-two band —
    // so the soft role rule is free to distribute the surviving cores.
    const weights: Record<string, number> = {};
    for (let i = 0; i < 10; i++) weights[`H|h${i}`] = 0.05 - i * 0.002;
    const data = makeData({ weights, support: {}, n_features: Object.keys(weights).length });
    const meta = {
      h10: { camp: 'X', label: '输出核心' },
      h11: { camp: 'X', label: '体系核心' },
      h12: { camp: 'X', label: '输出核心' },
    };
    const r = recommendTeams(heroes, skills, data, data.catalog, meta);
    expect(r.incomplete).toBe(false);
    // All three reserved low-strength cores survived the trim AND were placed.
    const placed = new Set(r.teams.flatMap((t) => t.heroes.map((h) => h.name)));
    expect(placed.has('h10')).toBe(true);
    expect(placed.has('h11')).toBe(true);
    expect(placed.has('h12')).toBe(true);
    // Deterministic across repeated calls.
    const r2 = recommendTeams(heroes, skills, data, data.catalog, meta);
    expect(r2).toEqual(r);
  }, 60000); // 13→12 trim exercises the full beam; allow extra time.

  test('is deterministic with hero metadata', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData();
    const meta = Object.fromEntries(heroes.map((h, i) => [h, { camp: i % 2 ? 'A' : 'B', label: '输出核心' }]));
    const a = recommendTeams(heroes, skills, data, data.catalog, meta);
    const b = recommendTeams(heroes, skills, data, data.catalog, meta);
    expect(a).toEqual(b);
  });

  test('tolerates missing metadata and partial pools (structure rules inert)', () => {
    const heroes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const data = makeData();
    // Only some heroes carry metadata; no camp on others. Must still complete.
    const meta = { h0: { label: '输出核心' }, h1: { camp: 'A' } };
    const r = recommendTeams(heroes, skills, data, data.catalog, meta);
    expect(r.incomplete).toBe(false);
    expect(r.teams).toHaveLength(3);
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
    for (const team of r.teams) {
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
    const h0Team = r.teams.find((t) => t.heroes.some((h) => h.name === 'h0'))!;
    expect(h0Team.evidence.heroSynergy.some((e) => e.label.includes('h0'))).toBe(true);
    // No evidence row anywhere reflects the negative feature.
    const allLabels = r.teams.flatMap((t) => [
      ...t.evidence.heroSynergy,
      ...t.evidence.heroSkill,
      ...t.evidence.skillSynergy,
    ]);
    expect(allLabels.every((e) => e.gain > 0)).toBe(true);
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
