import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { createEffect, createSignal, untrack } from "solid-js";
import {
  STRATEGIC_FIT_PLAN_LIMITS,
  STRATEGIC_FIT_SCHEMA_VERSION,
  STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION,
  StrategicFitPlanError,
  assertStrategicFitPlanCardSupported,
  buildRepertoireGraph,
  createStrategicFitTrainingPerformanceData,
  deriveStrategicFitTrainingMastery,
  mergeStrategicFitTrainingPerformance,
  parseStrategicFitTrainingPerformance,
  recordStrategicFitTrainingAttempt,
  renderStrategicFitPlanCardText,
  serializeStrategicFitTrainingPerformance,
  upsertStrategicFitTrainingTarget,
  type RepertoireGraph,
  type RepertoireGraphDecision,
  type RepertoireGraphRoute,
  type SemanticReferences,
  type StrategicCheckpointKind,
  type StrategicFinding,
  type StrategicFitDocumentMetadata,
  type StrategicFitPlanCard,
  type StrategicFitPlanEvidence,
  type StrategicFitReport,
  type StrategicFitSourceProvenance,
  type StrategicFitTrainingAttemptInput,
  type StrategicFitTrainingTarget,
  type StrategicFitTrainingMasteryReport,
  type StrategicFitTrainingPerformanceData,
  type StrategicFitTrainingPerformanceError,
} from "@chess-mcp/chess-tools";
import { createArtifact } from "./artifacts";
import { color, currentTree, documentId } from "./game";
import { idbGet, idbSet } from "./idb";
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
  scheduleStrategicFitReanalysis,
  strategicFitLifecycle,
  type StrategicFitCompletedResult,
} from "./strategic-fit";
import { invalidateCachedStrategicFitReports } from "../application/strategic-fit-report-cache";
import { registerStrategicFitTrainingEvidenceProvider } from "../application/strategic-fit-training-evidence";
import { registerStrategicFitTrainingWriter } from "../application/strategic-fit-training-writer";

export const STRATEGIC_FIT_TRAINING_ARTIFACT_KIND = "chess-mcp/strategic-fit-basic-drill";
/** 1.2.0 adds the optional confirmed plan card; 1.1.0 added the semantic decision identity. */
const STRATEGIC_FIT_TRAINING_ARTIFACT_VERSION = "1.2.0";

interface StrategicFitTrainingCheckpoint {
  readonly checkpoint_id: string;
  readonly kind: StrategicCheckpointKind;
  readonly ply: number;
  readonly position_id: string;
  readonly fen: string;
  readonly comparability: "comparable" | "incomplete" | "not-comparable";
}

interface StrategicFitTrainingMove {
  readonly decision_id: string;
  readonly position_id: string;
  readonly fen: string;
  readonly san: string;
  readonly ply: number;
}

interface StrategicFitBasicDrill {
  readonly drill_id: string;
  readonly position_id: string;
  readonly decision_id: string;
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
  /**
   * A confirmed plan card (Task 11.4), or null for a purely deterministic training item. It is
   * re-validated against this record's own evidence whenever the record is built, so a card can
   * only be as current as the concepts, checkpoints, and drills it cites.
   */
  readonly plan_card: StrategicFitPlanCard | null;
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
  readonly plan_card: StrategicFitPlanCard | null;
  readonly drills: readonly StrategicFitBasicDrill[];
}

export interface StrategicFitTrainingCreationInput {
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly user_notes?: string | null;
  /** Only an already validated card; the builder re-checks it against current evidence anyway. */
  readonly plan_card?: StrategicFitPlanCard | null;
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
  upsertPerformanceTargets(record: StrategicFitTrainingRecord): void;
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
  return [...unique.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
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
  return (
    graph.decisions.find(
      (decision) => decision.decision_id === decisionId && decision.from_position_id === positionId,
    ) ?? null
  );
}

function trainingRoute(
  report: StrategicFitReport,
  finding: StrategicFinding,
  graph: RepertoireGraph,
): RepertoireGraphRoute | null {
  const trajectories = new Set(report.trajectories.map((trajectory) => trajectory.route_id));
  return (
    [...finding.references.route_ids]
      .sort(compareStrings)
      .map((routeId) => graph.routes.find((route) => route.route_id === routeId))
      .find(
        (route): route is RepertoireGraphRoute =>
          route !== undefined && trajectories.has(route.route_id),
      ) ?? null
  );
}

function conceptIds(
  report: StrategicFitReport,
  finding: StrategicFinding,
  routeId: string,
): string[] {
  const fromSignals =
    report.trajectories
      .find((trajectory) => trajectory.route_id === routeId)
      ?.snapshots.flatMap((snapshot) =>
        snapshot.signals
          .filter((signal) => signal.family === "learning-concepts")
          .map((signal) => signal.feature_id),
      ) ?? [];
  const fromModes =
    report.cohorts
      .find((cohort) => cohort.cohort_id === finding.evidence.cohort_id)
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
      event.kind === "player-decision" && event.decision_id !== null ? [event.decision_id] : [],
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

/**
 * The bounded deterministic basis a plan card may rest on, derived from one built record. The same
 * object is disclosed to the model and used to validate what it writes, so evidence withheld by
 * these bounds cannot be cited either; each bound reports what it withheld.
 */
export function strategicFitPlanEvidenceForRecord(
  record: StrategicFitTrainingRecord,
  reportId: string,
): StrategicFitPlanEvidence {
  const limits = STRATEGIC_FIT_PLAN_LIMITS;
  const paths = record.references.source_san_paths
    .slice(0, limits.evidence_san_paths)
    .map((path) => path.slice(0, limits.evidence_san_path_plies));
  const drills = record.drills.slice(0, limits.evidence_drills);
  const moves = sortedUnique([
    ...paths.flat(),
    ...drills.flatMap((drill) => [
      ...drill.source_san_path.slice(0, limits.evidence_san_path_plies),
      drill.expected_san,
    ]),
    ...(record.causal_move === null ? [] : [record.causal_move.san]),
  ]);
  const checkpoints = record.checkpoints.slice(0, limits.evidence_checkpoints);
  const concepts = record.concept_ids.slice(0, limits.evidence_concept_ids);
  return {
    report_id: reportId,
    finding_id: record.finding_id,
    semantic_finding_id: record.semantic_finding_id,
    repertoire_revision: record.repertoire_revision,
    training_id: record.training_id,
    concept_ids: concepts,
    omitted_concept_count: record.concept_ids.length - concepts.length,
    checkpoints: checkpoints.map((checkpoint) => ({
      checkpoint_id: checkpoint.checkpoint_id,
      kind: checkpoint.kind,
      ply: checkpoint.ply,
      comparability: checkpoint.comparability,
    })),
    omitted_checkpoint_count: record.checkpoints.length - checkpoints.length,
    drills: drills.map((drill) => ({
      drill_id: drill.drill_id,
      expected_san: drill.expected_san,
      source_san_path: drill.source_san_path.slice(0, limits.evidence_san_path_plies),
      source: drill.source,
      checkpoint_id: drill.checkpoint_id,
    })),
    omitted_drill_count: record.drills.length - drills.length,
    causal_move_san: record.causal_move?.san ?? null,
    san_paths: paths,
    omitted_san_path_count: record.references.source_san_paths.length - paths.length,
    moves: moves.slice(0, limits.evidence_moves),
    omitted_move_count: Math.max(0, moves.length - limits.evidence_moves),
  };
}

function buildStrategicFitTrainingRecord(
  report: StrategicFitReport,
  finding: StrategicFinding,
  graph: RepertoireGraph,
  userNotes: string | null | undefined,
  createdAt: string,
  planCard?: StrategicFitPlanCard | null,
): StrategicFitTrainingRecord {
  const staleRoute = finding.references.route_ids.find(
    (routeId) => !graph.routes.some((route) => route.route_id === routeId),
  );
  if (staleRoute !== undefined) throw new Error("strategic_fit_training_stale_route");
  const route = trainingRoute(report, finding, graph);
  if (route === null) throw new Error("strategic_fit_training_route_evidence_unavailable");
  const trajectory = report.trajectories.find((entry) => entry.route_id === route.route_id);
  if (trajectory === undefined)
    throw new Error("strategic_fit_training_route_evidence_unavailable");
  const checkpoints = trajectory.snapshots
    .filter((snapshot) =>
      graph.positions.some(
        (position) =>
          position.position_id === snapshot.position_id && position.fen === snapshot.fen,
      ),
    )
    .map(
      (snapshot): StrategicFitTrainingCheckpoint => ({
        checkpoint_id: snapshot.checkpoint.checkpoint_id,
        kind: snapshot.checkpoint.kind,
        ply: snapshot.checkpoint.ply,
        position_id: snapshot.position_id,
        fen: snapshot.fen,
        comparability: snapshot.checkpoint.comparability,
      }),
    )
    .sort(
      (left, right) =>
        left.ply - right.ply || compareStrings(left.checkpoint_id, right.checkpoint_id),
    );
  if (checkpoints.length === 0) throw new Error("strategic_fit_training_checkpoint_unavailable");

  const concepts = conceptIds(report, finding, route.route_id);
  const causal = causalMove(finding, graph, route);
  const drills: StrategicFitBasicDrill[] = [];
  const addDrill = (
    positionId: string,
    decisionId: string,
    fen: string,
    san: string,
    ply: number,
    source: StrategicFitBasicDrill["source"],
    checkpoint: StrategicFitTrainingCheckpoint | null,
  ) => {
    if (!legalSan(fen, san)) return;
    const identity = `${positionId}\u001f${san}`;
    if (drills.some((drill) => `${drill.position_id}\u001f${drill.expected_san}` === identity))
      return;
    drills.push({
      drill_id: `strategic-fit-drill:${stableHash(identity)}`,
      position_id: positionId,
      decision_id: decisionId,
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
    addDrill(
      causal.position_id,
      causal.decision_id,
      causal.fen,
      causal.san,
      causal.ply,
      "causal-move",
      null,
    );
  }
  for (const checkpoint of checkpoints) {
    const decision = routeDecision(graph, route, checkpoint.ply);
    if (decision !== null) {
      addDrill(
        checkpoint.position_id,
        decision.decision_id,
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
  const trainingId = `strategic-fit-training:${stableHash(
    JSON.stringify({
      semantic_finding_id: finding.semantic_finding_id,
      route_id: route.route_id,
      position_ids: semanticPositionIds,
      causal_decision_id: causal?.decision_id ?? null,
    }),
  )}`;
  const record: StrategicFitTrainingRecord = {
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
    user_notes: userNotes?.trim() ?? null,
    plan_card: null,
    created_at: createdAt,
    provenance: [
      {
        source_id: "strategic-fit:basic-training-drill",
        kind: "training-metadata",
        state: "available",
        version: STRATEGIC_FIT_TRAINING_ARTIFACT_VERSION,
        snapshot: report.report_id,
        reason:
          "Deterministic training item created from Strategic Fit report evidence without AI.",
      },
    ],
  };
  if (planCard === undefined || planCard === null) return record;
  // The writer, not only the staged proposal, is where support is proved: a card handed to it
  // directly is validated against the evidence this very record just produced.
  const card = assertStrategicFitPlanCardSupported(
    planCard,
    strategicFitPlanEvidenceForRecord(record, report.report_id),
  );
  return {
    ...record,
    plan_card: card,
    provenance: [
      ...record.provenance,
      {
        source_id: `strategic-fit:plan-card:${card.evidence_identity}`,
        kind: "training-metadata",
        state: "available",
        version: card.plan_card_version,
        snapshot: report.report_id,
        reason:
          "Plan card written by the assistant, validated against this finding's deterministic evidence and confirmed by the user.",
      },
    ],
  };
}

function serializeStrategicFitTrainingArtifact(record: StrategicFitTrainingRecord): string {
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
    plan_card: record.plan_card,
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
  // A plan-card failure already carries its own code and a message written for the assistant.
  if (error instanceof StrategicFitPlanError) return { code: error.code, message: error.message };
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
  return {
    code,
    message: messages[code] ?? "The training item could not be created from current evidence.",
  };
}

/**
 * The durable note for a training resolution. A confirmed plan card belongs in document metadata,
 * not only in the exported artifact, so it is rendered alongside any note the user typed rather
 * than replacing it.
 */
function trainingResolutionNote(record: StrategicFitTrainingRecord): string | null {
  const parts = [
    record.user_notes,
    record.plan_card === null ? null : renderStrategicFitPlanCardText(record.plan_card),
  ].filter((part): part is string => part !== null && part.length > 0);
  return parts.length === 0 ? null : parts.join("\n\n");
}

export function createStrategicFitTrainingState(boundary: StrategicFitTrainingBoundary) {
  const buildCurrent = (
    input: StrategicFitTrainingCreationInput,
  ): StrategicFitTrainingRecord | null => {
    const report = boundary.currentReport();
    const finding = boundary.currentFinding(input.report_id, input.finding_id);
    if (
      report?.report_id !== input.report_id ||
      finding?.semantic_finding_id !== input.semantic_finding_id
    )
      return null;
    const existing = boundary
      .currentMetadata()
      .training_references.find(
        (reference) =>
          reference.finding_id === finding.finding_id &&
          reference.repertoire_revision === finding.repertoire_revision,
      );
    return buildStrategicFitTrainingRecord(
      report.result,
      finding,
      boundary.currentGraph(),
      input.user_notes,
      existing?.created_at ?? boundary.now(),
      input.plan_card,
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
      let record: StrategicFitTrainingRecord | null;
      try {
        record = buildCurrent(input);
        if (record === null) throw new Error("strategic_fit_training_stale_report");
      } catch (error) {
        const failure = friendlyBuildError(error);
        return { state: "blocked", ...failure, record: null, artifact_id: null };
      }
      const hadReference = boundary
        .currentMetadata()
        .training_references.some((reference) => reference.training_id === record.training_id);
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
        note: trainingResolutionNote(record),
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
      boundary.upsertPerformanceTargets(record);
      const artifact = boundary.createArtifact(
        "json",
        serializeStrategicFitTrainingArtifact(record),
        `${record.training_id.replace(/[^a-z0-9-]+/gi, "-")}.json`,
      );
      return {
        state:
          reference.state === "unchanged" && resolution.state === "unchanged"
            ? "unchanged"
            : "created",
        code: null,
        message:
          "Training item created. The repertoire was not changed, and the finding remains visible.",
        record,
        artifact_id: artifactId(artifact),
      };
    },
  };
}

const STRATEGIC_FIT_TRAINING_PERFORMANCE_STORAGE_KEY_PREFIX = "strategicFitTrainingPerformance:";

export interface StrategicFitTrainingPerformanceMutationResult {
  readonly state: "updated" | "unchanged" | "blocked";
  readonly code: string | null;
  readonly message: string;
  readonly data: StrategicFitTrainingPerformanceData;
  readonly mastery: StrategicFitTrainingMasteryReport | null;
  readonly artifact_id: string | null;
  readonly error: StrategicFitTrainingPerformanceError | null;
}

export interface StrategicFitTrainingPerformanceBoundary {
  currentDocumentId(): string;
  currentData(): StrategicFitTrainingPerformanceData;
  currentGraph(): RepertoireGraph;
  replaceData(data: StrategicFitTrainingPerformanceData): void;
  createArtifact(format: "json", content: string, name: string): unknown;
  now(): string;
  /** Called only when observed concept mastery supplied to report metrics actually changes. */
  onMetricEvidenceChanged?(): void;
}

/**
 * Host state for Task 7.3. Registering targets and recording attempts are intentionally separate:
 * creating a drill establishes an explicit untrained state, while only a real attempt supplies
 * recall, response-time, lapse, confidence, or spacing evidence.
 */
export function createStrategicFitTrainingPerformanceState(
  boundary: StrategicFitTrainingPerformanceBoundary,
) {
  const unchanged = (
    data: StrategicFitTrainingPerformanceData,
    message: string,
  ): StrategicFitTrainingPerformanceMutationResult => ({
    state: "unchanged",
    code: null,
    message,
    data,
    mastery: deriveStrategicFitTrainingMastery(data, boundary.currentGraph(), boundary.now()),
    artifact_id: null,
    error: null,
  });

  return {
    register(record: StrategicFitTrainingRecord): StrategicFitTrainingPerformanceMutationResult {
      const before = boundary.currentData();
      let next = before;
      for (const drill of record.drills) {
        next = upsertStrategicFitTrainingTarget(next, {
          training_id: record.training_id,
          position_id: drill.position_id,
          decision_id: drill.decision_id,
          concept_ids: drill.concept_ids,
          created_at: record.created_at,
          provenance: record.provenance,
        });
      }
      if (JSON.stringify(next) === JSON.stringify(before)) {
        return unchanged(before, "Training targets were already registered.");
      }
      boundary.replaceData(next);
      return {
        state: "updated",
        code: null,
        message: "Training targets registered as untrained until an attempt is recorded.",
        data: next,
        mastery: deriveStrategicFitTrainingMastery(next, boundary.currentGraph(), boundary.now()),
        artifact_id: null,
        error: null,
      };
    },

    recordAttempt(
      input: StrategicFitTrainingAttemptInput,
    ): StrategicFitTrainingPerformanceMutationResult {
      const before = boundary.currentData();
      try {
        const next = recordStrategicFitTrainingAttempt(before, input);
        if (next === before)
          return unchanged(before, "This exact training attempt was already recorded.");
        const generatedAt = boundary.now();
        const graph = boundary.currentGraph();
        const beforeMastery = deriveStrategicFitTrainingMastery(before, graph, generatedAt);
        const nextMastery = deriveStrategicFitTrainingMastery(next, graph, generatedAt);
        boundary.replaceData(next);
        if (
          JSON.stringify(beforeMastery.metric_evidence) !==
          JSON.stringify(nextMastery.metric_evidence)
        ) {
          boundary.onMetricEvidenceChanged?.();
        }
        return {
          state: "updated",
          code: null,
          message: "Training attempt recorded without changing the repertoire.",
          data: next,
          mastery: nextMastery,
          artifact_id: null,
          error: null,
        };
      } catch (caught) {
        return {
          state: "blocked",
          code: caught instanceof Error ? caught.message : "strategic_fit_training_attempt_failed",
          message: "The training attempt is invalid or no longer references a known target.",
          data: before,
          mastery: null,
          artifact_id: null,
          error: null,
        };
      }
    },

    mastery(): StrategicFitTrainingMasteryReport {
      return deriveStrategicFitTrainingMastery(
        boundary.currentData(),
        boundary.currentGraph(),
        boundary.now(),
      );
    },

    export(): StrategicFitTrainingPerformanceMutationResult {
      const data = boundary.currentData();
      const artifact = boundary.createArtifact(
        "json",
        serializeStrategicFitTrainingPerformance(data),
        `strategic-fit-training-performance-${data.document_id}.json`,
      );
      return {
        state: "unchanged",
        code: null,
        message: `Version ${STRATEGIC_FIT_TRAINING_PERFORMANCE_VERSION} training data exported.`,
        data,
        mastery: deriveStrategicFitTrainingMastery(data, boundary.currentGraph(), boundary.now()),
        artifact_id: artifactId(artifact),
        error: null,
      };
    },

    import(input: unknown): StrategicFitTrainingPerformanceMutationResult {
      const before = boundary.currentData();
      const parsed = parseStrategicFitTrainingPerformance(input);
      if (!("ok" in parsed)) {
        return {
          state: "blocked",
          code: parsed.code,
          message: parsed.reason,
          data: before,
          mastery: null,
          artifact_id: null,
          error: parsed,
        };
      }
      if (parsed.data.document_id !== boundary.currentDocumentId()) {
        return {
          state: "blocked",
          code: "strategic_fit_training_document_mismatch",
          message: "Training data belongs to a different document.",
          data: before,
          mastery: null,
          artifact_id: null,
          error: null,
        };
      }
      const next = mergeStrategicFitTrainingPerformance(before, parsed.data);
      if (JSON.stringify(next) === JSON.stringify(before)) {
        return unchanged(before, "The imported training data is already present.");
      }
      const generatedAt = boundary.now();
      const graph = boundary.currentGraph();
      const beforeMastery = deriveStrategicFitTrainingMastery(before, graph, generatedAt);
      const nextMastery = deriveStrategicFitTrainingMastery(next, graph, generatedAt);
      boundary.replaceData(next);
      if (
        JSON.stringify(beforeMastery.metric_evidence) !==
        JSON.stringify(nextMastery.metric_evidence)
      ) {
        boundary.onMetricEvidenceChanged?.();
      }
      return {
        state: "updated",
        code: null,
        message: `Version ${parsed.data.training_performance_version} training data imported.`,
        data: next,
        mastery: nextMastery,
        artifact_id: null,
        error: null,
      };
    },
  };
}

interface StrategicFitTrainingPerformanceStorage {
  get(documentId: string): Promise<unknown>;
  set(documentId: string, data: StrategicFitTrainingPerformanceData): Promise<void>;
}

interface BrowserTrainingPerformanceSnapshot {
  readonly document_id: string | null;
  readonly status: "idle" | "loading" | "ready";
  readonly data: StrategicFitTrainingPerformanceData;
  readonly warning: string | null;
}

function performanceStorageKey(id: string): string {
  return `${STRATEGIC_FIT_TRAINING_PERFORMANCE_STORAGE_KEY_PREFIX}${id}`;
}

function createIndexedDbStrategicFitTrainingPerformanceStorage(): StrategicFitTrainingPerformanceStorage {
  return {
    get: (id) => idbGet(performanceStorageKey(id)),
    set: (id, data) => idbSet(performanceStorageKey(id), data),
  };
}

const [browserPerformanceSnapshot, setBrowserPerformanceSnapshot] =
  createSignal<BrowserTrainingPerformanceSnapshot>({
    document_id: null,
    status: "idle",
    data: createStrategicFitTrainingPerformanceData("unbound"),
    warning: null,
  });
const [performanceRestoreSettled, setPerformanceRestoreSettled] = createSignal(false);
const browserPerformanceStorage = createIndexedDbStrategicFitTrainingPerformanceStorage();
const performanceWriteTails = new Map<string, Promise<void>>();
const pendingPerformanceWrites = new Map<
  string,
  {
    readonly data: StrategicFitTrainingPerformanceData;
    timer: ReturnType<typeof setTimeout> | null;
  }
>();
let performanceActivation = 0;
let performanceEffectStarted = false;
let performanceActiveLoad: Promise<void> = Promise.resolve();

function executePendingPerformanceWrite(id: string): Promise<void> {
  const pending = pendingPerformanceWrites.get(id);
  if (!pending) return performanceWriteTails.get(id) ?? Promise.resolve();
  if (pending.timer !== null) clearTimeout(pending.timer);
  pendingPerformanceWrites.delete(id);
  const previous = performanceWriteTails.get(id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => browserPerformanceStorage.set(id, pending.data))
    .catch(() => {
      const snapshot = untrack(browserPerformanceSnapshot);
      if (snapshot.document_id === id) {
        setBrowserPerformanceSnapshot({
          ...snapshot,
          warning: "Strategic Fit training performance could not be saved.",
        });
      }
    });
  performanceWriteTails.set(id, next);
  return next;
}

function replaceBrowserTrainingPerformance(data: StrategicFitTrainingPerformanceData): void {
  const id = documentId();
  const parsed = parseStrategicFitTrainingPerformance(data);
  if (!("ok" in parsed) || parsed.data.document_id !== id) {
    throw new Error("strategic_fit_training_invalid_current_document_data");
  }
  // An explicit attempt/import wins over any older IndexedDB read still in flight.
  performanceActivation += 1;
  performanceActiveLoad = Promise.resolve();
  setBrowserPerformanceSnapshot({
    document_id: id,
    status: "ready",
    data: parsed.data,
    warning: null,
  });
  const pending = pendingPerformanceWrites.get(id);
  if (pending?.timer !== null && pending?.timer !== undefined) clearTimeout(pending.timer);
  const next = { data: parsed.data, timer: null as ReturnType<typeof setTimeout> | null };
  next.timer = setTimeout(() => {
    void executePendingPerformanceWrite(id);
  }, 400);
  pendingPerformanceWrites.set(id, next);
}

function activateBrowserTrainingPerformance(id: string): Promise<void> {
  const current = browserPerformanceSnapshot();
  if (current.document_id === id && current.status !== "idle") return performanceActiveLoad;
  const token = ++performanceActivation;
  setBrowserPerformanceSnapshot({
    document_id: id,
    status: "loading",
    data: createStrategicFitTrainingPerformanceData(id),
    warning: null,
  });
  performanceActiveLoad = (async () => {
    try {
      const raw = await browserPerformanceStorage.get(id);
      if (token !== performanceActivation || documentId() !== id) return;
      if (raw === undefined) {
        setBrowserPerformanceSnapshot({
          document_id: id,
          status: "ready",
          data: createStrategicFitTrainingPerformanceData(id),
          warning: null,
        });
        return;
      }
      const parsed = parseStrategicFitTrainingPerformance(raw);
      setBrowserPerformanceSnapshot({
        document_id: id,
        status: "ready",
        data: "ok" in parsed ? parsed.data : createStrategicFitTrainingPerformanceData(id),
        warning:
          "ok" in parsed
            ? null
            : "Saved Strategic Fit training performance was invalid and was not loaded.",
      });
    } catch {
      if (token !== performanceActivation || documentId() !== id) return;
      setBrowserPerformanceSnapshot({
        document_id: id,
        status: "ready",
        data: createStrategicFitTrainingPerformanceData(id),
        warning: "Strategic Fit training performance could not be restored.",
      });
    }
  })();
  return performanceActiveLoad;
}

export function startStrategicFitTrainingPerformancePersistence(): void {
  if (performanceEffectStarted) return;
  performanceEffectStarted = true;
  createEffect(() => {
    const ready = performanceRestoreSettled();
    const id = documentId();
    if (ready) void activateBrowserTrainingPerformance(id);
  });
}

export async function restoreStrategicFitTrainingPerformance(): Promise<void> {
  setPerformanceRestoreSettled(true);
  await activateBrowserTrainingPerformance(documentId());
}

export function strategicFitTrainingPerformance(): StrategicFitTrainingPerformanceData {
  const id = documentId();
  const snapshot = browserPerformanceSnapshot();
  return snapshot.document_id === id
    ? snapshot.data
    : createStrategicFitTrainingPerformanceData(id);
}

export function strategicFitTrainingPerformanceWarning(): string | null {
  const id = documentId();
  const snapshot = browserPerformanceSnapshot();
  return snapshot.document_id === id ? snapshot.warning : null;
}

export async function flushStrategicFitTrainingPerformance(
  targetDocumentId?: string,
): Promise<void> {
  if (targetDocumentId !== undefined) {
    await executePendingPerformanceWrite(targetDocumentId);
    await (performanceWriteTails.get(targetDocumentId) ?? Promise.resolve());
    return;
  }
  for (const id of [...pendingPerformanceWrites.keys()]) await executePendingPerformanceWrite(id);
  await Promise.all([...performanceWriteTails.values()]);
}

const browserTrainingPerformance = createStrategicFitTrainingPerformanceState({
  currentDocumentId: documentId,
  currentData: strategicFitTrainingPerformance,
  currentGraph: () => buildRepertoireGraph(currentTree(), color()),
  replaceData: replaceBrowserTrainingPerformance,
  createArtifact,
  now: () => new Date().toISOString(),
  onMetricEvidenceChanged: () => {
    invalidateCachedStrategicFitReports();
    const completed = strategicFitLifecycle().last_completed;
    if (completed === null) return;
    scheduleStrategicFitReanalysis({
      trigger: "training-change",
      scope: {
        kind: "affected-cohorts",
        cohort_ids: completed.result.cohorts.map((cohort) => cohort.cohort_id).sort(),
        reason: "Observed training mastery changed personalized metrics for the current cohorts.",
      },
    });
  },
});

export const recordStrategicFitTrainingPerformanceAttempt = (
  input: StrategicFitTrainingAttemptInput,
) => browserTrainingPerformance.recordAttempt(input);
export const strategicFitTrainingMastery = () => browserTrainingPerformance.mastery();
registerStrategicFitTrainingEvidenceProvider(() => {
  const evidence = strategicFitTrainingMastery().metric_evidence;
  return evidence.concept_mastery.length > 0 ? evidence : null;
});
export const exportStrategicFitTrainingPerformance = () => browserTrainingPerformance.export();
export const importStrategicFitTrainingPerformance = (input: unknown) =>
  browserTrainingPerformance.import(input);

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
  upsertPerformanceTargets: (record) => {
    browserTrainingPerformance.register(record);
  },
  createArtifact,
  now: () => new Date().toISOString(),
});

export const createStrategicFitTrainingItem = (input: StrategicFitTrainingCreationInput) =>
  browserTraining.create(input);

/**
 * The registered target a drill belongs to, or null when the drill was never registered.
 *
 * Matched on the three fields the target is derived from rather than by recomputing its id: the
 * derivation (a stable hash over training/position/decision) is the library's own business, and a
 * second copy of it here would be a second thing to keep in step.
 */
export function strategicFitTrainingTargetForDrill(
  trainingId: string,
  drill: Pick<StrategicFitBasicDrill, "position_id" | "decision_id">,
): StrategicFitTrainingTarget | null {
  return (
    strategicFitTrainingPerformance().targets.find(
      (target) =>
        target.training_id === trainingId &&
        target.position_id === drill.position_id &&
        target.decision_id === drill.decision_id,
    ) ?? null
  );
}

/**
 * Record one drill attempt. `recalled` is decided by the caller comparing the move played against
 * the drill's `expected_san`; this only reports what happened.
 *
 * Registration and attempt stay separate on purpose — creating a drill establishes an untrained
 * target, and only a real attempt supplies recall and response-time evidence — so this must be
 * reached from a drill the user actually played, never from drill creation.
 */
export function recordStrategicFitDrillAttempt(input: {
  trainingId: string;
  drill: Pick<StrategicFitBasicDrill, "position_id" | "decision_id">;
  recalled: boolean;
  responseTimeMs: number | null;
}): StrategicFitTrainingPerformanceMutationResult | null {
  const target = strategicFitTrainingTargetForDrill(input.trainingId, input.drill);
  if (target === null) return null;
  return recordStrategicFitTrainingPerformanceAttempt({
    target_id: target.target_id,
    attempted_at: new Date().toISOString(),
    recalled: input.recalled,
    response_time_ms: input.responseTimeMs,
  });
}

/**
 * Rebuild the deterministic record for a finding without saving anything. Plan synthesis uses it
 * for both the evidence it discloses and the evidence it validates against, so a proposal and its
 * acceptance are measured with the same builder the training writer uses.
 */
const buildCurrentStrategicFitTrainingRecord = (input: StrategicFitTrainingCreationInput) =>
  browserTraining.buildCurrent(input);

/**
 * The drills for a finding, rebuilt from current canonical evidence, or null when there are none.
 *
 * The drill surface rebuilds rather than holding on to whatever `create` returned, because creating
 * a training item triggers reanalysis, which remounts the panel and would discard any record kept
 * in component state. Rebuilding also keeps drill content in step with the live repertoire, and is
 * side-effect free — unlike `exportStrategicFitTrainingItem`, it writes no artifact.
 */
export function strategicFitDrillsFor(
  input: StrategicFitTrainingCreationInput,
): StrategicFitTrainingRecord | null {
  try {
    const record = buildCurrentStrategicFitTrainingRecord(input);
    return record && record.drills.length > 0 ? record : null;
  } catch {
    // Building can reject a finding outright — a stale semantic route is the documented case. The
    // caller renders from this, so an unbuildable finding must read as "nothing to drill" rather
    // than take the surrounding panel down with it.
    return null;
  }
}

// Plan synthesis reaches training through this bridge rather than importing it: the browser command
// registry already reaches plan synthesis, and training reaches the finding-resolution graph.
registerStrategicFitTrainingWriter({
  planEvidence: (input) => {
    const record = buildCurrentStrategicFitTrainingRecord(input);
    return record === null ? null : strategicFitPlanEvidenceForRecord(record, input.report_id);
  },
  createItem: (input) => browserTraining.create(input),
});

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
