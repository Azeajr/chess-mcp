/**
 * Deterministic, explainable strategic-map projection over a completed Strategic Fit report.
 *
 * The map is a presentation projection like `report-projection.ts`: it consumes only retained
 * report evidence, never re-runs analysis, and never participates in cache identity. Coordinates
 * are anchor distances, not an opaque embedding: the horizontal axis is the canonical explainable
 * strategic distance from the heaviest strategic mode's representative route, and the vertical
 * axis is the distance from the second anchor mode. Every point retains the exact per-family and
 * per-feature contributions of both axis distances, so proximity is always explainable with the
 * same arithmetic that produced the coordinates.
 *
 * Routes without comparable shared evidence receive no fabricated position: they are listed as
 * explicit exclusions with a structured reason. Route concepts are not retained inside the report,
 * so the learning-concepts family never contributes to map coordinates; that limitation is
 * recorded on the axes rather than silently ignored.
 */
import {
  computeStrategicTrajectoryDistance,
  type StrategicDistanceFamilyContribution,
  type StrategicDistanceFeatureContribution,
  type StrategicTrajectoryDistance,
} from "./distance.js";
import type { StrategicRouteConcepts } from "./concepts.js";
import type {
  StrategicCohort,
  StrategicFinding,
  StrategicFitProfile,
  StrategicFitProvenance,
  StrategicFitSourceProvenance,
  StrategicSignalFamily,
  StrategicTrajectory,
} from "./types.js";
import { STRATEGIC_SIGNAL_FAMILIES } from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_MANIFEST, STRATEGIC_FIT_ANALYSIS_VERSION } from "./version.js";

/** Bump when coordinate semantics change so persisted or compared coordinates never mix silently. */
export const STRATEGIC_MAP_PROJECTION_VERSION = "1.0.0";

export const STRATEGIC_MAP_STATES = ["available", "single-axis", "unavailable"] as const;
export type StrategicMapState = (typeof STRATEGIC_MAP_STATES)[number];

export const STRATEGIC_MAP_EXCLUSION_REASONS = [
  "excluded-from-cohort",
  "missing-trajectory",
  "no-comparable-anchor-evidence",
] as const;
export type StrategicMapExclusionReason = (typeof STRATEGIC_MAP_EXCLUSION_REASONS)[number];

export const STRATEGIC_MAP_RESOLUTION_STATES = [
  "unresolved-finding",
  "resolved-finding",
  "no-finding",
] as const;
export type StrategicMapResolutionState = (typeof STRATEGIC_MAP_RESOLUTION_STATES)[number];

export type StrategicMapAxisId = "x" | "y";

export const STRATEGIC_MAP_ANCHOR_SOURCES = ["mode-representative", "heaviest-route"] as const;
export type StrategicMapAnchorSource = (typeof STRATEGIC_MAP_ANCHOR_SOURCES)[number];

export interface StrategicMapAxisAnchor {
  readonly axis: StrategicMapAxisId;
  readonly source: StrategicMapAnchorSource;
  /** Null when no cohort produced a strategic mode and a weighted route anchors the axis instead. */
  readonly mode_id: string | null;
  readonly cohort_id: string;
  readonly representative_route_id: string;
  readonly normalized_weight: number;
  readonly explanation: string;
}

export interface StrategicMapExcludedFamily {
  readonly family: StrategicSignalFamily;
  readonly reason: string;
}

export interface StrategicMapAxes {
  readonly x: StrategicMapAxisAnchor | null;
  readonly y: StrategicMapAxisAnchor | null;
  readonly excluded_families: readonly StrategicMapExcludedFamily[];
}

export interface StrategicMapAxisBreakdown {
  readonly axis: StrategicMapAxisId;
  readonly distance: number;
  readonly matched_checkpoint_keys: readonly string[];
  readonly family_contributions: readonly StrategicDistanceFamilyContribution[];
  readonly top_feature_contributions: readonly StrategicDistanceFeatureContribution[];
}

export interface StrategicMapPoint {
  readonly route_id: string;
  readonly cohort_id: string;
  readonly trajectory_id: string;
  /** Anchor distances in the range 0-1; the exact contribution arithmetic is retained per axis. */
  readonly x: number;
  readonly y: number;
  /** Canonical report route weight inside its cohort; drives point size. */
  readonly normalized_weight: number;
  /** Trajectory evidence coverage in the range 0-1; drives point opacity. */
  readonly confidence: number;
  /** Deterministic categorical color index over the sorted cohort identifiers. */
  readonly color_index: number;
  readonly resolution: StrategicMapResolutionState;
  readonly finding_ids: readonly string[];
  readonly is_anchor: StrategicMapAxisId | null;
  readonly axis_breakdowns: readonly StrategicMapAxisBreakdown[];
}

export interface StrategicMapTranspositionEdge {
  readonly from_route_id: string;
  readonly to_route_id: string;
  readonly shared_position_ids: readonly string[];
}

export interface StrategicMapExclusion {
  readonly route_id: string;
  readonly cohort_id: string;
  readonly reason: StrategicMapExclusionReason;
  readonly explanation: string;
}

export interface StrategicMapColorGroup {
  readonly cohort_id: string;
  readonly color_index: number;
  readonly route_count: number;
}

export interface StrategicMapProjection {
  readonly projection_version: string;
  readonly analysis_version: string;
  readonly distance_version: string;
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly state: StrategicMapState;
  readonly reason: string | null;
  readonly axes: StrategicMapAxes;
  readonly points: readonly StrategicMapPoint[];
  readonly edges: readonly StrategicMapTranspositionEdge[];
  readonly exclusions: readonly StrategicMapExclusion[];
  readonly color_groups: readonly StrategicMapColorGroup[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

/** The report fields the map consumes; both a report and a paged analysis result satisfy it. */
export interface StrategicMapReportInput {
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly analysis_version: string;
  readonly profile: StrategicFitProfile;
  readonly trajectories: readonly StrategicTrajectory[];
  readonly cohorts: readonly StrategicCohort[];
  readonly findings: readonly StrategicFinding[];
  readonly provenance: StrategicFitProvenance;
}

export interface StrategicMapOptions {
  /**
   * Complete finding set when the input carries only one page. Findings decide border/resolution
   * presentation only; coordinates never depend on them.
   */
  readonly findings?: readonly StrategicFinding[];
  /** Feature contributions retained per axis breakdown, largest first. */
  readonly top_feature_count?: number;
}

const DEFAULT_TOP_FEATURE_COUNT = 3;

const MAP_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:strategic-map",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_MAP_PROJECTION_VERSION,
  snapshot: null,
  reason: null,
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function emptyConcepts(trajectory: StrategicTrajectory): StrategicRouteConcepts {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    classifier_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts,
    trajectory_id: trajectory.trajectory_id,
    route_id: trajectory.route_id,
    concepts: [],
    provenance: [],
  };
}

interface AnchorCandidate {
  readonly source: StrategicMapAnchorSource;
  readonly mode_id: string | null;
  readonly cohort_id: string;
  readonly route_id: string;
  readonly normalized_weight: number;
  readonly score: number;
}

/** An anchor must carry comparable non-final evidence or every distance to it would be null. */
function canAnchor(trajectory: StrategicTrajectory | undefined): boolean {
  return (
    trajectory !== undefined &&
    trajectory.snapshots.some(
      (snapshot) =>
        snapshot.checkpoint.comparability === "comparable" &&
        snapshot.checkpoint.kind !== "final-valid-position",
    )
  );
}

/**
 * Deterministic anchor preference: real strategic-mode representatives ordered by expected weight,
 * then — only when no cohort produced a mode at all, as happens for small repertoires with
 * single-route cohorts — the cohorts' heaviest routes themselves. Both stay explainable because an
 * anchor is always a real repertoire route, never a synthetic centroid.
 */
function anchorCandidates(
  cohorts: readonly StrategicCohort[],
  trajectoriesByRoute: ReadonlyMap<string, StrategicTrajectory>,
): AnchorCandidate[] {
  const modeCandidates: AnchorCandidate[] = cohorts
    .flatMap((cohort) =>
      cohort.modes.map((mode) => ({
        source: "mode-representative" as const,
        mode_id: mode.mode_id,
        cohort_id: cohort.cohort_id,
        route_id: mode.representative_route_id,
        normalized_weight: mode.normalized_weight,
        score: mode.normalized_weight * Math.max(cohort.effective_sample_size, 0),
      })),
    )
    .filter((candidate) => canAnchor(trajectoriesByRoute.get(candidate.route_id)))
    .sort(
      (left, right) =>
        right.score - left.score || compareStrings(left.mode_id ?? "", right.mode_id ?? ""),
    );
  if (modeCandidates.length > 0) return modeCandidates;
  return cohorts
    .filter((cohort) => cohort.state !== "excluded")
    .flatMap((cohort) =>
      cohort.route_weights.map((weight) => ({
        source: "heaviest-route" as const,
        mode_id: null,
        cohort_id: cohort.cohort_id,
        route_id: weight.route_id,
        normalized_weight: weight.normalized_weight,
        score: weight.normalized_weight * Math.max(cohort.effective_sample_size, 0),
      })),
    )
    .filter((candidate) => canAnchor(trajectoriesByRoute.get(candidate.route_id)))
    .sort(
      (left, right) => right.score - left.score || compareStrings(left.route_id, right.route_id),
    );
}

function axisAnchor(axis: StrategicMapAxisId, candidate: AnchorCandidate): StrategicMapAxisAnchor {
  const anchorNoun =
    candidate.source === "mode-representative"
      ? "strategic mode's representative route"
      : "weighted repertoire route (no cohort produced a strategic mode)";
  return {
    axis,
    source: candidate.source,
    mode_id: candidate.mode_id,
    cohort_id: candidate.cohort_id,
    representative_route_id: candidate.route_id,
    normalized_weight: candidate.normalized_weight,
    explanation:
      axis === "x"
        ? `Horizontal position is the explainable strategic distance from the heaviest ${anchorNoun}.`
        : `Vertical position is the explainable strategic distance from the second anchor ${anchorNoun}.`,
  };
}

function excludedFamilies(profile: StrategicFitProfile): StrategicMapExcludedFamily[] {
  const excluded: StrategicMapExcludedFamily[] = [
    {
      family: "learning-concepts",
      reason:
        "Route concepts are not retained inside the report, so supported-concept overlap cannot contribute to map coordinates.",
    },
  ];
  for (const family of STRATEGIC_SIGNAL_FAMILIES) {
    if (family === "learning-concepts") continue;
    if ((profile.preferences.feature_family_weights[family] ?? 0) <= 0) {
      excluded.push({
        family,
        reason:
          "The active profile assigns this feature family zero weight, so it does not contribute to map coordinates.",
      });
    }
  }
  return excluded;
}

function axisBreakdown(
  axis: StrategicMapAxisId,
  distance: StrategicTrajectoryDistance,
  topFeatureCount: number,
): StrategicMapAxisBreakdown {
  return {
    axis,
    distance: distance.distance ?? 0,
    matched_checkpoint_keys: distance.matched_checkpoint_keys,
    family_contributions: distance.family_contributions,
    top_feature_contributions: [...distance.feature_contributions]
      .sort(
        (left, right) =>
          Math.abs(right.contribution) - Math.abs(left.contribution) ||
          compareStrings(left.feature_id, right.feature_id),
      )
      .slice(0, topFeatureCount),
  };
}

function unavailableProjection(
  input: StrategicMapReportInput,
  reason: string,
  axes: StrategicMapAxes,
  exclusions: readonly StrategicMapExclusion[],
): StrategicMapProjection {
  return {
    projection_version: STRATEGIC_MAP_PROJECTION_VERSION,
    analysis_version: input.analysis_version,
    distance_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.distance,
    report_id: input.report_id,
    repertoire_revision: input.repertoire_revision,
    state: "unavailable",
    reason,
    axes,
    points: [],
    edges: [],
    exclusions,
    color_groups: [],
    provenance: [MAP_PROVENANCE],
  };
}

function snapshotSequence(
  trajectory: StrategicTrajectory,
): readonly { readonly ply: number; readonly position_id: string }[] {
  return [...trajectory.snapshots]
    .sort((left, right) => left.checkpoint.ply - right.checkpoint.ply)
    .map((snapshot) => ({ ply: snapshot.checkpoint.ply, position_id: snapshot.position_id }));
}

/**
 * Two plotted routes are transposition-linked only when their retained snapshots prove observable
 * divergence before convergence: some earlier snapshot pair differs in both routes and a later
 * snapshot position is shared. Routes that merely share a common prefix never qualify, and
 * convergence that happens between retained checkpoints stays conservatively unlinked.
 */
function transpositionEdges(
  points: readonly StrategicMapPoint[],
  trajectoriesByRoute: ReadonlyMap<string, StrategicTrajectory>,
): StrategicMapTranspositionEdge[] {
  const sequences = points.map((point) => ({
    route_id: point.route_id,
    snapshots: snapshotSequence(trajectoriesByRoute.get(point.route_id)!),
  }));
  const edges: StrategicMapTranspositionEdge[] = [];
  for (let leftIndex = 0; leftIndex < sequences.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < sequences.length; rightIndex++) {
      const left = sequences[leftIndex]!;
      const right = sequences[rightIndex]!;
      const shared: string[] = [];
      for (const leftSnapshot of left.snapshots) {
        for (const rightSnapshot of right.snapshots) {
          if (leftSnapshot.position_id !== rightSnapshot.position_id) continue;
          const divergedBefore = left.snapshots.some(
            (earlierLeft) =>
              earlierLeft.ply < leftSnapshot.ply &&
              right.snapshots.some(
                (earlierRight) =>
                  earlierRight.ply < rightSnapshot.ply &&
                  earlierRight.position_id !== earlierLeft.position_id &&
                  !left.snapshots.some((probe) => probe.position_id === earlierRight.position_id) &&
                  !right.snapshots.some((probe) => probe.position_id === earlierLeft.position_id),
              ),
          );
          if (divergedBefore && !shared.includes(leftSnapshot.position_id)) {
            shared.push(leftSnapshot.position_id);
          }
        }
      }
      if (shared.length > 0) {
        const [fromRoute, toRoute] = [left.route_id, right.route_id].sort(compareStrings);
        edges.push({
          from_route_id: fromRoute!,
          to_route_id: toRoute!,
          shared_position_ids: shared.sort(compareStrings),
        });
      }
    }
  }
  return edges.sort(
    (first, second) =>
      compareStrings(first.from_route_id, second.from_route_id) ||
      compareStrings(first.to_route_id, second.to_route_id),
  );
}

/** Build the deterministic strategic-map projection from one completed report. */
export function buildStrategicMapProjection(
  input: StrategicMapReportInput,
  options: StrategicMapOptions = {},
): StrategicMapProjection {
  const topFeatureCount = options.top_feature_count ?? DEFAULT_TOP_FEATURE_COUNT;
  const findings = options.findings ?? input.findings;
  const trajectoriesByRoute = new Map(
    input.trajectories.map((trajectory) => [trajectory.route_id, trajectory]),
  );
  const sortedCohorts = [...input.cohorts].sort((left, right) =>
    compareStrings(left.cohort_id, right.cohort_id),
  );
  const colorIndexByCohort = new Map(
    sortedCohorts.map((cohort, index) => [cohort.cohort_id, index]),
  );
  const distanceOptions = {
    feature_family_weights: input.profile.preferences.feature_family_weights,
  };
  const axesLimitations = excludedFamilies(input.profile);
  const exclusions: StrategicMapExclusion[] = [];

  for (const cohort of sortedCohorts) {
    for (const routeId of [...cohort.excluded_route_ids].sort(compareStrings)) {
      exclusions.push({
        route_id: routeId,
        cohort_id: cohort.cohort_id,
        reason: "excluded-from-cohort",
        explanation:
          "This route is excluded from its cohort's analysis, so it receives no map position.",
      });
    }
  }

  const candidates = anchorCandidates(sortedCohorts, trajectoriesByRoute);
  const primary = candidates[0] ?? null;
  if (primary === null) {
    for (const cohort of sortedCohorts) {
      if (cohort.state === "excluded") continue;
      for (const routeId of [...cohort.route_ids].sort(compareStrings)) {
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "no-comparable-anchor-evidence",
          explanation:
            "No route in this report carries comparable strategic evidence, so no anchor axis and no honest position exist.",
        });
      }
    }
    exclusions.sort(
      (left, right) =>
        compareStrings(left.cohort_id, right.cohort_id) ||
        compareStrings(left.route_id, right.route_id),
    );
    return unavailableProjection(
      input,
      "The report retains no route trajectory with comparable strategic evidence that could anchor the map axes.",
      { x: null, y: null, excluded_families: axesLimitations },
      exclusions,
    );
  }
  const anchorXTrajectory = trajectoriesByRoute.get(primary.route_id)!;
  const anchorXConcepts = emptyConcepts(anchorXTrajectory);
  const distanceToX = (trajectory: StrategicTrajectory): StrategicTrajectoryDistance =>
    computeStrategicTrajectoryDistance(
      trajectory,
      anchorXTrajectory,
      emptyConcepts(trajectory),
      anchorXConcepts,
      distanceOptions,
    );

  let secondary: AnchorCandidate | null = null;
  for (const candidate of candidates.slice(1)) {
    if (candidate.route_id === primary.route_id) continue;
    const separation = distanceToX(trajectoriesByRoute.get(candidate.route_id)!);
    if (separation.distance !== null && separation.distance > 0) {
      secondary = candidate;
      break;
    }
  }
  const anchorYTrajectory =
    secondary === null ? null : trajectoriesByRoute.get(secondary.route_id)!;
  const anchorYConcepts = anchorYTrajectory === null ? null : emptyConcepts(anchorYTrajectory);

  const axes: StrategicMapAxes = {
    x: axisAnchor("x", primary),
    y: secondary === null ? null : axisAnchor("y", secondary),
    excluded_families: axesLimitations,
  };

  const findingsByRoute = new Map<string, StrategicFinding[]>();
  for (const finding of findings) {
    for (const routeId of finding.references.route_ids) {
      const existing = findingsByRoute.get(routeId);
      if (existing === undefined) findingsByRoute.set(routeId, [finding]);
      else existing.push(finding);
    }
  }

  const points: StrategicMapPoint[] = [];
  for (const cohort of sortedCohorts) {
    if (cohort.state === "excluded") {
      for (const routeId of [...cohort.route_ids].sort(compareStrings)) {
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "excluded-from-cohort",
          explanation:
            "This route's cohort is excluded from analysis, so it receives no map position.",
        });
      }
      continue;
    }
    const weightByRoute = new Map(
      cohort.route_weights.map((weight) => [weight.route_id, weight.normalized_weight]),
    );
    for (const routeId of [...cohort.route_ids].sort(compareStrings)) {
      const trajectory = trajectoriesByRoute.get(routeId);
      if (trajectory === undefined) {
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "missing-trajectory",
          explanation:
            "The report retains no trajectory for this route, so no coordinates can be calculated.",
        });
        continue;
      }
      const xDistance = distanceToX(trajectory);
      const yDistance =
        anchorYTrajectory === null || anchorYConcepts === null
          ? null
          : computeStrategicTrajectoryDistance(
              trajectory,
              anchorYTrajectory,
              emptyConcepts(trajectory),
              anchorYConcepts,
              distanceOptions,
            );
      const xUsable = xDistance.distance !== null;
      const yUsable =
        anchorYTrajectory === null || (yDistance !== null && yDistance.distance !== null);
      if (!xUsable || !yUsable) {
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "no-comparable-anchor-evidence",
          explanation:
            "This route shares no supported comparable evidence with an anchor route, so a position would be fabricated rather than measured.",
        });
        continue;
      }
      const routeFindings = (findingsByRoute.get(routeId) ?? []).sort((left, right) =>
        compareStrings(left.finding_id, right.finding_id),
      );
      const resolution: StrategicMapResolutionState =
        routeFindings.length === 0
          ? "no-finding"
          : routeFindings.some((finding) => finding.resolution_state === "unresolved")
            ? "unresolved-finding"
            : "resolved-finding";
      const breakdowns: StrategicMapAxisBreakdown[] = [
        axisBreakdown("x", xDistance, topFeatureCount),
      ];
      if (yDistance !== null) breakdowns.push(axisBreakdown("y", yDistance, topFeatureCount));
      points.push({
        route_id: routeId,
        cohort_id: cohort.cohort_id,
        trajectory_id: trajectory.trajectory_id,
        x: xDistance.distance ?? 0,
        y: yDistance?.distance ?? 0,
        normalized_weight: weightByRoute.get(routeId) ?? 0,
        confidence: trajectory.evidence_coverage,
        color_index: colorIndexByCohort.get(cohort.cohort_id)!,
        resolution,
        finding_ids: routeFindings.map((finding) => finding.finding_id),
        is_anchor:
          routeId === primary.route_id ? "x" : routeId === secondary?.route_id ? "y" : null,
        axis_breakdowns: breakdowns,
      });
    }
  }
  points.sort(
    (left, right) =>
      compareStrings(left.cohort_id, right.cohort_id) ||
      compareStrings(left.route_id, right.route_id),
  );
  exclusions.sort(
    (left, right) =>
      compareStrings(left.cohort_id, right.cohort_id) ||
      compareStrings(left.route_id, right.route_id),
  );

  const edges = transpositionEdges(points, trajectoriesByRoute);

  const colorGroups: StrategicMapColorGroup[] = sortedCohorts.map((cohort, index) => ({
    cohort_id: cohort.cohort_id,
    color_index: index,
    route_count: points.filter((point) => point.cohort_id === cohort.cohort_id).length,
  }));

  if (points.length === 0) {
    return {
      ...unavailableProjection(
        input,
        "No route shares comparable evidence with the anchor routes, so the map has no honest positions to show.",
        axes,
        exclusions,
      ),
    };
  }

  return {
    projection_version: STRATEGIC_MAP_PROJECTION_VERSION,
    analysis_version: input.analysis_version,
    distance_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.distance,
    report_id: input.report_id,
    repertoire_revision: input.repertoire_revision,
    state: secondary === null ? "single-axis" : "available",
    reason:
      secondary === null
        ? "Only one usable strategic mode anchor exists, so every point sits on the horizontal axis."
        : null,
    axes,
    points,
    edges,
    exclusions,
    color_groups: colorGroups,
    provenance: [MAP_PROVENANCE],
  };
}
