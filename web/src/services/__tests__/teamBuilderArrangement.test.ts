import { describe, expect, test } from 'vitest';
import type { FormationOption } from '../recommendationEngine';
import {
  applyTeamBuilderMove,
  collectUsedTeamBuilderHeroes,
  collectUsedTeamBuilderItems,
  collectUsedTeamBuilderSkills,
  createEmptyTeamBuilderLayout,
  createStoredTeamBuilderLayout,
  layoutFromFormation,
  normalizeTeamBuilderLayout,
  teamBuilderLayoutHasHero,
  teamBuilderPoolKey,
  type TeamBuilderLayout,
} from '../teamBuilderArrangement';

const FORMATIONS = ['一字阵', '鱼鳞阵'];

const normalize = (
  raw: unknown,
  allowedHeroes: string[] = ['A', 'B', 'C'],
  allowedSkills: string[] = ['s1', 's2', 's3', 's4']
) =>
  normalizeTeamBuilderLayout(raw, {
    allowedHeroes,
    allowedSkills,
    formations: FORMATIONS,
  });

describe('team builder layout creation and persistence migration', () => {
  test('creates independent teams in the exact 3x3x2 shape', () => {
    const layout = createEmptyTeamBuilderLayout();

    expect(layout).toHaveLength(3);
    for (const team of layout) {
      expect(team.formation).toBe('');
      expect(team.heroes).toHaveLength(3);
      for (const slot of team.heroes) {
        expect(slot).toEqual({
          hero: null,
          row: '前排',
          skills: [null, null],
        });
      }
    }

    layout[0].heroes[0].skills[0] = 'changed';
    expect(layout[0].heroes[1].skills[0]).toBeNull();
    expect(layout[1].heroes[0].skills[0]).toBeNull();
  });

  test('migrates a legacy raw array and never mutates it', () => {
    const legacy = [
      {
        formation: '一字阵',
        heroes: [
          { hero: 'A', row: '后排', skills: ['s1', 's2', 'ignored'] },
        ],
      },
    ];
    const before = structuredClone(legacy);

    const result = normalize(legacy);

    expect(result.storedPoolKey).toBeNull();
    expect(result.hasAssignments).toBe(true);
    expect(result.layout[0]).toMatchObject({
      formation: '一字阵',
      heroes: [
        { hero: 'A', row: '后排', skills: ['s1', 's2'] },
        { hero: null, row: '前排', skills: [null, null] },
        { hero: null, row: '前排', skills: [null, null] },
      ],
    });
    expect(result.layout).toHaveLength(3);
    expect(legacy).toEqual(before);
  });

  test('reads the pool identity from schema v2 and the constructor snapshots layout', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = 'A';
    const stored = createStoredTeamBuilderLayout('pool-v1', layout);

    layout[0].heroes[0].hero = 'changed-after-save';
    expect(stored.layout[0].heroes[0].hero).toBe('A');

    const result = normalize(stored);
    expect(result.storedPoolKey).toBe('pool-v1');
    expect(result.layout[0].heroes[0].hero).toBe('A');
  });

  test('filters stale values, invalid rows/formations, and orphaned skills', () => {
    const raw = [
      {
        formation: 'stale formation',
        heroes: [
          { hero: 'stale hero', row: '后排', skills: ['s1', 's2'] },
          { hero: 'A', row: 'middle', skills: ['stale skill', 's3'] },
        ],
      },
    ];

    const result = normalize(raw);

    expect(result.layout[0].formation).toBe('');
    expect(result.layout[0].heroes[0]).toEqual({
      hero: null,
      row: '前排',
      skills: [null, null],
    });
    expect(result.layout[0].heroes[1]).toEqual({
      hero: 'A',
      row: '前排',
      skills: [null, 's3'],
    });
  });

  test('keeps only the first global occurrence of each hero and skill', () => {
    const raw = [
      {
        formation: '',
        heroes: [
          { hero: 'A', row: '前排', skills: ['s1', 's2'] },
          { hero: 'A', row: '后排', skills: ['s3', 's4'] },
          { hero: 'B', row: '后排', skills: ['s1', 's3'] },
        ],
      },
    ];

    const { layout } = normalize(raw);

    expect(layout[0].heroes[0]).toEqual({
      hero: 'A',
      row: '前排',
      skills: ['s1', 's2'],
    });
    expect(layout[0].heroes[1]).toEqual({
      hero: null,
      row: '前排',
      skills: [null, null],
    });
    expect(layout[0].heroes[2]).toEqual({
      hero: 'B',
      row: '后排',
      skills: [null, 's3'],
    });
    expect([...collectUsedTeamBuilderHeroes(layout)]).toEqual(['A', 'B']);
    expect([...collectUsedTeamBuilderSkills(layout)]).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  test('reports an assignment only for a retained hero or skill', () => {
    expect(normalize(null).hasAssignments).toBe(false);
    expect(
      normalize([
        {
          heroes: [
            { hero: 'unknown', skills: ['unknown'], row: '前排' },
          ],
        },
      ]).hasAssignments
    ).toBe(false);
  });

  test('builds an order-insensitive, deduplicated pool key', () => {
    const first = teamBuilderPoolKey(
      ['B', 'A', 'A'],
      ['s2', 's1', 's1']
    );
    const reordered = teamBuilderPoolKey(['A', 'B'], ['s1', 's2']);

    expect(first).toBe(reordered);
    expect(first).not.toBe(
      teamBuilderPoolKey(['A'], ['B', 's1', 's2'])
    );
  });
});

describe('layoutFromFormation', () => {
  test('seeds three teams with blank formations, front rows, and two skills per hero', () => {
    const option: FormationOption = {
      teams: Array.from({ length: 3 }, (_, teamIndex) => ({
        heroes: Array.from({ length: 3 }, (_, heroIndex) => {
          const id = teamIndex * 3 + heroIndex;
          return {
            name: `H${id}`,
            skills: [`S${id * 2}`, `S${id * 2 + 1}`],
            skillScore: id,
          };
        }),
        strength: 100 - teamIndex,
        evidence: {
          heroSynergy: [],
          heroSkill: [],
          skillSynergy: [],
        },
      })),
    };

    const layout = layoutFromFormation(option);

    expect(layout.map((team) => team.formation)).toEqual(['', '', '']);
    expect(layout[0].heroes[0]).toEqual({
      hero: 'H0',
      row: '前排',
      skills: ['S0', 'S1'],
    });
    expect(layout[2].heroes[2]).toEqual({
      hero: 'H8',
      row: '前排',
      skills: ['S16', 'S17'],
    });
    expect(collectUsedTeamBuilderItems(layout).heroes.size).toBe(9);
    expect(collectUsedTeamBuilderItems(layout).skills.size).toBe(18);
    expect(teamBuilderLayoutHasHero(layout)).toBe(true);
  });
});

const populatedLayout = (): TeamBuilderLayout => {
  const layout = createEmptyTeamBuilderLayout();
  layout[0].heroes[0] = {
    hero: 'A',
    row: '后排',
    skills: ['s1', 's2'],
  };
  layout[1].heroes[1] = {
    hero: 'B',
    row: '前排',
    skills: ['s3', null],
  };
  return layout;
};

describe('applyTeamBuilderMove', () => {
  test('swaps only the hero fields, leaving each slot its own row and skills', () => {
    const layout = populatedLayout();
    const before = structuredClone(layout);

    const next = applyTeamBuilderMove(
      layout,
      { kind: 'hero', origin: 'slot', teamIndex: 0, heroIndex: 0 },
      { kind: 'hero', destination: 'slot', teamIndex: 1, heroIndex: 1 }
    );

    expect(next[0].heroes[0]).toEqual({
      hero: 'B',
      row: '后排',
      skills: ['s1', 's2'],
    });
    expect(next[1].heroes[1]).toEqual({
      hero: 'A',
      row: '前排',
      skills: ['s3', null],
    });
    expect(layout).toEqual(before);
    expect(next).not.toBe(layout);
  });

  test('a pool hero replaces only the hero in an occupied slot', () => {
    const layout = populatedLayout();

    const next = applyTeamBuilderMove(
      layout,
      { kind: 'hero', origin: 'pool', hero: 'C' },
      { kind: 'hero', destination: 'slot', teamIndex: 0, heroIndex: 0 }
    );

    expect(next[0].heroes[0]).toEqual({
      hero: 'C',
      row: '后排',
      skills: ['s1', 's2'],
    });
    expect([...collectUsedTeamBuilderHeroes(next)].sort()).toEqual(['B', 'C']);
    expect(layout[0].heroes[0].hero).toBe('A');
  });

  test('swaps assigned skills and lets a pool skill replace an occupied skill', () => {
    const layout = populatedLayout();
    const swapped = applyTeamBuilderMove(
      layout,
      {
        kind: 'skill',
        origin: 'slot',
        teamIndex: 0,
        heroIndex: 0,
        skillIndex: 0,
      },
      {
        kind: 'skill',
        destination: 'slot',
        teamIndex: 1,
        heroIndex: 1,
        skillIndex: 0,
      }
    );

    expect(swapped[0].heroes[0].skills[0]).toBe('s3');
    expect(swapped[1].heroes[1].skills[0]).toBe('s1');

    const replaced = applyTeamBuilderMove(
      swapped,
      { kind: 'skill', origin: 'pool', skill: 's4' },
      {
        kind: 'skill',
        destination: 'slot',
        teamIndex: 0,
        heroIndex: 0,
        skillIndex: 0,
      }
    );
    expect(replaced[0].heroes[0].skills[0]).toBe('s4');
    expect(collectUsedTeamBuilderSkills(replaced).has('s3')).toBe(false);
  });

  test('dropping assigned items into their pool removes them', () => {
    const layout = populatedLayout();
    const skillRemoved = applyTeamBuilderMove(
      layout,
      {
        kind: 'skill',
        origin: 'slot',
        teamIndex: 0,
        heroIndex: 0,
        skillIndex: 1,
      },
      { kind: 'skill', destination: 'pool' }
    );
    expect(skillRemoved[0].heroes[0]).toEqual({
      hero: 'A',
      row: '后排',
      skills: ['s1', null],
    });

    const heroRemoved = applyTeamBuilderMove(
      skillRemoved,
      { kind: 'hero', origin: 'slot', teamIndex: 0, heroIndex: 0 },
      { kind: 'hero', destination: 'pool' }
    );
    expect(heroRemoved[0].heroes[0]).toEqual({
      hero: null,
      row: '前排',
      skills: [null, null],
    });
    expect(collectUsedTeamBuilderSkills(heroRemoved).has('s1')).toBe(false);
  });

  test('rejects cross-kind, out-of-range, empty-source, and duplicate pool moves by identity', () => {
    const layout = populatedLayout();

    expect(
      applyTeamBuilderMove(
        layout,
        { kind: 'hero', origin: 'slot', teamIndex: 0, heroIndex: 0 },
        {
          kind: 'skill',
          destination: 'slot',
          teamIndex: 0,
          heroIndex: 0,
          skillIndex: 0,
        }
      )
    ).toBe(layout);
    expect(
      applyTeamBuilderMove(
        layout,
        { kind: 'hero', origin: 'slot', teamIndex: 9, heroIndex: 0 },
        { kind: 'hero', destination: 'pool' }
      )
    ).toBe(layout);
    expect(
      applyTeamBuilderMove(
        layout,
        { kind: 'hero', origin: 'slot', teamIndex: 0, heroIndex: 2 },
        { kind: 'hero', destination: 'pool' }
      )
    ).toBe(layout);
    expect(
      applyTeamBuilderMove(
        layout,
        { kind: 'hero', origin: 'pool', hero: 'A' },
        { kind: 'hero', destination: 'slot', teamIndex: 2, heroIndex: 2 }
      )
    ).toBe(layout);
    expect(
      applyTeamBuilderMove(
        layout,
        { kind: 'skill', origin: 'pool', skill: 's1' },
        {
          kind: 'skill',
          destination: 'slot',
          teamIndex: 1,
          heroIndex: 1,
          skillIndex: 1,
        }
      )
    ).toBe(layout);
  });

  test('deep-clones accepted results so later edits cannot mutate the input', () => {
    const layout = populatedLayout();
    const before = structuredClone(layout);
    const next = applyTeamBuilderMove(
      layout,
      { kind: 'hero', origin: 'pool', hero: 'C' },
      { kind: 'hero', destination: 'slot', teamIndex: 2, heroIndex: 2 }
    );

    next[1].heroes[1].skills[0] = 'later edit';
    expect(layout).toEqual(before);
    expect(next[1]).not.toBe(layout[1]);
    expect(next[1].heroes[1]).not.toBe(layout[1].heroes[1]);
  });
});
