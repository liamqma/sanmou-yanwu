import { describe, expect, test } from 'vitest';
import { recommendationData } from '../../data';
import type { RecommendationData } from '../../types/recommendation';
import { heroPairId, heroSkillId } from '../recommendationModel';
import {
  allocateTeams,
  evaluateLayout,
  teamWinChance,
  twoOfThreeChance,
} from '../teamAllocation';
import { applyMove, placedItems, type TeamLayout } from '../teamLayout';
import {
  TEN_ROUND_HERO_POOL,
  TEN_ROUND_SKILL_POOL,
} from './fixtures/tenRoundFormationFixture';

const HEROES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

function makeData(
  weights: Record<string, number>,
  { reference = 0, defaultSkill = {} as Record<string, string> } = {}
): RecommendationData {
  return {
    catalog: {
      default_skill: defaultSkill,
      relationships: { hero_camp: {}, bonds: [] },
    },
    model: {
      weights,
      support: {},
      enabled_families: ['H', 'S', 'HP', 'HS', 'SP', 'THS', 'TSP', 'HT', 'HC', 'B'],
      reference_team_score: reference,
    },
  } as unknown as RecommendationData;
}

/** Every hero pair and every hero-skill carry present with weight 0. */
function allCombos(heroes: string[], skills: string[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const a of heroes) {
    for (const b of heroes) if (a < b) weights[heroPairId(a, b)] = 0;
    for (const skill of skills) weights[heroSkillId(a, skill)] = 0;
  }
  return weights;
}

const teamHeroes = (layout: TeamLayout) =>
  layout.map((team) => team.map((slot) => slot.hero).filter(Boolean).sort());

describe('twoOfThreeChance', () => {
  test('matches the binomial chance of two or more wins', () => {
    expect(twoOfThreeChance([0.5, 0.5, 0.5])).toBeCloseTo(0.5);
    expect(twoOfThreeChance([1, 1, 0])).toBeCloseTo(1);
    expect(twoOfThreeChance([0.45, 0.45, 0.45])).toBeCloseTo(0.42525);
  });

  test('uses the reference team score as the even-chance point', () => {
    const data = makeData({}, { reference: 3 });
    expect(teamWinChance(3, data)).toBeCloseTo(0.5);
    expect(teamWinChance(4, data)).toBeGreaterThan(0.5);
  });
});

describe('allocateTeams', () => {
  test('fills three full teams when every combo has a weight', () => {
    const skills = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const layout = allocateTeams(HEROES, skills, makeData(allCombos(HEROES, skills)));
    const placed = placedItems(layout);
    expect(placed.heroes.size).toBe(9);
    expect(placed.skills.size).toBe(18);
  });

  test('never pairs heroes without an HP weight or carries without an HS weight', () => {
    const skills = ['s1', 's2', 's3'];
    const weights = allCombos(['A', 'B', 'C'], skills);
    delete weights[heroPairId('A', 'B')];
    delete weights[heroSkillId('C', 's3')];
    weights[heroSkillId('A', 's3')] = -0.5;
    const layout = allocateTeams(['A', 'B', 'C'], skills, makeData(weights));
    for (const team of teamHeroes(layout)) {
      expect(team.includes('A') && team.includes('B')).toBe(false);
    }
    const cSlot = layout.flat().find((slot) => slot.hero === 'C');
    expect(cSlot?.skills).not.toContain('s3');
    // A negative combo is still used when it is the only way to place the skill.
    expect(placedItems(layout).skills.has('s3')).toBe(true);
  });

  test('never gives a hero its own signature skill', () => {
    const skills = ['sigA', 'x'];
    const weights = allCombos(['A'], skills);
    const layout = allocateTeams(['A'], skills, makeData(weights, { defaultSkill: { A: 'sigA' } }));
    expect(layout[0][0]).toEqual({ hero: 'A', skills: ['x', null] });
  });

  test('concentrates strength in a weak pool and balances a strong one', () => {
    const weights = allCombos(HEROES, []);
    HEROES.forEach((hero, i) => {
      weights[`H|${hero}`] = i < 6 ? 3 : 0;
    });
    const strongSix = new Set(HEROES.slice(0, 6));
    const strongTeams = (layout: TeamLayout) =>
      teamHeroes(layout).filter((team) => team.every((hero) => strongSix.has(hero as string))).length;

    expect(strongTeams(allocateTeams(HEROES, [], makeData(weights, { reference: 8 })))).toBe(2);
    expect(strongTeams(allocateTeams(HEROES, [], makeData(weights, { reference: 0 })))).toBe(0);
  });

  test('places every hero of a small pool', () => {
    const heroes = ['A', 'B', 'C', 'D'];
    const layout = allocateTeams(heroes, [], makeData(allCombos(heroes, [])));
    expect(placedItems(layout).heroes.size).toBe(4);
  });

  test('is deterministic and ignores input order', () => {
    const first = allocateTeams([...TEN_ROUND_HERO_POOL], [...TEN_ROUND_SKILL_POOL], recommendationData);
    const second = allocateTeams(
      [...TEN_ROUND_HERO_POOL].reverse(),
      [...TEN_ROUND_SKILL_POOL].reverse(),
      recommendationData
    );
    expect(second).toEqual(first);
  });

  test('realistic 15-hero / 28-skill pool: valid, locally optimal, and fast', () => {
    const started = performance.now();
    const layout = allocateTeams([...TEN_ROUND_HERO_POOL], [...TEN_ROUND_SKILL_POOL], recommendationData);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(3_000);

    const { model, catalog } = recommendationData;
    const evaluation = evaluateLayout(layout, recommendationData);
    expect(evaluation.unseenHeroes.size).toBe(0);
    expect(evaluation.unseenSkills.size).toBe(0);
    for (const slot of layout.flat()) {
      if (slot.hero) expect(slot.skills).not.toContain(catalog.default_skill[slot.hero]);
    }

    // No single skill replacement allowed by the rule scores better.
    const placed = placedItems(layout);
    const unused = TEN_ROUND_SKILL_POOL.filter((skill) => !placed.skills.has(skill));
    layout.forEach((team, t) =>
      team.forEach((slot, s) => {
        if (!slot.hero) return;
        ([0, 1] as const).forEach((field) => {
          for (const skill of unused) {
            if (!(heroSkillId(slot.hero as string, skill) in model.weights)) continue;
            const moved = applyMove(
              layout,
              { kind: 'skill', name: skill, from: null },
              { team: t, slot: s, field },
              catalog.default_skill
            );
            if (moved === layout) continue;
            expect(evaluateLayout(moved, recommendationData).twoOfThree).toBeLessThanOrEqual(
              evaluation.twoOfThree + 1e-9
            );
          }
        });
      })
    );
  });
});

describe('evaluateLayout', () => {
  test('flags combos without a weight', () => {
    const layout: TeamLayout = [
      [
        { hero: 'A', skills: ['s1', null] },
        { hero: 'B', skills: [null, null] },
        { hero: null, skills: [null, null] },
      ],
      [],
      [],
    ];
    const evaluation = evaluateLayout(layout, makeData({ 'H|A': 1 }));
    expect([...evaluation.unseenHeroes].sort()).toEqual(['A', 'B']);
    expect([...evaluation.unseenSkills]).toEqual(['s1']);
    expect(evaluation.teams[1]).toEqual({ score: null, winChance: 0 });
  });
});
