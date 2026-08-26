import { describe, expect, test } from 'vitest';
import type { RecommendationCatalog } from '../../types/recommendation';
import {
  labelAnalyticsRelationship,
  labelFeature,
} from '../featureLabels';

const catalog = {
  mechanics: {
    mechanic_names: {
      'debuff:huo_gong': '火攻',
    },
  },
} as unknown as RecommendationCatalog;

describe('labelAnalyticsRelationship M validation', () => {
  test('renders a valid catalog mechanic with a human-readable relation and exact side', () => {
    expect(
      labelAnalyticsRelationship(
        'M|debuff:huo_gong|benefits_from|enemy',
        catalog
      )
    ).toMatchObject({
      label: '机制联动：火攻 · 受益于（敌方）',
      mechanic: {
        name: '火攻',
        consumerRelation: 'benefits_from',
        consumerRelationLabel: '受益于',
        side: 'enemy',
        sideLabel: '敌方',
      },
    });
  });

  test.each([
    [
      'M|debuff:huo_gong|requires',
      /Malformed Analytics M feature; expected mechanic, relation, and side/,
    ],
    [
      'M|debuff:unknown|requires|friendly',
      /unknown catalog mechanic: debuff:unknown/,
    ],
    [
      'M|debuff:huo_gong|provides|friendly',
      /unsupported consumer relation: provides/,
    ],
    [
      'M|debuff:huo_gong|requires|neutral',
      /invalid side: neutral/,
    ],
  ])('fails closed for invalid feature %s', (featureId, message) => {
    expect(() => labelAnalyticsRelationship(featureId, catalog)).toThrow(
      message
    );
  });
});

describe('labelFeature general mechanic fallbacks', () => {
  test('retains canonical mechanic and unknown relation values without a catalog', () => {
    expect(
      labelFeature('M|debuff:canonical_id|custom_relation|other').label
    ).toBe('机制联动：debuff:canonical_id · custom_relation（友方）');
  });
});
