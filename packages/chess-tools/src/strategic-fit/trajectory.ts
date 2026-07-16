/**
 * Deterministic Strategic Fit trajectory construction and persistence classification.
 *
 * Trajectories retain every selected checkpoint as evidence, including the editorial endpoint,
 * but only comparable checkpoints after distinct repertoire turns can establish persistence.
 * Historical facts such as castling and completed exchanges are irreversible as soon as they are
 * observed. Position features caused by an irreversible move are not automatically irreversible:
 * doubled pawns, files, and center states can still change at the next checkpoint.
 */
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";

import {
  selectStrategicCheckpoints,
  type MatchedStrategicCheckpoint,
  type StrategicCheckpointSelection,
  type StrategicCheckpointSelectionOptions,
} from "./checkpoints.js";
import type { RepertoireGraph, RepertoireGraphRoute } from "./graph.js";
import { extractPawnSignalsFromFen } from "./pawn-signals.js";
import { extractRoutePositionSignals } from "./position-signals.js";
import type {
  JsonValue,
  MissingStrategicCheckpoint,
  SignalPersistenceState,
  StrategicCheckpointKind,
  StrategicFitSourceProvenance,
  StrategicSignal,
  StrategicSnapshot,
  StrategicTrajectory,
  StrategicTrajectoryState,
} from "./types.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
} from "./version.js";

export interface StrategicTrajectoryBuildOptions extends StrategicCheckpointSelectionOptions {
  /** A precomputed selection may be injected by the analyzer to avoid selecting twice. */
  readonly checkpointSelection?: StrategicCheckpointSelection;
}

export interface StrategicTrajectoryReport {
  readonly analysis_version: string;
  readonly graph_id: string;
  readonly configured_plies: readonly number[];
  readonly trajectories: readonly StrategicTrajectory[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface RawSnapshot {
  readonly selected: MatchedStrategicCheckpoint;
  readonly snapshot: StrategicSnapshot;
}

interface PersistenceRun {
  signature: string;
  lastPly: number;
  distinctPlyCount: number;
}

const ID_SEPARATOR = "\u001f";
const CHECKPOINT_ORDER: Readonly<Record<StrategicCheckpointKind, number>> = Object.freeze({
  "opening-exit": 0,
  "central-resolution": 1,
  "irreversible-transformation": 2,
  "configured-ply": 3,
  "final-valid-position": 4,
});

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:trajectory",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.trajectory,
  snapshot: null,
  reason: null,
});

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function isObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
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

/** Metadata about repetition does not change which recurring placement was observed. */
function persistenceValue(signal: StrategicSignal): JsonValue {
  if (signal.feature_id !== "piece.recurring-placements" || !isObject(signal.value)) {
    return signal.value;
  }
  const placements = signal.value.placements;
  if (!Array.isArray(placements)) return signal.value;
  return {
    placements: placements.map((placement) => {
      if (!isObject(placement)) return placement;
      return {
        side: placement.side ?? null,
        role: placement.role ?? null,
        square: placement.square ?? null,
      };
    }),
  };
}

function pairHas(value: JsonValue, predicate: (side: { readonly [key: string]: JsonValue }) => boolean): boolean {
  if (!isObject(value)) return false;
  for (const side of [value.repertoire, value.opponent]) {
    if (side !== undefined && isObject(side) && predicate(side)) return true;
  }
  return false;
}

/** True only when the signal itself records an event that cannot be undone later in the route. */
function isHistoricalIrreversible(signal: StrategicSignal): boolean {
  switch (signal.feature_id) {
    case "king.castling-history":
      return pairHas(signal.value, (side) => side.castled === true);
    case "piece.fianchetto-history":
      return pairHas(signal.value, (side) => Array.isArray(side.wings) && side.wings.length > 0);
    case "piece.bishop-pair":
      return pairHas(signal.value, (side) => typeof side.first_lost_ply === "number");
    case "piece.exchange-history":
      return isObject(signal.value) && Array.isArray(signal.value.exchanges) && signal.value.exchanges.length > 0;
    case "piece.queen-retention":
      return pairHas(signal.value, (side) => typeof side.first_lost_ply === "number");
    default:
      return false;
  }
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
  return result;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function classifierConfidence(signals: readonly StrategicSignal[]): number {
  if (signals.length === 0) return 0;
  return round(signals.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length);
}

function requireSelection(graph: RepertoireGraph, options: StrategicTrajectoryBuildOptions): StrategicCheckpointSelection {
  const selection = options.checkpointSelection ?? selectStrategicCheckpoints(graph, options);
  if (selection.graph_id !== graph.graph_id) {
    throw new Error(
      `strategic_fit_trajectory_graph_mismatch: expected ${graph.graph_id}, received ${selection.graph_id}`,
    );
  }
  if (selection.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION) {
    throw new Error(`strategic_fit_trajectory_version_mismatch: ${selection.analysis_version}`);
  }
  const graphRouteIds = graph.routes.map((route) => route.route_id).sort();
  const selectionRouteIds = selection.routes.map((route) => route.route_id).sort();
  if (stableSerialize(graphRouteIds) !== stableSerialize(selectionRouteIds)) {
    throw new Error("strategic_fit_trajectory_route_mismatch");
  }
  return selection;
}

function makeSnapshot(
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
  selected: MatchedStrategicCheckpoint,
  positionSignals: ReturnType<typeof extractRoutePositionSignals>,
  positions: ReadonlyMap<string, RepertoireGraph["positions"][number]>,
): RawSnapshot {
  const position = positions.get(selected.position_id);
  if (!position || route.position_ids[selected.checkpoint.ply] !== selected.position_id) {
    throw new Error(
      `strategic_fit_trajectory_invalid_checkpoint: ${route.route_id} ${selected.checkpoint.checkpoint_id}`,
    );
  }
  const routeObservation = positionSignals.observations[selected.checkpoint.ply];
  if (!routeObservation || routeObservation.position_id !== selected.position_id) {
    throw new Error(
      `strategic_fit_trajectory_missing_position_signals: ${route.route_id} at ply ${selected.checkpoint.ply}`,
    );
  }
  const pawnReport = extractPawnSignalsFromFen(position.fen, route.repertoire_color);
  const snapshotId = `snapshot:${stableHash([
    STRATEGIC_FIT_ANALYSIS_VERSION,
    route.route_id,
    selected.checkpoint.checkpoint_id,
    selected.position_id,
  ].join(ID_SEPARATOR))}`;
  // Pawn signal value interfaces are JSON-safe but intentionally retain their narrower named
  // shapes, which TypeScript does not infer as the recursive JsonValue index signature.
  const sourceSignals: StrategicSignal[] = [
    ...pawnReport.signals.map((sourceSignal): StrategicSignal => ({
      ...sourceSignal,
      value: sourceSignal.value as unknown as JsonValue,
    })),
    ...routeObservation.signals,
  ];
  const signals: StrategicSignal[] = sourceSignals.map((sourceSignal) => ({
    ...sourceSignal,
    signal_id: `trajectory-signal:${stableHash([
      STRATEGIC_FIT_ANALYSIS_VERSION,
      snapshotId,
      signalSlot(sourceSignal),
    ].join(ID_SEPARATOR))}`,
    persistence: "unknown" as const,
    provenance: mergeProvenance([CORE_PROVENANCE], sourceSignal.provenance),
  }));
  const provenance = mergeProvenance(
    [CORE_PROVENANCE],
    pawnReport.provenance,
    routeObservation.provenance,
  );
  return {
    selected,
    snapshot: {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      snapshot_id: snapshotId,
      route_id: route.route_id,
      position_id: selected.position_id,
      fen: position.fen,
      checkpoint: selected.checkpoint,
      signals,
      classifier_confidence: classifierConfidence(signals),
      provenance,
    },
  };
}

function compareRawSnapshots(left: RawSnapshot, right: RawSnapshot): number {
  return left.snapshot.checkpoint.ply - right.snapshot.checkpoint.ply ||
    CHECKPOINT_ORDER[left.snapshot.checkpoint.kind] - CHECKPOINT_ORDER[right.snapshot.checkpoint.kind] ||
    left.snapshot.checkpoint.checkpoint_id.localeCompare(right.snapshot.checkpoint.checkpoint_id);
}

function applyPersistence(rawSnapshots: readonly RawSnapshot[]): StrategicSnapshot[] {
  const runs = new Map<string, PersistenceRun>();
  return rawSnapshots.map(({ snapshot }) => {
    const comparable = snapshot.checkpoint.comparability === "comparable";
    const signals = snapshot.signals.map((signal): StrategicSignal => {
      let persistence: SignalPersistenceState = "transient";
      if (comparable) {
        const slot = signalSlot(signal);
        const signature = stableSerialize(persistenceValue(signal));
        const run = runs.get(slot);
        if (!run || run.signature !== signature) {
          runs.set(slot, {
            signature,
            lastPly: snapshot.checkpoint.ply,
            distinctPlyCount: 1,
          });
        } else if (run.lastPly !== snapshot.checkpoint.ply) {
          run.lastPly = snapshot.checkpoint.ply;
          run.distinctPlyCount++;
        }
        const currentRun = runs.get(slot)!;
        if (isHistoricalIrreversible(signal)) persistence = "irreversible";
        else if (currentRun.distinctPlyCount >= 2) persistence = "stable";
      }
      return { ...signal, persistence };
    });
    return { ...snapshot, signals };
  });
}

function finalRouteIsTerminal(
  route: RepertoireGraphRoute,
  positions: ReadonlyMap<string, RepertoireGraph["positions"][number]>,
): boolean {
  const position = positions.get(route.terminal_position_id);
  if (!position) throw new Error(`strategic_fit_trajectory_missing_terminal_position: ${route.route_id}`);
  return Chess.fromSetup(parseFen(position.fen).unwrap()).unwrap().isEnd();
}

function trajectoryState(
  route: RepertoireGraphRoute,
  missing: readonly MissingStrategicCheckpoint[],
  requestedCount: number,
  usableCount: number,
  allRequestedUnsupported: boolean,
  positions: ReadonlyMap<string, RepertoireGraph["positions"][number]>,
): StrategicTrajectoryState {
  if (finalRouteIsTerminal(route, positions)) return "terminal";
  if (requestedCount > 0 && usableCount === 0 && allRequestedUnsupported) {
    return "unsupported";
  }
  return missing.length > 0 || usableCount < requestedCount ? "incomplete" : "complete";
}

function buildTrajectory(
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
  routeSelection: StrategicCheckpointSelection["routes"][number],
  positions: ReadonlyMap<string, RepertoireGraph["positions"][number]>,
): StrategicTrajectory {
  const positionSignals = extractRoutePositionSignals(graph, route);
  const rawSnapshots = routeSelection.milestones
    .filter((milestone): milestone is MatchedStrategicCheckpoint => milestone.state === "selected")
    .map((selected) => makeSnapshot(graph, route, selected, positionSignals, positions))
    .sort(compareRawSnapshots);
  const snapshots = applyPersistence(rawSnapshots);
  const missingCheckpoints = routeSelection.milestones
    .filter((milestone) => milestone.state === "missing")
    .map((milestone): MissingStrategicCheckpoint => ({
      kind: milestone.kind,
      reason: milestone.reason,
    }));
  const requestedMilestones = routeSelection.milestones.filter((milestone) =>
    milestone.state === "missing" || milestone.checkpoint.kind !== "final-valid-position"
  );
  const usableCount = requestedMilestones.filter((milestone) =>
    milestone.state === "selected" && milestone.checkpoint.comparability === "comparable"
  ).length;
  const requestedCount = requestedMilestones.length;
  const allRequestedUnsupported = requestedMilestones.every((milestone) =>
    milestone.state === "selected"
      ? milestone.checkpoint.comparability === "not-comparable"
      : milestone.comparability === "not-comparable"
  );
  const stableSignalIds: string[] = [];
  const transientSignalIds: string[] = [];
  for (const snapshot of snapshots) {
    for (const signal of snapshot.signals) {
      if (signal.persistence === "stable" || signal.persistence === "irreversible") {
        stableSignalIds.push(signal.signal_id);
      } else {
        transientSignalIds.push(signal.signal_id);
      }
    }
  }
  const trajectoryId = `trajectory:${stableHash([
    STRATEGIC_FIT_ANALYSIS_VERSION,
    graph.graph_id,
    route.route_id,
    ...routeSelection.milestones.map((milestone) =>
      milestone.state === "selected" ? milestone.checkpoint.checkpoint_id : milestone.checkpoint_id
    ),
  ].join(ID_SEPARATOR))}`;
  const provenance = mergeProvenance(
    [CORE_PROVENANCE],
    ...snapshots.map((snapshot) => snapshot.provenance),
  );
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    trajectory_id: trajectoryId,
    route_id: route.route_id,
    state: trajectoryState(
      route,
      missingCheckpoints,
      requestedCount,
      usableCount,
      allRequestedUnsupported,
      positions,
    ),
    snapshots,
    missing_checkpoints: missingCheckpoints,
    evidence_coverage: requestedCount === 0 ? 0 : round(usableCount / requestedCount),
    stable_signal_ids: stableSignalIds,
    transient_signal_ids: transientSignalIds,
    provenance,
  };
}

/** Build ordered, persistence-bearing trajectories for every canonical repertoire route. */
export function buildStrategicTrajectories(
  graph: RepertoireGraph,
  options: StrategicTrajectoryBuildOptions = {},
): StrategicTrajectoryReport {
  const selection = requireSelection(graph, options);
  const positions = new Map(graph.positions.map((position) => [position.position_id, position]));
  if (new Set(graph.routes.map((route) => route.route_id)).size !== graph.routes.length) {
    throw new Error("strategic_fit_trajectory_duplicate_route");
  }
  const selections = new Map(selection.routes.map((route) => [route.route_id, route]));
  const trajectories = graph.routes.map((route) => {
    const routeSelection = selections.get(route.route_id);
    if (!routeSelection) throw new Error(`strategic_fit_trajectory_missing_route: ${route.route_id}`);
    return buildTrajectory(graph, route, routeSelection, positions);
  });
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    graph_id: graph.graph_id,
    configured_plies: selection.configured_plies,
    trajectories,
    provenance: [CORE_PROVENANCE],
  };
}
