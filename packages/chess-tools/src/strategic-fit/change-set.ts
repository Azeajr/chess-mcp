import type { PgnNodeData } from "chessops/pgn";

import type { GameTree } from "../pgn.js";
import { buildRepertoireGraph, type RepertoireGraph } from "./graph.js";
import type { ReplacementCompleteCandidateExpansion } from "./replacement-expand.js";
import {
  simulateReplacementSafety,
  type ReplacementCandidateSafetySimulation,
  type ReplacementSafetySimulationResult,
} from "./replacement-safety.js";
import {
  scoreReplacementCandidates,
  type ReplacementScoredCandidate,
} from "./replacement-score.js";
import {
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  type ReplacementAddSubtreeOperation,
  type ReplacementArchivePayload,
  type ReplacementArchiveSubtreeOperation,
  type ReplacementChangeOperation,
  type ReplacementChangeOperationKind,
  type ReplacementChangeSet,
  type ReplacementChangeSetFailure,
  type ReplacementChangeSetPreview,
  type ReplacementChangeSetPreviewSuccess,
  type ReplacementChangeTarget,
  type ReplacementLinkTranspositionOperation,
  type ReplacementObjectiveQuality,
  type ReplacementOperationDiff,
  type ReplacementOperationResult,
  type ReplacementPreserveAnnotationOperation,
  type ReplacementPruneSubtreeOperation,
  type ReplacementReorderVariationsOperation,
  type ReplacementStrategicScore,
  type ReplacementTreeStatistics,
  type StrategicFitReplacementVersioned,
} from "./replacement-types.js";
import type { SemanticReferences, StrategicFitSourceProvenance } from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION, STRATEGIC_FIT_SCHEMA_VERSION } from "./version.js";
import { assertDefined } from "../assert.js";

export const REPLACEMENT_CHANGE_SET_ERROR_CODES = [
  "stale-revision",
  "safety-not-current",
  "safety-candidate-not-safe",
  "change-set-identity-mismatch",
  "change-set-version-mismatch",
  "change-set-not-validated",
  "unsupported-operation",
  "duplicate-operation",
  "invalid-operation-order",
  "invalid-retention",
  "stale-semantic-path",
  "semantic-identity-mismatch",
  "candidate-subtree-mismatch",
  "illegal-operation",
  "transposition-link-mismatch",
  "annotation-not-equivalent",
  "archive-payload-mismatch",
  "archive-required",
  "prune-not-confirmed",
  "reorder-boundary-mismatch",
  "result-graph-mismatch",
  "transaction-failed",
] as const;
export type ReplacementChangeSetErrorCode = (typeof REPLACEMENT_CHANGE_SET_ERROR_CODES)[number];

export const TASK_8_8_CHANGE_OPERATION_KINDS = [
  "add-subtree",
  "link-transposition",
  "preserve-annotation",
  "archive-subtree",
  "prune-subtree",
  "reorder-variations",
] as const satisfies readonly ReplacementChangeOperationKind[];
export type Task88ChangeOperationKind = (typeof TASK_8_8_CHANGE_OPERATION_KINDS)[number];

export interface ConstructReplacementChangeSetInput {
  readonly source_tree: GameTree;
  readonly current_repertoire_revision: string;
  readonly safety: ReplacementSafetySimulationResult;
  readonly candidate_id: string;
  readonly promote_candidate_to_mainline?: boolean;
}

export type ConstructReplacementChangeSetResult =
  | {
      readonly status: "constructed";
      readonly change_set: ReplacementChangeSet;
      readonly error_code: null;
      readonly explanation: string;
    }
  | {
      readonly status: "rejected" | "stale";
      readonly change_set: null;
      readonly error_code: ReplacementChangeSetErrorCode;
      readonly explanation: string;
    };

export interface ApplyReplacementChangeSetInput {
  readonly source_tree: GameTree;
  readonly current_repertoire_revision: string;
  readonly safety: ReplacementSafetySimulationResult;
  readonly change_set: ReplacementChangeSet;
}

interface ReplacementAtomicChangeSetResultBase {
  readonly source_tree_unchanged: true;
  readonly safety_unchanged: true;
  readonly change_set_unchanged: true;
  readonly evidence_unchanged: true;
  readonly inputs_unchanged: true;
}

export interface ReplacementAtomicChangeSetSuccess extends ReplacementAtomicChangeSetResultBase {
  readonly status: "success";
  readonly tree: GameTree;
  readonly output: ReplacementChangeSetPreviewSuccess;
}

export interface ReplacementAtomicChangeSetFailure extends ReplacementAtomicChangeSetResultBase {
  readonly status: "failure";
  readonly tree: null;
  readonly output: ReplacementChangeSetFailure;
}

export type ReplacementAtomicChangeSetResult =
  | ReplacementAtomicChangeSetSuccess
  | ReplacementAtomicChangeSetFailure;

const SEPARATOR = "\u001f";

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:replacement-change-set",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  snapshot: null,
  reason: null,
});

interface CurrentSafety {
  readonly graph: RepertoireGraph;
  readonly candidate: ReplacementCandidateSafetySimulation;
  readonly scored: ReplacementScoredCandidate;
}

interface MutableDiff {
  readonly operation_id: string;
  readonly sequence: number;
  readonly kind: ReplacementChangeOperationKind;
  readonly added_paths: string[][];
  readonly removed_paths: string[][];
  readonly annotated_paths: string[][];
  readonly linked_paths: string[][];
  readonly archived_paths: string[][];
  readonly reordered_parent_paths: string[][];
  readonly linked_position_ids: string[];
  readonly archive_ids: string[];
}

interface OperationFailure {
  readonly code: ReplacementChangeSetErrorCode;
  readonly explanation: string;
}

function versioned(): StrategicFitReplacementVersioned {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePaths(left: readonly string[], right: readonly string[]): number {
  return compareStrings(left.join(SEPARATOR), right.join(SEPARATOR)) || left.length - right.length;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function sortedPaths(values: readonly (readonly string[])[]): string[][] {
  const paths = new Map<string, string[]>();
  for (const value of values) paths.set(value.join(SEPARATOR), [...value]);
  return [...paths.values()].sort(comparePaths);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function canonicalBoundary<T>(value: T, field: string | null = null): T {
  if (Array.isArray(value)) {
    const arr = value as unknown as unknown[];
    const items = arr.map((item) => canonicalBoundary(item));
    const setLike =
      field === "provenance" ||
      field === "source_san_paths" ||
      field === "annotation_text" ||
      field === "source_kinds" ||
      (field?.endsWith("_ids") === true && field !== "node_ids" && field !== "edge_ids");
    return (
      setLike
        ? [...items].sort((left, right) => compareStrings(stableJson(left), stableJson(right)))
        : items
    ) as T;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).map(([key, item]) => [
      key,
      canonicalBoundary(item, key),
    ]),
  ) as T;
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function mergeProvenance(
  ...groups: readonly (readonly StrategicFitSourceProvenance[])[]
): StrategicFitSourceProvenance[] {
  const values = new Map<string, StrategicFitSourceProvenance>();
  for (const group of groups) {
    for (const source of group) {
      const copy = cloneJson(source);
      values.set(stableJson(copy), copy);
    }
  }
  return [...values.values()].sort(
    (left, right) =>
      compareStrings(left.source_id, right.source_id) ||
      compareStrings(stableJson(left), stableJson(right)),
  );
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((san, index) => san === right[index]);
}

function sameVersions(value: StrategicFitReplacementVersioned): boolean {
  return (
    value.schema_version === STRATEGIC_FIT_SCHEMA_VERSION &&
    value.analysis_version === STRATEGIC_FIT_ANALYSIS_VERSION &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    value.replacement_schema_version === STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION
  );
}

function actionInput(candidate: ReplacementCandidateSafetySimulation) {
  return candidate.action === "replace"
    ? [
        {
          candidate_id: candidate.candidate_id,
          action: "replace" as const,
          prune_explicitly_confirmed: true as const,
        },
      ]
    : [{ candidate_id: candidate.candidate_id, action: "add-alternative" as const }];
}

function currentSafety(
  sourceTree: GameTree,
  currentRevision: string,
  safety: ReplacementSafetySimulationResult,
  candidateId: string,
): CurrentSafety | OperationFailure {
  if (
    currentRevision !== safety.repertoire_revision ||
    currentRevision !== safety.request.repertoire_revision
  ) {
    return {
      code: "stale-revision",
      explanation: "Current repertoire revision does not match Task 8.7 safety evidence.",
    };
  }
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  if (
    !sameVersions(safety) ||
    !sameVersions(safety.request) ||
    !safety.source_tree_unchanged ||
    !safety.request_unchanged ||
    !safety.scoring_unchanged ||
    !safety.source_context_unchanged ||
    !safety.expansion_unchanged ||
    !safety.evidence_unchanged ||
    !safety.inputs_unchanged
  ) {
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
    return {
      code: "safety-not-current",
      explanation: "Task 8.7 versions or immutable evidence flags are not current.",
    };
  }
  const supplied = safety.candidates.find((candidate) => candidate.candidate_id === candidateId);
  if (!supplied) {
    return {
      code: "safety-candidate-not-safe",
      explanation: `Task 8.7 contains no candidate ${candidateId}.`,
    };
  }
  let graph: RepertoireGraph;
  let recomputed: ReplacementSafetySimulationResult;
  try {
    graph = buildRepertoireGraph(sourceTree, safety.repertoire_color);
    const rescored = scoreReplacementCandidates({
      request: safety.request,
      graph: safety.scoring.context.graph,
      cohort: safety.scoring.context.cohort,
      trajectories: safety.scoring.context.trajectories,
      concepts: safety.scoring.context.concepts,
      metrics: safety.scoring.context.metrics,
      training: safety.scoring.context.training,
      popularity: safety.scoring.context.popularity,
      expansion: safety.scoring.expansion,
    });
    if (
      (rescored.status !== "complete" && rescored.status !== "partial") ||
      rescored.error_code !== null ||
      stableJson(canonicalBoundary(cloneJson(rescored))) !==
        stableJson(canonicalBoundary(cloneJson(safety.scoring)))
    ) {
      return {
        code: "safety-not-current",
        explanation:
          "Retained Task 8.6 evidence does not reproduce the supplied Task 8.7 scoring boundary.",
      };
    }
    recomputed = simulateReplacementSafety({
      source_tree: sourceTree,
      request: safety.request,
      scoring: rescored,
      candidate_actions: actionInput(supplied),
    });
  } catch {
    return {
      code: "safety-not-current",
      explanation: "Task 8.7 safety evidence could not be recomputed from the source tree.",
    };
  }
  const current = recomputed.candidates.find((candidate) => candidate.candidate_id === candidateId);
  const currentApplicable = current?.status === "safe" || current?.status === "partial";
  const suppliedApplicable = supplied.status === "safe" || supplied.status === "partial";
  if (
    !current ||
    !currentApplicable ||
    current.error_code !== null ||
    !suppliedApplicable ||
    supplied.error_code !== null ||
    supplied.safety_checks.some((check) => check.status === "blocked") ||
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    !supplied.source_tree_unchanged ||
    !supplied.scored_candidate_unchanged ||
    !supplied.evidence_unchanged ||
    !supplied.inputs_unchanged
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
  ) {
    return {
      code: "safety-candidate-not-safe",
      explanation:
        "Only current Task 8.7 evidence with no blocked safety check can enter an atomic change set.",
    };
  }
  if (
    stableJson(canonicalBoundary(current)) !== stableJson(canonicalBoundary(supplied)) ||
    graph.graph_id !== supplied.before_graph_id
  ) {
    return {
      code: "safety-not-current",
      explanation:
        "Supplied Task 8.7 candidate differs from deterministic current safety evidence.",
    };
  }
  return { graph, candidate: current, scored: current.scored_candidate };
}

function routeSans(expansion: ReplacementCompleteCandidateExpansion): string[][] {
  const edges = new Map(expansion.subtree.edges.map((edge) => [edge.edge_id, edge]));
  const routes = new Map<string, string[]>();
  for (const route of expansion.subtree.routes) {
    const sans = route.edge_ids.map((edgeId) => edges.get(edgeId)?.san ?? "");
    if (sans.some((san) => san.length === 0)) continue;
    routes.set(sans.join(SEPARATOR), sans);
  }
  return [...routes.values()].sort(comparePaths);
}

function pivotDecisionPaths(current: CurrentSafety): string[][] {
  const pivot = current.scored.expansion.seed.pivot;
  const decision = current.graph.decisions.find((item) => item.decision_id === pivot.decision_id);
  if (!decision) return [];
  const disclosed = new Set(pivot.source_san_paths.map((path) => path.join(SEPARATOR)));
  const matched = decision.source_san_paths.filter((path) => disclosed.has(path.join(SEPARATOR)));
  return sortedPaths(matched.length > 0 ? matched : decision.source_san_paths);
}

function targetAt(graph: RepertoireGraph, path: readonly string[]): ReplacementChangeTarget | null {
  const position = graph.positions.find((item) =>
    item.source_san_paths.some((source) => samePath(source, path)),
  );
  if (!position) return null;
  const decision = graph.decisions.find((item) =>
    item.source_san_paths.some((source) => samePath(source, path)),
  );
  return {
    position_id: position.position_id,
    decision_id: decision?.decision_id ?? null,
    source_san_path: [...path],
  };
}

function targetMatches(graph: RepertoireGraph, target: ReplacementChangeTarget): boolean {
  const current = targetAt(graph, target.source_san_path);
  if (current?.position_id !== target.position_id) return false;
  return target.decision_id === null || current.decision_id === target.decision_id;
}

function sameTarget(left: ReplacementChangeTarget, right: ReplacementChangeTarget): boolean {
  return (
    left.position_id === right.position_id &&
    left.decision_id === right.decision_id &&
    samePath(left.source_san_path, right.source_san_path)
  );
}

function referencesFor(
  graph: RepertoireGraph,
  target: ReplacementChangeTarget,
): SemanticReferences {
  const position = graph.positions.find((item) => item.position_id === target.position_id);
  const decision =
    target.decision_id === null
      ? null
      : graph.decisions.find((item) => item.decision_id === target.decision_id);
  return {
    position_ids: [target.position_id],
    decision_ids: target.decision_id === null ? [] : [target.decision_id],
    route_ids: sortedUnique([...(position?.route_ids ?? []), ...(decision?.route_ids ?? [])]),
    source_san_paths: [[...target.source_san_path]],
  };
}

function archivePgn(tree: GameTree, targetPath: readonly string[]): string | null {
  if (targetPath.length === 0) return null;
  const clone = tree.clone();
  let node = clone.game.moves;
  for (const san of targetPath) {
    const child = node.children.find((item) => item.data.san === san);
    if (!child) return null;
    node.children.splice(0, node.children.length, child);
    node = child;
  }
  return clone.toPgn();
}

function subtreeOccurrences(
  parents: readonly (readonly string[])[],
  expansion: ReplacementCompleteCandidateExpansion,
): Map<string, string[][]> {
  const occurrences = new Map<string, string[][]>();
  const edges = new Map(expansion.subtree.edges.map((edge) => [edge.edge_id, edge]));
  for (const parent of parents) {
    for (const route of expansion.subtree.routes) {
      const path = [...parent];
      const rootId = route.node_ids[0];
      if (rootId) occurrences.set(rootId, sortedPaths([...(occurrences.get(rootId) ?? []), path]));
      for (const edgeId of route.edge_ids) {
        const edge = edges.get(edgeId);
        if (!edge) continue;
        path.push(edge.san);
        occurrences.set(
          edge.to_node_id,
          sortedPaths([...(occurrences.get(edge.to_node_id) ?? []), path]),
        );
        occurrences.set(
          edge.edge_id,
          sortedPaths([...(occurrences.get(edge.edge_id) ?? []), path]),
        );
      }
    }
  }
  return occurrences;
}

function operationId(changeId: string, kind: ReplacementChangeOperationKind, key: string): string {
  return `operation:${changeId}:${kind}:${stableHash(key)}`;
}

function withSequences(
  operations: readonly Omit<ReplacementChangeOperation, "sequence">[],
): ReplacementChangeOperation[] {
  return operations.map(
    (operation, sequence) => ({ ...operation, sequence }) as ReplacementChangeOperation,
  );
}

function changeSetId(
  safety: ReplacementSafetySimulationResult,
  candidateId: string,
  promoteCandidateToMainline: boolean,
): string {
  return `change-set:${stableHash(
    [
      safety.request_id,
      safety.report_id,
      safety.finding_id,
      safety.semantic_finding_id,
      safety.cohort_id,
      safety.pivot_id ?? "",
      safety.repertoire_revision,
      safety.repertoire_color,
      candidateId,
      promoteCandidateToMainline ? "promote-mainline" : "retain-editorial-order",
    ].join(SEPARATOR),
  )}`;
}

function annotationOperations(
  changeId: string,
  sourceTree: GameTree,
  sourceGraph: RepertoireGraph,
  expansion: ReplacementCompleteCandidateExpansion,
  occurrences: ReadonlyMap<string, string[][]>,
  provenance: readonly StrategicFitSourceProvenance[],
): Omit<ReplacementPreserveAnnotationOperation, "sequence">[] {
  const nodes = new Map(expansion.subtree.nodes.map((node) => [node.node_id, node]));
  const values = new Map<string, Omit<ReplacementPreserveAnnotationOperation, "sequence">>();
  for (const edge of expansion.subtree.edges) {
    const targetNode = nodes.get(edge.to_node_id);
    if (!targetNode) continue;
    const sourcePosition = sourceGraph.positions.find(
      (position) => position.position_id === targetNode.position_id,
    );
    const compatibleSources = sourcePosition?.source_san_paths ?? [];
    const comments: string[] = [...edge.annotation_text];
    const nags: number[] = [];
    let sourcePath: readonly string[] | null = null;
    for (const path of compatibleSources) {
      const index = sourceTree.indexPathOfSan(path);
      if (index === null) continue;
      const data = (sourceTree.nodeAt(index) as unknown as { data: PgnNodeData }).data;
      if ((data.comments?.length ?? 0) > 0 || (data.nags?.length ?? 0) > 0) sourcePath ??= path;
      comments.push(...(data.comments ?? []));
      nags.push(...(data.nags ?? []));
    }
    const orderedComments = sortedUnique(comments);
    const orderedNags = [...new Set(nags)].sort((left, right) => left - right);
    if (orderedComments.length === 0 && orderedNags.length === 0) continue;
    for (const targetPath of occurrences.get(edge.edge_id) ?? []) {
      const source = sourcePath ?? targetPath;
      const key = targetPath.join(SEPARATOR);
      values.set(key, {
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        operation_id: operationId(changeId, "preserve-annotation", key),
        kind: "preserve-annotation",
        source: {
          position_id: targetNode.position_id,
          decision_id: null,
          source_san_path: [...source],
        },
        target: {
          position_id: targetNode.position_id,
          decision_id: null,
          source_san_path: [...targetPath],
        },
        comments: orderedComments,
        nags: orderedNags,
        semantic_equivalence_verified: true,
        provenance: mergeProvenance(provenance),
      });
    }
  }
  return [...values.values()].sort((left, right) =>
    comparePaths(left.target.source_san_path, right.target.source_san_path),
  );
}

function structuralClone(current: CurrentSafety, source: GameTree): GameTree | null {
  const expansion = current.scored.expansion as ReplacementCompleteCandidateExpansion;
  const clone = source.clone();
  for (const decisionPath of pivotDecisionPaths(current)) {
    const parent = decisionPath.slice(0, -1);
    const parentIndex = clone.indexPathOfSan(parent);
    if (parentIndex === null) return null;
    for (const route of routeSans(expansion)) {
      let cursor = [...parentIndex];
      for (const san of route) cursor = clone.appendSan(cursor, san).path;
    }
  }
  if (current.candidate.action === "replace") {
    for (const path of pivotDecisionPaths(current).sort(
      (left, right) => right.length - left.length || comparePaths(right, left),
    )) {
      const index = clone.indexPathOfSan(path);
      if (index === null || index.length === 0) return null;
      const parent = clone.nodeAt(index.slice(0, -1));
      parent.children.splice(assertDefined(index.at(-1)), 1);
    }
  }
  return clone;
}

function constructOperations(
  input: ConstructReplacementChangeSetInput,
  current: CurrentSafety,
): ReplacementChangeOperation[] | OperationFailure {
  const changeId = changeSetId(
    input.safety,
    input.candidate_id,
    input.promote_candidate_to_mainline === true,
  );
  const expansion = current.scored.expansion as ReplacementCompleteCandidateExpansion;
  const decisionPaths = pivotDecisionPaths(current);
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  if (
    decisionPaths.length === 0 ||
    expansion.status !== "complete" ||
    expansion.subtree.status !== "complete"
  ) {
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
    return {
      code: "candidate-subtree-mismatch",
      explanation: "Safe candidate lacks a complete subtree or current pivot path.",
    };
  }
  const parentPaths = sortedPaths(decisionPaths.map((path) => path.slice(0, -1)));
  const provenance = mergeProvenance(
    [CORE_PROVENANCE],
    current.candidate.provenance,
    input.safety.provenance,
  );
  const occurrences = subtreeOccurrences(parentPaths, expansion);
  const add: Omit<ReplacementAddSubtreeOperation, "sequence">[] = parentPaths.map((path) => {
    const parent = targetAt(current.graph, path);
    if (!parent) throw new Error("stale parent");
    return {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      operation_id: operationId(changeId, "add-subtree", path.join(SEPARATOR)),
      kind: "add-subtree",
      parent: { ...parent, decision_id: null },
      subtree: cloneJson(expansion.subtree),
      provenance,
    };
  });
  const links: Omit<ReplacementLinkTranspositionOperation, "sequence">[] = [];
  for (const node of expansion.subtree.nodes) {
    if (node.transposition_target_position_id === null) continue;
    for (const path of occurrences.get(node.node_id) ?? []) {
      links.push({
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        operation_id: operationId(
          changeId,
          "link-transposition",
          `${path.join(SEPARATOR)}${SEPARATOR}${node.transposition_target_position_id}`,
        ),
        kind: "link-transposition",
        source: { position_id: node.position_id, decision_id: null, source_san_path: path },
        target_position_id: node.transposition_target_position_id,
        provenance,
      });
    }
  }
  links.sort(
    (left, right) =>
      comparePaths(left.source.source_san_path, right.source.source_san_path) ||
      compareStrings(left.target_position_id, right.target_position_id),
  );
  const annotations = annotationOperations(
    changeId,
    input.source_tree,
    current.graph,
    expansion,
    occurrences,
    provenance,
  );
  const archives: Omit<ReplacementArchiveSubtreeOperation, "sequence">[] = [];
  const prunes: (Omit<ReplacementPruneSubtreeOperation, "sequence"> & {
    archive_operation_id: string;
  })[] = [];
  if (current.candidate.action === "replace") {
    for (const path of decisionPaths) {
      const target = targetAt(current.graph, path);
      const pgn = archivePgn(input.source_tree, path);
      if (!target || !pgn)
        return { code: "stale-semantic-path", explanation: "Archive target no longer resolves." };
      const archiveId = `archive:${stableHash(`${input.current_repertoire_revision}${SEPARATOR}${target.decision_id ?? ""}${SEPARATOR}${path.join(SEPARATOR)}`)}`;
      const archiveOperationId = operationId(changeId, "archive-subtree", archiveId);
      archives.push({
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        operation_id: archiveOperationId,
        kind: "archive-subtree",
        archive_id: archiveId,
        target,
        archive_pgn: pgn,
        references: referencesFor(current.graph, target),
        provenance,
      });
      prunes.push({
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        operation_id: operationId(changeId, "prune-subtree", path.join(SEPARATOR)),
        kind: "prune-subtree",
        target,
        archive_operation_id: archiveOperationId,
        explicitly_confirmed: true,
        provenance,
      });
    }
  }
  archives.sort((left, right) =>
    comparePaths(left.target.source_san_path, right.target.source_san_path),
  );
  prunes.sort(
    (left, right) =>
      right.target.source_san_path.length - left.target.source_san_path.length ||
      comparePaths(right.target.source_san_path, left.target.source_san_path),
  );
  const reorders: Omit<ReplacementReorderVariationsOperation, "sequence">[] = [];
  if (input.promote_candidate_to_mainline) {
    const simulated = structuralClone(current, input.source_tree);
    if (!simulated)
      return {
        code: "transaction-failed",
        explanation: "Candidate structure could not be prepared for deterministic reordering.",
      };
    const graph = buildRepertoireGraph(simulated, input.safety.repertoire_color);
    const firstEdge = expansion.subtree.edges.find(
      (edge) => edge.from_node_id === expansion.subtree.nodes[0].node_id,
    );
    if (!firstEdge)
      return {
        code: "candidate-subtree-mismatch",
        explanation: "Candidate subtree has no root decision.",
      };
    const parents = new Map<string, { positionId: string; paths: string[][] }>();
    for (const path of parentPaths) {
      const parent = targetAt(graph, path);
      if (!parent)
        return { code: "stale-semantic-path", explanation: "Reorder parent no longer resolves." };
      const grouped = parents.get(parent.position_id) ?? {
        positionId: parent.position_id,
        paths: [],
      };
      grouped.paths.push([...path]);
      parents.set(parent.position_id, grouped);
    }
    for (const parent of [...parents.values()].sort((left, right) =>
      compareStrings(left.positionId, right.positionId),
    )) {
      const position = graph.positions.find((item) => item.position_id === parent.positionId);
      if (!position?.outgoing_decision_ids.includes(firstEdge.decision_id)) {
        return {
          code: "reorder-boundary-mismatch",
          explanation: "Candidate decision is absent from reorder parent.",
        };
      }
      const ordered = [
        firstEdge.decision_id,
        ...sortedUnique(
          position.outgoing_decision_ids.filter((id) => id !== firstEdge.decision_id),
        ),
      ];
      reorders.push({
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        operation_id: operationId(changeId, "reorder-variations", parent.positionId),
        kind: "reorder-variations",
        parent_position_id: parent.positionId,
        ordered_decision_ids: ordered,
        provenance,
      });
    }
  }
  return withSequences([...add, ...links, ...annotations, ...archives, ...prunes, ...reorders]);
}

export function constructReplacementChangeSet(
  input: ConstructReplacementChangeSetInput,
): ConstructReplacementChangeSetResult {
  const current = currentSafety(
    input.source_tree,
    input.current_repertoire_revision,
    input.safety,
    input.candidate_id,
  );
  if ("code" in current) {
    return {
      status:
        current.code === "stale-revision" || current.code === "safety-not-current"
          ? "stale"
          : "rejected",
      change_set: null,
      error_code: current.code,
      explanation: current.explanation,
    };
  }
  let operations: ReplacementChangeOperation[] | OperationFailure;
  try {
    operations = constructOperations(input, current);
  } catch {
    operations = {
      code: "transaction-failed",
      explanation: "Change-set operations could not be constructed from current semantic evidence.",
    };
  }
  if ("code" in operations) {
    return {
      status: "rejected",
      change_set: null,
      error_code: operations.code,
      explanation: operations.explanation,
    };
  }
  const changeId = changeSetId(
    input.safety,
    input.candidate_id,
    input.promote_candidate_to_mainline === true,
  );
  const replace = current.candidate.action === "replace";
  const changeSet: ReplacementChangeSet = {
    ...versioned(),
    change_set_id: changeId,
    request_id: input.safety.request_id,
    candidate_id: input.candidate_id,
    base_repertoire_revision: input.current_repertoire_revision,
    status: "validated",
    atomic: true,
    staged: true,
    retention: replace
      ? {
          archive: "archive",
          prune: "prune",
          prune_explicitly_confirmed: true,
          archive_before_prune: true,
        }
      : {
          archive: "keep-active",
          prune: "retain",
          prune_explicitly_confirmed: false,
          archive_before_prune: true,
        },
    operations,
    safety_checks: cloneJson(current.candidate.safety_checks),
    unresolved_risk_ids: sortedUnique(
      current.scored.expansion.unresolved_risks.map((risk) => risk.risk_id),
    ),
    provenance: mergeProvenance(
      [CORE_PROVENANCE],
      input.safety.provenance,
      current.candidate.provenance,
    ),
  };
  return {
    status: "constructed",
    change_set: changeSet,
    error_code: null,
    explanation:
      "Current Task 8.7 safety evidence produced a deterministic atomic domain change set.",
  };
}

function kindRank(kind: ReplacementChangeOperationKind): number {
  return TASK_8_8_CHANGE_OPERATION_KINDS.indexOf(kind as Task88ChangeOperationKind);
}

function annotationOperationsMatchEvidence(
  input: ApplyReplacementChangeSetInput,
  current: CurrentSafety,
  operations: readonly ReplacementChangeOperation[],
  promotesCandidate: boolean,
): boolean {
  const expected = constructOperations(
    {
      source_tree: input.source_tree,
      current_repertoire_revision: input.current_repertoire_revision,
      safety: input.safety,
      candidate_id: input.change_set.candidate_id,
      promote_candidate_to_mainline: promotesCandidate,
    },
    current,
  );
  if ("code" in expected) return false;
  return (
    stableJson(
      canonicalBoundary(expected.filter((operation) => operation.kind === "preserve-annotation")),
    ) ===
    stableJson(
      canonicalBoundary(operations.filter((operation) => operation.kind === "preserve-annotation")),
    )
  );
}

function validateChangeSet(
  input: ApplyReplacementChangeSetInput,
  current: CurrentSafety,
): { operations: ReplacementChangeOperation[] } | OperationFailure {
  const changeSet = input.change_set;
  if (
    !sameVersions(changeSet) ||
    changeSet.operations.some(
      (operation) => operation.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION,
    )
  ) {
    return {
      code: "change-set-version-mismatch",
      explanation: "Change-set or operation schema versions are not current.",
    };
  }
  const promotesCandidate = changeSet.operations.some(
    (operation) => operation.kind === "reorder-variations",
  );
  if (
    changeSet.change_set_id !==
      changeSetId(input.safety, changeSet.candidate_id, promotesCandidate) ||
    changeSet.request_id !== input.safety.request_id ||
    changeSet.candidate_id !== current.candidate.candidate_id ||
    changeSet.base_repertoire_revision !== input.current_repertoire_revision
  ) {
    return {
      code: "change-set-identity-mismatch",
      explanation: "Change-set request, candidate, revision, or deterministic identity is stale.",
    };
  }
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  if (changeSet.status !== "validated" || !changeSet.atomic || !changeSet.staged) {
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
    return {
      code: "change-set-not-validated",
      explanation: "Only a validated atomic domain proposal can be applied to a clone.",
    };
  }
  const replace = current.candidate.action === "replace";
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  const validRetention = replace
    ? changeSet.retention.archive === "archive" &&
      changeSet.retention.prune === "prune" &&
      changeSet.retention.prune_explicitly_confirmed &&
      changeSet.retention.archive_before_prune
    : changeSet.retention.archive === "keep-active" &&
      changeSet.retention.prune === "retain" &&
      !changeSet.retention.prune_explicitly_confirmed &&
      changeSet.retention.archive_before_prune;
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */
  if (!validRetention)
    return {
      code: "invalid-retention",
      explanation: "Retention does not match explicit Task 8.7 action.",
    };
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const operation of changeSet.operations) {
    if (!TASK_8_8_CHANGE_OPERATION_KINDS.includes(operation.kind as Task88ChangeOperationKind)) {
      return {
        code: "unsupported-operation",
        explanation: `Task 8.8 does not apply ${operation.kind}.`,
      };
    }
    if (
      !operation.operation_id ||
      ids.has(operation.operation_id) ||
      sequences.has(operation.sequence)
    ) {
      return {
        code: "duplicate-operation",
        explanation: "Operation IDs and sequence numbers must be unique.",
      };
    }
    if (!Number.isSafeInteger(operation.sequence) || operation.sequence < 0) {
      return {
        code: "invalid-operation-order",
        explanation: "Operation sequences must be non-negative safe integers.",
      };
    }
    ids.add(operation.operation_id);
    sequences.add(operation.sequence);
  }
  const operations = [...changeSet.operations].sort(
    (left, right) =>
      left.sequence - right.sequence || compareStrings(left.operation_id, right.operation_id),
  );
  if (
    operations.some((operation, index) => operation.sequence !== index) ||
    operations.some(
      (operation, index) =>
        index > 0 && kindRank(operation.kind) < kindRank(assertDefined(operations[index - 1]).kind),
    )
  ) {
    return {
      code: "invalid-operation-order",
      explanation:
        "Operations must use contiguous canonical add/link/annotate/archive/prune/reorder order.",
    };
  }
  if (
    !operations.some((operation) => operation.kind === "add-subtree") ||
    (replace &&
      (!operations.some((operation) => operation.kind === "archive-subtree") ||
        !operations.some((operation) => operation.kind === "prune-subtree"))) ||
    (!replace &&
      operations.some(
        (operation) => operation.kind === "archive-subtree" || operation.kind === "prune-subtree",
      ))
  ) {
    return {
      code: "invalid-retention",
      explanation:
        "Operation set does not match add-only or explicitly archived replacement retention.",
    };
  }
  for (const operation of operations) {
    if (operation.kind !== "prune-subtree") continue;
    const archiveIndex = operations.findIndex(
      (candidate) => candidate.operation_id === operation.archive_operation_id,
    );
    const archive = archiveIndex < 0 ? undefined : operations[archiveIndex];
    if (!archive || archiveIndex >= operation.sequence || archive.kind !== "archive-subtree") {
      return {
        code: "archive-required",
        explanation: "Every prune must reference an earlier archive operation.",
      };
    }
    if (!sameTarget(archive.target, operation.target)) {
      return {
        code: "archive-required",
        explanation:
          "Every prune must reference an earlier successful archive of the same semantic subtree.",
      };
    }
  }
  try {
    if (!annotationOperationsMatchEvidence(input, current, operations, promotesCandidate)) {
      return {
        code: "annotation-not-equivalent",
        explanation:
          "Annotation operations must exactly match canonical current source-tree and candidate evidence.",
      };
    }
  } catch {
    return {
      code: "annotation-not-equivalent",
      explanation: "Canonical annotation evidence could not be reconstructed.",
    };
  }
  return { operations };
}

function emptyDiff(operation: ReplacementChangeOperation): MutableDiff {
  return {
    operation_id: operation.operation_id,
    sequence: operation.sequence,
    kind: operation.kind,
    added_paths: [],
    removed_paths: [],
    annotated_paths: [],
    linked_paths: [],
    archived_paths: [],
    reordered_parent_paths: [],
    linked_position_ids: [],
    archive_ids: [],
  };
}

function immutableDiff(diff: MutableDiff): ReplacementOperationDiff {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    operation_id: diff.operation_id,
    sequence: diff.sequence,
    kind: diff.kind,
    added_paths: sortedPaths(diff.added_paths),
    removed_paths: sortedPaths(diff.removed_paths),
    annotated_paths: sortedPaths(diff.annotated_paths),
    linked_paths: sortedPaths(diff.linked_paths),
    archived_paths: sortedPaths(diff.archived_paths),
    reordered_parent_paths: sortedPaths(diff.reordered_parent_paths),
    linked_position_ids: sortedUnique(diff.linked_position_ids),
    archive_ids: sortedUnique(diff.archive_ids),
  };
}

function verifyAddedSubtree(
  tree: GameTree,
  color: "white" | "black",
  parentPath: readonly string[],
  subtree: ReplacementAddSubtreeOperation["subtree"],
): boolean {
  const graph = buildRepertoireGraph(tree, color);
  const edges = new Map(subtree.edges.map((edge) => [edge.edge_id, edge]));
  for (const route of subtree.routes) {
    const path = [...parentPath];
    for (const edgeId of route.edge_ids) {
      const edge = edges.get(edgeId);
      if (!edge) return false;
      path.push(edge.san);
      const decision = graph.decisions.find(
        (item) =>
          item.decision_id === edge.decision_id &&
          item.source_san_paths.some((source) => samePath(source, path)),
      );
      if (
        !decision ||
        decision.to_position_id !==
          subtree.nodes.find((node) => node.node_id === edge.to_node_id)?.position_id
      ) {
        return false;
      }
    }
  }
  return true;
}

function applyAdd(
  tree: GameTree,
  graph: RepertoireGraph,
  operation: ReplacementAddSubtreeOperation,
  selected: ReplacementScoredCandidate,
  color: "white" | "black",
  diff: MutableDiff,
): OperationFailure | null {
  if (!targetMatches(graph, operation.parent)) {
    return {
      code: "stale-semantic-path",
      explanation: "Add parent SAN path no longer resolves to its semantic position.",
    };
  }
  const expected = (selected.expansion as ReplacementCompleteCandidateExpansion).subtree;
  if (
    stableJson(canonicalBoundary(operation.subtree)) !== stableJson(canonicalBoundary(expected))
  ) {
    return {
      code: "candidate-subtree-mismatch",
      explanation: "Add operation subtree differs from current safe Task 8.7 candidate.",
    };
  }
  const parentIndex = tree.indexPathOfSan(operation.parent.source_san_path);
  if (parentIndex === null)
    return { code: "stale-semantic-path", explanation: "Add parent path is unavailable." };
  for (const route of routeSans(selected.expansion as ReplacementCompleteCandidateExpansion)) {
    let cursor = [...parentIndex];
    const path = [...operation.parent.source_san_path];
    for (const san of route) {
      const added = tree.appendSan(cursor, san);
      cursor = added.path;
      path.push(san);
      if (added.appended) diff.added_paths.push([...path]);
    }
  }
  try {
    if (!verifyAddedSubtree(tree, color, operation.parent.source_san_path, operation.subtree)) {
      return {
        code: "semantic-identity-mismatch",
        explanation: "Added subtree does not reproduce canonical node and decision identities.",
      };
    }
  } catch {
    return {
      code: "illegal-operation",
      explanation: "Added subtree did not produce a legal canonical graph.",
    };
  }
  return null;
}

function applyLink(
  graph: RepertoireGraph,
  operation: ReplacementLinkTranspositionOperation,
  diff: MutableDiff,
): OperationFailure | null {
  if (
    !targetMatches(graph, operation.source) ||
    operation.source.position_id !== operation.target_position_id
  ) {
    return {
      code: "transposition-link-mismatch",
      explanation: "Transposition source does not reach its canonical target position.",
    };
  }
  if (!graph.positions.some((position) => position.position_id === operation.target_position_id)) {
    return {
      code: "transposition-link-mismatch",
      explanation: "Canonical graph contains no matching prepared target position.",
    };
  }
  diff.linked_paths.push([...operation.source.source_san_path]);
  diff.linked_position_ids.push(operation.target_position_id);
  return null;
}

function applyAnnotation(
  tree: GameTree,
  graph: RepertoireGraph,
  operation: ReplacementPreserveAnnotationOperation,
  diff: MutableDiff,
): { failure: OperationFailure | null; count: number } {
  if (
    !operation.semantic_equivalence_verified ||
    !targetMatches(graph, operation.source) ||
    !targetMatches(graph, operation.target) ||
    operation.source.position_id !== operation.target.position_id
  ) {
    return {
      failure: {
        code: "annotation-not-equivalent",
        explanation: "Annotations move only between current semantically equivalent positions.",
      },
      count: 0,
    };
  }
  const index = tree.indexPathOfSan(operation.target.source_san_path);
  if (index === null)
    return {
      failure: {
        code: "stale-semantic-path",
        explanation: "Annotation target path is unavailable.",
      },
      count: 0,
    };
  const data = (tree.nodeAt(index) as unknown as { data: PgnNodeData }).data;
  const beforeComments = data.comments?.length ?? 0;
  const beforeNags = data.nags?.length ?? 0;
  data.comments = sortedUnique([...(data.comments ?? []), ...operation.comments]);
  data.nags = [...new Set([...(data.nags ?? []), ...operation.nags])].sort(
    (left, right) => left - right,
  );
  const count = data.comments.length - beforeComments + data.nags.length - beforeNags;
  if (count > 0) diff.annotated_paths.push([...operation.target.source_san_path]);
  return { failure: null, count };
}

function applyArchive(
  tree: GameTree,
  graph: RepertoireGraph,
  operation: ReplacementArchiveSubtreeOperation,
  diff: MutableDiff,
): { failure: OperationFailure | null; payload: ReplacementArchivePayload | null } {
  if (!targetMatches(graph, operation.target))
    return {
      failure: {
        code: "stale-semantic-path",
        explanation: "Archive target no longer resolves semantically.",
      },
      payload: null,
    };
  const expectedPgn = archivePgn(tree, operation.target.source_san_path);
  const expectedReferences = referencesFor(graph, operation.target);
  if (
    expectedPgn === null ||
    expectedPgn !== operation.archive_pgn ||
    stableJson(canonicalBoundary(expectedReferences)) !==
      stableJson(canonicalBoundary(operation.references))
  ) {
    return {
      failure: {
        code: "archive-payload-mismatch",
        explanation: "Archive payload is not the exact current subtree projection.",
      },
      payload: null,
    };
  }
  diff.archived_paths.push([...operation.target.source_san_path]);
  diff.archive_ids.push(operation.archive_id);
  return {
    failure: null,
    payload: {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      archive_id: operation.archive_id,
      operation_id: operation.operation_id,
      target: cloneJson(operation.target),
      pgn: operation.archive_pgn,
      references: cloneJson(operation.references),
      provenance: mergeProvenance(operation.provenance, [CORE_PROVENANCE]),
    },
  };
}

function subtreeSanPaths(tree: GameTree, targetPath: readonly string[]): string[][] | null {
  const targetIndex = tree.indexPathOfSan(targetPath);
  if (targetIndex === null) return null;
  const paths: string[][] = [];
  const pending: { indexPath: number[]; sanPath: string[] }[] = [
    {
      indexPath: [...targetIndex],
      sanPath: [...targetPath],
    },
  ];
  while (pending.length > 0) {
    const current = assertDefined(pending.pop());
    paths.push(current.sanPath);
    const node = tree.nodeAt(current.indexPath);
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = assertDefined(node.children[index]);
      pending.push({
        indexPath: [...current.indexPath, index],
        sanPath: [...current.sanPath, child.data.san],
      });
    }
  }
  return sortedPaths(paths);
}

function applyPrune(
  tree: GameTree,
  graph: RepertoireGraph,
  operation: ReplacementPruneSubtreeOperation,
  archivedTargets: ReadonlyMap<string, ReplacementChangeTarget>,
  diff: MutableDiff,
): OperationFailure | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!operation.explicitly_confirmed)
    return { code: "prune-not-confirmed", explanation: "Pruning requires literal confirmation." };
  const archivedTarget = archivedTargets.get(operation.archive_operation_id);
  if (!archivedTarget || !sameTarget(archivedTarget, operation.target)) {
    return {
      code: "archive-required",
      explanation: "Referenced archive of this exact subtree did not succeed before pruning.",
    };
  }
  if (!targetMatches(graph, operation.target))
    return {
      code: "stale-semantic-path",
      explanation: "Prune target no longer resolves semantically.",
    };
  const index = tree.indexPathOfSan(operation.target.source_san_path);
  if (index === null || index.length === 0)
    return {
      code: "illegal-operation",
      explanation: "Prune target must be a non-root current branch.",
    };
  const removedPaths = subtreeSanPaths(tree, operation.target.source_san_path);
  if (removedPaths === null)
    return { code: "stale-semantic-path", explanation: "Prune subtree paths are unavailable." };
  const parent = tree.nodeAt(index.slice(0, -1));
  parent.children.splice(assertDefined(index.at(-1)), 1);
  diff.removed_paths.push(...removedPaths);
  return null;
}

function applyReorder(
  tree: GameTree,
  graph: RepertoireGraph,
  operation: ReplacementReorderVariationsOperation,
  diff: MutableDiff,
): OperationFailure | null {
  const parent = graph.positions.find(
    (position) => position.position_id === operation.parent_position_id,
  );
  if (!parent || parent.source_san_paths.length === 0) {
    return {
      code: "stale-semantic-path",
      explanation: "Reorder parent semantic position is unavailable.",
    };
  }
  if (
    new Set(operation.ordered_decision_ids).size !== operation.ordered_decision_ids.length ||
    stableJson([...operation.ordered_decision_ids].sort(compareStrings)) !==
      stableJson([...parent.outgoing_decision_ids].sort(compareStrings))
  ) {
    return {
      code: "reorder-boundary-mismatch",
      explanation: "Reorder IDs must uniquely and exactly cover semantic children.",
    };
  }
  for (const path of parent.source_san_paths) {
    const index = tree.indexPathOfSan(path);
    if (index === null)
      return {
        code: "stale-semantic-path",
        explanation: "Reorder parent SAN path is unavailable.",
      };
    const node = tree.nodeAt(index);
    const childByDecision = new Map<string, (typeof node.children)[number]>();
    for (const child of node.children) {
      const childPath = [...path, (child as unknown as { data: PgnNodeData }).data.san];
      const decision = graph.decisions.find((item) =>
        item.source_san_paths.some((source) => samePath(source, childPath)),
      );
      if (!decision)
        return {
          code: "reorder-boundary-mismatch",
          explanation: "Reorder child lacks canonical decision identity.",
        };
      childByDecision.set(decision.decision_id, child);
    }
    const reordered = operation.ordered_decision_ids.flatMap((id) => {
      const child = childByDecision.get(id);
      return child ? [child] : [];
    });
    if (reordered.length !== node.children.length) {
      return {
        code: "reorder-boundary-mismatch",
        explanation: "Editorial reorder children are outside semantic parent boundary.",
      };
    }
    if (reordered.some((child, childIndex) => child !== node.children[childIndex])) {
      node.children.splice(0, node.children.length, ...reordered);
      diff.reordered_parent_paths.push([...path]);
    }
  }
  return null;
}

function treeStatistics(graph: RepertoireGraph): ReplacementTreeStatistics {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    position_count: graph.positions.length,
    decision_count: graph.decisions.length,
    route_count: graph.routes.length,
    source_route_count: graph.source_route_count,
    transposition_count: graph.transposition_links.length,
  };
}

function unavailableObjective(after: ReplacementObjectiveQuality): ReplacementObjectiveQuality {
  return {
    ...cloneJson(after),
    state: "unavailable",
    white_pov_evaluation_cp: null,
    white_pov_mate_in: null,
    white_pov_best_evaluation_cp: null,
    white_pov_best_mate_in: null,
    repertoire_pov_evaluation_cp: null,
    repertoire_pov_mate_in: null,
    repertoire_pov_loss_from_best_cp: null,
    repertoire_pov_verdict: "unverified",
    engine_depth: null,
    engine_multipv: null,
    evaluation_uncertainty_cp: null,
    tactical_volatility: null,
    evaluation_sensitivity_cp: null,
    forcing_density: null,
    king_safety_risk: null,
    viable_move_width: null,
    database_performance: null,
    theoretical_status: null,
    reason:
      "Task 8.7 retains candidate objective evidence but no comparable old-line objective object; Task 8.8 does not fabricate one.",
    provenance: mergeProvenance(after.provenance, [CORE_PROVENANCE]),
  };
}

function unavailableStrategicBefore(after: ReplacementStrategicScore): ReplacementStrategicScore {
  return {
    ...cloneJson(after),
    state: "unavailable",
    trajectory_ids: [],
    strategic_fit_score: null,
    strategic_fit_delta: null,
    strategic_familiarity: null,
    memorization_burden: null,
    expected_opponent_coverage: null,
    new_concept_ids: [],
    theory_nodes_before: null,
    theory_nodes_after: null,
    theory_nodes_added: null,
    theory_nodes_removed: null,
    popularity: null,
    homogenization_cost: null,
    training_cost: null,
    transposition_position_ids: [],
    contributions: [],
    provenance: mergeProvenance(after.provenance, [CORE_PROVENANCE]),
  };
}

function failureOutput(
  changeSet: ReplacementChangeSet,
  code: ReplacementChangeSetErrorCode,
  operationIdValue: string | null,
  explanation: string,
  operations: readonly ReplacementChangeOperation[] = changeSet.operations,
): ReplacementAtomicChangeSetFailure {
  const operationResults: ReplacementOperationResult[] = operations.map((operation) => ({
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    operation_id: operation.operation_id,
    status: operation.operation_id === operationIdValue ? "failed" : "skipped",
    error_code: operation.operation_id === operationIdValue ? code : null,
    explanation:
      operation.operation_id === operationIdValue
        ? explanation
        : "Atomic transaction returned no clone; this operation has no committed partial result.",
  }));
  const output: ReplacementChangeSetFailure = {
    ...versioned(),
    change_set_id: changeSet.change_set_id,
    base_repertoire_revision: changeSet.base_repertoire_revision,
    atomic: true,
    source_tree_unchanged: true,
    operation_results: operationResults,
    provenance: mergeProvenance(changeSet.provenance, [CORE_PROVENANCE]),
    status:
      code === "stale-revision" || code === "safety-not-current"
        ? "stale"
        : operationIdValue === null
          ? "rejected"
          : "failed",
    result: null,
    failure: { code, operation_id: operationIdValue, explanation },
  };
  return {
    status: "failure",
    tree: null,
    output,
    source_tree_unchanged: true,
    safety_unchanged: true,
    change_set_unchanged: true,
    evidence_unchanged: true,
    inputs_unchanged: true,
  };
}

export function applyReplacementChangeSet(
  input: ApplyReplacementChangeSetInput,
): ReplacementAtomicChangeSetResult {
  const current = currentSafety(
    input.source_tree,
    input.current_repertoire_revision,
    input.safety,
    input.change_set.candidate_id,
  );
  if ("code" in current)
    return failureOutput(input.change_set, current.code, null, current.explanation);
  const validated = validateChangeSet(input, current);
  if ("code" in validated)
    return failureOutput(input.change_set, validated.code, null, validated.explanation);
  const operations = validated.operations;
  const clone = input.source_tree.clone();
  const before = current.graph;
  const diffs: MutableDiff[] = [];
  const archivePayloads: ReplacementArchivePayload[] = [];
  const archivedTargets = new Map<string, ReplacementChangeTarget>();
  let preservedAnnotationCount = 0;
  for (const operation of operations) {
    const diff = emptyDiff(operation);
    let graph: RepertoireGraph;
    try {
      graph = buildRepertoireGraph(clone, input.safety.repertoire_color);
    } catch {
      return failureOutput(
        input.change_set,
        "transaction-failed",
        operation.operation_id,
        "Transaction clone stopped producing a legal canonical graph.",
        operations,
      );
    }
    let failure: OperationFailure | null = null;
    try {
      if (operation.kind === "add-subtree") {
        failure = applyAdd(
          clone,
          graph,
          operation,
          current.scored,
          input.safety.repertoire_color,
          diff,
        );
      } else if (operation.kind === "link-transposition") {
        failure = applyLink(graph, operation, diff);
      } else if (operation.kind === "preserve-annotation") {
        const result = applyAnnotation(clone, graph, operation, diff);
        failure = result.failure;
        preservedAnnotationCount += result.count;
      } else if (operation.kind === "archive-subtree") {
        const result = applyArchive(clone, graph, operation, diff);
        failure = result.failure;
        if (result.payload) {
          archivePayloads.push(result.payload);
          archivedTargets.set(operation.operation_id, cloneJson(operation.target));
        }
      } else if (operation.kind === "prune-subtree") {
        failure = applyPrune(clone, graph, operation, archivedTargets, diff);
      } else if (operation.kind === "reorder-variations") {
        failure = applyReorder(clone, graph, operation, diff);
      } else {
        failure = {
          code: "unsupported-operation",
          explanation: `Task 8.8 does not apply ${operation.kind}.`,
        };
      }
    } catch {
      failure = {
        code: "illegal-operation",
        explanation: `Operation ${operation.operation_id} failed deterministic tree validation.`,
      };
    }
    if (failure)
      return failureOutput(
        input.change_set,
        failure.code,
        operation.operation_id,
        failure.explanation,
        operations,
      );
    diffs.push(diff);
  }
  let after: RepertoireGraph;
  try {
    after = buildRepertoireGraph(clone, input.safety.repertoire_color);
  } catch {
    return failureOutput(
      input.change_set,
      "transaction-failed",
      operations.at(-1)?.operation_id ?? null,
      "Completed operations did not produce a legal canonical graph.",
      operations,
    );
  }
  if (after.graph_id !== current.candidate.simulated_graph_id) {
    return failureOutput(
      input.change_set,
      "result-graph-mismatch",
      operations.at(-1)?.operation_id ?? null,
      "Atomic result graph differs from the current Task 8.7 safety simulation.",
      operations,
    );
  }
  let resultPgn: string;
  try {
    resultPgn = clone.toPgn();
  } catch {
    return failureOutput(
      input.change_set,
      "transaction-failed",
      operations.at(-1)?.operation_id ?? null,
      "Atomic result could not be serialized deterministically.",
      operations,
    );
  }
  const immutableDiffs = diffs.map(immutableDiff);
  const affectedPaths = sortedPaths(
    immutableDiffs.flatMap((diff) => [
      ...diff.added_paths,
      ...diff.removed_paths,
      ...diff.annotated_paths,
      ...diff.linked_paths,
      ...diff.archived_paths,
      ...diff.reordered_parent_paths,
    ]),
  );
  const preview: ReplacementChangeSetPreview = {
    ...versioned(),
    before: treeStatistics(before),
    after: treeStatistics(after),
    objective_quality_before: unavailableObjective(current.scored.objective_quality),
    objective_quality_after: cloneJson(current.scored.objective_quality),
    strategic_score_before: unavailableStrategicBefore(current.scored.strategic_score),
    strategic_score_after: cloneJson(current.scored.strategic_score),
    coverage_effects: cloneJson(current.candidate.coverage_effects),
    affected_paths: affectedPaths,
    preserved_annotation_count: preservedAnnotationCount,
    archive_ids: sortedUnique(archivePayloads.map((payload) => payload.archive_id)),
    operation_diffs: immutableDiffs,
    archive_payloads: [...archivePayloads].sort((left, right) =>
      compareStrings(left.archive_id, right.archive_id),
    ),
    finding_changes_state: "not-reanalyzed",
    changed_finding_ids: [],
    new_finding_ids: [],
    resolved_finding_ids: [],
  };
  const operationResults: ReplacementOperationResult[] = operations.map((operation) => ({
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    operation_id: operation.operation_id,
    status: "applied",
    error_code: null,
    explanation: "Operation completed on the isolated transaction clone.",
  }));
  const output: ReplacementChangeSetPreviewSuccess = {
    ...versioned(),
    change_set_id: input.change_set.change_set_id,
    base_repertoire_revision: input.change_set.base_repertoire_revision,
    atomic: true,
    source_tree_unchanged: true,
    operation_results: operationResults,
    provenance: mergeProvenance(input.change_set.provenance, input.safety.provenance, [
      CORE_PROVENANCE,
    ]),
    status: "previewed",
    result: {
      repertoire_revision: null,
      pgn: resultPgn,
      preview,
    },
    failure: null,
  };
  return {
    status: "success",
    tree: clone,
    output,
    source_tree_unchanged: true,
    safety_unchanged: true,
    change_set_unchanged: true,
    evidence_unchanged: true,
    inputs_unchanged: true,
  };
}

export function constructAndApplyReplacementChangeSet(
  input: ConstructReplacementChangeSetInput,
): ReplacementAtomicChangeSetResult {
  const constructed = constructReplacementChangeSet(input);
  if (constructed.change_set === null) {
    const placeholder: ReplacementChangeSet = {
      ...versioned(),
      change_set_id: changeSetId(
        input.safety,
        input.candidate_id,
        input.promote_candidate_to_mainline === true,
      ),
      request_id: input.safety.request_id,
      candidate_id: input.candidate_id,
      base_repertoire_revision: input.current_repertoire_revision,
      status: "blocked",
      atomic: true,
      staged: true,
      retention: {
        archive: "keep-active",
        prune: "retain",
        prune_explicitly_confirmed: false,
        archive_before_prune: true,
      },
      operations: [],
      safety_checks: [],
      unresolved_risk_ids: [],
      provenance: mergeProvenance([CORE_PROVENANCE], input.safety.provenance),
    };
    return failureOutput(placeholder, constructed.error_code, null, constructed.explanation, []);
  }
  return applyReplacementChangeSet({
    source_tree: input.source_tree,
    current_repertoire_revision: input.current_repertoire_revision,
    safety: input.safety,
    change_set: constructed.change_set,
  });
}
