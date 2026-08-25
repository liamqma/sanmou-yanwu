import { describe, expect, test } from 'vitest';
import { recommendationData } from '../../data';
import type {
  PairedModel,
  RecommendationCatalog,
} from '../../types/recommendation';
import {
  aggregateRelationshipTargetsFor,
  buildContextualRelationshipPreviewIndex,
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

const concreteFireLayout = (): TeamBuilderLayout => {
  const layout = createEmptyTeamBuilderLayout();
  layout[0].heroes[0].hero = '张昭';
  layout[0].heroes[0].skills[0] = '烈火张天';
  layout[0].heroes[1].hero = '陆逊';
  layout[0].heroes[2].hero = '黄盖';
  return layout;
};

const productionStaticIndex = () =>
  buildStaticRelationshipPreviewIndex(
    ['张昭', '陆逊', '黄盖'],
    ['烈火张天', '风助火势'],
    recommendationData.model
  );

const makeModel = (
  weights: Record<string, number>,
  support: Record<string, number> = Object.fromEntries(
    Object.keys(weights).map((featureId) => [featureId, 100])
  )
): PairedModel => ({
  ...recommendationData.model,
  enabled_families: ['HP', 'HS', 'THS', 'SP', 'TSP', 'M', 'B', 'HC'],
  weights,
  support,
  n_features: Object.keys(weights).length,
});

const makeCatalog = (): RecommendationCatalog => ({
  ...recommendationData.catalog,
  default_skill: { A: 'a-default', B: 'b-default', C: 'c-default' },
  relationships: {
    hero_camp: { A: '吴', B: '吴', C: '蜀' },
    bonds: [{ name: 'AB缘分', required_members: 2, members: ['A', 'B'] }],
  },
  mechanics: {
    certainty_mode: 'all_reviewed',
    mechanic_names: { 'buff:test': '测试机制' },
    skills: {
      'a-default': [
        { relation: 'provides', mechanic: 'buff:test', subject: 'team' },
      ],
      equipped: [
        { relation: 'requires', mechanic: 'buff:test', subject: 'team' },
      ],
    },
  },
});

describe('static relationship preview lookup', () => {
  test('uses exact production HP, HS, THS and TSP weights without confidence filtering', () => {
    const index = productionStaticIndex();

    expect(
      relationshipsBetween(
        index,
        item('skill', '烈火张天'),
        item('hero', '张昭')
      ).map(({ family, weight, support }) => ({ family, weight, support }))
    ).toEqual([
      { family: 'HS', weight: 0.062113, support: 64 },
      { family: 'THS', weight: 0.042916, support: 87 },
    ]);
    expect(
      relationshipsBetween(
        index,
        item('skill', '烈火张天'),
        item('hero', '陆逊')
      ).map(({ family, weight }) => ({ family, weight }))
    ).toContainEqual({ family: 'THS', weight: 0.050431 });
    expect(
      relationshipsBetween(
        index,
        item('skill', '烈火张天'),
        item('skill', '风助火势')
      ).map(({ family, weight }) => ({ family, weight }))
    ).toEqual([{ family: 'TSP', weight: -0.045183 }]);

    expect(
      relationshipsBetween(
        index,
        item('hero', '张昭'),
        item('hero', '陆逊')
      ).map(({ family, weight }) => ({ family, weight }))
    ).toEqual([{ family: 'HP', weight: 0.102953 }]);
    expect(
      relationshipsBetween(
        index,
        item('hero', '张昭'),
        item('hero', '黄盖')
      ).map(({ family, weight }) => ({ family, weight }))
    ).toEqual([{ family: 'HP', weight: -0.03639 }]);
  });

  test('does not expose atomic or excluded high-order families', () => {
    const model = makeModel({
      'H|A': 4,
      'S|x': 3,
      'HT|A|B|C': 2,
      'TS3|x|y|z': 1,
    });
    model.enabled_families = ['H', 'S', 'HT', 'TS3'];
    const index = buildStaticRelationshipPreviewIndex(
      ['A', 'B', 'C'],
      ['x', 'y', 'z'],
      model
    );

    expect(index.bySource.size).toBe(0);
  });

  test('omits disabled, missing, zero, and under-supported weights while retaining eligible small negatives', () => {
    const model = makeModel(
      {
        'HP|A|B': -0.00001,
        'HS|A|x': 0,
        'THS|A|x': 0.25,
      },
      { 'HP|A|B': 8, 'HS|A|x': 99, 'THS|A|x': 2 }
    );
    model.enabled_families = ['HP', 'HS'];
    const index = buildStaticRelationshipPreviewIndex(['A', 'B'], ['x'], model);

    expect(
      relationshipsBetween(index, item('hero', 'A'), item('hero', 'B'))
    ).toMatchObject([{ family: 'HP', weight: -0.00001, support: 8 }]);
    expect(
      relationshipsBetween(index, item('hero', 'A'), item('skill', 'x'))
    ).toEqual([]);

    const underSupported = buildStaticRelationshipPreviewIndex(
      ['A', 'B'],
      [],
      makeModel({ 'HP|A|B': 0.5 }, { 'HP|A|B': 7 })
    );
    expect(
      relationshipsBetween(underSupported, item('hero', 'A'), item('hero', 'B'))
    ).toEqual([]);
  });
});

describe('carrier-context relationship preview lookup', () => {
  test('associates concrete M witnesses with the correct hero/default-skill card', () => {
    const layout = concreteFireLayout();
    const index = buildContextualRelationshipPreviewIndex(
      layout,
      recommendationData.model,
      recommendationData.catalog
    );
    const relationships = relationshipsBetween(
      index,
      item('skill', '烈火张天'),
      item('hero', '陆逊')
    );

    expect(relationships).toHaveLength(1);
    expect(relationships[0]).toMatchObject({
      family: 'M',
      weight: 0.024749,
      mechanicWitness: {
        provider: {
          skill: '烈火张天',
          carrierHero: '张昭',
          origin: 'equipped',
          slotIndex: 1,
        },
        consumer: {
          skill: '火烧连营',
          carrierHero: '陆逊',
          origin: 'default',
          slotIndex: 0,
        },
      },
    });
    expect(relationships[0].accessibleLabel).toContain('模型权重 +0.0247');
  });

  test('shows SP only for two skills on a known common carrier', () => {
    const model = makeModel({ 'SP|A|x|y': -0.25 });
    const catalog = makeCatalog();
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = 'A';
    layout[0].heroes[0].skills = ['x', 'y'];
    let index = buildContextualRelationshipPreviewIndex(layout, model, catalog);

    expect(
      relationshipsBetween(index, item('skill', 'x'), item('skill', 'y'))
    ).toMatchObject([
      {
        family: 'SP',
        label: '同武将',
        weight: -0.25,
        carrierHero: 'A',
      },
    ]);

    layout[0].heroes[0].skills[1] = null;
    index = buildContextualRelationshipPreviewIndex(layout, model, catalog);
    expect(
      relationshipsBetween(index, item('skill', 'x'), item('skill', 'y'))
    ).toEqual([]);
  });

  test('warehouse skill M/SP context appears only after a concrete drag-over placement', () => {
    const catalog = makeCatalog();
    const model = makeModel({
      'M|buff:test|requires|friendly': 0.4,
      'SP|A|equipped|x': 0.3,
    });
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = 'A';
    layout[0].heroes[0].skills[1] = 'x';
    layout[0].heroes[1].hero = 'B';
    layout[0].heroes[2].hero = 'C';
    const current = buildContextualRelationshipPreviewIndex(
      layout,
      model,
      catalog
    );
    expect(
      relationshipTargetsFor(item('skill', 'equipped'), current).size
    ).toBe(0);

    const prospective = buildProspectiveContextualRelationshipPreviewIndex(
      layout,
      { kind: 'skill', origin: 'pool', skill: 'equipped' },
      {
        kind: 'skill',
        destination: 'slot',
        teamIndex: 0,
        heroIndex: 0,
        skillIndex: 0,
      },
      model,
      catalog
    );
    expect(
      relationshipsBetween(
        prospective,
        item('skill', 'equipped'),
        item('hero', 'A')
      )
    ).toMatchObject([{ family: 'M', weight: 0.4 }]);
    expect(
      relationshipsBetween(
        prospective,
        item('skill', 'equipped'),
        item('skill', 'x')
      )
    ).toMatchObject([{ family: 'SP', weight: 0.3 }]);
  });

  test('deduplicates repeated witnesses with the same M id and target card', () => {
    const layout = concreteFireLayout();
    layout[0].heroes[0].skills[1] = '烈火张天';
    const index = buildContextualRelationshipPreviewIndex(
      layout,
      recommendationData.model,
      recommendationData.catalog
    );

    expect(
      relationshipsBetween(
        index,
        item('skill', '烈火张天'),
        item('hero', '陆逊')
      ).filter(({ family }) => family === 'M')
    ).toHaveLength(1);
  });
});

describe('aggregate relationship previews', () => {
  test('sums every distinct eligible component and preserves deterministic detail order', () => {
    const staticIndex = productionStaticIndex();
    const contextualIndex = buildContextualRelationshipPreviewIndex(
      concreteFireLayout(),
      recommendationData.model,
      recommendationData.catalog
    );
    const source = item('skill', '烈火张天');
    const targets = aggregateRelationshipTargetsFor(
      source,
      staticIndex,
      contextualIndex
    );

    const zhangZhao = targets.get(relationshipPreviewItemKey(item('hero', '张昭')));
    expect(zhangZhao?.total).toBeCloseTo(0.105029, 12);
    expect(zhangZhao?.components.map(({ featureId }) => featureId)).toEqual([
      'HS|张昭|烈火张天',
      'THS|张昭|烈火张天',
    ]);

    const luXun = targets.get(relationshipPreviewItemKey(item('hero', '陆逊')));
    expect(luXun?.total).toBeCloseTo(0.07518, 12);
    expect(luXun?.components.map(({ featureId }) => featureId)).toEqual([
      'THS|陆逊|烈火张天',
      'M|debuff:huo_gong|benefits_from|enemy',
    ]);

    expect(targets.get(relationshipPreviewItemKey(item('skill', '风助火势')))).toMatchObject({
      total: -0.045183,
      components: [{ featureId: 'TSP|烈火张天|风助火势' }],
    });
  });

  test('deduplicates canonical features, omits exact cancellation, and keeps multiple targets', () => {
    const model = makeModel({
      'HS|A|x': 0.25,
      'THS|A|x': -0.25,
      'HS|B|x': 0.4,
      'THS|B|x': 0.1,
    });
    const first = buildStaticRelationshipPreviewIndex(['A', 'B'], ['x'], model);
    const second = buildStaticRelationshipPreviewIndex(['A', 'B'], ['x'], model);
    const targets = aggregateRelationshipTargetsFor(item('skill', 'x'), first, second);

    expect(targets.has(relationshipPreviewItemKey(item('hero', 'A')))).toBe(false);
    expect(targets.get(relationshipPreviewItemKey(item('hero', 'B')))).toMatchObject({
      total: 0.5,
    });
    expect(
      targets.get(relationshipPreviewItemKey(item('hero', 'B')))?.components
    ).toHaveLength(2);
    expect(targets.size).toBe(1);
  });
});
