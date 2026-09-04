import { describe, expect, test } from 'vitest';
import { recommendationData } from '../../data';
import type { PairedModel } from '../../types/recommendation';
import {
  buildCandidateRelationshipEdges,
  candidateRelationshipNodeKey,
  CANDIDATE_RELATIONSHIP_LABELS,
  formatCandidateRelationshipWeight,
  selectCandidateRelationshipEdges,
  type CandidateRelationshipEdge,
  type CandidateRelationshipNode,
} from '../candidateRelationships';

const modelWith = (
  weights: Record<string, number>,
  support: Record<string, number> = Object.fromEntries(
    Object.keys(weights).map((featureId) => [featureId, 100])
  )
): PairedModel => ({
  ...recommendationData.model,
  enabled_families: ['HP', 'HS', 'THS', 'SP', 'HT'],
  weights,
  support,
  n_features: Object.keys(weights).length,
});

const node = (
  kind: CandidateRelationshipNode['kind'],
  name: string,
  source: CandidateRelationshipNode['source'] = 'candidate'
): CandidateRelationshipNode => ({
  key: candidateRelationshipNodeKey(kind, name),
  kind,
  name,
  source,
});

const edge = (
  featureId: string,
  sourceKey: string,
  targetKey: string,
  weight: number
): CandidateRelationshipEdge => ({
  featureId,
  family: featureId.startsWith('HP|') ? 'HP' : 'HS',
  sourceKey,
  targetKey,
  weight,
  support: 20,
});

describe('candidate relationship graph data', () => {
  test('builds only supported direct same-team and carrying relationships', () => {
    const nodes = [
      node('hero', '祝融'),
      node('hero', '孟获', 'pool'),
      node('skill', '威名显赫', 'pool'),
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

    expect(
      buildCandidateRelationshipEdges(nodes, model).map(
        ({ featureId, family, weight, support }) => ({
          featureId,
          family,
          weight,
          support,
        })
      )
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
    expect(CANDIDATE_RELATIONSHIP_LABELS).toEqual({
      HP: '武将同队',
      HS: '武将携带战法',
    });
    expect(formatCandidateRelationshipWeight(0.25)).toBe('+2.5');
    expect(formatCandidateRelationshipWeight(-0.13)).toBe('−1.3');
  });

  test('compact mode keeps internal, strongest, and shared relationships', () => {
    const a = 'hero:A';
    const b = 'hero:B';
    const shared = 'hero:共同';
    const second = 'hero:次强';
    const weak = 'hero:较弱';
    const edges = [
      edge('HP|A|B', a, b, 0.1),
      edge('HP|A|共同', a, shared, 0.7),
      edge('HP|B|共同', b, shared, 0.05),
      edge('HP|A|次强', a, second, 0.6),
      edge('HP|A|较弱', a, weak, 0.2),
    ];

    expect(
      selectCandidateRelationshipEdges(edges, [a, b], 'compact').map(
        ({ featureId }) => featureId
      )
    ).toEqual([
      'HP|A|共同',
      'HP|A|次强',
      'HP|A|B',
      'HP|B|共同',
    ]);
  });

  test('all mode still excludes relationships that touch no focus node', () => {
    const a = 'hero:A';
    const b = 'hero:B';
    const c = 'hero:C';
    const d = 'hero:D';
    const edges = [
      edge('HP|A|B', a, b, 0.4),
      edge('HP|C|D', c, d, 0.8),
    ];

    expect(selectCandidateRelationshipEdges(edges, [a], 'all')).toEqual([
      edges[0],
    ]);
    expect(selectCandidateRelationshipEdges(edges, [], 'all')).toEqual([]);
  });
});
