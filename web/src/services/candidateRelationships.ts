import type { PairedModel } from '../types/recommendation';
import {
  buildStaticRelationshipPreviewIndex,
  type PairRelationshipFamily,
  type RelationshipPreviewItem,
} from './relationshipPreview';

export type CandidateRelationshipNodeKind = 'hero' | 'skill';
export type CandidateRelationshipNodeSource = 'candidate' | 'pool';
export type CandidateRelationshipMode = 'compact' | 'all';

export interface CandidateRelationshipNode {
  key: string;
  name: string;
  kind: CandidateRelationshipNodeKind;
  source: CandidateRelationshipNodeSource;
}

export interface CandidateRelationshipEdge {
  featureId: string;
  family: Extract<PairRelationshipFamily, 'HP' | 'HS'>;
  sourceKey: string;
  targetKey: string;
  weight: number;
  support: number;
}

export const CANDIDATE_RELATIONSHIP_LABELS = {
  HP: '武将同队',
  HS: '武将携带战法',
} as const;

export const candidateRelationshipNodeKey = (
  kind: CandidateRelationshipNodeKind,
  name: string
): string => `${kind}:${name}`;

const previewItemKey = (item: RelationshipPreviewItem): string =>
  candidateRelationshipNodeKey(item.kind, item.name);

/**
 * Build the candidate-stage relationship graph from the same evidence-filtered
 * HP/HS lookup used by relationship previews. Team-context and carrier-context
 * families are deliberately excluded because the candidate pool is not a
 * concrete three-hero team with assigned tactics.
 */
export function buildCandidateRelationshipEdges(
  nodes: readonly CandidateRelationshipNode[],
  model: PairedModel
): CandidateRelationshipEdge[] {
  const heroes = nodes
    .filter((node) => node.kind === 'hero')
    .map((node) => node.name);
  const skills = nodes
    .filter((node) => node.kind === 'skill')
    .map((node) => node.name);
  const nodeKeys = new Set(nodes.map((node) => node.key));
  const index = buildStaticRelationshipPreviewIndex(heroes, skills, model);
  const seen = new Set<string>();
  const result: CandidateRelationshipEdge[] = [];

  for (const targets of index.bySource.values()) {
    for (const relationships of targets.values()) {
      for (const relationship of relationships) {
        if (relationship.family !== 'HP' && relationship.family !== 'HS') {
          continue;
        }
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

  return result.sort((left, right) =>
    Math.abs(right.weight) !== Math.abs(left.weight)
      ? Math.abs(right.weight) - Math.abs(left.weight)
      : left.featureId.localeCompare(right.featureId, 'zh-CN')
  );
}

const touchesFocus = (
  edge: CandidateRelationshipEdge,
  focusKeys: ReadonlySet<string>
): boolean => focusKeys.has(edge.sourceKey) !== focusKeys.has(edge.targetKey);

const outsideKey = (
  edge: CandidateRelationshipEdge,
  focusKeys: ReadonlySet<string>
): string => (focusKeys.has(edge.sourceKey) ? edge.targetKey : edge.sourceKey);

/**
 * Compact mode keeps every relationship inside the focus set, the two
 * strongest external relationships for each focus, and every edge to a shared
 * external node. This preserves multi-focus comparison without producing an
 * unrestricted hairball.
 */
export function selectCandidateRelationshipEdges(
  edges: readonly CandidateRelationshipEdge[],
  focus: readonly string[],
  mode: CandidateRelationshipMode
): CandidateRelationshipEdge[] {
  const focusKeys = new Set(focus);
  if (!focusKeys.size) return [];

  const internal = edges.filter(
    (edge) => focusKeys.has(edge.sourceKey) && focusKeys.has(edge.targetKey)
  );
  const external = edges.filter((edge) => touchesFocus(edge, focusKeys));
  if (mode === 'all') return [...internal, ...external];

  const selected = new Map(
    internal.map((edge) => [edge.featureId, edge] as const)
  );
  const externalConnectionCounts = new Map<string, number>();
  for (const edge of external) {
    const key = outsideKey(edge, focusKeys);
    externalConnectionCounts.set(
      key,
      (externalConnectionCounts.get(key) ?? 0) + 1
    );
  }

  for (const focusKey of focusKeys) {
    external
      .filter(
        (edge) =>
          edge.sourceKey === focusKey || edge.targetKey === focusKey
      )
      .sort((left, right) =>
        Math.abs(right.weight) !== Math.abs(left.weight)
          ? Math.abs(right.weight) - Math.abs(left.weight)
          : left.featureId.localeCompare(right.featureId, 'zh-CN')
      )
      .slice(0, 2)
      .forEach((edge) => selected.set(edge.featureId, edge));
  }

  for (const edge of external) {
    if ((externalConnectionCounts.get(outsideKey(edge, focusKeys)) ?? 0) >= 2) {
      selected.set(edge.featureId, edge);
    }
  }

  return [...selected.values()].sort((left, right) =>
    Math.abs(right.weight) !== Math.abs(left.weight)
      ? Math.abs(right.weight) - Math.abs(left.weight)
      : left.featureId.localeCompare(right.featureId, 'zh-CN')
  );
}

export const formatCandidateRelationshipWeight = (weight: number): string => {
  const scoreImpact = weight * 10;
  return `${scoreImpact >= 0 ? '+' : '−'}${Math.abs(scoreImpact).toFixed(1)}`;
};
