import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import {
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  type RepertoireGraph,
  type RepertoireGraphDecision,
  type RepertoireGraphRoute,
  type SemanticReferences,
  type StrategicCheckpointKind,
  type StrategicFinding,
  type StrategicFitDocumentMetadata,
  type StrategicFitReport,
  type StrategicFitSourceProvenance,
} from "@chess-mcp/chess-tools";
import { createArtifact } from "./artifacts";
import { color, currentTree } from "./game";
import { strategicFitFindingQueue } from "./strategic-fit-finding-queue";
import {
  strategicFitFindingResolutionAvailability,
  transitionStrategicFitFindingResolution,
  type StrategicFitFindingResolutionTransitionResult,
  type StrategicFitResolutionAvailability,
} from "./strategic-fit-finding-resolutions";
import { strategicFitMetadata } from "./strategic-fit-metadata";
import {
  removeStrategicFitTrainingReference,
  upsertStrategicFitTrainingReference,
  type StrategicFitSettingsMutationResult,
  type StrategicFitTrainingReferenceMutationInput,
} from "./strategic-fit-resolutions";
import {
  strategicFitLifecycle,
  type StrategicFitCompletedResult,
} from "./strategic-fit";

export const STRATEGIC_FIT_TRAINING_ARTIFACT_KIND =
  "chess-mcp/strategic-fit-basic-drill";
export const STRATEGIC_FIT_TRAINING_ARTIFACT_VERSION = "1.0.0";

export interface StrategicFitTrainingCheckpoint {
  readonly checkpoint_id: string;
  readonly kind: StrategicCheckpointKind;
  readonly ply: number;
  readonly position_id: string;
  readonly fen: string;
  readonly comparability: "comparable" | "incomplete" | "not-comparable";
}

export interface StrategicFitTrainingMove {
  readonly decision_id: string;
  readonly position_id: string;
  readonly fen: string;
  readonly san: string;
  readonly ply: number;
}

export interface StrategicFitBasicDrill {
  readonly drill_id: string;
  readonly position_id: string;
  readonly fen: string;
  readonly expected_san: string;
  readonly source_san_path: readonly string[];
  readonly source: "causal-move" | "checkpoint";
  readonly checkpoint_id: string | null;
  readonly checkpoint_kind: StrategicCheckpointKind | null;
  readonly concept_ids: readonly string[];
}

export interface StrategicFitTrainingRecord {
  readonly schema_version: typeof STRATEGIC_FIT_SCHEMA_VERSION;
  readonly training_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly repertoire_revision: string;
  readonly route_id: string;
  readonly references: SemanticReferences;
  readonly checkpoints: readonly StrategicFitTrainingCheckpoint[];
  readonly concept_ids: readonly string[];
  readonly causal_move: StrategicFitTrainingMove | null;
  readonly drills: readonly StrategicFitBasicDrill[];
  readonly user_notes: string | null;
  readonly created_at: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitTrainingArtifact {
  readonly artifact_kind: typeof STRATEGIC_FIT_TRAINING_ARTIFACT_KIND;
  readonly artifact_version: typeof STRATEGIC_FIT_TRAINING_ARTIFACT_VERSION;
  readonly training_id: string;
  readonly semantic_finding_id: string;
  readonly repertoire_revision: string;
  readonly route_id: string;
  readonly concept_ids: readonly string[];
  readonly user_notes: string | null;
  readonly drills: readonly StrategicFitBasicDrill[];
}

export interface StrategicFitTrainingCreationInput {
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly user_notes?: string | null;
}

export interface StrategicFitTrainingCreationResult {
  readonly state: "created" | "unchanged" | "blocked";
  readonly code: string | null;
  readonly message: string;
  readonly record: StrategicFitTrainingRecord | null;
  readonly artifact_id: string | null;
}

export interface StrategicFitTrainingBoundary {
  currentReport(): StrategicFitCompletedResult | null;
  currentFinding(reportId: string, findingId: string): StrategicFinding | null;
  currentMetadata(): StrategicFitDocumentMetadata;
  currentGraph(): RepertoireGraph;
  resolutionAvailability(
    reportId: string,
    findingId: string,
    semanticFindingId: string,
  ): StrategicFitResolutionAvailability;
  upsertTrainingReference(
    input: StrategicFitTrainingReferenceMutationInput,
  ): StrategicFitSettingsMutationResult;
  removeTrainingReference(trainingId: string): StrategicFitSettingsMutationResult;
  transitionResolution(input: {
    readonly report_id: string;
    readonly finding_id: string;
    readonly semantic_finding_id: string;
    readonly state: "train-as-exception";
    readonly note: string | null;
    readonly linked_training_ids: readonly string[];
  }): StrategicFitFindingResolutionTransitionResult;
  createArtifact(format: "json", content: string, name: string): unknown;
  now(): string;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values.filter(Boolean))].sort(compareStrings);

function sortedPaths(paths: readonly (readonly string[])[]): string[][] {
  const unique = new Map<string, string[]>();
  for (const path of paths) unique.set(JSON.stringify(path), [...path]);
  return [...unique.entries()].sort(([left], [right]) => compareStrings(left, right))
    .map(([, path]) => path);
}

function legalSan(fen: string, san: string): boolean {
  try {
    const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    return parseSan(position, san) !== undefined;
  } catch {
    return false;
  }
}

function routeDecision(
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
  ply: number,
): RepertoireGraphDecision | null {
  const decisionId = route.decision_ids[ply];
  const positionId = route.position_ids[ply];
  if (decisionId === undefined || positionId === undefined) return null;
  return graph.decisions.find((decision) =>
    decision.decision_id === decisionId && decision.from_position_id === positionId
  ) ?? null;
}

function trainingRoute(
  report: StrategicFitReport,
  finding: StrategicFinding,
  graph: RepertoireGraph,
): RepertoireGraphRoute | null {
  const trajectories = new Set(report.trajectories.map((trajectory) => trajectory.route_id));
  return [...finding.references.route_ids].sort(compareStrings)
    .map((routeId) => graph.routes.find((route) => route.route_id === routeId))
    .find((route): route is RepertoireGraphRoute => route !== undefined && trajectories.has(route.route_id)) ?? null;
}

function conceptIds(
  report: StrategicFitReport,
  finding: StrategicFinding,
  routeId: string,
): string[] {
  const fromSignals = report.trajectories.find((trajectory) => trajectory.route_id === routeId)
    ?.snapshots.flatMap((snapshot) => snapshot.signals
      .filter((signal) => signal.family === "learning-concepts")
      .map((signal) => signal.feature_id)) ?? [];
  const fromModes = report.cohorts.find((cohort) => cohort.cohort_id === finding.evidence.cohort_id)
    ?.modes.filter((mode) => mode.supporting_route_ids.includes(routeId))
    .flatMap((mode) => mode.concept_ids) ?? [];
  return sortedUnique([...fromSignals, ...fromModes]);
}

function causalMove(
  finding: StrategicFinding,
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
): StrategicFitTrainingMove | null {
  const candidateIds = sortedUnique([
    ...finding.evidence.causality.likely_causal_decision_ids,
    ...finding.evidence.causality.timeline.flatMap((event) =>
      event.kind === "player-decision" && event.decision_id !== null ? [event.decision_id] : []
    ),
  ]);
  for (const decisionId of candidateIds) {
    const ply = route.decision_ids.indexOf(decisionId);
    if (ply < 0) continue;
    const decision = routeDecision(graph, route, ply);
    const positionId = route.position_ids[ply];
    const position = graph.positions.find((entry) => entry.position_id === positionId);
    if (!decision || !position || !legalSan(position.fen, decision.san)) continue;
    return {
      decision_id: decision.decision_id,
      position_id: position.position_id,
      fen: position.fen,
      san: decision.san,
      ply,
    };
  }
  return null;
}

export function buildStrategicFitTrainingRecord(
  report: StrategicFitReport,
  finding: StrategicFinding,
  graph: RepertoireGraph,
  userNotes: string | null | undefined,
  createdAt: string,
): StrategicFitTrainingRecord {
  const staleRoute = finding.references.route_ids.find((routeId) =>
    !graph.routes.some((route) => route.route_id === routeId)
  );
  if (staleRoute !== undefined) throw new Error("strategic_fit_training_stale_route");
  const route = trainingRoute(report, finding, graph);
  if (route === null) throw new Error("strategic_fit_training_route_evidence_unavailable");
  const trajectory = report.trajectories.find((entry) => entry.route_id === route.route_id)!;
  const checkpoints = trajectory.snapshots
    .filter((snapshot) => graph.positions.some((position) =>
      position.position_id === snapshot.position_id && position.fen === snapshot.fen
    ))
    .map((snapshot): StrategicFitTrainingCheckpoint => ({
      checkpoint_id: snapshot.checkpoint.checkpoint_id,
      kind: snapshot.checkpoint.kind,
      ply: snapshot.checkpoint.ply,
      position_id: snapshot.position_id,
      fen: snapshot.fen,
      comparability: snapshot.checkpoint.comparability,
    }))
    .sort((left, right) => left.ply - right.ply || compareStrings(left.checkpoint_id, right.checkpoint_id));
  if (checkpoints.length === 0) throw new Error("strategic_fit_training_checkpoint_unavailable");

  const concepts = conceptIds(report, finding, route.route_id);
  const causal = causalMove(finding, graph, route);
  const drills: StrategicFitBasicDrill[] = [];
  const addDrill = (
    positionId: string,
    fen: string,
    san: string,
    ply: number,
    source: StrategicFitBasicDrill["source"],
    checkpoint: StrategicFitTrainingCheckpoint | null,
  ) => {
    if (!legalSan(fen, san)) return;
    const identity = `${positionId}\u001f${san}`;
    if (drills.some((drill) => `${drill.position_id}\u001f${drill.expected_san}` === identity)) return;
    drills.push({
      drill_id: `strategic-fit-drill:${stableHash(identity)}`,
      position_id: positionId,
      fen,
      expected_san: san,
      source_san_path: route.san_moves.slice(0, ply),
      source,
      checkpoint_id: checkpoint?.checkpoint_id ?? null,
      checkpoint_kind: checkpoint?.kind ?? null,
      concept_ids: concepts,
    });
  };
  if (causal !== null) {
    addDrill(causal.position_id, causal.fen, causal.san, causal.ply, "causal-move", null);
  }
  for (const checkpoint of checkpoints) {
    const decision = routeDecision(graph, route, checkpoint.ply);
    if (decision !== null) {
      addDrill(
        checkpoint.position_id,
        checkpoint.fen,
        decision.san,
        checkpoint.ply,
        "checkpoint",
        checkpoint,
      );
    }
  }
  if (drills.length === 0) throw new Error("strategic_fit_training_legal_drill_unavailable");

  const semanticPositionIds = sortedUnique([
    ...checkpoints.map((checkpoint) => checkpoint.position_id),
    ...(causal === null ? [] : [causal.position_id]),
  ]);
  const semanticDecisionIds = sortedUnique([
    ...drills.map((drill) => route.decision_ids[drill.source_san_path.length] ?? ""),
    ...(causal === null ? [] : [causal.decision_id]),
  ]);
  const references: SemanticReferences = {
    position_ids: semanticPositionIds,
    decision_ids: semanticDecisionIds,
    route_ids: [route.route_id],
    source_san_paths: sortedPaths(route.source_san_paths),
  };
  const trainingId = `strategic-fit-training:${stableHash(JSON.stringify({
    semantic_finding_id: finding.semantic_finding_id,
    route_id: route.route_id,
    position_ids: semanticPositionIds,
    causal_decision_id: causal?.decision_id ?? null,
  }))}`;
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    training_id: trainingId,
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
    repertoire_revision: finding.repertoire_revision,
    route_id: route.route_id,
    references,
    checkpoints,
    concept_ids: concepts,
    causal_move: causal,
    drills,
    user_notes: userNotes?.trim() || null,
    created_at: createdAt,
    provenance: [{
      source_id: "strategic-fit:basic-training-drill",
      kind: "training-metadata",
      state: "available",
      version: STRATEGIC_FIT_TRAINING_ARTIFACT_VERSION,
      snapshot: report.report_id,
      reason: "Deterministic training item created from Strategic Fit report evidence without AI.",
    }],
  };
}

export function serializeStrategicFitTrainingArtifact(record: StrategicFitTrainingRecord): string {
  for (const drill of record.drills) {
    if (!legalSan(drill.fen, drill.expected_san)) {
      throw new Error("strategic_fit_training_artifact_illegal_drill");
    }
  }
  const artifact: StrategicFitTrainingArtifact = {
    artifact_kind: STRATEGIC_FIT_TRAINING_ARTIFACT_KIND,
    artifact_version: STRATEGIC_FIT_TRAINING_ARTIFACT_VERSION,
    training_id: record.training_id,
    semantic_finding_id: record.semantic_finding_id,
    repertoire_revision: record.repertoire_revision,
    route_id: record.route_id,
    concept_ids: record.concept_ids,
    user_notes: record.user_notes,
    drills: record.drills,
  };
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function artifactId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { artifact_id?: unknown }).artifact_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function friendlyBuildError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error ? error.message : "strategic_fit_training_failed";
  const messages: Record<string, string> = {
    strategic_fit_training_stale_route:
      "Training is blocked because an affected semantic route no longer belongs to the repertoire.",
    strategic_fit_training_route_evidence_unavailable:
      "Training is blocked because the current report has no trajectory for an affected route.",
    strategic_fit_training_checkpoint_unavailable:
      "Training is blocked because no legal semantic checkpoint remains in the current repertoire.",
    strategic_fit_training_legal_drill_unavailable:
      "Training is blocked because no checkpoint has a legal next SAN move to practice.",
  };
  return { code, message: messages[code] ?? "The training item could not be created from current evidence." };
}

export function createStrategicFitTrainingState(boundary: StrategicFitTrainingBoundary) {
  const buildCurrent = (input: StrategicFitTrainingCreationInput): StrategicFitTrainingRecord | null => {
    const report = boundary.currentReport();
    const finding = boundary.currentFinding(input.report_id, input.finding_id);
    if (
      report === null || report.report_id !== input.report_id || finding === null ||
      finding.semantic_finding_id !== input.semantic_finding_id
    ) return null;
    const existing = boundary.currentMetadata().training_references.find((reference) =>
      reference.finding_id === finding.finding_id &&
      reference.repertoire_revision === finding.repertoire_revision
    );
    return buildStrategicFitTrainingRecord(
      report.result,
      finding,
      boundary.currentGraph(),
      input.user_notes,
      existing?.created_at ?? boundary.now(),
    );
  };

  return {
    buildCurrent,
    create(input: StrategicFitTrainingCreationInput): StrategicFitTrainingCreationResult {
      const available = boundary.resolutionAvailability(
        input.report_id,
        input.finding_id,
        input.semantic_finding_id,
      );
      if (!available.available || available.finding === null) {
        return {
          state: "blocked",
          code: available.code,
          message: available.message ?? "Training is not available for this finding.",
          record: null,
          artifact_id: null,
        };
      }
      let record: StrategicFitTrainingRecord;
      try {
        record = buildCurrent(input)!;
        if (record === null) throw new Error("strategic_fit_training_stale_report");
      } catch (error) {
        const failure = friendlyBuildError(error);
        return { state: "blocked", ...failure, record: null, artifact_id: null };
      }
      const hadReference = boundary.currentMetadata().training_references.some((reference) =>
        reference.training_id === record.training_id
      );
      const reference = boundary.upsertTrainingReference({
        training_id: record.training_id,
        finding_id: record.finding_id,
        repertoire_revision: record.repertoire_revision,
        references: record.references,
        created_at: record.created_at,
        provenance: record.provenance,
      });
      const resolution = boundary.transitionResolution({
        report_id: input.report_id,
        finding_id: input.finding_id,
        semantic_finding_id: input.semantic_finding_id,
        state: "train-as-exception",
        note: record.user_notes,
        linked_training_ids: [record.training_id],
      });
      if (resolution.state === "blocked") {
        if (!hadReference && reference.state === "updated") {
          boundary.removeTrainingReference(record.training_id);
        }
        return {
          state: "blocked",
          code: resolution.code,
          message: resolution.message,
          record: null,
          artifact_id: null,
        };
      }
      const artifact = boundary.createArtifact(
        "json",
        serializeStrategicFitTrainingArtifact(record),
        `${record.training_id.replace(/[^a-z0-9-]+/gi, "-")}.json`,
      );
      return {
        state: reference.state === "unchanged" && resolution.state === "unchanged"
          ? "unchanged"
          : "created",
        code: null,
        message: "Training item created. The repertoire was not changed, and the finding remains visible.",
        record,
        artifact_id: artifactId(artifact),
      };
    },
  };
}

const browserTraining = createStrategicFitTrainingState({
  currentReport: () => {
    const lifecycle = strategicFitLifecycle();
    return lifecycle.status === "completed" ? lifecycle.current_result : null;
  },
  currentFinding: (reportId, findingId) => {
    const queue = strategicFitFindingQueue.snapshot();
    if (queue.report_id !== reportId) return null;
    return queue.findings.find((finding) => finding.finding_id === findingId) ?? null;
  },
  currentMetadata: strategicFitMetadata,
  currentGraph: () => buildRepertoireGraph(currentTree(), color()),
  resolutionAvailability: strategicFitFindingResolutionAvailability,
  upsertTrainingReference: upsertStrategicFitTrainingReference,
  removeTrainingReference: removeStrategicFitTrainingReference,
  transitionResolution: transitionStrategicFitFindingResolution,
  createArtifact,
  now: () => new Date().toISOString(),
});

export const createStrategicFitTrainingItem = (input: StrategicFitTrainingCreationInput) =>
  browserTraining.create(input);

/** Rebuild a saved deterministic drill from current canonical evidence for portable export. */
export function exportStrategicFitTrainingItem(
  input: StrategicFitTrainingCreationInput,
): StrategicFitTrainingCreationResult {
  try {
    const record = browserTraining.buildCurrent(input);
    if (record === null) throw new Error("strategic_fit_training_stale_report");
    const artifact = createArtifact(
      "json",
      serializeStrategicFitTrainingArtifact(record),
      `${record.training_id.replace(/[^a-z0-9-]+/gi, "-")}.json`,
    );
    return {
      state: "unchanged",
      code: null,
      message: "Saved training item rebuilt from current canonical evidence.",
      record,
      artifact_id: artifactId(artifact),
    };
  } catch (error) {
    const failure = friendlyBuildError(error);
    return { state: "blocked", ...failure, record: null, artifact_id: null };
  }
}
