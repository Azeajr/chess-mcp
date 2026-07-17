/**
 * Provisional engine-free causal ownership for Strategic Fit differences.
 *
 * Causality starts with the stable feature differences already accepted by the distance stage.
 * For each feature, this module walks backward through deterministic route observations until the
 * continuous difference begins, then assigns that move using semantic graph ownership. This is
 * deliberately conservative: unsupported concepts, missing raw evidence, and interacting moves
 * increase uncertainty instead of manufacturing a player-controlled pivot.
 */
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSquare, squareFile } from "chessops/util";

import type {
  StrategicDistanceFeatureContribution,
  StrategicDistanceReport,
  StrategicRouteModeDistance,
  StrategicTrajectoryDistance,
} from "./distance.js";
import type {
  RepertoireGraph,
  RepertoireGraphDecision,
  RepertoireGraphRoute,
} from "./graph.js";
import { extractPawnSignalsFromFen } from "./pawn-signals.js";
import { extractRoutePositionSignals } from "./position-signals.js";
import type {
  CausalAttribution,
  CausalControlLabel,
  CausalEvent,
  CausalEventKind,
  JsonValue,
  StrategicCheckpointKind,
  StrategicFitSourceProvenance,
  StrategicSignal,
  StrategicSignalFamily,
  StrategicSnapshot,
  StrategicTrajectory,
} from "./types.js";
import type { StrategicTrajectoryReport } from "./trajectory.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";

export const STRATEGIC_CAUSALITY_VERSION = STRATEGIC_FIT_ANALYSIS_MANIFEST.components.causality;

export interface StrategicCausalComparison {
  readonly cohort_id: string;
  readonly mode_id: string;
  readonly affected_route_id: string;
  readonly representative_route_id: string;
  readonly distance: number | null;
  readonly attribution: CausalAttribution;
}

export interface StrategicCausalityReport {
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly causality_version: string;
  readonly graph_id: string;
  readonly distance_version: string;
  readonly comparisons: readonly StrategicCausalComparison[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface RouteRawEvidence {
  readonly route: RepertoireGraphRoute;
  readonly signalsByPly: readonly ReadonlyMap<string, StrategicSignal>[];
}

interface SharedPosition {
  readonly positionId: string;
  readonly affectedPly: number;
  readonly baselinePly: number;
}

interface StableFeatureDifference {
  readonly family: StrategicSignalFamily;
  readonly featureId: string;
  readonly slot: string;
  readonly affectedSnapshot: StrategicSnapshot;
  readonly baselineSnapshot: StrategicSnapshot;
  readonly weight: number;
}

interface LocatedFeatureDifference extends StableFeatureDifference {
  readonly onsetPly: number | null;
  readonly decision: RepertoireGraphDecision | null;
}

interface CausalityContext {
  readonly graph: RepertoireGraph;
  readonly routes: ReadonlyMap<string, RepertoireGraphRoute>;
  readonly decisions: ReadonlyMap<string, RepertoireGraphDecision>;
  readonly rawEvidence: ReadonlyMap<string, RouteRawEvidence>;
}

const ID_SEPARATOR = "\u001f";
const EPSILON = 1e-12;
const CHECKPOINT_ORDER: Readonly<Record<Exclude<StrategicCheckpointKind, "final-valid-position">, number>> =
  Object.freeze({
    "opening-exit": 0,
    "central-resolution": 1,
    "irreversible-transformation": 2,
    "configured-ply": 3,
  });
const EVENT_ORDER: Readonly<Record<CausalEventKind, number>> = Object.freeze({
  "opponent-divergence": 0,
  "player-decision": 1,
  "irreversible-event": 2,
  "first-strategic-difference": 3,
  "difference-stable": 4,
  transposition: 5,
});
const TIMING_AND_TRANSPORT_KEYS = new Set([
  "analysis_version",
  "at_ply",
  "color",
  "confidence",
  "first_lost_ply",
  "first_observed_ply",
  "first_ply",
  "last_ply",
  "observation_count",
]);

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:causality",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_CAUSALITY_VERSION,
  snapshot: null,
  reason: null,
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function isObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !TIMING_AND_TRANSPORT_KEYS.has(key))
      .sort(compareStrings)
      .map((key) => [key, canonicalValue(value[key]!)]),
  );
}

function stableSerialize(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort(compareStrings).map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key]!)}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signalSlot(signal: StrategicSignal): string {
  const subject = isObject(signal.value) && typeof signal.value.subject === "string"
    ? signal.value.subject
    : null;
  return subject === null ? signal.feature_id : `${signal.feature_id}:${subject}`;
}

function stableSignals(snapshot: StrategicSnapshot): Map<string, StrategicSignal> {
  const result = new Map<string, StrategicSignal>();
  for (const signal of snapshot.signals) {
    if (signal.persistence !== "stable" && signal.persistence !== "irreversible") continue;
    const slot = signalSlot(signal);
    if (result.has(slot)) {
      throw new Error(`strategic_fit_causality_duplicate_signal_slot: ${snapshot.snapshot_id} ${slot}`);
    }
    result.set(slot, signal);
  }
  return result;
}

function checkpointKey(snapshot: StrategicSnapshot): string {
  return snapshot.checkpoint.kind === "configured-ply"
    ? `${snapshot.checkpoint.kind}:${snapshot.checkpoint.ply}`
    : snapshot.checkpoint.kind;
}

function compareCheckpointKeys(left: string, right: string): number {
  const leftKind = left.split(":", 1)[0] as Exclude<StrategicCheckpointKind, "final-valid-position">;
  const rightKind = right.split(":", 1)[0] as Exclude<StrategicCheckpointKind, "final-valid-position">;
  const kindOrder = CHECKPOINT_ORDER[leftKind] - CHECKPOINT_ORDER[rightKind];
  if (kindOrder !== 0) return kindOrder;
  if (leftKind === "configured-ply" && rightKind === "configured-ply") {
    const plyOrder = Number(left.slice(left.indexOf(":") + 1)) - Number(right.slice(right.indexOf(":") + 1));
    if (plyOrder !== 0) return plyOrder;
  }
  return compareStrings(left, right);
}

function comparableSnapshots(trajectory: StrategicTrajectory): Map<string, StrategicSnapshot> {
  const result = new Map<string, StrategicSnapshot>();
  for (const snapshot of trajectory.snapshots) {
    if (
      snapshot.checkpoint.comparability !== "comparable" ||
      snapshot.checkpoint.kind === "final-valid-position"
    ) continue;
    const key = checkpointKey(snapshot);
    if (result.has(key)) {
      throw new Error(`strategic_fit_causality_duplicate_checkpoint: ${trajectory.route_id} ${key}`);
    }
    result.set(key, snapshot);
  }
  return result;
}

function sameValue(left: JsonValue, right: JsonValue): boolean {
  return stableSerialize(canonicalValue(left)) === stableSerialize(canonicalValue(right));
}

function contributionDifferences(
  contribution: StrategicDistanceFeatureContribution,
  affectedSnapshots: ReadonlyMap<string, StrategicSnapshot>,
  baselineSnapshots: ReadonlyMap<string, StrategicSnapshot>,
): StableFeatureDifference[] {
  if (contribution.distance <= EPSILON || contribution.family === "learning-concepts") return [];
  const bySlot = new Map<string, Omit<StableFeatureDifference, "weight">>();
  for (const key of [...contribution.matched_checkpoint_keys].sort(compareCheckpointKeys)) {
    const affectedSnapshot = affectedSnapshots.get(key);
    const baselineSnapshot = baselineSnapshots.get(key);
    if (!affectedSnapshot || !baselineSnapshot) continue;
    const affectedSignals = stableSignals(affectedSnapshot);
    const baselineSignals = stableSignals(baselineSnapshot);
    for (const [slot, affectedSignal] of affectedSignals) {
      const baselineSignal = baselineSignals.get(slot);
      if (
        !baselineSignal ||
        affectedSignal.family !== contribution.family ||
        affectedSignal.feature_id !== contribution.feature_id ||
        baselineSignal.family !== contribution.family ||
        baselineSignal.feature_id !== contribution.feature_id ||
        sameValue(affectedSignal.value, baselineSignal.value) ||
        bySlot.has(slot)
      ) continue;
      bySlot.set(slot, {
        family: contribution.family,
        featureId: contribution.feature_id,
        slot,
        affectedSnapshot,
        baselineSnapshot,
      });
    }
  }
  if (bySlot.size === 0) return [];
  const totalWeight = contribution.contribution > EPSILON
    ? contribution.contribution
    : contribution.normalized_weight * contribution.distance;
  const weight = totalWeight / bySlot.size;
  return [...bySlot.values()].map((value) => ({ ...value, weight }));
}

function rawSignalsForRoute(graph: RepertoireGraph, route: RepertoireGraphRoute): RouteRawEvidence {
  const positions = new Map(graph.positions.map((position) => [position.position_id, position]));
  const routeSignals = extractRoutePositionSignals(graph, route);
  const signalsByPly = route.position_ids.map((positionId, ply) => {
    const position = positions.get(positionId);
    const observation = routeSignals.observations[ply];
    if (!position || !observation || observation.position_id !== positionId) {
      throw new Error(`strategic_fit_causality_missing_route_evidence: ${route.route_id} at ply ${ply}`);
    }
    const result = new Map<string, StrategicSignal>();
    for (const signal of [
      ...extractPawnSignalsFromFen(position.fen, route.repertoire_color).signals,
      ...observation.signals,
    ]) {
      const slot = signalSlot(signal as StrategicSignal);
      if (result.has(slot)) {
        throw new Error(`strategic_fit_causality_duplicate_raw_signal_slot: ${route.route_id} ${ply} ${slot}`);
      }
      result.set(slot, signal as StrategicSignal);
    }
    return result;
  });
  return { route, signalsByPly };
}

function commonPrefixPly(affected: RepertoireGraphRoute, baseline: RepertoireGraphRoute): number {
  const length = Math.min(affected.position_ids.length, baseline.position_ids.length);
  let last = -1;
  for (let ply = 0; ply < length; ply++) {
    if (affected.position_ids[ply] !== baseline.position_ids[ply]) break;
    last = ply;
  }
  return last;
}

function sharedPositions(
  affected: RepertoireGraphRoute,
  baseline: RepertoireGraphRoute,
  affectedLimit: number,
  baselineLimit: number,
): SharedPosition[] {
  const baselineByPosition = new Map<string, number[]>();
  for (let ply = 0; ply <= Math.min(baselineLimit, baseline.position_ids.length - 1); ply++) {
    const positionId = baseline.position_ids[ply]!;
    const values = baselineByPosition.get(positionId) ?? [];
    values.push(ply);
    baselineByPosition.set(positionId, values);
  }
  const result: SharedPosition[] = [];
  for (let affectedPly = 0; affectedPly <= Math.min(affectedLimit, affected.position_ids.length - 1); affectedPly++) {
    const positionId = affected.position_ids[affectedPly]!;
    for (const baselinePly of baselineByPosition.get(positionId) ?? []) {
      result.push({ positionId, affectedPly, baselinePly });
    }
  }
  return result.sort((left, right) =>
    left.affectedPly + left.baselinePly - (right.affectedPly + right.baselinePly) ||
    left.affectedPly - right.affectedPly ||
    left.baselinePly - right.baselinePly
  );
}

function lastSharedPosition(
  affected: RepertoireGraphRoute,
  baseline: RepertoireGraphRoute,
  affectedLimit: number,
  baselineLimit: number,
): SharedPosition {
  const shared = sharedPositions(affected, baseline, affectedLimit, baselineLimit);
  const result = shared.at(-1);
  if (!result) throw new Error("strategic_fit_causality_routes_do_not_share_root");
  return result;
}

function convergenceAfterDivergence(
  affected: RepertoireGraphRoute,
  baseline: RepertoireGraphRoute,
  affectedLimit: number,
  baselineLimit: number,
): SharedPosition | null {
  const prefix = commonPrefixPly(affected, baseline);
  return sharedPositions(affected, baseline, affectedLimit, baselineLimit)
    .find((shared) => shared.affectedPly > prefix || shared.baselinePly > prefix) ?? null;
}

function signalDiffers(
  affected: RouteRawEvidence,
  baseline: RouteRawEvidence,
  affectedPly: number,
  baselinePly: number,
  slot: string,
): boolean | null {
  const affectedSignal = affected.signalsByPly[affectedPly]?.get(slot);
  const baselineSignal = baseline.signalsByPly[baselinePly]?.get(slot);
  if (!affectedSignal || !baselineSignal || affectedSignal.feature_id !== baselineSignal.feature_id) return null;
  return !sameValue(affectedSignal.value, baselineSignal.value);
}

function locateFeatureOnset(
  difference: StableFeatureDifference,
  affected: RouteRawEvidence,
  baseline: RouteRawEvidence,
  shared: SharedPosition,
): number | null {
  let affectedPly = difference.affectedSnapshot.checkpoint.ply;
  let baselinePly = difference.baselineSnapshot.checkpoint.ply;
  const stableDiffers = signalDiffers(affected, baseline, affectedPly, baselinePly, difference.slot);
  if (stableDiffers !== true) return null;

  while (affectedPly > shared.affectedPly && baselinePly > shared.baselinePly) {
    const previous = signalDiffers(affected, baseline, affectedPly - 1, baselinePly - 1, difference.slot);
    if (previous !== true) break;
    affectedPly--;
    baselinePly--;
  }
  return affectedPly > shared.affectedPly ? affectedPly : null;
}

function eventId(
  graphId: string,
  routeId: string,
  kind: CausalEventKind,
  ply: number,
  decisionId: string | null,
): string {
  return `causal-event:${stableHash([
    STRATEGIC_CAUSALITY_VERSION,
    graphId,
    routeId,
    kind,
    String(ply),
    decisionId ?? "none",
  ].join(ID_SEPARATOR))}`;
}

function makeEvent(
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
  kind: CausalEventKind,
  ply: number,
  explanation: string,
): CausalEvent {
  const decisionId = ply > 0 ? route.decision_ids[ply - 1] ?? null : null;
  const positionId = route.position_ids[ply];
  if (!positionId) throw new Error(`strategic_fit_causality_invalid_event_ply: ${route.route_id} ${ply}`);
  const san = ply > 0 ? route.san_moves[ply - 1] ?? null : null;
  return {
    event_id: eventId(graph.graph_id, route.route_id, kind, ply, decisionId),
    kind,
    ply,
    position_id: positionId,
    decision_id: decisionId,
    san,
    explanation,
  };
}

function irreversibleExplanation(
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
  ply: number,
): string | null {
  if (ply < 1) return null;
  const beforeId = route.position_ids[ply - 1];
  const beforeFen = beforeId
    ? graph.positions.find((position) => position.position_id === beforeId)?.fen
    : undefined;
  const uci = route.uci_moves[ply - 1];
  if (!beforeFen || !uci) return null;
  const before = Chess.fromSetup(parseFen(beforeFen).unwrap()).unwrap();
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  if (from === undefined || to === undefined) return null;
  const movingPiece = before.board.get(from);
  if (!movingPiece) return null;
  const destination = before.board.get(to);
  // chessops represents standard castling in UCI_Chess960 form: the king targets its friendly
  // rook square. Keep this aligned with position-signals so the rook is never called a capture.
  const rookTarget = destination?.color === movingPiece.color && destination.role === "rook";
  const castling = movingPiece.role === "king" &&
    (rookTarget || Math.abs(squareFile(from) - squareFile(to)) === 2);
  const enPassant = movingPiece.role === "pawn" && squareFile(from) !== squareFile(to) && destination === undefined;
  const capture = !rookTarget && (destination !== undefined || enPassant);
  const promotion = uci.length === 5;
  if (!capture && movingPiece.role !== "pawn" && !castling && !promotion) return null;
  const reasons = [
    movingPiece.role === "pawn" ? "pawn move" : null,
    capture ? "capture" : null,
    castling ? "castling" : null,
    promotion ? "promotion" : null,
  ].filter((reason): reason is string => reason !== null);
  return `Irreversible ${reasons.join(" and ")} ${route.san_moves[ply - 1]!} contributes to the stable difference.`;
}

function causalLabel(controllability: number | null): CausalControlLabel {
  if (controllability === null) return "unknown";
  if (controllability <= 0.34) return "mostly-opponent-forced";
  if (controllability <= 0.64) return "shared-or-uncertain";
  return "mostly-player-controlled";
}

function mergeProvenance(
  ...groups: readonly (readonly StrategicFitSourceProvenance[])[]
): StrategicFitSourceProvenance[] {
  const result: StrategicFitSourceProvenance[] = [];
  const seen = new Set<string>();
  for (const source of groups.flat()) {
    const identity = [source.source_id, source.version, source.snapshot].join(ID_SEPARATOR);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(source);
  }
  return result.sort((left, right) => compareStrings(left.source_id, right.source_id));
}

function sortEvents(events: readonly CausalEvent[]): CausalEvent[] {
  const seen = new Set<string>();
  return [...events]
    .sort((left, right) =>
      left.ply - right.ply || EVENT_ORDER[left.kind] - EVENT_ORDER[right.kind] ||
      compareStrings(left.event_id, right.event_id)
    )
    .filter((event) => {
      const key = [event.kind, event.ply, event.decision_id].join(ID_SEPARATOR);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function unknownAttribution(explanation: string, timeline: readonly CausalEvent[] = []): CausalAttribution {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    controllability: null,
    label: "unknown",
    player_contribution: null,
    opponent_contribution: null,
    likely_causal_decision_ids: [],
    timeline: sortEvents(timeline),
    explanation,
  };
}

function explanationFor(
  label: CausalControlLabel,
  unknownShare: number,
  playerDecisionCount: number,
  opponentDecisionCount: number,
): string {
  const uncertainty = unknownShare > EPSILON
    ? ` ${Math.round(unknownShare * 100)}% of weighted feature evidence has no deterministic move pivot and remains uncertain.`
    : "";
  const interaction = playerDecisionCount + opponentDecisionCount > 1
    ? " Several decisions interact, so the causal pivot remains provisional."
    : "";
  if (label === "mostly-opponent-forced") {
    return `Mostly opponent-forced: the stable feature differences emerged before a relevant repertoire choice.${uncertainty}${interaction}`;
  }
  if (label === "mostly-player-controlled") {
    return `Mostly player-controlled: deterministic feature changes trace back to repertoire-side decisions.${uncertainty}${interaction}`;
  }
  return `Shared or uncertain: opponent and repertoire decisions both contribute to the stable difference.${uncertainty}${interaction}`;
}

function opponentDivergencePly(
  affected: RepertoireGraphRoute,
  baseline: RepertoireGraphRoute,
  shared: SharedPosition,
  decisions: ReadonlyMap<string, RepertoireGraphDecision>,
  affectedLimit: number,
  baselineLimit: number,
): number | null {
  const baselineSegment = new Set(
    baseline.decision_ids.slice(shared.baselinePly, baselineLimit),
  );
  for (let ply = shared.affectedPly + 1; ply <= affectedLimit; ply++) {
    const decisionId = affected.decision_ids[ply - 1];
    const decision = decisionId ? decisions.get(decisionId) : undefined;
    if (decision?.owner === "opponent" && !baselineSegment.has(decisionId!)) return ply;
  }
  return null;
}

function attributeWithContext(
  context: CausalityContext,
  affectedTrajectory: StrategicTrajectory,
  baselineTrajectory: StrategicTrajectory,
  distance: StrategicTrajectoryDistance,
): CausalAttribution {
  if (
    affectedTrajectory.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    baselineTrajectory.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    distance.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION
  ) {
    throw new Error("strategic_fit_causality_version_mismatch");
  }
  if (
    distance.left_route_id !== affectedTrajectory.route_id ||
    distance.right_route_id !== baselineTrajectory.route_id
  ) {
    throw new Error("strategic_fit_causality_route_mismatch");
  }
  const affectedRoute = context.routes.get(affectedTrajectory.route_id);
  const baselineRoute = context.routes.get(baselineTrajectory.route_id);
  const affectedRaw = context.rawEvidence.get(affectedTrajectory.route_id);
  const baselineRaw = context.rawEvidence.get(baselineTrajectory.route_id);
  if (!affectedRoute || !baselineRoute || !affectedRaw || !baselineRaw) {
    throw new Error("strategic_fit_causality_missing_route");
  }

  const convergence = convergenceAfterDivergence(
    affectedRoute,
    baselineRoute,
    affectedRoute.position_ids.length - 1,
    baselineRoute.position_ids.length - 1,
  );
  const transpositionTimeline = convergence
    ? [makeEvent(
      context.graph,
      affectedRoute,
      "transposition",
      convergence.affectedPly,
      `The routes converge on canonical position ${convergence.positionId} after different move orders.`,
    )]
    : [];
  if (affectedRoute.terminal_position_id === baselineRoute.terminal_position_id && convergence) {
    return unknownAttribution(
      "Transpositional equivalence: the move orders converge on the same canonical outcome, so no causal blame is assigned.",
      transpositionTimeline,
    );
  }
  if (distance.state !== "available" || distance.distance === null || distance.distance <= EPSILON) {
    return unknownAttribution(
      "No stable strategic pivot is supported by the matched engine-free evidence; causal ownership remains unknown.",
      transpositionTimeline,
    );
  }

  const affectedSnapshots = comparableSnapshots(affectedTrajectory);
  const baselineSnapshots = comparableSnapshots(baselineTrajectory);
  const stableDifferences = distance.feature_contributions.flatMap((contribution) =>
    contributionDifferences(contribution, affectedSnapshots, baselineSnapshots)
  );
  if (stableDifferences.length === 0) {
    return unknownAttribution(
      "The distance has no stable position-level feature pivot that engine-free evidence can attribute; causal ownership remains unknown.",
      transpositionTimeline,
    );
  }

  const earliestStable = stableDifferences.reduce((earliest, difference) =>
    difference.affectedSnapshot.checkpoint.ply < earliest.affectedSnapshot.checkpoint.ply
      ? difference
      : earliest
  );
  if (earliestStable.affectedSnapshot.position_id === earliestStable.baselineSnapshot.position_id) {
    return unknownAttribution(
      "Transpositional equivalence reaches the same canonical stable position, so route-order differences receive no causal blame.",
      [
        ...transpositionTimeline,
        makeEvent(
          context.graph,
          affectedRoute,
          "transposition",
          earliestStable.affectedSnapshot.checkpoint.ply,
          "The matched stable checkpoints share one canonical position.",
        ),
      ],
    );
  }

  const shared = lastSharedPosition(
    affectedRoute,
    baselineRoute,
    earliestStable.affectedSnapshot.checkpoint.ply,
    earliestStable.baselineSnapshot.checkpoint.ply,
  );
  const located: LocatedFeatureDifference[] = stableDifferences.map((difference) => {
    const onsetPly = locateFeatureOnset(difference, affectedRaw, baselineRaw, shared);
    const decisionId = onsetPly === null ? undefined : affectedRoute.decision_ids[onsetPly - 1];
    return {
      ...difference,
      onsetPly,
      decision: decisionId ? context.decisions.get(decisionId) ?? null : null,
    };
  });
  const totalWeight = located.reduce((sum, difference) => sum + difference.weight, 0);
  let playerWeight = 0;
  let opponentWeight = 0;
  let unknownWeight = 0;
  for (const difference of located) {
    if (difference.decision?.owner === "repertoire") playerWeight += difference.weight;
    else if (difference.decision?.owner === "opponent") opponentWeight += difference.weight;
    else unknownWeight += difference.weight;
  }
  if (totalWeight <= EPSILON || playerWeight + opponentWeight <= EPSILON) {
    return unknownAttribution(
      "Stable differences are present, but walking backward does not expose a supported semantic decision pivot.",
      transpositionTimeline,
    );
  }

  const playerContribution = clamp((playerWeight + unknownWeight / 2) / totalWeight);
  const opponentContribution = clamp((opponentWeight + unknownWeight / 2) / totalWeight);
  const controllability = round(playerContribution);
  const label = causalLabel(controllability);
  const playerDifferences = located.filter((difference) => difference.decision?.owner === "repertoire");
  const opponentDifferences = located.filter((difference) => difference.decision?.owner === "opponent");
  const likelyCausalDecisionIds = sortedUnique(
    playerDifferences.flatMap((difference) => difference.decision?.decision_id ?? []),
  ).sort((left, right) => {
    const leftPly = affectedRoute.decision_ids.indexOf(left);
    const rightPly = affectedRoute.decision_ids.indexOf(right);
    return leftPly - rightPly || compareStrings(left, right);
  });
  const events: CausalEvent[] = [...transpositionTimeline];
  const opponentPly = opponentDivergencePly(
    affectedRoute,
    baselineRoute,
    shared,
    context.decisions,
    earliestStable.affectedSnapshot.checkpoint.ply,
    earliestStable.baselineSnapshot.checkpoint.ply,
  );
  if (opponentPly !== null) {
    events.push(makeEvent(
      context.graph,
      affectedRoute,
      "opponent-divergence",
      opponentPly,
      "First opponent-owned decision on the divergent route segment.",
    ));
  }
  for (const difference of playerDifferences) {
    if (difference.onsetPly === null) continue;
    events.push(makeEvent(
      context.graph,
      affectedRoute,
      "player-decision",
      difference.onsetPly,
      `Repertoire decision associated with ${difference.featureId} becoming different.`,
    ));
  }
  for (const difference of located) {
    if (difference.onsetPly === null || !difference.decision) continue;
    const irreversible = irreversibleExplanation(context.graph, affectedRoute, difference.onsetPly);
    if (irreversible) {
      events.push(makeEvent(
        context.graph,
        affectedRoute,
        "irreversible-event",
        difference.onsetPly,
        irreversible,
      ));
    }
  }
  const locatedPlies = located.flatMap((difference) => difference.onsetPly ?? []);
  if (locatedPlies.length > 0) {
    const firstDifferencePly = Math.min(...locatedPlies);
    events.push(makeEvent(
      context.graph,
      affectedRoute,
      "first-strategic-difference",
      firstDifferencePly,
      "First deterministic feature difference that persists into the stable comparison.",
    ));
  }
  events.push(makeEvent(
    context.graph,
    affectedRoute,
    "difference-stable",
    earliestStable.affectedSnapshot.checkpoint.ply,
    `The difference is stable at matched checkpoint ${checkpointKey(earliestStable.affectedSnapshot)}.`,
  ));

  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    controllability,
    label,
    player_contribution: controllability,
    opponent_contribution: round(opponentContribution),
    likely_causal_decision_ids: likelyCausalDecisionIds,
    timeline: sortEvents(events),
    explanation: explanationFor(
      label,
      totalWeight <= EPSILON ? 1 : unknownWeight / totalWeight,
      new Set(playerDifferences.map((difference) => difference.decision!.decision_id)).size,
      new Set(opponentDifferences.map((difference) => difference.decision!.decision_id)).size,
    ),
  };
}

function buildContext(graph: RepertoireGraph): CausalityContext {
  const routes = new Map(graph.routes.map((route) => [route.route_id, route]));
  return {
    graph,
    routes,
    decisions: new Map(graph.decisions.map((decision) => [decision.decision_id, decision])),
    rawEvidence: new Map(graph.routes.map((route) => [route.route_id, rawSignalsForRoute(graph, route)])),
  };
}

/** Attribute one route-to-baseline distance without using an engine or network source. */
export function attributeStrategicCausalOwnership(
  graph: RepertoireGraph,
  affectedTrajectory: StrategicTrajectory,
  baselineTrajectory: StrategicTrajectory,
  distance: StrategicTrajectoryDistance,
): CausalAttribution {
  return attributeWithContext(buildContext(graph), affectedTrajectory, baselineTrajectory, distance);
}

function requireCompatibleReports(
  graph: RepertoireGraph,
  trajectories: StrategicTrajectoryReport,
  distances: StrategicDistanceReport,
): void {
  if (
    graph.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    trajectories.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    distances.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION
  ) {
    throw new Error("strategic_fit_causality_report_version_mismatch");
  }
  if (graph.graph_id !== trajectories.graph_id || graph.graph_id !== distances.graph_id) {
    throw new Error("strategic_fit_causality_report_graph_mismatch");
  }
  const graphRouteIds = sortedUnique(graph.routes.map((route) => route.route_id));
  const trajectoryRouteIds = sortedUnique(trajectories.trajectories.map((trajectory) => trajectory.route_id));
  if (
    graphRouteIds.length !== trajectoryRouteIds.length ||
    graphRouteIds.some((routeId, index) => routeId !== trajectoryRouteIds[index])
  ) {
    throw new Error("strategic_fit_causality_report_route_mismatch");
  }
}

/** Attribute every route-to-mode comparison in a deterministic distance report. */
export function calculateStrategicCausality(
  graph: RepertoireGraph,
  trajectoryReport: StrategicTrajectoryReport,
  distanceReport: StrategicDistanceReport,
): StrategicCausalityReport {
  requireCompatibleReports(graph, trajectoryReport, distanceReport);
  const context = buildContext(graph);
  const trajectoryByRoute = new Map(
    trajectoryReport.trajectories.map((trajectory) => [trajectory.route_id, trajectory]),
  );
  const comparisons = [...distanceReport.comparisons]
    .sort((left, right) =>
      compareStrings(left.cohort_id, right.cohort_id) ||
      compareStrings(left.left_route_id, right.left_route_id) ||
      compareStrings(left.mode_id, right.mode_id)
    )
    .map((comparison: StrategicRouteModeDistance): StrategicCausalComparison => {
      const affected = trajectoryByRoute.get(comparison.left_route_id);
      const baseline = trajectoryByRoute.get(comparison.representative_route_id);
      if (!affected || !baseline || comparison.right_route_id !== comparison.representative_route_id) {
        throw new Error("strategic_fit_causality_report_comparison_route_mismatch");
      }
      return {
        cohort_id: comparison.cohort_id,
        mode_id: comparison.mode_id,
        affected_route_id: comparison.left_route_id,
        representative_route_id: comparison.representative_route_id,
        distance: comparison.distance,
        attribution: attributeWithContext(context, affected, baseline, comparison),
      };
    });
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    causality_version: STRATEGIC_CAUSALITY_VERSION,
    graph_id: graph.graph_id,
    distance_version: distanceReport.distance_version,
    comparisons,
    provenance: mergeProvenance(
      [CORE_PROVENANCE],
      trajectoryReport.provenance,
      distanceReport.provenance,
      ...distanceReport.comparisons.map((comparison) => comparison.provenance),
    ),
  };
}
