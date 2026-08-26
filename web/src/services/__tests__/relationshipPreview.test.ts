import { describe, expect, test } from 'vitest';
import { recommendationData } from '../../data';
import type { PairedModel } from '../../types/recommendation';
import {
  aggregateRelationshipTargetsFor,
  buildContextualRelationshipPreviewIndex,
  buildHeroTrioRelationshipPreviews,
  buildProspectiveContextualRelationshipPreviewIndex,
  buildStaticRelationshipPreviewIndex,
  relationshipPreviewItemKey,
  relationshipTargetsFor,
  type PairRelationshipPreview,
  type RelationshipPreviewIndex,
  type RelationshipPreviewItem,
} from '../relationshipPreview';
import {
  createEmptyTeamBuilderLayout,
  type TeamBuilderLayout,
} from '../teamBuilderArrangement';

const item = (
  kind: RelationshipPreviewItem['kind'],
  name: string
): RelationshipPreviewItem => ({ kind, name });

const relationshipsBetween = (
  index: RelationshipPreviewIndex,
  source: RelationshipPreviewItem,
  target: RelationshipPreviewItem
): readonly PairRelationshipPreview[] =>
  relationshipTargetsFor(source, index).get(
    relationshipPreviewItemKey(target)
  ) ?? [];

const makeModel = (
  weights: Record<string, number>,
  support: Record<string, number> = Object.fromEntries(
    Object.keys(weights).map((featureId) => [featureId, 100])
  )
): PairedModel => ({
  ...recommendationData.model,
  enabled_families: [
    'HP',
    'HS',
    'THS',
    'SP',
    'TSP',
    'HT',
    'M',
    'B',
    'HC',
  ],
  weights,
  support,
  n_features: Object.keys(weights).length,
});

const completeLayout = (
  heroes: readonly [string, string, string] = ['A', 'B', 'C']
): TeamBuilderLayout => {
  const layout = createEmptyTeamBuilderLayout();
  heroes.forEach((hero, heroIndex) => {
    layout[0].heroes[heroIndex].hero = hero;
  });
  return layout;
};

describe('static relationship preview lookup', () => {
  test('shows direct HP and HS with their exact production meanings', () => {
    const index = buildStaticRelationshipPreviewIndex(
      ['张昭', '陆逊', '黄盖'],
      ['烈火张天', '风助火势'],
      recommendationData.model
    );

    expect(
      relationshipsBetween(
        index,
        item('skill', '烈火张天'),
        item('hero', '张昭')
      ).map(({ family, featureId, weight, support }) => ({
        family,
        featureId,
        weight,
        support,
      }))
    ).toEqual([
      {
        family: 'HS',
        featureId: 'HS|张昭|烈火张天',
        weight: 0.062113,
        support: 64,
      },
    ]);
    expect(
      relationshipsBetween(
        index,
        item('hero', '张昭'),
        item('hero', '陆逊')
      ).map(({ family, featureId, weight }) => ({ family, featureId, weight }))
    ).toEqual([
      {
        family: 'HP',
        featureId: 'HP|张昭|陆逊',
        weight: 0.102953,
      },
    ]);
  });

  test('never substitutes team-wide THS for direct HS (张昭→胜敌益强 regression)', () => {
    expect(recommendationData.model.weights['THS|张昭|胜敌益强']).toBe(
      0.008539
    );
    expect(recommendationData.model.weights['HS|张昭|胜敌益强']).toBeUndefined();

    const index = buildStaticRelationshipPreviewIndex(
      ['张昭'],
      ['胜敌益强'],
      recommendationData.model
    );
    expect(
      relationshipsBetween(
        index,
        item('hero', '张昭'),
        item('skill', '胜敌益强')
      )
    ).toEqual([]);
  });

  test('excludes THS, TSP, M, atomics, HC/B, and unrelated high-order families', () => {
    const model = makeModel({
      'H|A': 4,
      'S|x': 3,
      'THS|A|x': 2,
      'TSP|x|y': 1,
      'M|buff:test|requires|friendly': 0.8,
      'HC|3': 0.7,
      'B|bond': 0.6,
      'TS3|x|y|z': 0.5,
    });
    const index = buildStaticRelationshipPreviewIndex(
      ['A', 'B', 'C'],
      ['x', 'y', 'z'],
      model
    );

    expect(index.bySource.size).toBe(0);
  });

  test('omits zero-rendering and under-supported direct weights', () => {
    const model = makeModel(
      {
        'HP|A|B': -0.00001,
        'HP|A|C': -0.000051,
        'HS|A|x': 0,
        'HS|B|x': 0.25,
      },
      {
        'HP|A|B': 8,
        'HP|A|C': 8,
        'HS|A|x': 99,
        'HS|B|x': 7,
      }
    );
    const index = buildStaticRelationshipPreviewIndex(
      ['A', 'B', 'C'],
      ['x'],
      model
    );

    expect(
      relationshipsBetween(index, item('hero', 'A'), item('hero', 'B'))
    ).toEqual([]);
    expect(
      relationshipsBetween(index, item('hero', 'A'), item('hero', 'C'))
    ).toMatchObject([{ family: 'HP', weight: -0.000051, support: 8 }]);
    expect(
      relationshipsBetween(index, item('hero', 'A'), item('skill', 'x'))
    ).toEqual([]);
    expect(
      relationshipsBetween(index, item('hero', 'B'), item('skill', 'x'))
    ).toEqual([]);
  });
});

describe('carrier-aware SP preview lookup', () => {
  test('shows SP only for two skills on one concrete current carrier', () => {
    const model = makeModel({
      'SP|A|x|y': -0.25,
      'TSP|x|y': 0.9,
      'M|buff:test|requires|friendly': 0.4,
    });
    const layout = completeLayout();
    layout[0].heroes[0].skills = ['x', 'y'];
    let index = buildContextualRelationshipPreviewIndex(layout, model);

    expect(
      relationshipsBetween(index, item('skill', 'x'), item('skill', 'y'))
    ).toMatchObject([
      {
        family: 'SP',
        featureId: 'SP|A|x|y',
        label: '同武将',
        weight: -0.25,
        carrierHero: 'A',
      },
    ]);
    expect(
      [...index.bySource.values()]
        .flatMap((targets) => [...targets.values()])
        .flat()
        .every(({ family }) => family === 'SP')
    ).toBe(true);

    layout[0].heroes[0].skills[1] = null;
    index = buildContextualRelationshipPreviewIndex(layout, model);
    expect(
      relationshipsBetween(index, item('skill', 'x'), item('skill', 'y'))
    ).toEqual([]);
  });

  test('shows SP for a concrete prospective drag-over placement, not before', () => {
    const model = makeModel({ 'SP|A|x|y': 0.3 });
    const layout = completeLayout();
    layout[0].heroes[0].skills[1] = 'x';
    const current = buildContextualRelationshipPreviewIndex(layout, model);
    expect(relationshipTargetsFor(item('skill', 'y'), current).size).toBe(0);

    const prospective = buildProspectiveContextualRelationshipPreviewIndex(
      layout,
      { kind: 'skill', origin: 'pool', skill: 'y' },
      {
        kind: 'skill',
        destination: 'slot',
        teamIndex: 0,
        heroIndex: 0,
        skillIndex: 0,
      },
      model
    );
    expect(
      relationshipsBetween(
        prospective,
        item('skill', 'y'),
        item('skill', 'x')
      )
    ).toMatchObject([{ family: 'SP', weight: 0.3, carrierHero: 'A' }]);
  });
});

describe('exact hero-trio previews', () => {
  test('surfaces one canonical HT at team level for an exact active trio', () => {
    const model = makeModel({ 'HT|A|B|C': 0.125 });
    const previews = buildHeroTrioRelationshipPreviews(
      completeLayout(),
      { kind: 'hero', origin: 'slot', teamIndex: 0, heroIndex: 1 },
      model
    );

    expect(previews.size).toBe(1);
    expect(previews.get(0)).toMatchObject({
      total: 0.125,
      compactLabel: '三人组',
      components: [
        {
          family: 'HT',
          featureId: 'HT|A|B|C',
          detailLabel: '精确三人组',
        },
      ],
    });
    expect(previews.get(0)?.accessibleLabel).toContain('精确武将三人组A、B、C');
  });

  test('requires a complete unambiguous active or post-replacement team', () => {
    const model = makeModel({
      'HT|A|B|C': 0.125,
      'HT|A|B|D': -0.25,
    });
    const incomplete = completeLayout();
    incomplete[0].heroes[2].hero = null;

    expect(
      buildHeroTrioRelationshipPreviews(
        incomplete,
        { kind: 'hero', origin: 'slot', teamIndex: 0, heroIndex: 0 },
        model
      ).size
    ).toBe(0);
    expect(
      buildHeroTrioRelationshipPreviews(
        incomplete,
        { kind: 'hero', origin: 'pool', hero: 'C' },
        model
      ).size
    ).toBe(0);

    const completed = buildHeroTrioRelationshipPreviews(
      incomplete,
      { kind: 'hero', origin: 'pool', hero: 'C' },
      model,
      {
        kind: 'hero',
        destination: 'slot',
        teamIndex: 0,
        heroIndex: 2,
      }
    );
    expect(completed.get(0)?.components).toMatchObject([
      { featureId: 'HT|A|B|C' },
    ]);

    const replaced = buildHeroTrioRelationshipPreviews(
      completeLayout(),
      { kind: 'hero', origin: 'pool', hero: 'D' },
      model,
      {
        kind: 'hero',
        destination: 'slot',
        teamIndex: 0,
        heroIndex: 2,
      }
    );
    expect(replaced.size).toBe(1);
    expect(replaced.get(0)?.components).toMatchObject([
      { featureId: 'HT|A|B|D' },
    ]);
  });

  test('omits disabled, zero, and under-supported HT', () => {
    const layout = completeLayout();
    for (const model of [
      makeModel({ 'HT|A|B|C': 0 }),
      makeModel({ 'HT|A|B|C': 0.00001 }),
      makeModel({ 'HT|A|B|C': 0.2 }, { 'HT|A|B|C': 49 }),
      {
        ...makeModel({ 'HT|A|B|C': 0.2 }),
        enabled_families: ['HP'] as PairedModel['enabled_families'],
      },
    ]) {
      expect(
        buildHeroTrioRelationshipPreviews(
          layout,
          { kind: 'hero', origin: 'slot', teamIndex: 0, heroIndex: 0 },
          model
        ).size
      ).toBe(0);
    }
  });
});

describe('aggregate relationship previews', () => {
  test('sums only distinct displayed components and preserves detail meaning', () => {
    const model = makeModel({
      'HS|A|x': 0.25,
      'THS|A|x': 0.5,
      'M|buff:test|requires|friendly': 0.4,
      'TSP|x|y': 0.3,
    });
    const first = buildStaticRelationshipPreviewIndex(['A'], ['x'], model);
    const second = buildStaticRelationshipPreviewIndex(['A'], ['x'], model);
    const aggregate = aggregateRelationshipTargetsFor(
      item('skill', 'x'),
      first,
      second
    ).get(relationshipPreviewItemKey(item('hero', 'A')));

    expect(aggregate).toMatchObject({
      total: 0.25,
      components: [{ family: 'HS', featureId: 'HS|A|x' }],
    });
    expect(aggregate?.components).toHaveLength(1);
    expect(aggregate?.accessibleLabel).toContain('共 1 项');
    expect(aggregate?.components[0].accessibleLabel).toContain('直接携带');
  });
});
