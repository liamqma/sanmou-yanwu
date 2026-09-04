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
        'THS|孟获|威名显赫': 0.9,
      },
      {
        'HP|孟获|祝融': 18,
        'HS|祝融|威名显赫': 24,
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

  test('sorts and limits positive and negative relationships independently', () => {
    const focus = rosterRelationshipNodeKey('hero', 'A');
    const nodes = [
      node('hero', 'A'),
      node('hero', 'B'),
      node('hero', 'C'),
      node('hero', 'D'),
      node('skill', '甲'),
    ];
    const edges = buildRosterRelationshipEdges(
      nodes,
      modelWith({
        'HP|A|B': 0.1,
        'HP|A|C': 0.4,
        'HP|A|D': -0.3,
        'HS|A|甲': -0.05,
      })
    );

    expect(
      rosterRelationshipsForNode(edges, focus, 'positive', 3).map(
        ({ featureId }) => featureId
      )
    ).toEqual(['HP|A|C', 'HP|A|B']);
    expect(
      rosterRelationshipsForNode(edges, focus, 'negative', 3).map(
        ({ featureId }) => featureId
      )
    ).toEqual(['HP|A|D', 'HS|A|甲']);
    expect(
      rosterRelationshipsForNode(edges, focus, 'negative', 'all').map(
        ({ featureId }) => featureId
      )
    ).toEqual(['HP|A|D', 'HS|A|甲']);
    expect(rosterRelationshipOtherNodeKey(edges[0], focus)).toBe('hero:C');
  });
});
