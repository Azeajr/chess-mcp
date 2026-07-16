/**
 * Deterministic, transposition-aware repertoire graph for Strategic Fit.
 *
 * The source GameTree remains an editorial navigation tree. This projection keeps its SAN paths
 * while merging positions and decisions by chess semantics so later analysis is not biased by
 * variation ordering, duplicate branches, or move-order transpositions.
 */
import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";

import { positionKey, type Color } from "../congruence.js";
import type { GameTree } from "../pgn.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION } from "./version.js";

export type RepertoireMoveOwner = "repertoire" | "opponent";

export interface RepertoireGraphPosition {
  readonly analysis_version: string;
  readonly position_id: string;
  /** Four-field FEN key: placement, turn, castling rights, and en-passant square. */
  readonly position_key: string;
  /** Deterministically selected legal source FEN. IDs never depend on its clock fields. */
  readonly fen: string;
  readonly turn: Color;
  readonly source_san_paths: readonly (readonly string[])[];
  readonly incoming_move_order_ids: readonly string[];
  readonly incoming_decision_ids: readonly string[];
  readonly outgoing_decision_ids: readonly string[];
  readonly route_ids: readonly string[];
}

export interface RepertoireGraphDecision {
  readonly analysis_version: string;
  readonly decision_id: string;
  readonly from_position_id: string;
  readonly to_position_id: string;
  readonly san: string;
  readonly uci: string;
  readonly mover_color: Color;
  readonly owner: RepertoireMoveOwner;
  /** A semantic edge may occur at several depths after move-order convergence. */
  readonly plies: readonly number[];
  readonly source_san_paths: readonly (readonly string[])[];
  readonly route_ids: readonly string[];
}

export interface RepertoireGraphMoveOrder {
  readonly analysis_version: string;
  readonly move_order_id: string;
  readonly position_id: string;
  readonly ply: number;
  readonly san_moves: readonly string[];
  readonly uci_moves: readonly string[];
  readonly decision_ids: readonly string[];
  readonly source_san_paths: readonly (readonly string[])[];
  readonly route_ids: readonly string[];
}

export interface RepertoireGraphRoute {
  readonly analysis_version: string;
  readonly route_id: string;
  readonly repertoire_color: Color;
  readonly san_moves: readonly string[];
  readonly uci_moves: readonly string[];
  /** Includes the initial position followed by every position reached on the route. */
  readonly position_ids: readonly string[];
  readonly decision_ids: readonly string[];
  readonly move_order_ids: readonly string[];
  readonly terminal_position_id: string;
  /** Exact source paths are retained even when duplicate routes share one semantic ID. */
  readonly source_san_paths: readonly (readonly string[])[];
  readonly source_route_count: number;
}

export interface RepertoireGraphTranspositionLink {
  readonly analysis_version: string;
  readonly transposition_id: string;
  readonly position_id: string;
  readonly incoming_move_order_ids: readonly string[];
  readonly incoming_decision_ids: readonly string[];
  readonly route_ids: readonly string[];
  readonly source_san_paths: readonly (readonly string[])[];
}

export interface RepertoireGraph {
  readonly analysis_version: string;
  readonly graph_id: string;
  readonly repertoire_color: Color;
  readonly root_position_id: string;
  readonly positions: readonly RepertoireGraphPosition[];
  readonly decisions: readonly RepertoireGraphDecision[];
  readonly move_orders: readonly RepertoireGraphMoveOrder[];
  readonly routes: readonly RepertoireGraphRoute[];
  readonly transposition_links: readonly RepertoireGraphTranspositionLink[];
  /** Leaf occurrences in the editorial tree, before semantic duplicate-route collapse. */
  readonly source_route_count: number;
}

interface PositionAccumulator {
  readonly positionId: string;
  readonly positionKey: string;
  readonly fens: string[];
  readonly turn: Color;
  readonly sourceSanPaths: string[][];
  readonly incomingMoveOrderIds: Set<string>;
  readonly incomingDecisionIds: Set<string>;
  readonly outgoingDecisionIds: Set<string>;
  readonly routeIds: Set<string>;
}

interface DecisionAccumulator {
  readonly decisionId: string;
  readonly fromPositionId: string;
  readonly toPositionId: string;
  readonly san: string;
  readonly uci: string;
  readonly moverColor: Color;
  readonly owner: RepertoireMoveOwner;
  readonly plies: Set<number>;
  readonly sourceSanPaths: string[][];
  readonly routeIds: Set<string>;
}

interface MoveOrderAccumulator {
  readonly moveOrderId: string;
  readonly positionId: string;
  readonly ply: number;
  readonly sanMoves: readonly string[];
  readonly uciMoves: readonly string[];
  readonly decisionIds: readonly string[];
  readonly sourceSanPaths: string[][];
  readonly routeIds: Set<string>;
}

interface RouteAccumulator {
  readonly routeId: string;
  readonly sanMoves: readonly string[];
  readonly uciMoves: readonly string[];
  readonly positionIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly moveOrderIds: readonly string[];
  readonly sourceSanPaths: string[][];
}

const PATH_SEPARATOR = "\u001f";

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function semanticId(kind: string, value: string): string {
  return `${kind}:${stableHash(value)}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePaths(left: readonly string[], right: readonly string[]): number {
  const byValue = compareStrings(left.join(PATH_SEPARATOR), right.join(PATH_SEPARATOR));
  return byValue || left.length - right.length;
}

function sortedPaths(paths: readonly (readonly string[])[]): string[][] {
  return paths.map((path) => [...path]).sort(comparePaths);
}

function sortedValues(values: ReadonlySet<string>): string[] {
  return [...values].sort(compareStrings);
}

function requireStandardStart(tree: GameTree): void {
  const fen = tree.game.headers.get("FEN");
  if (fen === undefined) return;

  let standard = false;
  try {
    standard = makeFen(parseFen(fen).unwrap()) === INITIAL_FEN;
  } catch {
    // Invalid setup data is rejected with the same graph-boundary error as a custom setup.
  }
  if (!standard) {
    throw new Error("strategic_fit_graph_unsupported_start: expected the standard initial position");
  }
}

/**
 * Project a legal standard-start GameTree into the canonical Strategic Fit graph.
 *
 * This function is read-only: it clones positions while replaying moves and never writes to tree
 * nodes, headers, annotations, or child arrays.
 */
export function buildRepertoireGraph(tree: GameTree, repertoireColor: Color): RepertoireGraph {
  requireStandardStart(tree);

  const positions = new Map<string, PositionAccumulator>();
  const decisions = new Map<string, DecisionAccumulator>();
  const moveOrders = new Map<string, MoveOrderAccumulator>();
  const routes = new Map<string, RouteAccumulator>();
  let sourceRouteCount = 0;

  const ensurePosition = (position: Chess, sourceSanPath: readonly string[]): PositionAccumulator => {
    const fen = makeFen(position.toSetup());
    const key = positionKey(fen);
    const positionId = semanticId("position", key);
    let accumulator = positions.get(positionId);
    if (!accumulator) {
      accumulator = {
        positionId,
        positionKey: key,
        fens: [],
        turn: position.turn,
        sourceSanPaths: [],
        incomingMoveOrderIds: new Set(),
        incomingDecisionIds: new Set(),
        outgoingDecisionIds: new Set(),
        routeIds: new Set(),
      };
      positions.set(positionId, accumulator);
    } else if (accumulator.positionKey !== key) {
      throw new Error(`strategic_fit_graph_id_collision: ${positionId}`);
    }
    accumulator.fens.push(fen);
    accumulator.sourceSanPaths.push([...sourceSanPath]);
    return accumulator;
  };

  const rootPosition = Chess.default();
  const root = ensurePosition(rootPosition, []);
  const ancestors = new Set<object>();

  const visit = (
    node: object,
    position: Chess,
    sourceSans: readonly string[],
    canonicalSans: readonly string[],
    ucis: readonly string[],
    positionIds: readonly string[],
    decisionIds: readonly string[],
    moveOrderIds: readonly string[],
  ): void => {
    if (ancestors.has(node)) throw new Error("strategic_fit_graph_invalid_tree: cycle detected");
    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children)) throw new Error("strategic_fit_graph_invalid_tree: malformed children");

    if (children.length === 0 && sourceSans.length > 0) {
      sourceRouteCount++;
      const routeKey = ucis.join(PATH_SEPARATOR);
      const routeId = semanticId("route", routeKey);
      const existing = routes.get(routeId);
      if (existing) {
        if (existing.uciMoves.join(PATH_SEPARATOR) !== routeKey) {
          throw new Error(`strategic_fit_graph_id_collision: ${routeId}`);
        }
        existing.sourceSanPaths.push([...sourceSans]);
      } else {
        routes.set(routeId, {
          routeId,
          sanMoves: [...canonicalSans],
          uciMoves: [...ucis],
          positionIds: [...positionIds],
          decisionIds: [...decisionIds],
          moveOrderIds: [...moveOrderIds],
          sourceSanPaths: [[...sourceSans]],
        });
      }
      return;
    }

    ancestors.add(node);
    for (const child of children) {
      if (!child || typeof child !== "object") {
        throw new Error("strategic_fit_graph_invalid_tree: malformed child");
      }
      const data = (child as { data?: unknown }).data;
      const sourceSan = data && typeof data === "object" ? (data as { san?: unknown }).san : undefined;
      if (typeof sourceSan !== "string" || sourceSan.length === 0) {
        throw new Error("strategic_fit_graph_invalid_tree: missing SAN move");
      }

      const move = parseSan(position, sourceSan);
      if (!move) {
        throw new Error(`strategic_fit_graph_illegal_san: ${[...sourceSans, sourceSan].join(" ")}`);
      }
      const canonicalSan = makeSan(position, move);
      const uci = makeUci(move);
      const next = position.clone();
      next.play(move);

      const nextSourceSans = [...sourceSans, sourceSan];
      const nextCanonicalSans = [...canonicalSans, canonicalSan];
      const nextUcis = [...ucis, uci];
      const fromPositionId = positionIds.at(-1)!;
      const nextPosition = ensurePosition(next, nextSourceSans);
      const decisionKey = [fromPositionId, uci, nextPosition.positionId].join(PATH_SEPARATOR);
      const decisionId = semanticId("decision", decisionKey);
      let decision = decisions.get(decisionId);
      if (!decision) {
        decision = {
          decisionId,
          fromPositionId,
          toPositionId: nextPosition.positionId,
          san: canonicalSan,
          uci,
          moverColor: position.turn,
          owner: position.turn === repertoireColor ? "repertoire" : "opponent",
          plies: new Set(),
          sourceSanPaths: [],
          routeIds: new Set(),
        };
        decisions.set(decisionId, decision);
      } else if (
        decision.fromPositionId !== fromPositionId ||
        decision.toPositionId !== nextPosition.positionId ||
        decision.uci !== uci
      ) {
        throw new Error(`strategic_fit_graph_id_collision: ${decisionId}`);
      }
      decision.plies.add(nextUcis.length);
      decision.sourceSanPaths.push(nextSourceSans);
      positions.get(fromPositionId)!.outgoingDecisionIds.add(decisionId);
      nextPosition.incomingDecisionIds.add(decisionId);

      const nextDecisionIds = [...decisionIds, decisionId];
      const moveOrderKey = nextUcis.join(PATH_SEPARATOR);
      const moveOrderId = semanticId("move-order", moveOrderKey);
      let moveOrder = moveOrders.get(moveOrderId);
      if (!moveOrder) {
        moveOrder = {
          moveOrderId,
          positionId: nextPosition.positionId,
          ply: nextUcis.length,
          sanMoves: nextCanonicalSans,
          uciMoves: nextUcis,
          decisionIds: nextDecisionIds,
          sourceSanPaths: [],
          routeIds: new Set(),
        };
        moveOrders.set(moveOrderId, moveOrder);
      } else if (
        moveOrder.positionId !== nextPosition.positionId ||
        moveOrder.uciMoves.join(PATH_SEPARATOR) !== moveOrderKey
      ) {
        throw new Error(`strategic_fit_graph_id_collision: ${moveOrderId}`);
      }
      moveOrder.sourceSanPaths.push(nextSourceSans);
      nextPosition.incomingMoveOrderIds.add(moveOrderId);

      visit(
        child,
        next,
        nextSourceSans,
        nextCanonicalSans,
        nextUcis,
        [...positionIds, nextPosition.positionId],
        nextDecisionIds,
        [...moveOrderIds, moveOrderId],
      );
    }
    ancestors.delete(node);
  };

  visit(tree.game.moves, rootPosition, [], [], [], [root.positionId], [], []);

  for (const route of routes.values()) {
    for (const positionId of route.positionIds) positions.get(positionId)!.routeIds.add(route.routeId);
    for (const decisionId of route.decisionIds) decisions.get(decisionId)!.routeIds.add(route.routeId);
    for (const moveOrderId of route.moveOrderIds) moveOrders.get(moveOrderId)!.routeIds.add(route.routeId);
  }

  const graphPositions: RepertoireGraphPosition[] = [...positions.values()]
    .map((position) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      position_id: position.positionId,
      position_key: position.positionKey,
      fen: [...position.fens].sort(compareStrings)[0]!,
      turn: position.turn,
      source_san_paths: sortedPaths(position.sourceSanPaths),
      incoming_move_order_ids: sortedValues(position.incomingMoveOrderIds),
      incoming_decision_ids: sortedValues(position.incomingDecisionIds),
      outgoing_decision_ids: sortedValues(position.outgoingDecisionIds),
      route_ids: sortedValues(position.routeIds),
    }))
    .sort((left, right) => compareStrings(left.position_id, right.position_id));

  const graphDecisions: RepertoireGraphDecision[] = [...decisions.values()]
    .map((decision) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      decision_id: decision.decisionId,
      from_position_id: decision.fromPositionId,
      to_position_id: decision.toPositionId,
      san: decision.san,
      uci: decision.uci,
      mover_color: decision.moverColor,
      owner: decision.owner,
      plies: [...decision.plies].sort((left, right) => left - right),
      source_san_paths: sortedPaths(decision.sourceSanPaths),
      route_ids: sortedValues(decision.routeIds),
    }))
    .sort((left, right) => compareStrings(left.decision_id, right.decision_id));

  const graphMoveOrders: RepertoireGraphMoveOrder[] = [...moveOrders.values()]
    .map((moveOrder) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      move_order_id: moveOrder.moveOrderId,
      position_id: moveOrder.positionId,
      ply: moveOrder.ply,
      san_moves: [...moveOrder.sanMoves],
      uci_moves: [...moveOrder.uciMoves],
      decision_ids: [...moveOrder.decisionIds],
      source_san_paths: sortedPaths(moveOrder.sourceSanPaths),
      route_ids: sortedValues(moveOrder.routeIds),
    }))
    .sort((left, right) => compareStrings(left.move_order_id, right.move_order_id));

  const graphRoutes: RepertoireGraphRoute[] = [...routes.values()]
    .map((route) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      route_id: route.routeId,
      repertoire_color: repertoireColor,
      san_moves: [...route.sanMoves],
      uci_moves: [...route.uciMoves],
      position_ids: [...route.positionIds],
      decision_ids: [...route.decisionIds],
      move_order_ids: [...route.moveOrderIds],
      terminal_position_id: route.positionIds.at(-1)!,
      source_san_paths: sortedPaths(route.sourceSanPaths),
      source_route_count: route.sourceSanPaths.length,
    }))
    .sort((left, right) => compareStrings(left.route_id, right.route_id));

  const transpositionLinks: RepertoireGraphTranspositionLink[] = graphPositions
    .filter((position) => position.incoming_move_order_ids.length > 1)
    .map((position) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      transposition_id: semanticId(
        "transposition",
        [position.position_id, ...position.incoming_move_order_ids].join(PATH_SEPARATOR),
      ),
      position_id: position.position_id,
      incoming_move_order_ids: [...position.incoming_move_order_ids],
      incoming_decision_ids: [...position.incoming_decision_ids],
      route_ids: [...position.route_ids],
      source_san_paths: position.source_san_paths.map((path) => [...path]),
    }))
    .sort((left, right) => compareStrings(left.transposition_id, right.transposition_id));

  const graphIdentity = [
    STRATEGIC_FIT_ANALYSIS_VERSION,
    repertoireColor,
    ...graphRoutes.map((route) => route.route_id),
  ].join(PATH_SEPARATOR);

  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    graph_id: semanticId("repertoire-graph", graphIdentity),
    repertoire_color: repertoireColor,
    root_position_id: root.positionId,
    positions: graphPositions,
    decisions: graphDecisions,
    move_orders: graphMoveOrders,
    routes: graphRoutes,
    transposition_links: transpositionLinks,
    source_route_count: sourceRouteCount,
  };
}
