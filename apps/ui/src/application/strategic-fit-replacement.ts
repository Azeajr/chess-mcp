import {
  REPLACEMENT_TOOL_V2_CONTRACT,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  buildStrategicConceptDictionary,
  buildStrategicTrajectories,
  expandReplacementCandidates,
  explorerFilterKey,
  generateReplacementCandidates,
  generateReplacementEngineCandidates,
  normalizeExplorerFilters,
  scoreReplacementCandidates,
  selectReplacementPivot,
  simulateReplacementSafety,
  type ReplacementCandidateGenerationResult,
  type ReplacementCandidateScoringResult,
  type ReplacementCandidateSourceKind,
  type ReplacementEngineAnalysisEvidence,
  type ReplacementEngineCandidateGenerationResult,
  type ReplacementEngineIdentity,
  type ReplacementEngineProvider,
  type ReplacementExplorerExpansionProvider,
  type ReplacementGenerationBudget,
  type ReplacementOpeningDatabaseEvidence,
  type ReplacementPivotCohortEvidence,
  type ReplacementPivotSelectionResult,
  type ReplacementRequest,
  type ReplacementSafetyCandidateAction,
  type ReplacementSafetySimulationResult,
  type ReplacementToolV2Result,
  type StrategicFinding,
  type StrategicFitAnalysisResult,
  type StrategicFitSourceProvenance,
  type StrategicTrajectoryReport,
} from "@chess-mcp/chess-tools";
import type {
  StrategicFitCompletedResult,
  StrategicFitRequestSnapshot,
} from "../store/strategic-fit";
import { executeBrowserCommand } from "./browser-commands/client";
import type {
  BrowserCommandDependencies,
  BrowserCommandExecutionOptions,
} from "./browser-commands/types";

export const REPLACEMENT_LAB_SUPPORTED_SOURCES = [
  "existing-repertoire-transposition",
  "move-order-shortcut",
  "opening-database",
  "engine-multipv",
] as const satisfies readonly ReplacementCandidateSourceKind[];

export const REPLACEMENT_LAB_UNAVAILABLE_SOURCES = [
  "user-defined",
  "structurally-similar-repertoire",
] as const satisfies readonly ReplacementCandidateSourceKind[];

export type ReplacementLabActionabilityCode =
  | "actionable"
  | "stale-report"
  | "stale-document"
  | "stale-finding"
  | "provisional-finding"
  | "resolved-finding"
  | "uncertain-finding"
  | "forced-finding"
  | "non-replacement-classification"
  | "non-causal-finding"
  | "opponent-owned-finding"
  | "unsupported-cohort"
  | "unsupported-document";

export interface ReplacementLabActionability {
  readonly actionable: boolean;
  readonly code: ReplacementLabActionabilityCode;
  readonly message: string;
}

export interface ReplacementLabContext {
  readonly completed: StrategicFitCompletedResult;
  readonly report: StrategicFitAnalysisResult;
  readonly finding: StrategicFinding;
  readonly cohort_id: string;
  readonly request_snapshot: StrategicFitRequestSnapshot;
}

export interface ReplacementLabControls {
  readonly sources: readonly ReplacementCandidateSourceKind[];
  readonly engine_depth: number;
  readonly maximum_candidates: number;
  readonly maximum_subtree_nodes_per_candidate: number;
  readonly maximum_engine_positions: number;
  readonly maximum_explorer_queries: number;
  readonly engine_multipv: number;
  readonly strategic_horizon_ply: number;
  readonly minimum_reply_popularity: number;
  readonly include_all_forcing_replies: boolean;
}

export type ReplacementLabProgressPhase =
  | "validating"
  | "candidates"
  | "engine"
  | "expansion"
  | "scoring"
  | "safety"
  | "staging";

export interface ReplacementLabProgress {
  readonly phase: ReplacementLabProgressPhase;
  readonly completed: number;
  readonly total: number;
  readonly detail: string;
}

export interface ReplacementLabPreparedContext {
  readonly context: ReplacementLabContext;
  readonly actionability: ReplacementLabActionability;
  readonly request: ReplacementRequest | null;
  readonly pivot_result: ReplacementPivotSelectionResult | null;
}

export interface ReplacementLabGenerationResult {
  readonly request: ReplacementRequest;
  readonly pivot_result: ReplacementPivotSelectionResult;
  readonly candidate_generation: ReplacementCandidateGenerationResult;
  readonly engine_generation: ReplacementEngineCandidateGenerationResult;
  readonly expansion: Awaited<ReturnType<typeof expandReplacementCandidates>>;
  readonly scoring: ReplacementCandidateScoringResult;
  readonly safety: ReplacementSafetySimulationResult;
  readonly preview: Omit<ReplacementToolV2Result, "items"> & {
    readonly items: readonly (ReplacementToolV2Result["items"][number] & {
      readonly stage?: unknown;
    })[];
    readonly host?: Readonly<Record<string, unknown>>;
  };
}

export type ReplacementLabChangeReviewAction = "add-alternative" | "replace";

export interface ReplacementLabChangeReviewResult {
  readonly action: ReplacementLabChangeReviewAction;
  readonly safety: ReplacementSafetySimulationResult;
  readonly item: ReplacementToolV2Result["items"][number] & { readonly stage?: unknown };
}

export interface ReplacementLabApplicationBoundary {
  readonly dependencies: BrowserCommandDependencies;
  currentSnapshot(): StrategicFitRequestSnapshot;
  currentCompletedReport(): StrategicFitCompletedResult | null;
}

const versioned = () =>
  ({
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  }) as const;

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function sameSnapshot(
  left: StrategicFitRequestSnapshot,
  right: StrategicFitRequestSnapshot,
): boolean {
  return (
    left.document_id === right.document_id &&
    left.repertoire_revision === right.repertoire_revision &&
    left.repertoire_pgn === right.repertoire_pgn &&
    left.repertoire_color === right.repertoire_color &&
    left.profile_identity === right.profile_identity &&
    left.settings_identity === right.settings_identity
  );
}

function unavailable(
  code: Exclude<ReplacementLabActionabilityCode, "actionable">,
  message: string,
): ReplacementLabActionability {
  return { actionable: false, code, message };
}

export function replacementLabActionability(
  context: ReplacementLabContext,
  currentSnapshot: StrategicFitRequestSnapshot,
  currentCompleted: StrategicFitCompletedResult | null,
): ReplacementLabActionability {
  const { completed, report, finding } = context;
  if (currentCompleted?.report_id !== completed.report_id) {
    return unavailable(
      "stale-report",
      "This finding no longer belongs to the current completed report.",
    );
  }
  if (!sameSnapshot(context.request_snapshot, currentSnapshot)) {
    return unavailable(
      "stale-document",
      "Document, revision, profile, or analysis settings changed. Analyze again before opening Replacement Lab.",
    );
  }
  if (
    currentCompleted.result.repertoire_revision !== report.repertoire_revision ||
    currentCompleted.result.schema_version !== report.schema_version ||
    currentCompleted.result.analysis_version !== report.analysis_version ||
    finding.repertoire_revision !== report.repertoire_revision ||
    completed.result.report_id !== report.report_id
  )
    return unavailable(
      "stale-finding",
      "Finding, report, and repertoire identities no longer match.",
    );
  const currentFinding = currentCompleted.result.findings.find(
    (candidate) => candidate.finding_id === finding.finding_id,
  );
  if (
    currentFinding?.semantic_finding_id !== finding.semantic_finding_id ||
    currentFinding.repertoire_revision !== finding.repertoire_revision
  )
    return unavailable(
      "stale-finding",
      "Finding, report, and repertoire identities no longer match.",
    );
  if (finding.provisional) {
    return unavailable(
      "provisional-finding",
      "Provisional findings cannot propose repertoire changes.",
    );
  }
  if (finding.resolution_state !== "unresolved") {
    return unavailable(
      "resolved-finding",
      "Only an unresolved current finding can open Replacement Lab.",
    );
  }
  if (report.preflight.issues.some((issue) => issue.code === "unsupported-custom-start")) {
    return unavailable(
      "unsupported-document",
      "Replacement generation is unavailable for custom starting positions.",
    );
  }
  const cohort = report.cohorts.find((entry) => entry.cohort_id === finding.evidence.cohort_id);
  if (cohort?.state !== "actionable") {
    return unavailable(
      "unsupported-cohort",
      "This finding has no current actionable comparison cohort.",
    );
  }
  if (finding.classification === "uncertain" || finding.classification === "data-quality-issue") {
    return unavailable(
      "uncertain-finding",
      "Evidence is uncertain or incomplete, so no replacement is implied.",
    );
  }
  if (finding.classification === "forced-diversity") {
    return unavailable(
      "forced-finding",
      "This difference is forced; train or retain it instead of implying a replacement.",
    );
  }
  if (finding.evidence.causality.label === "mostly-opponent-forced") {
    return unavailable(
      "opponent-owned-finding",
      "Opponent-owned divergence cannot be replaced at a repertoire decision.",
    );
  }
  if (
    finding.evidence.causality.label === "unknown" ||
    finding.evidence.causality.controllability === null ||
    finding.evidence.causality.likely_causal_decision_ids.length === 0
  )
    return unavailable(
      "non-causal-finding",
      "No supported repertoire-owned causal decision is available.",
    );
  if (
    finding.classification !== "genuine-inconsistency" ||
    finding.replacement_priority.actionability <= 0
  ) {
    return unavailable(
      "non-replacement-classification",
      "This finding is informative, intentional, productive, mixed, or equivalent; it does not imply replacement.",
    );
  }
  return {
    actionable: true,
    code: "actionable",
    message: "Current finding supports replacement candidate generation.",
  };
}

function requestFor(
  context: ReplacementLabContext,
  controls: ReplacementLabControls,
  pivotDecisionId: string | null,
  attempt: number,
): ReplacementRequest {
  const { finding, report, request_snapshot: snapshot } = context;
  const budget: ReplacementGenerationBudget = {
    maximum_candidates: controls.maximum_candidates,
    maximum_subtree_nodes_per_candidate: controls.maximum_subtree_nodes_per_candidate,
    maximum_engine_positions: controls.maximum_engine_positions,
    maximum_explorer_queries: controls.maximum_explorer_queries,
    engine_depth: Math.max(1, Math.min(30, Math.round(controls.engine_depth))),
    engine_multipv: controls.engine_multipv,
    strategic_horizon_ply: controls.strategic_horizon_ply,
    minimum_reply_popularity: controls.minimum_reply_popularity,
    include_all_forcing_replies: controls.include_all_forcing_replies,
  };
  const identity = [
    snapshot.document_id,
    report.report_id,
    finding.finding_id,
    finding.semantic_finding_id,
    pivotDecisionId ?? "automatic",
    attempt,
    JSON.stringify(controls),
  ].join("\u001f");
  return {
    ...versioned(),
    request_id: `replacement-request:${stableHash(identity)}`,
    report_id: report.report_id,
    finding_id: finding.finding_id,
    semantic_finding_id: finding.semantic_finding_id,
    cohort_id: finding.evidence.cohort_id,
    repertoire_revision: report.repertoire_revision,
    repertoire_color: snapshot.repertoire_color,
    pivot_selection:
      pivotDecisionId === null
        ? { kind: "automatic", decision_id: null }
        : { kind: "user-selected", decision_id: pivotDecisionId },
    profile: report.profile,
    candidate_sources: [...new Set(controls.sources)].sort(),
    user_candidate_san_lines: [],
    maximum_repertoire_pov_loss_from_best_cp: report.profile.preferences.maximum_engine_loss_cp,
    minimum_expected_opponent_coverage: report.profile.preferences.minimum_opponent_coverage,
    budget,
    provenance: report.provenance.sources,
  };
}

export function prepareReplacementLab(
  context: ReplacementLabContext,
  boundary: ReplacementLabApplicationBoundary,
  controls: ReplacementLabControls,
): ReplacementLabPreparedContext {
  const actionability = replacementLabActionability(
    context,
    boundary.currentSnapshot(),
    boundary.currentCompletedReport(),
  );
  if (!actionability.actionable)
    return { context, actionability, request: null, pivot_result: null };
  const request = requestFor(context, controls, null, 0);
  const graph = buildRepertoireGraph(boundary.dependencies.currentTree(), request.repertoire_color);
  const cohort = context.report.cohorts.find((entry) => entry.cohort_id === context.cohort_id);
  if (cohort === undefined) throw new Error("replacement_lab_cohort_unavailable");
  const pivot = selectReplacementPivot({
    request,
    graph,
    finding: context.finding,
    cohort: pivotCohortEvidence(cohort, graph),
  });
  return { context, actionability, request, pivot_result: pivot };
}

const source = (
  id: string,
  kind: StrategicFitSourceProvenance["kind"],
  state: StrategicFitSourceProvenance["state"],
  snapshot: string,
  reason: string | null,
  sourceVersion = STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
): StrategicFitSourceProvenance => ({
  source_id: id,
  kind,
  state,
  version: sourceVersion,
  snapshot,
  reason,
});

function pivotCohortEvidence(
  cohort: StrategicFitAnalysisResult["cohorts"][number],
  graph: ReturnType<typeof buildRepertoireGraph>,
): ReplacementPivotCohortEvidence {
  const routes = new Set(cohort.route_ids);
  return {
    ...cohort,
    transposition_position_ids: [
      ...new Set(
        graph.transposition_links
          .filter((link) => link.route_ids.some((routeId) => routes.has(routeId)))
          .map((link) => link.position_id),
      ),
    ].sort(),
  };
}

function engineProvider(dependencies: BrowserCommandDependencies): ReplacementEngineProvider {
  const identity: ReplacementEngineIdentity = {
    engine_id: "browser-stockfish-18-lite-single",
    name: "Stockfish",
    version: "18",
    configuration_id: "browser-scan-worker-pool",
    configuration: { host: "browser", worker: true, white_pov_transport: true },
    analysis_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  };
  return {
    identity,
    async analyse(request, signal) {
      const lines = await dependencies.analyse(
        request.position.fen,
        request.multipv,
        request.depth,
        undefined,
        signal,
      );
      const reached = lines?.reduce((maximum, line) => Math.max(maximum, line.depth), 0) ?? null;
      const state =
        lines === null
          ? "unavailable"
          : reached !== null && reached < request.depth
            ? "partial"
            : "available";
      const evidenceSnapshot = `stockfish:${stableHash(
        JSON.stringify({
          engine: identity,
          position: request.position.position_key,
          depth: request.depth,
          multipv: request.multipv,
          lines,
        }),
      )}`;
      const provenance = [
        source(
          `replacement-engine:${request.position.position_id}`,
          "engine",
          state === "available" ? "available" : state === "partial" ? "partial" : "unavailable",
          evidenceSnapshot,
          lines === null ? "Browser Stockfish worker is unavailable." : null,
          identity.version,
        ),
      ];
      return {
        ...versioned(),
        evidence_id: `replacement-engine-evidence:${stableHash(`${request.request_id}\u001f${request.position.position_id}\u001f${request.depth}\u001f${request.multipv}`)}`,
        state,
        engine: identity,
        position: request.position,
        requested_depth: request.depth,
        requested_multipv: request.multipv,
        reached_depth: reached,
        lines: (lines ?? []).map((line, index) => ({
          line_id: `replacement-engine-line:${request.position.position_id}:${index + 1}`,
          multipv_rank: index + 1,
          uci: line.uci,
          pv: [...line.pv],
          white_pov_evaluation_cp: line.cp,
          white_pov_mate_in: line.mate,
          depth: line.depth,
          observations: {
            tactical_volatility: null,
            evaluation_sensitivity_cp: null,
            forcing_move_count: null,
            observed_move_count: null,
            king_safety_risk: null,
          },
          provenance,
        })),
        reason: lines === null ? "Browser Stockfish worker is unavailable." : null,
        provenance,
      } satisfies ReplacementEngineAnalysisEvidence;
    },
  };
}

function explorerProvider(
  dependencies: BrowserCommandDependencies,
): ReplacementExplorerExpansionProvider {
  return {
    provider: "lichess-opening-explorer",
    version: "live",
    snapshot: "live",
    async query(request, signal) {
      if (!dependencies.hasExplorerToken()) return null;
      const value = await dependencies.explorerPosition(
        request.position.fen,
        { db: "lichess", movesLimit: 30 },
        signal,
      );
      if (value === null) return null;
      const evidenceSnapshot = `lichess:${stableHash(
        JSON.stringify({
          position: request.position.position_key,
          moves: value.moves,
        }),
      )}`;
      const provenance = [
        source(
          `replacement-explorer:${request.position.position_id}`,
          "opening-explorer",
          "available",
          evidenceSnapshot,
          null,
          "live",
        ),
      ];
      return {
        ...versioned(),
        evidence_id: `replacement-explorer-evidence:${stableHash(`${request.request_id}\u001f${request.position.position_id}`)}`,
        state: "available",
        provider: "lichess-opening-explorer",
        provider_version: "live",
        snapshot: evidenceSnapshot,
        position: request.position,
        replies: value.moves.map((move, index) => ({
          move_id: `replacement-explorer-move:${request.position.position_id}:${index + 1}`,
          san: move.san,
          uci: move.uci,
          played_probability: move.played_pct / 100,
          games: move.games,
          pv: [],
          provenance,
        })),
        reason: null,
        provenance,
      };
    },
  };
}

async function openingDatabaseEvidence(
  request: ReplacementRequest,
  pivot: Extract<ReplacementPivotSelectionResult, { status: "selected" }>,
  graph: ReturnType<typeof buildRepertoireGraph>,
  dependencies: BrowserCommandDependencies,
  signal?: AbortSignal,
): Promise<ReplacementOpeningDatabaseEvidence[]> {
  if (!request.candidate_sources.includes("opening-database")) return [];
  const position = graph.positions.find((entry) => entry.position_id === pivot.pivot.position_id);
  if (position === undefined) return [];
  const requestedFilters = { db: "lichess" as const, movesLimit: 30 };
  const filters = normalizeExplorerFilters(requestedFilters);
  const hasToken = dependencies.hasExplorerToken();
  let value = null;
  if (hasToken) {
    try {
      value = await dependencies.explorerPosition(position.fen, requestedFilters, signal);
    } catch {
      throwIfAborted(signal);
    }
  }
  const state = !hasToken ? "missing" : value === null ? "offline" : "available";
  const reason = !hasToken
    ? "Lichess token is unavailable; local and engine candidates remain usable."
    : value === null
      ? "Opening explorer is offline; local and engine candidates remain usable."
      : null;
  const evidenceSnapshot =
    value === null
      ? "lichess:unavailable"
      : `lichess:${stableHash(JSON.stringify({ filters, moves: value.moves }))}`;
  const provenance = [
    source(
      `replacement-opening-database:${position.position_id}`,
      "opening-explorer",
      state === "available" ? "available" : "unavailable",
      evidenceSnapshot,
      reason,
      "live",
    ),
  ];
  return [
    {
      ...versioned(),
      evidence_id: `replacement-opening-database-evidence:${stableHash(`${request.request_id}\u001f${position.position_id}`)}`,
      state,
      database: "lichess",
      provider: "lichess-opening-explorer",
      version: "live",
      snapshot: evidenceSnapshot,
      filter_key: explorerFilterKey(requestedFilters),
      filters,
      position: {
        position_id: position.position_id,
        position_key: position.position_key,
        fen: position.fen,
      },
      moves: (value?.moves ?? []).map((move, index) => ({
        move_id: `replacement-opening-database-move:${position.position_id}:${index + 1}`,
        san: move.san,
        uci: move.uci,
        popularity: {
          games: move.games,
          played_pct: move.played_pct,
          white_pct: move.white_pct,
          draw_pct: move.draw_pct,
          black_pct: move.black_pct,
          average_rating: move.average_rating,
        },
        provenance,
      })),
      reason,
      provenance,
    },
  ];
}

function trajectoryContext(
  graph: ReturnType<typeof buildRepertoireGraph>,
  report: StrategicFitAnalysisResult,
): StrategicTrajectoryReport {
  const rebuilt = buildStrategicTrajectories(graph);
  const reportRouteIds = [...report.trajectories.map((item) => item.route_id)].sort();
  const graphRouteIds = [...graph.routes.map((item) => item.route_id)].sort();
  return reportRouteIds.length === graphRouteIds.length &&
    reportRouteIds.every((id, index) => id === graphRouteIds[index])
    ? { ...rebuilt, trajectories: report.trajectories, provenance: report.provenance.sources }
    : rebuilt;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

function emptyReplacementPreview(
  request: ReplacementRequest,
  safety: ReplacementSafetySimulationResult,
): ReplacementLabGenerationResult["preview"] {
  return {
    ...versioned(),
    contract: REPLACEMENT_TOOL_V2_CONTRACT,
    status: "complete",
    error_code: null,
    explanation: "No complete safe candidates were available to stage.",
    request_id: request.request_id,
    report_id: request.report_id,
    finding_id: request.finding_id,
    semantic_finding_id: request.semantic_finding_id,
    cohort_id: request.cohort_id,
    repertoire_revision: request.repertoire_revision,
    repertoire_color: request.repertoire_color,
    items: [],
    safety,
    source_tree_unchanged: true,
    inputs_unchanged: true,
    provenance: safety.provenance,
    host: {
      kind: "browser",
      preview_policy: "stage-only",
      acceptance_required: true,
      empty: true,
    },
  };
}

export async function runReplacementLabGeneration(
  prepared: ReplacementLabPreparedContext,
  controls: ReplacementLabControls,
  confirmedPivotDecisionId: string,
  attempt: number,
  boundary: ReplacementLabApplicationBoundary,
  options: BrowserCommandExecutionOptions & {
    readonly onLabProgress?: (progress: ReplacementLabProgress) => void;
  } = {},
): Promise<ReplacementLabGenerationResult> {
  const emit = (
    phase: ReplacementLabProgressPhase,
    completed: number,
    total: number,
    detail: string,
  ) => options.onLabProgress?.({ phase, completed, total, detail });
  emit("validating", 0, 7, "Revalidating report, finding, document, and semantic pivot identities");
  const currentActionability = replacementLabActionability(
    prepared.context,
    boundary.currentSnapshot(),
    boundary.currentCompletedReport(),
  );
  if (!currentActionability.actionable)
    throw Object.assign(new Error(currentActionability.message), {
      code: currentActionability.code,
    });
  throwIfAborted(options.signal);
  const automaticDecision =
    prepared.pivot_result?.status === "selected" ? prepared.pivot_result.pivot.decision_id : null;
  const useAutomatic = automaticDecision === confirmedPivotDecisionId;
  const request = requestFor(
    prepared.context,
    controls,
    useAutomatic ? null : confirmedPivotDecisionId,
    attempt,
  );
  const graph = buildRepertoireGraph(boundary.dependencies.currentTree(), request.repertoire_color);
  const cohort = prepared.context.report.cohorts.find(
    (entry) => entry.cohort_id === request.cohort_id,
  );
  if (cohort === undefined) throw new Error("replacement_lab_cohort_unavailable");
  const pivot = selectReplacementPivot({
    request,
    graph,
    finding: prepared.context.finding,
    cohort: pivotCohortEvidence(cohort, graph),
  });
  if (pivot.status !== "selected" || pivot.pivot.decision_id !== confirmedPivotDecisionId) {
    throw Object.assign(new Error("Confirmed semantic pivot is no longer current or selected."), {
      code: "stale-pivot",
    });
  }

  emit("candidates", 1, 7, "Generating local and opening-database candidate seeds");
  const databaseEvidence = await openingDatabaseEvidence(
    request,
    pivot,
    graph,
    boundary.dependencies,
    options.signal,
  );
  throwIfAborted(options.signal);
  const candidateGeneration = generateReplacementCandidates({
    request,
    graph,
    pivot_result: pivot,
    database_evidence: databaseEvidence,
  });

  emit(
    "engine",
    2,
    7,
    `Generating bounded engine candidates at depth ${request.budget.engine_depth}`,
  );
  const engineGeneration = await generateReplacementEngineCandidates({
    request,
    graph,
    pivot_result: pivot,
    candidate_generation: candidateGeneration,
    provider: request.candidate_sources.includes("engine-multipv")
      ? engineProvider(boundary.dependencies)
      : null,
    signal: options.signal,
  });
  throwIfAborted(options.signal);

  emit("expansion", 3, 7, "Expanding candidates into bounded coverage-aware subtrees");
  const expansion = await expandReplacementCandidates({
    request,
    graph,
    pivot_result: pivot,
    candidate_generation: candidateGeneration,
    engine_generation: engineGeneration,
    explorer_provider: request.candidate_sources.includes("opening-database")
      ? explorerProvider(boundary.dependencies)
      : null,
    engine_provider: request.candidate_sources.includes("engine-multipv")
      ? engineProvider(boundary.dependencies)
      : null,
    signal: options.signal,
    onProgress: (progress) =>
      options.onLabProgress?.({
        phase: "expansion",
        completed: progress.completed_units,
        total: Math.max(1, progress.total_units),
        detail: `Expanded ${progress.completed_candidates}/${progress.total_candidates} candidates; visited ${progress.visited_positions} positions`,
      }),
  });
  throwIfAborted(options.signal);

  emit("scoring", 4, 7, "Validating complete candidate trajectories without choosing a best line");
  const trajectories = trajectoryContext(graph, prepared.context.report);
  const concepts = buildStrategicConceptDictionary(trajectories);
  const scoring = scoreReplacementCandidates({
    request,
    graph,
    cohort,
    trajectories,
    concepts,
    metrics: prepared.context.report.summary.metrics,
    training: boundary.dependencies.currentStrategicFitTrainingEvidence?.() ?? null,
    popularity: null,
    expansion,
  });

  emit("safety", 5, 7, "Simulating add-alternative previews on a clone");
  const safety = simulateReplacementSafety({
    source_tree: boundary.dependencies.currentTree(),
    request,
    scoring,
  });
  throwIfAborted(options.signal);

  emit("staging", 6, 7, "Staging immutable previews; no repertoire edit is applied");
  const candidateIds = safety.candidates.map((candidate) => candidate.candidate_id);
  const preview =
    candidateIds.length === 0
      ? emptyReplacementPreview(request, safety)
      : ((await executeBrowserCommand(
          "suggest_replacement_line",
          {
            contract: REPLACEMENT_TOOL_V2_CONTRACT,
            replacement_request: request,
            finding: {
              report_id: request.report_id,
              finding_id: request.finding_id,
              semantic_finding_id: request.semantic_finding_id,
              cohort_id: request.cohort_id,
              repertoire_revision: request.repertoire_revision,
            },
            pivot: request.pivot_selection,
            profile: request.profile,
            sources: request.candidate_sources,
            budget: request.budget,
            engine: {
              depth: request.budget.engine_depth,
              multipv: request.budget.engine_multipv,
              allow_unavailable_evidence: true,
            },
            coverage: {
              minimum_expected_opponent_coverage: request.minimum_expected_opponent_coverage,
              require_all_forcing_replies: request.budget.include_all_forcing_replies,
            },
            retention: candidateIds.map((candidate_id) => ({
              candidate_id,
              action: "add-alternative",
            })),
            candidate_ids: candidateIds,
            safety,
          },
          { signal: options.signal },
          boundary.dependencies,
        )) as ReplacementLabGenerationResult["preview"]);
  throwIfAborted(options.signal);
  emit("staging", 7, 7, "Candidate preview staging finished");
  return {
    request,
    pivot_result: pivot,
    candidate_generation: candidateGeneration,
    engine_generation: engineGeneration,
    expansion,
    scoring,
    safety,
    preview,
  };
}

/**
 * Re-stage one selected candidate through canonical Phase 8 safety/change-set producers.
 * UI supplies only retention intent; no coverage, metric, safety, or diff value is recomputed here.
 */
export async function stageReplacementLabChangeReview(
  result: ReplacementLabGenerationResult,
  candidateId: string,
  action: ReplacementLabChangeReviewAction,
  boundary: ReplacementLabApplicationBoundary,
  options: BrowserCommandExecutionOptions = {},
): Promise<ReplacementLabChangeReviewResult> {
  throwIfAborted(options.signal);
  const current = boundary.currentSnapshot();
  if (
    `browser:${current.repertoire_revision}` !== result.request.repertoire_revision ||
    current.repertoire_color !== result.request.repertoire_color
  ) {
    throw Object.assign(
      new Error(
        "Replacement review evidence no longer belongs to current document revision or repertoire color.",
      ),
      {
        code: "stale-revision",
      },
    );
  }
  if (!result.scoring.candidates.some((candidate) => candidate.candidate_id === candidateId)) {
    throw Object.assign(new Error("Selected candidate is absent from retained scoring evidence."), {
      code: "candidate-not-found",
    });
  }
  const candidateActions: readonly ReplacementSafetyCandidateAction[] =
    action === "replace"
      ? [{ candidate_id: candidateId, action: "replace", prune_explicitly_confirmed: true }]
      : [];
  const safety = simulateReplacementSafety({
    source_tree: boundary.dependencies.currentTree(),
    request: result.request,
    scoring: result.scoring,
    candidate_actions: candidateActions,
  });
  throwIfAborted(options.signal);
  const preview = (await executeBrowserCommand(
    "suggest_replacement_line",
    {
      contract: REPLACEMENT_TOOL_V2_CONTRACT,
      replacement_request: result.request,
      finding: {
        report_id: result.request.report_id,
        finding_id: result.request.finding_id,
        semantic_finding_id: result.request.semantic_finding_id,
        cohort_id: result.request.cohort_id,
        repertoire_revision: result.request.repertoire_revision,
      },
      pivot: result.request.pivot_selection,
      profile: result.request.profile,
      sources: result.request.candidate_sources,
      budget: result.request.budget,
      engine: {
        depth: result.request.budget.engine_depth,
        multipv: result.request.budget.engine_multipv,
        allow_unavailable_evidence: true,
      },
      coverage: {
        minimum_expected_opponent_coverage: result.request.minimum_expected_opponent_coverage,
        require_all_forcing_replies: result.request.budget.include_all_forcing_replies,
      },
      retention:
        action === "replace"
          ? [{ candidate_id: candidateId, action: "replace", prune_explicitly_confirmed: true }]
          : [{ candidate_id: candidateId, action: "add-alternative" }],
      candidate_ids: [candidateId],
      safety,
    },
    options,
    boundary.dependencies,
  )) as ReplacementLabGenerationResult["preview"];
  throwIfAborted(options.signal);
  const item = preview.items.find((candidate) => candidate.candidate_id === candidateId);
  if (!item) {
    throw Object.assign(new Error("Canonical preview producer omitted selected candidate."), {
      code: preview.error_code ?? "preview-failed",
    });
  }
  return { action, safety, item };
}
