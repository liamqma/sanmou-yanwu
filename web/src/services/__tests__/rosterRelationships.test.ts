import { describe, expect, test } from 'vitest';
import { recommendationData } from '../../data';
import type { PairedModel } from '../../types/recommendation';
import {
  buildRosterRelationshipEdges,
  formatRosterRelationshipWeight,
  maxRosterRelationshipMagnitude,
  rosterRelationshipNodeKey,
  rosterRelationshipOtherNodeKey,
  rosterRelationshipsForNode,
  ROSTER_RELATIONSHIP_LABELS,
  type RosterRelationshipNode,
} from '../rosterRelationships';

const modelWith = (
  weights: Record<string, number>,
  support: Record<string, number> = Object.fromEntries(
    Object.keys(weights).map((featureId) => [featureId, 100])
  )
): PairedModel => ({
  ...recommendationData.model,
  enabled_families: ['HP', 'HS', 'THS'],
  weights,
  support,
  n_features: Object.keys(weights).length,
});

const node = (
  kind: RosterRelationshipNode['kind'],
  name: string
): RosterRelationshipNode => ({
  key: rosterRelationshipNodeKey(kind, name),
  kind,
  name,
});

describe('current-roster relationship data', () => {
  test('builds only supported direct same-team and carrying relationships', () => {
    const nodes = [
      node('hero', '祝融'),
      node('hero', '孟获'),
      node('skill', '威名显赫'),
    ];
    const model = modelWith(
      {
        'HP|孟获|祝融': 0.12,
        'HS|祝融|威名显赫': 0.25,
        'HS|孟获|威名显赫': -0.4,
        'THS|孟获|威名显赫': 0.9,
      },
      {
        'HP|孟获|祝融': 18,
        'HS|祝融|威名显赫': 24,
        'HS|孟获|威名显赫': 30,
        'THS|孟获|威名显赫': 100,
      }
    );

    const edges = buildRosterRelationshipEdges(nodes, model);
    expect(
      edges.map(({ featureId, family, weight, support }) => ({
        featureId,
        family,
        weight,
        support,
      }))
    ).toEqual([
      {
        featureId: 'HS|祝融|威名显赫',
        family: 'HS',
        weight: 0.25,
        support: 24,
      },
      {
        featureId: 'HP|孟获|祝融',
        family: 'HP',
        weight: 0.12,
        support: 18,
      },
    ]);
    expect(ROSTER_RELATIONSHIP_LABELS).toEqual({
      HP: '武将同队',
      HS: '武将携带战法',
    });
    expect(maxRosterRelationshipMagnitude(edges)).toBe(0.25);
    expect(formatRosterRelationshipWeight(0.25)).toBe('+2.5');
    expect(formatRosterRelationshipWeight(-0.13)).toBe('−1.3');
  });

  test('retains tiny supported positive weights without a display threshold', () => {
    const featureId = 'HS|吕布|辕门射戟';
    const underSupportedFeatureId = 'HS|吕布|无足够证据';
    const supportFloor = recommendationData.model.min_support_pair;
    const nodes = [
      node('hero', '吕布'),
      node('skill', '辕门射戟'),
      node('skill', '无足够证据'),
    ];
    const edges = buildRosterRelationshipEdges(
      nodes,
      modelWith(
        {
          [featureId]: 0.00004,
          [underSupportedFeatureId]: 0.5,
        },
        {
          [featureId]: supportFloor,
          [underSupportedFeatureId]: supportFloor - 1,
        }
      )
    );

    expect(edges).toMatchObject([
      {
        featureId,
        family: 'HS',
        weight: 0.00004,
        support: supportFloor,
      },
    ]);
    expect(
      rosterRelationshipsForNode(
        edges,
        rosterRelationshipNodeKey('hero', '吕布'),
        'skill',
        'all'
      ).map((edge) => edge.featureId)
    ).toEqual([featureId]);
    expect(formatRosterRelationshipWeight(edges[0].weight)).toBe('+0.0');
  });

  test('sorts and limits supported relationships while omitting negative weights', () => {
    const focus = rosterRelationshipNodeKey('hero', 'A');
    const nodes = [
      node('hero', 'A'),
      node('hero', 'B'),
      node('hero', 'C'),
      node('hero', 'D'),
      node('skill', '甲'),
      node('skill', '乙'),
    ];
    const edges = buildRosterRelationshipEdges(
      nodes,
      modelWith({
        'HP|A|B': 0.1,
        'HP|A|C': 0.4,
        'HP|A|D': -0.3,
        'HS|A|甲': -0.05,
        'HS|A|乙': 0.25,
      })
    );

    expect(
      rosterRelationshipsForNode(edges, focus, 'hero', 3).map(
        ({ featureId }) => featureId
      )
    ).toEqual(['HP|A|C', 'HP|A|B']);
    expect(
      rosterRelationshipsForNode(edges, focus, 'skill', 'all').map(
        ({ featureId }) => featureId
      )
    ).toEqual(['HS|A|乙']);
    expect(edges.map(({ featureId }) => featureId)).not.toContain('HP|A|D');
    expect(edges.map(({ featureId }) => featureId)).not.toContain('HS|A|甲');
    expect(rosterRelationshipOtherNodeKey(edges[0], focus)).toBe('hero:C');
  });
});
