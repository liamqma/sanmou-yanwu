import type { PairedModel } from '../types/recommendation';
import { heroPairId, heroSkillId } from './recommendationModel';

export type RosterRelationshipNodeKind = 'hero' | 'skill';
export type RosterRelationshipLimit = 3 | 5 | 'all';

export interface RosterRelationshipNode {
  key: string;
  name: string;
  kind: RosterRelationshipNodeKind;
}

export interface RosterRelationshipEdge {
  featureId: string;
  family: 'HP' | 'HS';
  sourceKey: string;
  targetKey: string;
  weight: number;
  support: number;
}

export const ROSTER_RELATIONSHIP_LABELS = {
  HP: '武将同队',
  HS: '武将携带战法',
} as const;

export const rosterRelationshipNodeKey = (
  kind: RosterRelationshipNodeKind,
  name: string
): string => `${kind}:${name}`;

/**
 * Build positive, direct, evidence-filtered HP and HS edges between items the
 * player has already selected. Contextual and non-positive families stay
 * excluded because this page is a concise reference for recognised pairings,
 * not an assigned three-team formation or a warning system.
 */
export function buildRosterRelationshipEdges(
  nodes: readonly RosterRelationshipNode[],
  model: PairedModel
): RosterRelationshipEdge[] {
  const heroes = [
    ...new Set(
      nodes.filter((node) => node.kind === 'hero').map((node) => node.name)
    ),
  ];
  const skills = [
    ...new Set(
      nodes.filter((node) => node.kind === 'skill').map((node) => node.name)
    ),
  ];
  const result: RosterRelationshipEdge[] = [];

  const addEdge = (
    family: RosterRelationshipEdge['family'],
    featureId: string,
    sourceKey: string,
    targetKey: string
  ) => {
    if (!model.enabled_families.includes(family)) return;
    const weight = model.weights[featureId];
    const support = model.support[featureId] ?? 0;
    if (
      !Number.isFinite(weight) ||
      weight <= 0 ||
      !Number.isFinite(support) ||
      support < model.min_support_pair
    ) {
      return;
    }
    result.push({
      featureId,
      family,
      sourceKey,
      targetKey,
      weight,
      support,
    });
  };

  for (let first = 0; first < heroes.length; first += 1) {
    for (let second = first + 1; second < heroes.length; second += 1) {
      addEdge(
        'HP',
        heroPairId(heroes[first], heroes[second]),
        rosterRelationshipNodeKey('hero', heroes[first]),
        rosterRelationshipNodeKey('hero', heroes[second])
      );
    }
  }

  for (const hero of heroes) {
    for (const skill of skills) {
      addEdge(
        'HS',
        heroSkillId(hero, skill),
        rosterRelationshipNodeKey('hero', hero),
        rosterRelationshipNodeKey('skill', skill)
      );
    }
  }

  return result.sort(compareRelationships);
}

const compareRelationships = (
  left: RosterRelationshipEdge,
  right: RosterRelationshipEdge
): number =>
  right.weight !== left.weight
    ? right.weight - left.weight
    : left.featureId.localeCompare(right.featureId, 'zh-CN');

export const rosterRelationshipOtherNodeKey = (
  edge: RosterRelationshipEdge,
  nodeKey: string
): string => (edge.sourceKey === nodeKey ? edge.targetKey : edge.sourceKey);

export function rosterRelationshipsForNode(
  edges: readonly RosterRelationshipEdge[],
  nodeKey: string,
  otherKind: RosterRelationshipNodeKind,
  limit: RosterRelationshipLimit
): RosterRelationshipEdge[] {
  const matches = edges
    .filter((edge) => {
      if (edge.sourceKey !== nodeKey && edge.targetKey !== nodeKey) {
        return false;
      }
      return rosterRelationshipOtherNodeKey(edge, nodeKey).startsWith(
        `${otherKind}:`
      );
    })
    .sort(compareRelationships);
  return limit === 'all' ? matches : matches.slice(0, limit);
}

export const maxRosterRelationshipMagnitude = (
  edges: readonly RosterRelationshipEdge[]
): number =>
  edges.reduce(
    (maximum, edge) => Math.max(maximum, edge.weight),
    0
  );

export const formatRosterRelationshipWeight = (weight: number): string => {
  const scoreImpact = weight * 10;
  return `${scoreImpact >= 0 ? '+' : '−'}${Math.abs(scoreImpact).toFixed(1)}`;
};
