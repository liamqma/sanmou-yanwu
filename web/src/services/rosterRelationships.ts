import type { PairedModel } from '../types/recommendation';
import {
  buildStaticRelationshipPreviewIndex,
  type PairRelationshipFamily,
  type RelationshipPreviewItem,
} from './relationshipPreview';

export type RosterRelationshipNodeKind = 'hero' | 'skill';
export type RosterRelationshipLimit = 3 | 5 | 'all';

export interface RosterRelationshipNode {
  key: string;
  name: string;
  kind: RosterRelationshipNodeKind;
}

export interface RosterRelationshipEdge {
  featureId: string;
  family: Extract<PairRelationshipFamily, 'HP' | 'HS'>;
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

const previewItemKey = (item: RelationshipPreviewItem): string =>
  rosterRelationshipNodeKey(item.kind, item.name);

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
  const heroes = nodes
    .filter((node) => node.kind === 'hero')
    .map((node) => node.name);
  const skills = nodes
    .filter((node) => node.kind === 'skill')
    .map((node) => node.name);
  const nodeKeys = new Set(nodes.map((node) => node.key));
  const index = buildStaticRelationshipPreviewIndex(heroes, skills, model);
  const seen = new Set<string>();
  const result: RosterRelationshipEdge[] = [];

  for (const targets of index.bySource.values()) {
    for (const relationships of targets.values()) {
      for (const relationship of relationships) {
        if (relationship.family !== 'HP' && relationship.family !== 'HS') {
          continue;
        }
        if (relationship.weight <= 0) continue;
        if (seen.has(relationship.featureId)) continue;
        const sourceKey = previewItemKey(relationship.source);
        const targetKey = previewItemKey(relationship.target);
        if (!nodeKeys.has(sourceKey) || !nodeKeys.has(targetKey)) continue;
        seen.add(relationship.featureId);
        result.push({
          featureId: relationship.featureId,
          family: relationship.family,
          sourceKey,
          targetKey,
          weight: relationship.weight,
          support: relationship.support,
        });
      }
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
