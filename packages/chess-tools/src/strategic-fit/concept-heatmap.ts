import {
  deriveStrategicRouteConcepts,
  type StrategicConceptCategory,
  type StrategicConceptLabel,
} from "./concepts.js";
import type { StrategicFitTrainingMasteryReport } from "./training.js";
import type {
  StrategicCohort,
  StrategicFinding,
  StrategicFitProfile,
  StrategicFitSourceProvenance,
  StrategicTrajectory,
} from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_MANIFEST } from "./version.js";
import { assertDefined } from "../assert.js";

export const CONCEPT_HEATMAP_PROJECTION_VERSION = "1.0.0";

export const CONCEPT_HEATMAP_STATES = ["available", "unavailable"] as const;
export type ConceptHeatmapState = (typeof CONCEPT_HEATMAP_STATES)[number];

export const CONCEPT_HEATMAP_MASTERY_STATES = [
  "observed",
  "stale",
  "untrained",
  "unavailable",
] as const;
export type ConceptHeatmapMasteryState = (typeof CONCEPT_HEATMAP_MASTERY_STATES)[number];

export const CONCEPT_HEATMAP_INTENT_STATES = ["preferred", "avoided", "not-declared"] as const;
export type ConceptHeatmapIntentState = (typeof CONCEPT_HEATMAP_INTENT_STATES)[number];

export const CONCEPT_HEATMAP_EXCLUSION_REASONS = [
  "excluded-from-cohort",
  "missing-trajectory",
] as const;
export type ConceptHeatmapExclusionReason = (typeof CONCEPT_HEATMAP_EXCLUSION_REASONS)[number];

export interface ConceptHeatmapMastery {
  readonly value: number | null;
  readonly state: ConceptHeatmapMasteryState;
  readonly attempt_count: number;
  readonly reason: string | null;
}

export interface ConceptHeatmapColumn {
  readonly concept_id: string;
  readonly label: string;
  readonly category: StrategicConceptCategory;
  readonly intent: ConceptHeatmapIntentState;
  readonly mastery: ConceptHeatmapMastery;
  readonly cohort_count: number;
  readonly max_expected_frequency: number;
}

export interface ConceptHeatmapRow {
  readonly cohort_id: string;
  readonly route_count: number;
}

export interface ConceptHeatmapCell {
  readonly cohort_id: string;
  readonly concept_id: string;
  readonly expected_frequency: number;
  readonly confidence: number;
  readonly route_ids: readonly string[];
  readonly finding_ids: readonly string[];
}

export interface ConceptHeatmapExclusion {
  readonly route_id: string;
  readonly cohort_id: string;
  readonly reason: ConceptHeatmapExclusionReason;
  readonly explanation: string;
}

export interface ConceptHeatmapProjection {
  readonly projection_version: string;
  readonly analysis_version: string;
  readonly concepts_version: string;
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly state: ConceptHeatmapState;
  readonly reason: string | null;
  readonly rows: readonly ConceptHeatmapRow[];
  readonly columns: readonly ConceptHeatmapColumn[];
  readonly cells: readonly ConceptHeatmapCell[];
  readonly exclusions: readonly ConceptHeatmapExclusion[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ConceptHeatmapReportInput {
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly analysis_version: string;
  readonly profile: StrategicFitProfile;
  readonly trajectories: readonly StrategicTrajectory[];
  readonly cohorts: readonly StrategicCohort[];
  readonly findings: readonly StrategicFinding[];
}

export interface ConceptHeatmapOptions {
  readonly findings?: readonly StrategicFinding[];
  readonly mastery?: StrategicFitTrainingMasteryReport | null;
}

const HEATMAP_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:concept-heatmap",
  kind: "deterministic-core",
  state: "available",
  version: CONCEPT_HEATMAP_PROJECTION_VERSION,
  snapshot: null,
  reason: null,
});

const CLASSIFIER_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:concept-classifier",
  kind: "concept-classifier",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts,
  snapshot: null,
  reason: null,
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function masteryProvenance(
  mastery: StrategicFitTrainingMasteryReport | null,
): StrategicFitSourceProvenance {
  if (mastery === null) {
    return {
      source_id: "strategic-fit:training-performance",
      kind: "training-metadata",
      state: "unavailable",
      version: null,
      snapshot: null,
      reason: "No training performance evidence was supplied to the heatmap.",
    };
  }
  return {
    source_id: "strategic-fit:training-performance",
    kind: "training-metadata",
    state: "available",
    version: mastery.training_performance_version,
    snapshot: mastery.generated_at,
    reason: null,
  };
}

function conceptMastery(
  conceptId: string,
  mastery: StrategicFitTrainingMasteryReport | null,
): ConceptHeatmapMastery {
  if (mastery === null) {
    return {
      value: null,
      state: "unavailable",
      attempt_count: 0,
      reason: "No training performance evidence was supplied, so mastery cannot be shown.",
    };
  }
  const statistic = mastery.concept_mastery.find(
    (candidate) => candidate.identity_id === conceptId,
  );
  if (statistic === undefined) {
    return {
      value: null,
      state: "untrained",
      attempt_count: 0,
      reason:
        "No training target references this concept, so mastery is untrained rather than zero.",
    };
  }
  return {
    value: statistic.mastery,
    state: statistic.state,
    attempt_count: statistic.attempt_count,
    reason:
      statistic.state === "stale"
        ? "The training targets behind this concept no longer match the current repertoire graph."
        : statistic.state === "untrained"
          ? "Training targets exist but no attempt has been recorded, so mastery is untrained rather than zero."
          : null,
  };
}

function conceptIntent(conceptId: string, profile: StrategicFitProfile): ConceptHeatmapIntentState {
  if (profile.preferences.preferred_concept_ids.includes(conceptId)) return "preferred";
  if (profile.preferences.avoided_concept_ids.includes(conceptId)) return "avoided";
  return "not-declared";
}

function unavailableProjection(
  input: ConceptHeatmapReportInput,
  reason: string,
  exclusions: readonly ConceptHeatmapExclusion[],
  mastery: StrategicFitTrainingMasteryReport | null,
): ConceptHeatmapProjection {
  return {
    projection_version: CONCEPT_HEATMAP_PROJECTION_VERSION,
    analysis_version: input.analysis_version,
    concepts_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts,
    report_id: input.report_id,
    repertoire_revision: input.repertoire_revision,
    state: "unavailable",
    reason,
    rows: [],
    columns: [],
    cells: [],
    exclusions,
    provenance: [HEATMAP_PROVENANCE, CLASSIFIER_PROVENANCE, masteryProvenance(mastery)],
  };
}

interface MutableCell {
  expectedFrequency: number;
  weightedConfidence: number;
  confidenceWeight: number;
  unweightedConfidenceSum: number;
  observationCount: number;
  routeIds: string[];
}

export function buildConceptHeatmapProjection(
  input: ConceptHeatmapReportInput,
  options: ConceptHeatmapOptions = {},
): ConceptHeatmapProjection {
  const mastery = options.mastery ?? null;
  const findings = options.findings ?? input.findings;
  const trajectoriesByRoute = new Map(
    input.trajectories.map((trajectory) => [trajectory.route_id, trajectory]),
  );
  const sortedCohorts = [...input.cohorts].sort((left, right) =>
    compareStrings(left.cohort_id, right.cohort_id),
  );
  const exclusions: ConceptHeatmapExclusion[] = [];
  const labels = new Map<string, StrategicConceptLabel>();
  const categories = new Map<string, StrategicConceptCategory>();
  const cellsByCohort = new Map<string, Map<string, MutableCell>>();
  const rows: ConceptHeatmapRow[] = [];

  for (const cohort of sortedCohorts) {
    for (const routeId of [...cohort.excluded_route_ids].sort(compareStrings)) {
      exclusions.push({
        route_id: routeId,
        cohort_id: cohort.cohort_id,
        reason: "excluded-from-cohort",
        explanation:
          "This route is excluded from its cohort's analysis, so it contributes no cells.",
      });
    }
    if (cohort.state === "excluded") {
      for (const routeId of [...cohort.route_ids].sort(compareStrings)) {
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "excluded-from-cohort",
          explanation: "This route's cohort is excluded from analysis, so it contributes no cells.",
        });
      }
      continue;
    }
    const weightByRoute = new Map(
      cohort.route_weights.map((weight) => [weight.route_id, weight.normalized_weight]),
    );
    let routeCount = 0;
    for (const routeId of [...cohort.route_ids].sort(compareStrings)) {
      const trajectory = trajectoriesByRoute.get(routeId);
      if (trajectory === undefined) {
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "missing-trajectory",
          explanation:
            "The report retains no trajectory for this route, so its concepts cannot be derived.",
        });
        continue;
      }
      routeCount += 1;
      const routeConcepts = deriveStrategicRouteConcepts(trajectory, labels);
      const weight = weightByRoute.get(routeId) ?? 0;
      const cohortCells = cellsByCohort.get(cohort.cohort_id) ?? new Map<string, MutableCell>();
      cellsByCohort.set(cohort.cohort_id, cohortCells);
      for (const concept of routeConcepts.concepts) {
        categories.set(concept.concept_id, concept.category);
        const cell = cohortCells.get(concept.concept_id) ?? {
          expectedFrequency: 0,
          weightedConfidence: 0,
          confidenceWeight: 0,
          unweightedConfidenceSum: 0,
          observationCount: 0,
          routeIds: [],
        };
        cell.expectedFrequency += weight;
        cell.weightedConfidence += weight * concept.confidence;
        cell.confidenceWeight += weight;
        cell.unweightedConfidenceSum += concept.confidence;
        cell.observationCount += 1;
        cell.routeIds.push(routeId);
        cohortCells.set(concept.concept_id, cell);
      }
    }
    if (routeCount > 0) rows.push({ cohort_id: cohort.cohort_id, route_count: routeCount });
  }

  exclusions.sort(
    (left, right) =>
      compareStrings(left.cohort_id, right.cohort_id) ||
      compareStrings(left.route_id, right.route_id),
  );

  if (rows.length === 0) {
    return unavailableProjection(
      input,
      "The report retains no analyzable route trajectory, so no concept observations exist.",
      exclusions,
      mastery,
    );
  }
  if (labels.size === 0) {
    return unavailableProjection(
      input,
      "No stable strategic concept was observed in the retained checkpoint evidence.",
      exclusions,
      mastery,
    );
  }

  const findingsByRoute = new Map<string, string[]>();
  for (const finding of findings) {
    for (const routeId of finding.references.route_ids) {
      const existing = findingsByRoute.get(routeId);
      if (existing === undefined) findingsByRoute.set(routeId, [finding.finding_id]);
      else existing.push(finding.finding_id);
    }
  }

  const cells: ConceptHeatmapCell[] = [...cellsByCohort.entries()]
    .flatMap(([cohortId, cohortCells]) =>
      [...cohortCells.entries()].map(([conceptId, cell]) => ({ cohortId, conceptId, cell })),
    )
    .map(({ cohortId, conceptId, cell }) => {
      const routeIds = [...new Set(cell.routeIds)].sort(compareStrings);
      const findingIds = [
        ...new Set(routeIds.flatMap((routeId) => findingsByRoute.get(routeId) ?? [])),
      ].sort(compareStrings);
      return {
        cohort_id: cohortId,
        concept_id: conceptId,
        expected_frequency: round(Math.min(cell.expectedFrequency, 1)),
        confidence: round(
          cell.confidenceWeight > 0
            ? cell.weightedConfidence / cell.confidenceWeight
            : cell.unweightedConfidenceSum / cell.observationCount,
        ),
        route_ids: routeIds,
        finding_ids: findingIds,
      };
    })
    .sort(
      (left, right) =>
        compareStrings(left.cohort_id, right.cohort_id) ||
        compareStrings(left.concept_id, right.concept_id),
    );

  const columns: ConceptHeatmapColumn[] = [...labels.values()]
    .sort((left, right) => compareStrings(left.concept_id, right.concept_id))
    .map((label) => {
      const conceptCells = cells.filter((cell) => cell.concept_id === label.concept_id);
      return {
        concept_id: label.concept_id,
        label: label.label,
        category: assertDefined(categories.get(label.concept_id)),
        intent: conceptIntent(label.concept_id, input.profile),
        mastery: conceptMastery(label.concept_id, mastery),
        cohort_count: conceptCells.length,
        max_expected_frequency: conceptCells.reduce(
          (maximum, cell) => Math.max(maximum, cell.expected_frequency),
          0,
        ),
      };
    });

  return {
    projection_version: CONCEPT_HEATMAP_PROJECTION_VERSION,
    analysis_version: input.analysis_version,
    concepts_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts,
    report_id: input.report_id,
    repertoire_revision: input.repertoire_revision,
    state: "available",
    reason: null,
    rows,
    columns,
    cells,
    exclusions,
    provenance: [HEATMAP_PROVENANCE, CLASSIFIER_PROVENANCE, masteryProvenance(mastery)],
  };
}
