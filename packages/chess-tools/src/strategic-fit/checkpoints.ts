/**
 * Deterministic Strategic Fit checkpoint selection.
 *
 * Checkpoints are selected on the transposition-aware graph, but remain route-scoped because a
 * semantic position can occur at different moments in different move orders. Strategic milestone
 * events are aligned to the first position after a repertoire move that contains the event; fixed
 * ply horizons use the last such position at or before the requested horizon. Arbitrary editorial
 * endpoints are retained for navigation and evidence, but are never treated as matched endpoints.
 */
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSquare, squareFile } from "chessops/util";

import type { OpeningTable } from "../openings.js";
import { centerState } from "../structure.js";
import type {
  CheckpointComparabilityState,
  StrategicCheckpoint,
  StrategicCheckpointKind,
} from "./types.js";
import type {
  RepertoireGraph,
  RepertoireGraphPosition,
  RepertoireGraphRoute,
} from "./graph.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION } from "./version.js";

export const DEFAULT_STRATEGIC_FIT_CHECKPOINT_PLIES = Object.freeze([12, 16, 20, 24] as const);
/** A profile may replace the defaults, but cannot create an unbounded number of snapshots. */
export const STRATEGIC_FIT_MAX_CONFIGURED_CHECKPOINTS = 16;

export interface StrategicCheckpointSelectionOptions {
  readonly openingTable?: OpeningTable | null;
  readonly configuredPlies?: readonly number[];
}

export interface MatchedStrategicCheckpoint {
  readonly analysis_version: string;
  readonly state: "selected";
  readonly checkpoint: StrategicCheckpoint;
  readonly route_id: string;
  readonly position_id: string;
  readonly move_order_id: string;
  readonly decision_id: string;
  /** Configured horizon, when this is a configured-ply checkpoint. */
  readonly requested_ply: number | null;
  /** Ply at which the semantic event happened; selection may follow on the player's next move. */
  readonly event_ply: number;
}

export interface MissingStrategicCheckpointSelection {
  readonly analysis_version: string;
  readonly state: "missing";
  readonly checkpoint_id: string;
  readonly route_id: string;
  readonly kind: StrategicCheckpointKind;
  readonly requested_ply: number | null;
  readonly comparability: Exclude<CheckpointComparabilityState, "comparable">;
  readonly reason: string;
}

export type StrategicCheckpointMilestone =
  | MatchedStrategicCheckpoint
  | MissingStrategicCheckpointSelection;

export interface StrategicRouteCheckpointSelection {
  readonly analysis_version: string;
  readonly route_id: string;
  /** Frozen milestone order: opening, center, transformation, configured horizons, final. */
  readonly milestones: readonly StrategicCheckpointMilestone[];
}

export interface StrategicCheckpointSelection {
  readonly analysis_version: string;
  readonly graph_id: string;
  readonly configured_plies: readonly number[];
  readonly routes: readonly StrategicRouteCheckpointSelection[];
}

interface RouteContext {
  readonly graph: RepertoireGraph;
  readonly route: RepertoireGraphRoute;
  readonly positions: ReadonlyMap<string, RepertoireGraphPosition>;
  readonly configuredPlies: readonly number[];
  readonly openingTable: OpeningTable | null;
}

interface EventObservation {
  readonly ply: number;
  readonly reason: string;
}

const ID_SEPARATOR = "\u001f";
const CENTRAL_FILES = new Set([3, 4]);

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function checkpointId(
  graphId: string,
  routeId: string,
  kind: StrategicCheckpointKind,
  requestedPly: number | null,
): string {
  const identity = [
    STRATEGIC_FIT_ANALYSIS_VERSION,
    graphId,
    routeId,
    kind,
    requestedPly === null ? "milestone" : String(requestedPly),
  ].join(ID_SEPARATOR);
  return `checkpoint:${stableHash(identity)}`;
}

function normalizeConfiguredPlies(configured: readonly number[] | undefined): number[] {
  const values = configured ?? DEFAULT_STRATEGIC_FIT_CHECKPOINT_PLIES;
  for (const ply of values) {
    if (!Number.isSafeInteger(ply) || ply < 1) {
      throw new Error(`strategic_fit_checkpoints_invalid_ply: ${String(ply)}`);
    }
  }
  const normalized = [...new Set(values)].sort((left, right) => left - right);
  if (normalized.length > STRATEGIC_FIT_MAX_CONFIGURED_CHECKPOINTS) {
    throw new Error(
      `strategic_fit_checkpoints_too_many_configured_plies: maximum ${STRATEGIC_FIT_MAX_CONFIGURED_CHECKPOINTS}`,
    );
  }
  return normalized;
}

function positionAfterRepertoireMove(ply: number, repertoireColor: "white" | "black"): boolean {
  return repertoireColor === "white" ? ply % 2 === 1 : ply % 2 === 0;
}

function firstPlayerCheckpointAtOrAfter(route: RepertoireGraphRoute, eventPly: number): number | null {
  for (let ply = Math.max(eventPly, 1); ply < route.position_ids.length; ply++) {
    if (positionAfterRepertoireMove(ply, route.repertoire_color)) return ply;
  }
  return null;
}

function configuredPlayerCheckpoint(route: RepertoireGraphRoute, requestedPly: number): number | null {
  const finalPly = route.position_ids.length - 1;
  if (finalPly < requestedPly) return null;
  for (let ply = requestedPly; ply >= 1; ply--) {
    if (positionAfterRepertoireMove(ply, route.repertoire_color)) return ply;
  }
  return null;
}

function selected(
  context: RouteContext,
  kind: StrategicCheckpointKind,
  selectedPly: number,
  eventPly: number,
  reason: string,
  comparability: CheckpointComparabilityState,
  requestedPly: number | null = null,
): MatchedStrategicCheckpoint {
  const { graph, route } = context;
  const positionId = route.position_ids[selectedPly];
  const moveOrderId = route.move_order_ids[selectedPly - 1];
  const decisionId = route.decision_ids[selectedPly - 1];
  if (!positionId || !moveOrderId || !decisionId) {
    throw new Error(`strategic_fit_checkpoints_invalid_route: ${route.route_id} at ply ${selectedPly}`);
  }
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    state: "selected",
    checkpoint: {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      checkpoint_id: checkpointId(graph.graph_id, route.route_id, kind, requestedPly),
      kind,
      ply: selectedPly,
      reason,
      comparability,
    },
    route_id: route.route_id,
    position_id: positionId,
    move_order_id: moveOrderId,
    decision_id: decisionId,
    requested_ply: requestedPly,
    event_ply: eventPly,
  };
}

function missing(
  context: RouteContext,
  kind: StrategicCheckpointKind,
  reason: string,
  comparability: "incomplete" | "not-comparable",
  requestedPly: number | null = null,
): MissingStrategicCheckpointSelection {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    state: "missing",
    checkpoint_id: checkpointId(context.graph.graph_id, context.route.route_id, kind, requestedPly),
    route_id: context.route.route_id,
    kind,
    requested_ply: requestedPly,
    comparability,
    reason,
  };
}

function chessAt(context: RouteContext, ply: number): Chess {
  const positionId = context.route.position_ids[ply];
  const fen = positionId ? context.positions.get(positionId)?.fen : undefined;
  if (!fen) {
    throw new Error(`strategic_fit_checkpoints_missing_position: ${context.route.route_id} at ply ${ply}`);
  }
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

function moveFacts(context: RouteContext, ply: number): {
  readonly movingPawn: boolean;
  readonly capturedPawn: boolean;
  readonly capture: boolean;
  readonly promotion: boolean;
  readonly centralPawnCapture: boolean;
  readonly beforeCenter: ReturnType<typeof centerState>;
  readonly afterCenter: ReturnType<typeof centerState>;
} {
  const before = chessAt(context, ply - 1);
  const after = chessAt(context, ply);
  const uci = context.route.uci_moves[ply - 1]!;
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  if (from === undefined || to === undefined) {
    throw new Error(`strategic_fit_checkpoints_invalid_uci: ${uci}`);
  }
  const movingPiece = before.board.get(from);
  const destinationPiece = before.board.get(to);
  const movingPawn = movingPiece?.role === "pawn";
  const enPassantCapture = movingPawn && squareFile(from) !== squareFile(to) && destinationPiece === undefined;
  const capture = destinationPiece !== undefined || enPassantCapture;
  const capturedPawn =
    destinationPiece?.role === "pawn" ||
    (enPassantCapture && before.board.get(to + (movingPiece!.color === "white" ? -8 : 8))?.role === "pawn");
  const centralPawnCapture =
    capture &&
    (movingPawn || capturedPawn) &&
    (CENTRAL_FILES.has(squareFile(from)) || CENTRAL_FILES.has(squareFile(to)));
  return {
    movingPawn,
    capturedPawn,
    capture,
    promotion: uci.length === 5,
    centralPawnCapture,
    beforeCenter: centerState(before.board),
    afterCenter: centerState(after.board),
  };
}

function firstCentralResolution(context: RouteContext): EventObservation | null {
  for (let ply = 1; ply < context.route.position_ids.length; ply++) {
    const facts = moveFacts(context, ply);
    const tensionResolved = facts.beforeCenter === "tense" && facts.afterCenter !== "tense";
    // A routine opening pawn advance (for example 1.d4 d5) is not itself a resolution. A locked
    // checkpoint is meaningful only after an observable central tension existed.
    const centerLocked = facts.beforeCenter === "tense" && facts.afterCenter === "locked";
    if (facts.centralPawnCapture || tensionResolved || centerLocked) {
      const san = context.route.san_moves[ply - 1]!;
      const cause = facts.centralPawnCapture
        ? "central pawn capture"
        : centerLocked
          ? "center became locked"
          : "central pawn tension resolved";
      return { ply, reason: `First central resolution: ${san} (${cause}).` };
    }
  }
  return null;
}

function firstIrreversibleTransformation(context: RouteContext): EventObservation | null {
  for (let ply = 1; ply < context.route.position_ids.length; ply++) {
    const facts = moveFacts(context, ply);
    const centerLocked = facts.beforeCenter === "tense" && facts.afterCenter === "locked";
    if ((facts.movingPawn && facts.capture) || facts.capturedPawn || facts.promotion || centerLocked) {
      const san = context.route.san_moves[ply - 1]!;
      return {
        ply,
        reason: `First irreversible pawn-topology transformation: ${san}.`,
      };
    }
  }
  return null;
}

function selectOpeningExit(context: RouteContext): StrategicCheckpointMilestone {
  if (!context.openingTable || context.openingTable.size === 0) {
    return missing(
      context,
      "opening-exit",
      "Opening-exit checkpoint is not comparable because opening-classification data is unavailable.",
      "not-comparable",
    );
  }

  let deepestHit = -1;
  for (let ply = 0; ply < context.route.position_ids.length; ply++) {
    const position = context.positions.get(context.route.position_ids[ply]!);
    if (position && context.openingTable.has(position.position_key)) deepestHit = ply;
  }
  if (deepestHit < 0) {
    return missing(
      context,
      "opening-exit",
      "Opening-exit checkpoint is not comparable because this route has no opening-table hit.",
      "not-comparable",
    );
  }

  const exitPly = deepestHit + 1;
  const selectedPly = firstPlayerCheckpointAtOrAfter(context.route, exitPly);
  if (selectedPly === null) {
    return missing(
      context,
      "opening-exit",
      `Route ends at ply ${context.route.position_ids.length - 1} before a player checkpoint beyond the deepest opening hit at ply ${deepestHit}.`,
      "incomplete",
    );
  }
  return selected(
    context,
    "opening-exit",
    selectedPly,
    exitPly,
    `First player checkpoint after the deepest opening-table hit at ply ${deepestHit}.`,
    "comparable",
  );
}

function selectEvent(
  context: RouteContext,
  kind: "central-resolution" | "irreversible-transformation",
  event: EventObservation | null,
): StrategicCheckpointMilestone {
  if (!event) {
    return missing(
      context,
      kind,
      `Route ends at ply ${context.route.position_ids.length - 1} without reaching ${kind === "central-resolution" ? "a central resolution" : "an irreversible structural transformation"}.`,
      "incomplete",
    );
  }
  const selectedPly = firstPlayerCheckpointAtOrAfter(context.route, event.ply);
  if (selectedPly === null) {
    return missing(
      context,
      kind,
      `${event.reason} The route ends before the repertoire player's next checkpoint.`,
      "incomplete",
    );
  }
  return selected(context, kind, selectedPly, event.ply, event.reason, "comparable");
}

function selectConfiguredPly(context: RouteContext, requestedPly: number): StrategicCheckpointMilestone {
  const selectedPly = configuredPlayerCheckpoint(context.route, requestedPly);
  if (selectedPly === null) {
    return missing(
      context,
      "configured-ply",
      `Route ends at ply ${context.route.position_ids.length - 1} before configured horizon ${requestedPly}.`,
      "incomplete",
      requestedPly,
    );
  }
  return selected(
    context,
    "configured-ply",
    selectedPly,
    requestedPly,
    selectedPly === requestedPly
      ? `Configured comparison horizon at ply ${requestedPly}.`
      : `Player checkpoint at ply ${selectedPly} within configured horizon ${requestedPly}.`,
    "comparable",
    requestedPly,
  );
}

function selectFinalPosition(context: RouteContext): MatchedStrategicCheckpoint {
  const finalPly = context.route.position_ids.length - 1;
  const finalPosition = chessAt(context, finalPly);
  const terminal = finalPosition.isEnd();
  return selected(
    context,
    "final-valid-position",
    finalPly,
    finalPly,
    terminal
      ? `Final legal route position at ply ${finalPly}; the game is terminal and this endpoint is not a matched milestone.`
      : `Final legal route position at ply ${finalPly}; editorial endpoints are not matched milestones.`,
    "not-comparable",
  );
}

function selectForRoute(context: RouteContext): StrategicRouteCheckpointSelection {
  const milestones: StrategicCheckpointMilestone[] = [
    selectOpeningExit(context),
    selectEvent(context, "central-resolution", firstCentralResolution(context)),
    selectEvent(context, "irreversible-transformation", firstIrreversibleTransformation(context)),
    ...context.configuredPlies.map((ply) => selectConfiguredPly(context, ply)),
    selectFinalPosition(context),
  ];
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    route_id: context.route.route_id,
    milestones,
  };
}

/** Select bounded, engine-free strategic milestones for every canonical repertoire route. */
export function selectStrategicCheckpoints(
  graph: RepertoireGraph,
  options: StrategicCheckpointSelectionOptions = {},
): StrategicCheckpointSelection {
  const configuredPlies = normalizeConfiguredPlies(options.configuredPlies);
  const positions = new Map(graph.positions.map((position) => [position.position_id, position]));
  const openingTable = options.openingTable ?? null;
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    graph_id: graph.graph_id,
    configured_plies: configuredPlies,
    routes: graph.routes.map((route) =>
      selectForRoute({ graph, route, positions, configuredPlies, openingTable }),
    ),
  };
}
