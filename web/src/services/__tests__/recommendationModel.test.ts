import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import {
  teamFeatureIds,
  mechanicWitnesses,
  scoreTeam,
  weightOf,
  supportOf,
  nonDefaultSkillsForHero,
  validateRecommendationCatalog,
  type AssignedHero,
} from '../recommendationModel';
import type { PairedModel, RecommendationCatalog } from '../../types/recommendation';

const catalog: RecommendationCatalog = {
  catalog_version: 'test',
  relationship_version: 'abcdefabcdef',
  mechanics_version: '123456789abc',
  mechanics: {
    certainty_mode: 'all_reviewed',
    mechanic_names: {},
    skills: {},
  },
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
      catalog
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
      catalog,
      false
    );
    const global = teamFeatureIds(
      [
        { name: 'A', skills: ['a'] },
        { name: 'B', skills: ['b'] },
        { name: 'C', skills: ['c'] },
        { name: 'D', skills: ['d'] },
      ],
      catalog
    );
    for (const features of [offeredSet, global]) {
      expect(
        [...features].some((feature) => /^(THS|TSP|HT|TS3|HC|B)\|/.test(feature))
      ).toBe(false);
    }
  });

  const fireCatalog: RecommendationCatalog = {
    ...catalog,
    default_skill: {
      陆逊: '火烧连营',
      张昭: '张昭签名',
      孙权: '孙权签名',
      周瑜: '周瑜签名',
    },
    mechanics: {
      certainty_mode: 'all_reviewed',
      mechanic_names: { 'debuff:huo_gong': '火攻' },
      skills: {
        火烧连营: [
          { relation: 'provides', mechanic: 'debuff:huo_gong', subject: 'enemy' },
          { relation: 'benefits_from', mechanic: 'debuff:huo_gong', subject: 'enemy' },
        ],
        烈火张天: [
          { relation: 'provides', mechanic: 'debuff:huo_gong', subject: 'enemy' },
        ],
      },
    },
  };
  const fireTeam = (carrier: '陆逊' | '张昭' | '孙权'): AssignedHero[] =>
    ['陆逊', '张昭', '孙权'].map((name) => ({
      name,
      skills: name === carrier ? ['烈火张天'] : [],
    }));
  const mechEnabled = new Set(['M']);

  test('emits the reviewed fire feature for a distinct provider on any carrier', () => {
    for (const carrier of ['陆逊', '张昭', '孙权'] as const) {
      expect(
        teamFeatureIds(fireTeam(carrier), fireCatalog, true, mechEnabled)
      ).toContain('M|debuff:huo_gong|benefits_from|enemy');
    }
  });

  test('retains concrete provider and consumer origin, carrier, and slot witnesses', () => {
    const team = fireTeam('张昭');
    team[1].skills = ['', '烈火张天'];
    const witness = mechanicWitnesses(team, fireCatalog).find(
      ({ provider, consumer, featureId }) =>
        provider.skill === '烈火张天' &&
        consumer.skill === '火烧连营' &&
        featureId === 'M|debuff:huo_gong|benefits_from|enemy'
    );

    expect(witness).toEqual({
      provider: {
        skill: '烈火张天',
        carrierHero: '张昭',
        origin: 'equipped',
        slotIndex: 2,
      },
      consumer: {
        skill: '火烧连营',
        carrierHero: '陆逊',
        origin: 'default',
        slotIndex: 0,
      },
      mechanic: 'debuff:huo_gong',
      relation: 'benefits_from',
      side: 'enemy',
      featureId: 'M|debuff:huo_gong|benefits_from|enemy',
    });
  });

  test('does not emit fire without a consumer or from the signature self-loop', () => {
    const withoutConsumer: AssignedHero[] = [
      { name: '张昭', skills: ['烈火张天'] },
      { name: '孙权', skills: [] },
      { name: '周瑜', skills: [] },
    ];
    const withoutProvider: AssignedHero[] = [
      { name: '陆逊', skills: [] },
      { name: '张昭', skills: [] },
      { name: '孙权', skills: [] },
    ];
    expect(teamFeatureIds(withoutConsumer, fireCatalog, true, mechEnabled)).not.toContain(
      'M|debuff:huo_gong|benefits_from|enemy'
    );
    expect(teamFeatureIds(withoutProvider, fireCatalog, true, mechEnabled)).not.toContain(
      'M|debuff:huo_gong|benefits_from|enemy'
    );
  });

  test('preserves canonical/equipped copies and repeated equipped slots as distinct instances', () => {
    const sameSkillCatalog: RecommendationCatalog = {
      ...fireCatalog,
      default_skill: { A: 'loop', B: 'b', C: 'c' },
      mechanics: {
        certainty_mode: 'all_reviewed',
        mechanic_names: { 'debuff:huo_gong': '火攻' },
        skills: {
          loop: [
            { relation: 'provides', mechanic: 'debuff:huo_gong', subject: 'enemy' },
            { relation: 'consumes', mechanic: 'debuff:huo_gong', subject: 'enemy' },
          ],
        },
      },
    };
    const canonicalCopy = [
      { name: 'A', skills: ['loop'] },
      { name: 'B', skills: [] },
      { name: 'C', skills: [] },
    ];
    const repeatedSlots = [
      { name: 'A', skills: ['loop', 'loop'] },
      { name: 'B', skills: [] },
      { name: 'C', skills: [] },
    ];
    const canonicalFeatures = teamFeatureIds(
      canonicalCopy,
      sameSkillCatalog,
      true,
      mechEnabled
    );
    expect(canonicalFeatures).toContain('M|debuff:huo_gong|consumes|enemy');
    expect(canonicalFeatures).not.toContain('S|loop');
    expect(teamFeatureIds(repeatedSlots, sameSkillCatalog, true, mechEnabled)).toContain(
      'M|debuff:huo_gong|consumes|enemy'
    );
  });

  test('resolves friendly, enemy, any, unknown, and exact mechanic matching', () => {
    const subjectCatalog: RecommendationCatalog = {
      ...catalog,
      default_skill: { A: 'provider', B: 'consumer', C: 'unknown' },
      mechanics: {
        certainty_mode: 'all_reviewed',
        mechanic_names: {
          'buff:exact': '精确',
          'buff:parent': '父级',
        },
        skills: {
          provider: [
            { relation: 'provides', mechanic: 'buff:exact', subject: 'any' },
          ],
          consumer: [
            { relation: 'requires', mechanic: 'buff:exact', subject: 'any' },
            { relation: 'benefits_from', mechanic: 'buff:parent', subject: 'any' },
          ],
          unknown: [
            { relation: 'requires', mechanic: 'buff:exact', subject: 'unknown' },
          ],
        },
      },
    };
    const features = teamFeatureIds(
      [
        { name: 'A', skills: [] },
        { name: 'B', skills: [] },
        { name: 'C', skills: [] },
      ],
      subjectCatalog,
      true,
      mechEnabled
    );
    expect(features).toContain('M|buff:exact|requires|friendly');
    expect(features).toContain('M|buff:exact|requires|enemy');
    expect([...features].some((feature) => feature.includes('buff:parent'))).toBe(false);
  });

  test('matches frozen pre-witness M scoring characterization outputs', () => {
    const fixture = JSON.parse(
      readFileSync(
        'src/services/__tests__/fixtures/mechanicScoringCharacterization.json',
        'utf8'
      )
    ) as {
      catalog: {
        default_skill: Record<string, string>;
        mechanic_names: Record<string, string>;
        skills: RecommendationCatalog['mechanics']['skills'];
      };
      cases: Array<{
        name: string;
        team: Array<{ name: string; equipped: string[] }>;
        expected_m: string[];
      }>;
    };
    const characterizationCatalog: RecommendationCatalog = {
      ...catalog,
      default_skill: fixture.catalog.default_skill,
      mechanics: {
        certainty_mode: 'all_reviewed',
        mechanic_names: fixture.catalog.mechanic_names,
        skills: fixture.catalog.skills,
      },
    };

    for (const fixtureCase of fixture.cases) {
      const emitted = [
        ...teamFeatureIds(
          fixtureCase.team.map(({ name, equipped }) => ({
            name,
            skills: equipped,
          })),
          characterizationCatalog,
          true,
          mechEnabled
        ),
      ]
        .filter((feature) => feature.startsWith('M|'))
        .sort();
      expect(emitted, fixtureCase.name).toEqual(fixtureCase.expected_m);
    }
  });

  test('matches the shared Python/TypeScript MECH parity fixture', () => {
    const fixture = JSON.parse(
      readFileSync('../data/evaluation/mech_feature_parity.json', 'utf8')
    ) as {
      certainty_mode: 'all_reviewed';
      mechanic_names: Record<string, string>;
      default_skill: Record<string, string>;
      skills: RecommendationCatalog['mechanics']['skills'];
      cases: Array<{
        name: string;
        team: Array<{ name: string; equipped: string[] }>;
        expected_m: string[];
      }>;
    };
    const fixtureCatalog: RecommendationCatalog = {
      ...catalog,
      default_skill: fixture.default_skill,
      mechanics: {
        certainty_mode: fixture.certainty_mode,
        mechanic_names: fixture.mechanic_names,
        skills: fixture.skills,
      },
    };

    for (const fixtureCase of fixture.cases) {
      const emitted = [
        ...teamFeatureIds(
          fixtureCase.team.map(({ name, equipped }) => ({
            name,
            skills: equipped,
          })),
          fixtureCatalog,
          true,
          mechEnabled
        ),
      ]
        .filter((feature) => feature.startsWith('M|'))
        .sort();
      expect(emitted, fixtureCase.name).toEqual(fixtureCase.expected_m);
    }
  });

  test('does no M work for disabled or non-concrete pools and presence-encodes witnesses', () => {
    const repeatedProviders = fireTeam('张昭');
    repeatedProviders[2].skills = ['烈火张天'];
    const features = teamFeatureIds(repeatedProviders, fireCatalog, true, mechEnabled);
    expect([...features].filter((feature) => feature === 'M|debuff:huo_gong|benefits_from|enemy')).toHaveLength(1);
    expect(teamFeatureIds(repeatedProviders, fireCatalog, false, mechEnabled)).not.toContain(
      'M|debuff:huo_gong|benefits_from|enemy'
    );
    expect(teamFeatureIds(repeatedProviders, fireCatalog, true, new Set(['H']))).not.toContain(
      'M|debuff:huo_gong|benefits_from|enemy'
    );
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
    min_support_mechanic: 30,
    min_mechanic_pair_diversity: 2,
    team_context_shrinkage: 0.5,
    high_order_shrinkage: 0.35,
    mechanic_shrinkage: 0.25,
    mech_certainty_mode: 'all_reviewed',
    scoring_version: 'fedcbafedcba',
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
      scoreTeam(first, contextual, catalog) +
        scoreTeam(second, contextual, catalog)
    ).toBe(0);
    expect(scoreTeam(together, contextual, catalog)).toBe(5);
  });

  test('scores signature-only and equipped MECH interactions on concrete teams', () => {
    const mechModel: PairedModel = {
      ...model,
      enabled_families: ['M'],
      weights: { 'M|debuff:huo_gong|benefits_from|enemy': 2 },
      support: { 'M|debuff:huo_gong|benefits_from|enemy': 903 },
      n_features: 1,
    };
    const fireCatalog = {
      ...catalog,
      default_skill: { 陆逊: '火烧连营', 张昭: '张昭签名', 孙权: '孙权签名' },
      mechanics: {
        certainty_mode: 'all_reviewed' as const,
        mechanic_names: { 'debuff:huo_gong': '火攻' },
        skills: {
          火烧连营: [
            { relation: 'benefits_from' as const, mechanic: 'debuff:huo_gong', subject: 'enemy' as const },
          ],
          烈火张天: [
            { relation: 'provides' as const, mechanic: 'debuff:huo_gong', subject: 'enemy' as const },
          ],
        },
      },
    };
    expect(
      scoreTeam(
        [
          { name: '陆逊', skills: [] },
          { name: '张昭', skills: ['烈火张天'] },
          { name: '孙权', skills: [] },
        ],
        mechModel,
        fireCatalog
      )
    ).toBe(2);
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

    expect(scoreTeam(team, withContextEnabled, catalog)).toBe(
      scoreTeam(team, model)
    );
  });
});

describe('generated mechanics validation', () => {
  test('rejects removes/prevents from the production scoring contract', () => {
    const invalid = structuredClone(catalog) as RecommendationCatalog;
    invalid.mechanics = {
      certainty_mode: 'all_reviewed',
      mechanic_names: { 'debuff:huo_gong': '火攻' },
      skills: {
        bad: [
          {
            relation: 'removes',
            mechanic: 'debuff:huo_gong',
            subject: 'enemy',
          } as never,
        ],
      },
    };
    expect(() => validateRecommendationCatalog(invalid)).toThrow(
      'Invalid mechanic relationship'
    );
  });
});

describe('nonDefaultSkillsForHero', () => {
  test('drops the catalog default skill', () => {
    expect(nonDefaultSkillsForHero('A', ['defA', 's1', 's2'], catalog)).toEqual(['s1', 's2']);
  });
});
