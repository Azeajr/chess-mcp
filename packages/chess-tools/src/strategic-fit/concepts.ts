/**
 * Deterministic Strategic Fit learning concepts.
 *
 * Concept rules consume only stable or irreversible trajectory evidence. They intentionally stay
 * conservative: this module records an observed setup, exchange, prerequisite, or plan pattern;
 * it does not infer chess value, tactical soundness, or an unsupported strategic intention.
 * Language-neutral concept IDs are kept separate from English display labels.
 */
import type {
  JsonValue,
  StrategicFitSourceProvenance,
  StrategicSignal,
  StrategicSnapshot,
  StrategicTrajectory,
} from "./types.js";
import type { StrategicTrajectoryReport } from "./trajectory.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";

export const STRATEGIC_CONCEPT_CATEGORIES = [
  "pawn-break",
  "plan",
  "setup-family",
  "exchange",
  "tactical-risk-prerequisite",
  "endgame-tendency",
] as const;
export type StrategicConceptCategory = (typeof STRATEGIC_CONCEPT_CATEGORIES)[number];

export const STRATEGIC_CONCEPT_RULE_IDS = [
  "stable-likely-pawn-break",
  "stable-pawn-formation",
  "castling-setup",
  "fianchetto-setup",
  "bishop-pair-setup",
  "recurring-piece-placement",
  "observed-pawn-expansion",
  "rook-on-open-file",
  "observed-exchange-pattern",
  "opposite-side-castling-prerequisite",
  "queens-retained-fluid-center-prerequisite",
  "queenless-endgame-tendency",
] as const;
export type StrategicConceptRuleId = (typeof STRATEGIC_CONCEPT_RULE_IDS)[number];

export type StrategicConceptPersistence = "stable" | "irreversible";

export interface StrategicConceptEvidence {
  readonly signal_id: string;
  readonly feature_id: string;
  readonly snapshot_id: string;
  readonly position_id: string;
  readonly ply: number;
  readonly persistence: StrategicConceptPersistence;
}

export interface StrategicConcept {
  readonly analysis_version: string;
  readonly classifier_version: string;
  readonly concept_id: string;
  readonly category: StrategicConceptCategory;
  readonly rule_id: StrategicConceptRuleId;
  readonly confidence: number;
  readonly persistence: StrategicConceptPersistence;
  readonly first_observed_ply: number;
  readonly evidence: readonly StrategicConceptEvidence[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

/** Labels are a presentation catalog and never participate in concept identity or overlap. */
export interface StrategicConceptLabel {
  readonly concept_id: string;
  readonly locale: "en";
  readonly label: string;
}

export interface StrategicRouteConcepts {
  readonly analysis_version: string;
  readonly classifier_version: string;
  readonly trajectory_id: string;
  readonly route_id: string;
  readonly concepts: readonly StrategicConcept[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicConceptDictionary {
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly classifier_version: string;
  readonly graph_id: string;
  readonly routes: readonly StrategicRouteConcepts[];
  readonly labels: readonly StrategicConceptLabel[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicConceptOverlap {
  readonly shared_concept_ids: readonly string[];
  readonly left_only_concept_ids: readonly string[];
  readonly right_only_concept_ids: readonly string[];
  /** Jaccard overlap. Two routes with no supported concepts have overlap 1. */
  readonly overlap: number;
}

interface MutableConcept {
  category: StrategicConceptCategory;
  ruleId: StrategicConceptRuleId;
  label: string;
  confidence: number;
  persistence: StrategicConceptPersistence;
  firstObservedPly: number;
  evidence: Map<string, StrategicConceptEvidence>;
  provenance: StrategicFitSourceProvenance[];
}

const ID_SEPARATOR = "\u001f";
const SQUARE_PATTERN = /^[a-h][1-8]$/;
const TOKEN_PATTERN = /^[a-z][a-z0-9-]*$/;
const RELATIVE_SIDES = new Set(["repertoire", "opponent"]);

const CLASSIFIER_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:concept-classifier",
  kind: "concept-classifier",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts,
  snapshot: null,
  reason: null,
});

function isObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectValue(value: JsonValue | undefined): { readonly [key: string]: JsonValue } | null {
  return value !== undefined && isObject(value) ? value : null;
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : [];
}

function validToken(value: JsonValue | undefined): string | null {
  const token = stringValue(value);
  return token !== null && TOKEN_PATTERN.test(token) ? token : null;
}

function validSide(value: JsonValue | undefined): "repertoire" | "opponent" | null {
  const side = stringValue(value);
  return side !== null && RELATIVE_SIDES.has(side) ? side as "repertoire" | "opponent" : null;
}

function validSquare(value: JsonValue | undefined): string | null {
  const square = stringValue(value);
  return square !== null && SQUARE_PATTERN.test(square) ? square : null;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function title(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function sideLabel(side: "repertoire" | "opponent"): string {
  return side === "repertoire" ? "Repertoire" : "Opponent";
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

function stableSignals(snapshot: StrategicSnapshot): StrategicSignal[] {
  return snapshot.signals.filter((signal) =>
    signal.persistence === "stable" || signal.persistence === "irreversible"
  );
}

function byFeature(signals: readonly StrategicSignal[], featureId: string): StrategicSignal | null {
  return signals.find((signal) => signal.feature_id === featureId) ?? null;
}

function evidenceFor(snapshot: StrategicSnapshot, signal: StrategicSignal): StrategicConceptEvidence {
  return {
    signal_id: signal.signal_id,
    feature_id: signal.feature_id,
    snapshot_id: snapshot.snapshot_id,
    position_id: snapshot.position_id,
    ply: snapshot.checkpoint.ply,
    persistence: signal.persistence as StrategicConceptPersistence,
  };
}

function emit(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signals: readonly StrategicSignal[],
  conceptId: string,
  category: StrategicConceptCategory,
  ruleId: StrategicConceptRuleId,
  label: string,
  confidence: number,
  firstObservedPly = snapshot.checkpoint.ply,
  persistenceOverride?: StrategicConceptPersistence,
): void {
  if (!signals.length || signals.some((signal) =>
    signal.persistence !== "stable" && signal.persistence !== "irreversible"
  )) return;
  const persistence: StrategicConceptPersistence = persistenceOverride ?? (
    signals.every((signal) => signal.persistence === "irreversible") ? "irreversible" : "stable"
  );
  const evidence = signals.map((signal) => evidenceFor(snapshot, signal));
  const provenance = mergeProvenance(
    [CLASSIFIER_PROVENANCE],
    ...signals.map((signal) => signal.provenance),
  );
  const existing = concepts.get(conceptId);
  if (!existing) {
    concepts.set(conceptId, {
      category,
      ruleId,
      label,
      confidence: round(Math.max(0, Math.min(1, confidence))),
      persistence,
      firstObservedPly,
      evidence: new Map(evidence.map((item) => [`${item.snapshot_id}${ID_SEPARATOR}${item.signal_id}`, item])),
      provenance,
    });
    return;
  }
  if (existing.category !== category || existing.ruleId !== ruleId || existing.label !== label) {
    throw new Error(`strategic_fit_concept_identity_collision: ${conceptId}`);
  }
  existing.confidence = Math.max(existing.confidence, round(Math.max(0, Math.min(1, confidence))));
  if (persistence === "irreversible") existing.persistence = "irreversible";
  existing.firstObservedPly = Math.min(existing.firstObservedPly, firstObservedPly);
  for (const item of evidence) {
    existing.evidence.set(`${item.snapshot_id}${ID_SEPARATOR}${item.signal_id}`, item);
  }
  existing.provenance = mergeProvenance(existing.provenance, provenance);
}

function emitPawnBreaks(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  if (!value || !Array.isArray(value.breaks)) return;
  for (const candidate of value.breaks) {
    const item = objectValue(candidate);
    if (!item) continue;
    const side = validSide(item.subject);
    const from = validSquare(item.from);
    const to = validSquare(item.to);
    if (!side || !from || !to) continue;
    const itemConfidence = numberValue(item.confidence) ?? signal.confidence;
    emit(
      concepts,
      snapshot,
      [signal],
      `pawn-break.${side}.${from}-${to}`,
      "pawn-break",
      "stable-likely-pawn-break",
      `${sideLabel(side)} ${from}–${to} pawn break`,
      Math.min(signal.confidence, itemConfidence),
    );
  }
}

function emitFormation(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  const formation = value ? validToken(value.formation_id) : null;
  if (!formation || formation === "unknown") return;
  emit(
    concepts,
    snapshot,
    [signal],
    `setup-family.pawn-formation.${formation}`,
    "setup-family",
    "stable-pawn-formation",
    `${title(formation)} pawn formation`,
    signal.confidence,
  );
}

function emitCastlingSetups(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  if (!value) return;
  for (const side of ["repertoire", "opponent"] as const) {
    const setup = objectValue(value[side]);
    const wing = setup ? validToken(setup.side) : null;
    if (!setup || setup.castled !== true || (wing !== "kingside" && wing !== "queenside")) continue;
    emit(
      concepts,
      snapshot,
      [signal],
      `setup-family.castling.${side}.${wing}`,
      "setup-family",
      "castling-setup",
      `${sideLabel(side)} ${wing === "kingside" ? "short" : "long"} castling setup`,
      signal.confidence,
      numberValue(setup.at_ply) ?? snapshot.checkpoint.ply,
    );
  }
}

function emitFianchettoSetups(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  if (!value) return;
  for (const side of ["repertoire", "opponent"] as const) {
    const setup = objectValue(value[side]);
    if (!setup) continue;
    const firstObserved = objectValue(setup.first_observed_ply);
    for (const wing of stringArray(setup.wings).sort()) {
      if (wing !== "kingside" && wing !== "queenside") continue;
      emit(
        concepts,
        snapshot,
        [signal],
        `setup-family.fianchetto.${side}.${wing}`,
        "setup-family",
        "fianchetto-setup",
        `${sideLabel(side)} ${wing} fianchetto setup`,
        signal.confidence,
        firstObserved ? numberValue(firstObserved[wing]) ?? snapshot.checkpoint.ply : snapshot.checkpoint.ply,
      );
    }
  }
}

function emitBishopPairSetups(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  if (!value) return;
  for (const side of ["repertoire", "opponent"] as const) {
    const setup = objectValue(value[side]);
    if (!setup || setup.has_pair !== true) continue;
    emit(
      concepts,
      snapshot,
      [signal],
      `setup-family.bishop-pair.${side}`,
      "setup-family",
      "bishop-pair-setup",
      `${sideLabel(side)} bishop-pair setup`,
      signal.confidence,
      snapshot.checkpoint.ply,
      "stable",
    );
  }
}

function emitRecurringPlacements(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  if (!value || !Array.isArray(value.placements)) return;
  for (const candidate of value.placements) {
    const placement = objectValue(candidate);
    if (!placement) continue;
    const side = validSide(placement.side);
    const role = validToken(placement.role);
    const square = validSquare(placement.square);
    if (!side || !role || !square) continue;
    emit(
      concepts,
      snapshot,
      [signal],
      `setup-family.piece-placement.${side}.${role}.${square}`,
      "setup-family",
      "recurring-piece-placement",
      `${sideLabel(side)} ${role} setup on ${square}`,
      signal.confidence,
      numberValue(placement.first_ply) ?? snapshot.checkpoint.ply,
    );
  }
}

function emitPawnExpansionPlans(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  if (!value) return;
  for (const side of ["repertoire", "opponent"] as const) {
    const expansion = objectValue(value[side]);
    if (!expansion) continue;
    for (const wing of ["queenside", "kingside"] as const) {
      // One advanced wing pawn is ordinary opening development. Two observed pawns are the
      // conservative deterministic threshold for naming an expansion plan.
      if (stringArray(expansion[wing]).length < 2) continue;
      emit(
        concepts,
        snapshot,
        [signal],
        `plan.pawn-expansion.${side}.${wing}`,
        "plan",
        "observed-pawn-expansion",
        `${sideLabel(side)} ${wing} pawn expansion`,
        signal.confidence,
      );
    }
  }
}

function emitExchangePatterns(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  if (!value || !Array.isArray(value.exchanges)) return;
  for (const candidate of value.exchanges) {
    const exchange = objectValue(candidate);
    if (!exchange || (numberValue(exchange.count) ?? 0) < 1) continue;
    const side = validSide(exchange.capturing_side);
    const capturingRole = validToken(exchange.capturing_role);
    const capturedRole = validToken(exchange.captured_role);
    if (!side || !capturingRole || !capturedRole) continue;
    emit(
      concepts,
      snapshot,
      [signal],
      `exchange.${side}.${capturingRole}-for-${capturedRole}`,
      "exchange",
      "observed-exchange-pattern",
      `${sideLabel(side)} ${capturingRole}-for-${capturedRole} exchange`,
      signal.confidence,
      numberValue(exchange.first_ply) ?? snapshot.checkpoint.ply,
    );
  }
}

function emitRookFilePlans(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  fileSignal: StrategicSignal,
  placementSignal: StrategicSignal,
): void {
  const fileValue = objectValue(fileSignal.value);
  const placementValue = objectValue(placementSignal.value);
  if (!fileValue || !placementValue || !Array.isArray(placementValue.placements)) return;
  const open = new Set(stringArray(fileValue.open));
  const halfOpen = objectValue(fileValue.half_open);
  for (const candidate of placementValue.placements) {
    const placement = objectValue(candidate);
    if (!placement || placement.role !== "rook") continue;
    const side = validSide(placement.side);
    const square = validSquare(placement.square);
    if (!side || !square) continue;
    const file = square[0]!;
    const available = open.has(file) || (halfOpen ? stringArray(halfOpen[side]).includes(file) : false);
    if (!available) continue;
    emit(
      concepts,
      snapshot,
      [fileSignal, placementSignal],
      `plan.rook-on-open-file.${side}.${file}`,
      "plan",
      "rook-on-open-file",
      `${sideLabel(side)} rook use of the ${file}-file`,
      Math.min(fileSignal.confidence, placementSignal.confidence),
      numberValue(placement.first_ply) ?? snapshot.checkpoint.ply,
    );
  }
}

function emitTacticalPrerequisites(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signals: readonly StrategicSignal[],
): void {
  const castling = byFeature(signals, "king.castling-history");
  if (castling) {
    const value = objectValue(castling.value);
    const repertoire = value ? objectValue(value.repertoire) : null;
    const opponent = value ? objectValue(value.opponent) : null;
    if (
      repertoire?.castled === true && opponent?.castled === true &&
      typeof repertoire.side === "string" && typeof opponent.side === "string" &&
      repertoire.side !== opponent.side
    ) {
      emit(
        concepts,
        snapshot,
        [castling],
        "tactical-prerequisite.opposite-side-castling",
        "tactical-risk-prerequisite",
        "opposite-side-castling-prerequisite",
        "Opposite-side castling tactical prerequisite",
        castling.confidence,
      );
    }
  }

  const queens = byFeature(signals, "piece.queen-retention");
  const center = byFeature(signals, "center-dynamics.fluidity");
  if (!queens || !center) return;
  const queenValue = objectValue(queens.value);
  const centerValue = objectValue(center.value);
  const repertoire = queenValue ? objectValue(queenValue.repertoire) : null;
  const opponent = queenValue ? objectValue(queenValue.opponent) : null;
  if (
    repertoire?.status === "retained" && opponent?.status === "retained" &&
    centerValue?.state === "fluid"
  ) {
    emit(
      concepts,
      snapshot,
      [queens, center],
      "tactical-prerequisite.queens-retained-fluid-center",
      "tactical-risk-prerequisite",
      "queens-retained-fluid-center-prerequisite",
      "Queens retained with a fluid center",
      Math.min(queens.confidence, center.confidence),
    );
  }
}

function emitEndgameTendencies(
  concepts: Map<string, MutableConcept>,
  snapshot: StrategicSnapshot,
  signal: StrategicSignal,
): void {
  const value = objectValue(signal.value);
  if (!value || value.mutual_exchange !== true) return;
  emit(
    concepts,
    snapshot,
    [signal],
    "endgame-tendency.queenless",
    "endgame-tendency",
    "queenless-endgame-tendency",
    "Queenless endgame tendency",
    signal.confidence,
    Math.max(
      numberValue(objectValue(value.repertoire)?.first_lost_ply) ?? snapshot.checkpoint.ply,
      numberValue(objectValue(value.opponent)?.first_lost_ply) ?? snapshot.checkpoint.ply,
    ),
  );
}

function extractRouteConcepts(
  trajectory: StrategicTrajectory,
  labels: Map<string, StrategicConceptLabel>,
): StrategicRouteConcepts {
  const concepts = new Map<string, MutableConcept>();
  for (const snapshot of trajectory.snapshots) {
    const signals = stableSignals(snapshot);
    for (const signal of signals) {
      switch (signal.feature_id) {
        case "center-dynamics.likely-breaks":
          emitPawnBreaks(concepts, snapshot, signal);
          break;
        case "pawn-topology.named-formation":
          emitFormation(concepts, snapshot, signal);
          break;
        case "king.castling-history":
          emitCastlingSetups(concepts, snapshot, signal);
          break;
        case "piece.fianchetto-history":
          emitFianchettoSetups(concepts, snapshot, signal);
          break;
        case "piece.bishop-pair":
          emitBishopPairSetups(concepts, snapshot, signal);
          break;
        case "piece.recurring-placements":
          emitRecurringPlacements(concepts, snapshot, signal);
          break;
        case "space.wing-expansion":
          emitPawnExpansionPlans(concepts, snapshot, signal);
          break;
        case "piece.exchange-history":
          emitExchangePatterns(concepts, snapshot, signal);
          break;
        case "piece.queen-retention":
          emitEndgameTendencies(concepts, snapshot, signal);
          break;
      }
    }
    const files = byFeature(signals, "files.open-and-half-open");
    const placements = byFeature(signals, "piece.recurring-placements");
    if (files && placements) emitRookFilePlans(concepts, snapshot, files, placements);
    emitTacticalPrerequisites(concepts, snapshot, signals);
  }

  const result = [...concepts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([conceptId, concept]): StrategicConcept => {
      const existingLabel = labels.get(conceptId);
      if (existingLabel && existingLabel.label !== concept.label) {
        throw new Error(`strategic_fit_concept_label_collision: ${conceptId}`);
      }
      labels.set(conceptId, { concept_id: conceptId, locale: "en", label: concept.label });
      return {
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        classifier_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts,
        concept_id: conceptId,
        category: concept.category,
        rule_id: concept.ruleId,
        confidence: concept.confidence,
        persistence: concept.persistence,
        first_observed_ply: concept.firstObservedPly,
        evidence: [...concept.evidence.values()].sort((left, right) =>
          left.ply - right.ply ||
          left.snapshot_id.localeCompare(right.snapshot_id) ||
          left.signal_id.localeCompare(right.signal_id)
        ),
        provenance: concept.provenance,
      };
    });
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    classifier_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts,
    trajectory_id: trajectory.trajectory_id,
    route_id: trajectory.route_id,
    concepts: result,
    provenance: mergeProvenance(
      [CLASSIFIER_PROVENANCE],
      trajectory.provenance,
      ...result.map((concept) => concept.provenance),
    ),
  };
}

/** Build the versioned concept dictionary for every trajectory in a report. */
export function buildStrategicConceptDictionary(
  trajectories: StrategicTrajectoryReport,
): StrategicConceptDictionary {
  if (trajectories.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION) {
    throw new Error(`strategic_fit_concept_version_mismatch: ${trajectories.analysis_version}`);
  }
  if (new Set(trajectories.trajectories.map((trajectory) => trajectory.route_id)).size !== trajectories.trajectories.length) {
    throw new Error("strategic_fit_concept_duplicate_route");
  }
  const labels = new Map<string, StrategicConceptLabel>();
  const routes = trajectories.trajectories.map((trajectory) => extractRouteConcepts(trajectory, labels));
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    classifier_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts,
    graph_id: trajectories.graph_id,
    routes,
    labels: [...labels.values()].sort((left, right) => left.concept_id.localeCompare(right.concept_id)),
    provenance: mergeProvenance(
      [CLASSIFIER_PROVENANCE],
      trajectories.provenance,
      ...routes.map((route) => route.provenance),
    ),
  };
}

/** Compute deterministic route-level concept overlap without using display labels. */
export function computeStrategicConceptOverlap(
  left: StrategicRouteConcepts,
  right: StrategicRouteConcepts,
): StrategicConceptOverlap {
  const leftIds = new Set(left.concepts.map((concept) => concept.concept_id));
  const rightIds = new Set(right.concepts.map((concept) => concept.concept_id));
  const shared = [...leftIds].filter((conceptId) => rightIds.has(conceptId)).sort();
  const leftOnly = [...leftIds].filter((conceptId) => !rightIds.has(conceptId)).sort();
  const rightOnly = [...rightIds].filter((conceptId) => !leftIds.has(conceptId)).sort();
  const unionSize = shared.length + leftOnly.length + rightOnly.length;
  return {
    shared_concept_ids: shared,
    left_only_concept_ids: leftOnly,
    right_only_concept_ids: rightOnly,
    overlap: unionSize === 0 ? 1 : round(shared.length / unionSize),
  };
}
