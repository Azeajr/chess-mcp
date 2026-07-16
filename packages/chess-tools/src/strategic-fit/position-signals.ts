/**
 * Deterministic king, piece-setup, space, and file observations for Strategic Fit.
 *
 * The extractor walks a complete semantic route rather than classifying isolated FENs. That is
 * necessary for historical evidence: a castled king may later move, a fianchetto bishop may be
 * exchanged, and queens may disappear before a later checkpoint. The output remains descriptive;
 * none of these observations makes an engine-quality or chess-value claim.
 */
import { parseFen } from "chessops/fen";
import type { Board } from "chessops/board";
import type { Color, Role } from "chessops/types";
import { makeSquare, parseSquare, squareFile, squareRank } from "chessops/util";

import { halfOpenFiles, openFiles } from "../structure.js";
import type { JsonValue, SignalPersistenceState, StrategicFitSourceProvenance, StrategicSignal } from "./types.js";
import type { RepertoireGraph, RepertoireGraphRoute } from "./graph.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
} from "./version.js";

export type StrategicFitRelativeSide = "repertoire" | "opponent";
export type StrategicFitBoardWing = "queenside" | "kingside";

export const STRATEGIC_POSITION_SIGNAL_FEATURES = [
  "king.castling-history",
  "piece.fianchetto-history",
  "piece.bishop-pair",
  "piece.recurring-placements",
  "piece.exchange-history",
  "piece.queen-retention",
  "space.pawn-advancement",
  "files.open-and-half-open",
  "space.wing-expansion",
  "space.color-complex-tendency",
] as const;
export type StrategicPositionSignalFeature = (typeof STRATEGIC_POSITION_SIGNAL_FEATURES)[number];

export interface StrategicPositionSignalObservation {
  readonly analysis_version: string;
  readonly observation_id: string;
  readonly route_id: string;
  readonly position_id: string;
  readonly ply: number;
  readonly signals: readonly StrategicSignal[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicRoutePositionSignals {
  readonly analysis_version: string;
  readonly route_id: string;
  readonly repertoire_color: Color;
  readonly observations: readonly StrategicPositionSignalObservation[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface HistoricalSideState {
  castling: { side: StrategicFitBoardWing; ply: number } | null;
  fianchetto: Map<StrategicFitBoardWing, number>;
  bishopPairLostAtPly: number | null;
  queenLostAtPly: number | null;
}

interface ExchangeObservation {
  readonly capturingSide: StrategicFitRelativeSide;
  readonly capturingRole: Role;
  readonly capturedSide: StrategicFitRelativeSide;
  readonly capturedRole: Role;
  count: number;
  firstPly: number;
  lastPly: number;
}

interface PlacementObservation {
  readonly side: StrategicFitRelativeSide;
  readonly role: Role;
  readonly square: string;
  readonly plies: number[];
}

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:position-signals",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components["position-signals"],
  snapshot: null,
  reason: null,
});

const PIECE_PLACEMENT_ROLES = new Set<Role>(["knight", "bishop", "rook", "queen"]);
const HOME_SQUARES = new Set([
  "white:knight:b1",
  "white:knight:g1",
  "white:bishop:c1",
  "white:bishop:f1",
  "white:rook:a1",
  "white:rook:h1",
  "white:queen:d1",
  "black:knight:b8",
  "black:knight:g8",
  "black:bishop:c8",
  "black:bishop:f8",
  "black:rook:a8",
  "black:rook:h8",
  "black:queen:d8",
]);
const PATH_SEPARATOR = "\u001f";

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function other(color: Color): Color {
  return color === "white" ? "black" : "white";
}

function relativeSide(color: Color, repertoireColor: Color): StrategicFitRelativeSide {
  return color === repertoireColor ? "repertoire" : "opponent";
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function repertoireProvenance(routeId: string): StrategicFitSourceProvenance {
  return {
    source_id: "repertoire",
    kind: "repertoire",
    state: "available",
    version: null,
    snapshot: routeId,
    reason: null,
  };
}

function signal(
  route: RepertoireGraphRoute,
  positionId: string,
  ply: number,
  featureId: StrategicPositionSignalFeature,
  value: JsonValue,
  confidence: number,
  persistence: SignalPersistenceState,
  provenance: readonly StrategicFitSourceProvenance[],
): StrategicSignal {
  const identity = [
    STRATEGIC_FIT_ANALYSIS_VERSION,
    route.route_id,
    positionId,
    String(ply),
    featureId,
  ].join(PATH_SEPARATOR);
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    signal_id: `position-signal:${stableHash(identity)}`,
    family: featureId.startsWith("space.") || featureId.startsWith("files.")
      ? "space-and-files"
      : "king-and-piece-setup",
    feature_id: featureId,
    kind: "observation",
    value,
    confidence,
    persistence,
    provenance,
  };
}

function requireRoute(graph: RepertoireGraph, routeOrId: RepertoireGraphRoute | string): RepertoireGraphRoute {
  const routeId = typeof routeOrId === "string" ? routeOrId : routeOrId.route_id;
  const route = graph.routes.find((candidate) => candidate.route_id === routeId);
  if (!route) throw new Error(`strategic_fit_position_signals_unknown_route: ${routeId}`);
  if (route.repertoire_color !== graph.repertoire_color) {
    throw new Error(`strategic_fit_position_signals_color_mismatch: ${routeId}`);
  }
  if (
    route.position_ids.length !== route.uci_moves.length + 1 ||
    route.san_moves.length !== route.uci_moves.length ||
    route.decision_ids.length !== route.uci_moves.length
  ) {
    throw new Error(`strategic_fit_position_signals_invalid_route: ${routeId}`);
  }
  return route;
}

function boardsForRoute(graph: RepertoireGraph, route: RepertoireGraphRoute): Board[] {
  const positions = new Map(graph.positions.map((position) => [position.position_id, position]));
  return route.position_ids.map((positionId) => {
    const position = positions.get(positionId);
    if (!position) {
      throw new Error(`strategic_fit_position_signals_missing_position: ${route.route_id} ${positionId}`);
    }
    try {
      return parseFen(position.fen).unwrap().board;
    } catch {
      throw new Error(`strategic_fit_position_signals_invalid_fen: ${route.route_id} ${positionId}`);
    }
  });
}

function emptySideState(): HistoricalSideState {
  return {
    castling: null,
    fianchetto: new Map(),
    bishopPairLostAtPly: null,
    queenLostAtPly: null,
  };
}

function fianchettoWing(color: Color, square: number): StrategicFitBoardWing | null {
  const name = makeSquare(square);
  if (color === "white") {
    if (name === "b2") return "queenside";
    if (name === "g2") return "kingside";
  } else {
    if (name === "b7") return "queenside";
    if (name === "g7") return "kingside";
  }
  return null;
}

function observeFianchettos(board: Board, ply: number, state: Record<Color, HistoricalSideState>): void {
  for (const color of ["white", "black"] as const) {
    for (const square of board.pieces(color, "bishop")) {
      const wing = fianchettoWing(color, square);
      if (wing && !state[color].fianchetto.has(wing)) state[color].fianchetto.set(wing, ply);
    }
  }
}

function observeCastling(
  before: Board,
  uci: string,
  ply: number,
  state: Record<Color, HistoricalSideState>,
): void {
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  if (from === undefined || to === undefined) {
    throw new Error(`strategic_fit_position_signals_invalid_uci: ${uci}`);
  }
  const mover = before.get(from);
  const destination = before.get(to);
  // chessops represents standard castling in UCI_Chess960 form (king to the friendly rook square).
  const rookTarget = destination?.color === mover?.color && destination?.role === "rook";
  if (!mover || mover.role !== "king" || (!rookTarget && Math.abs(squareFile(to) - squareFile(from)) !== 2)) return;
  if (!state[mover.color].castling) {
    state[mover.color].castling = {
      side: squareFile(to) < squareFile(from) ? "queenside" : "kingside",
      ply,
    };
  }
}

function observePieceLosses(
  before: Board,
  after: Board,
  ply: number,
  state: Record<Color, HistoricalSideState>,
): void {
  for (const color of ["white", "black"] as const) {
    if (
      state[color].bishopPairLostAtPly === null &&
      before.pieces(color, "bishop").size() >= 2 &&
      after.pieces(color, "bishop").size() < 2
    ) {
      state[color].bishopPairLostAtPly = ply;
    }
    if (
      state[color].queenLostAtPly === null &&
      before.pieces(color, "queen").nonEmpty() &&
      after.pieces(color, "queen").isEmpty()
    ) {
      state[color].queenLostAtPly = ply;
    }
  }
}

function observeExchange(
  before: Board,
  uci: string,
  ply: number,
  repertoireColor: Color,
  exchanges: Map<string, ExchangeObservation>,
): void {
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  if (from === undefined || to === undefined) {
    throw new Error(`strategic_fit_position_signals_invalid_uci: ${uci}`);
  }
  const mover = before.get(from);
  if (!mover) throw new Error(`strategic_fit_position_signals_missing_mover: ${uci}`);
  let captured = before.get(to);
  // A same-color rook on the king's destination is chessops' castling encoding, not a capture.
  if (mover.role === "king" && captured?.color === mover.color && captured.role === "rook") return;
  if (!captured && mover.role === "pawn" && squareFile(from) !== squareFile(to)) {
    captured = before.get(to + (mover.color === "white" ? -8 : 8));
  }
  if (!captured) return;

  const capturingSide = relativeSide(mover.color, repertoireColor);
  const capturedSide = relativeSide(captured.color, repertoireColor);
  const key = [capturingSide, mover.role, capturedSide, captured.role].join(PATH_SEPARATOR);
  const existing = exchanges.get(key);
  if (existing) {
    existing.count++;
    existing.lastPly = ply;
  } else {
    exchanges.set(key, {
      capturingSide,
      capturingRole: mover.role,
      capturedSide,
      capturedRole: captured.role,
      count: 1,
      firstPly: ply,
      lastPly: ply,
    });
  }
}

function observePlacements(
  board: Board,
  ply: number,
  repertoireColor: Color,
  placements: Map<string, PlacementObservation>,
): void {
  for (const [square, piece] of board) {
    if (!PIECE_PLACEMENT_ROLES.has(piece.role)) continue;
    const name = makeSquare(square);
    if (HOME_SQUARES.has(`${piece.color}:${piece.role}:${name}`)) continue;
    const side = relativeSide(piece.color, repertoireColor);
    const key = [side, piece.role, name].join(PATH_SEPARATOR);
    let placement = placements.get(key);
    if (!placement) {
      placement = { side, role: piece.role, square: name, plies: [] };
      placements.set(key, placement);
    }
    placement.plies.push(ply);
  }
}

function sideHistoryValue(state: HistoricalSideState): JsonValue {
  return {
    castled: state.castling !== null,
    side: state.castling?.side ?? null,
    at_ply: state.castling?.ply ?? null,
  };
}

function fianchettoHistoryValue(state: HistoricalSideState): JsonValue {
  return {
    wings: [...state.fianchetto.keys()].sort(),
    first_observed_ply: {
      queenside: state.fianchetto.get("queenside") ?? null,
      kingside: state.fianchetto.get("kingside") ?? null,
    },
  };
}

function relativePair<T extends JsonValue>(
  repertoireColor: Color,
  value: (color: Color) => T,
): { readonly repertoire: T; readonly opponent: T } {
  return {
    repertoire: value(repertoireColor),
    opponent: value(other(repertoireColor)),
  };
}

function recurringPlacementValue(placements: ReadonlyMap<string, PlacementObservation>): JsonValue {
  return {
    placements: [...placements.values()]
      .filter((placement) => placement.plies.length >= 2)
      .sort((left, right) =>
        left.side.localeCompare(right.side) ||
        left.role.localeCompare(right.role) ||
        left.square.localeCompare(right.square)
      )
      .map((placement) => ({
        side: placement.side,
        role: placement.role,
        square: placement.square,
        observation_count: placement.plies.length,
        first_ply: placement.plies[0]!,
        last_ply: placement.plies.at(-1)!,
      })),
  };
}

function exchangeValue(exchanges: ReadonlyMap<string, ExchangeObservation>): JsonValue {
  return {
    exchanges: [...exchanges.values()]
      .sort((left, right) =>
        left.firstPly - right.firstPly ||
        left.capturingSide.localeCompare(right.capturingSide) ||
        left.capturingRole.localeCompare(right.capturingRole) ||
        left.capturedRole.localeCompare(right.capturedRole)
      )
      .map((exchange) => ({
        capturing_side: exchange.capturingSide,
        capturing_role: exchange.capturingRole,
        captured_side: exchange.capturedSide,
        captured_role: exchange.capturedRole,
        count: exchange.count,
        first_ply: exchange.firstPly,
        last_ply: exchange.lastPly,
      })),
  };
}

function advancedPawnSquares(board: Board, color: Color): string[] {
  return [...board.pieces(color, "pawn")]
    .filter((square) => color === "white" ? squareRank(square) >= 3 : squareRank(square) <= 4)
    .map(makeSquare)
    .sort();
}

function spaceValue(board: Board, repertoireColor: Color): JsonValue {
  const pair = relativePair(repertoireColor, (color) => {
    const advancedPawns = advancedPawnSquares(board, color);
    return {
      advanced_pawns: advancedPawns,
      score: round(advancedPawns.length / 8),
    };
  });
  return {
    ...pair,
    balance: round(pair.repertoire.score - pair.opponent.score),
  };
}

function filesValue(board: Board, repertoireColor: Color): JsonValue {
  return {
    open: openFiles(board),
    half_open: relativePair(repertoireColor, (color) => halfOpenFiles(board, color)),
  };
}

function wingExpansionFor(board: Board, color: Color): JsonValue {
  const advanced = advancedPawnSquares(board, color);
  const queenside = advanced.filter((square) => squareFile(parseSquare(square)!) <= 2);
  const kingside = advanced.filter((square) => squareFile(parseSquare(square)!) >= 5);
  return {
    queenside,
    kingside,
    queenside_score: round(queenside.length / 3),
    kingside_score: round(kingside.length / 3),
  };
}

function colorComplexFor(board: Board, color: Color): JsonValue {
  let light = 0;
  let dark = 0;
  for (const square of board.pieces(color, "pawn")) {
    if ((squareFile(square) + squareRank(square)) % 2 === 0) dark++;
    else light++;
  }
  const sparserComplex = light === dark ? "balanced" : light < dark ? "light" : "dark";
  return {
    light_square_pawns: light,
    dark_square_pawns: dark,
    sparser_complex: sparserComplex,
    imbalance: Math.abs(light - dark),
  };
}

function observationSignals(
  route: RepertoireGraphRoute,
  board: Board,
  positionId: string,
  ply: number,
  state: Record<Color, HistoricalSideState>,
  placements: ReadonlyMap<string, PlacementObservation>,
  exchanges: ReadonlyMap<string, ExchangeObservation>,
  provenance: readonly StrategicFitSourceProvenance[],
): StrategicSignal[] {
  const color = route.repertoire_color;
  const castling = relativePair(color, (sideColorValue) => sideHistoryValue(state[sideColorValue]));
  const fianchetto = relativePair(color, (sideColorValue) => fianchettoHistoryValue(state[sideColorValue]));
  const bishopPair = relativePair(color, (sideColorValue) => ({
    bishop_count: board.pieces(sideColorValue, "bishop").size(),
    has_pair: board.pieces(sideColorValue, "bishop").size() >= 2,
    first_lost_ply: state[sideColorValue].bishopPairLostAtPly,
  }));
  const queen = relativePair(color, (sideColorValue) => ({
    status: board.pieces(sideColorValue, "queen").isEmpty() ? "exchanged" : "retained",
    first_lost_ply: state[sideColorValue].queenLostAtPly,
  }));
  const bothQueensGone = board.pieces("white", "queen").isEmpty() && board.pieces("black", "queen").isEmpty();
  const colorComplex = relativePair(color, (sideColorValue) => colorComplexFor(board, sideColorValue));
  const repertoireComplex = colorComplex.repertoire as { imbalance: number };
  const opponentComplex = colorComplex.opponent as { imbalance: number };
  const colorComplexConfidence = round(
    Math.min(0.95, 0.75 + Math.min(repertoireComplex.imbalance, opponentComplex.imbalance) * 0.05),
  );

  return [
    // Task 1.7 owns trajectory-level stability. Route history is retained here, but these raw
    // observations remain unknown until matched checkpoints apply the frozen persistence rules.
    signal(route, positionId, ply, "king.castling-history", castling, 1, "unknown", provenance),
    signal(route, positionId, ply, "piece.fianchetto-history", fianchetto, 0.95, "unknown", provenance),
    signal(route, positionId, ply, "piece.bishop-pair", bishopPair, 1, "unknown", provenance),
    signal(route, positionId, ply, "piece.recurring-placements", recurringPlacementValue(placements), 0.9, "unknown", provenance),
    signal(route, positionId, ply, "piece.exchange-history", exchangeValue(exchanges), 1, "unknown", provenance),
    signal(
      route,
      positionId,
      ply,
      "piece.queen-retention",
      { ...queen, mutual_exchange: bothQueensGone },
      1,
      "unknown",
      provenance,
    ),
    signal(route, positionId, ply, "space.pawn-advancement", spaceValue(board, color), 0.8, "unknown", provenance),
    signal(route, positionId, ply, "files.open-and-half-open", filesValue(board, color), 1, "unknown", provenance),
    signal(
      route,
      positionId,
      ply,
      "space.wing-expansion",
      relativePair(color, (sideColorValue) => wingExpansionFor(board, sideColorValue)),
      0.85,
      "unknown",
      provenance,
    ),
    signal(
      route,
      positionId,
      ply,
      "space.color-complex-tendency",
      colorComplex,
      colorComplexConfidence,
      "unknown",
      provenance,
    ),
  ];
}

/** Extract every route position so Task 1.7 can select matched checkpoints without replaying history. */
export function extractRoutePositionSignals(
  graph: RepertoireGraph,
  routeOrId: RepertoireGraphRoute | string,
): StrategicRoutePositionSignals {
  const route = requireRoute(graph, routeOrId);
  const boards = boardsForRoute(graph, route);
  const provenance = Object.freeze([CORE_PROVENANCE, repertoireProvenance(route.route_id)]);
  const state: Record<Color, HistoricalSideState> = {
    white: emptySideState(),
    black: emptySideState(),
  };
  const placements = new Map<string, PlacementObservation>();
  const exchanges = new Map<string, ExchangeObservation>();
  const observations: StrategicPositionSignalObservation[] = [];

  for (let ply = 0; ply < boards.length; ply++) {
    const board = boards[ply]!;
    if (ply > 0) {
      const before = boards[ply - 1]!;
      const uci = route.uci_moves[ply - 1]!;
      observeCastling(before, uci, ply, state);
      observeExchange(before, uci, ply, route.repertoire_color, exchanges);
      observePieceLosses(before, board, ply, state);
    }
    observeFianchettos(board, ply, state);
    observePlacements(board, ply, route.repertoire_color, placements);

    const positionId = route.position_ids[ply]!;
    const observationIdentity = [
      STRATEGIC_FIT_ANALYSIS_VERSION,
      route.route_id,
      positionId,
      String(ply),
    ].join(PATH_SEPARATOR);
    observations.push({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      observation_id: `position-observation:${stableHash(observationIdentity)}`,
      route_id: route.route_id,
      position_id: positionId,
      ply,
      signals: observationSignals(route, board, positionId, ply, state, placements, exchanges, provenance),
      provenance,
    });
  }

  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    route_id: route.route_id,
    repertoire_color: route.repertoire_color,
    observations,
    provenance,
  };
}
