/**
 * Canonical public-tool inputs for Strategic Fit.
 *
 * Hosts inject document/handle metadata and may choose a worker or in-process execution boundary,
 * but both map the same bounded JSON input into the same deterministic analyzer options here.
 */
import type { Color } from "../congruence.js";
import type { ExplorerDb, ExplorerRatingBucket, ExplorerSpeed } from "../explorer.js";
import type { OpeningTable } from "../openings.js";
import type {
  AnalyzeStrategicFitOptions,
  StrategicFitFindingPageInput,
  StrategicFitFindingSort,
  StrategicFitRouteAssessmentInput,
} from "./analyze.js";
import type { StrategicCohortOverride } from "./cohorts.js";
import type { StrategicExplicitModeTarget } from "./modes.js";
import type {
  StrategicFitProfileMode,
  StrategicFitProfilePreferences,
  StrategicFitSourceProvenance,
} from "./types.js";
import { STRATEGIC_FIT_SCHEMA_VERSION } from "./version.js";
import type {
  StrategicPopularityCollectionOptions,
} from "./popularity.js";
import type {
  StrategicDecisionWeightInput,
  StrategicRouteWeightInput,
  StrategicRouteWeightingMode,
} from "./weights.js";

export interface StrategicFitToolProfilePreferencesInput {
  readonly maximum_engine_loss_cp?: number;
  readonly opponent_popularity_importance?: number;
  readonly personal_game_frequency_importance?: number;
  readonly manual_weight_importance?: number;
  readonly additional_memorization_tolerance?: number;
  readonly preferred_concept_ids?: readonly string[];
  readonly avoided_concept_ids?: readonly string[];
  readonly preferred_tactical_character?: readonly string[];
  readonly minimum_opponent_coverage?: number;
}

export interface StrategicFitToolProfileInput {
  readonly mode: StrategicFitProfileMode;
  readonly preferences?: StrategicFitToolProfilePreferencesInput;
}

type WithoutProvenance<T> = T extends { readonly provenance?: unknown }
  ? Omit<T, "provenance">
  : T;

export type StrategicFitToolRouteWeightInput = WithoutProvenance<StrategicRouteWeightInput>;
export type StrategicFitToolDecisionWeightInput = WithoutProvenance<StrategicDecisionWeightInput>;
export type StrategicFitToolCohortOverrideInput = WithoutProvenance<StrategicCohortOverride>;
export type StrategicFitToolExplicitModeTargetInput = WithoutProvenance<StrategicExplicitModeTarget>;

export interface StrategicFitToolWeightingInput {
  readonly mode?: StrategicRouteWeightingMode;
  readonly route_weights?: readonly StrategicFitToolRouteWeightInput[];
  readonly decision_weights?: readonly StrategicFitToolDecisionWeightInput[];
}

export interface StrategicFitToolPopularityInput {
  readonly db?: ExplorerDb;
  readonly speeds?: readonly ExplorerSpeed[];
  readonly ratings?: readonly ExplorerRatingBucket[];
  /** Lichess uses YYYY-MM; masters uses YYYY. */
  readonly since?: string;
  /** Lichess uses YYYY-MM; masters uses YYYY. */
  readonly until?: string;
  readonly max_positions?: number;
}

export interface StrategicFitToolArguments {
  /** Legacy V1 inputs remain accepted until the final cutover. */
  readonly min_severity?: "low" | "medium" | "high";
  /** Bounded legacy projection size; native V2 paging lives in `page`. */
  readonly limit?: number;
  readonly acknowledged_weaknesses?: readonly (readonly string[])[];
  readonly exclude_paths?: readonly (readonly string[])[];
  readonly profile?: StrategicFitToolProfileInput;
  readonly weighting?: StrategicFitToolWeightingInput;
  /** Optional host-collected population evidence. The deterministic core never performs I/O. */
  readonly popularity?: StrategicFitToolPopularityInput;
  readonly page?: StrategicFitFindingPageInput;
  readonly sort?: StrategicFitFindingSort;
  readonly cohort_overrides?: readonly StrategicFitToolCohortOverrideInput[];
  readonly explicit_targets?: readonly StrategicFitToolExplicitModeTargetInput[];
  readonly route_assessments?: readonly Omit<StrategicFitRouteAssessmentInput, "semantic_finding_id">[];
}

/** Map the public snake-case popularity request into the host-neutral bounded collector options. */
export function strategicPopularityOptionsFromToolArguments(
  args: StrategicFitToolArguments,
): StrategicPopularityCollectionOptions | null {
  if (args.popularity === undefined) return null;
  const { max_positions: maxPositions, ...filters } = args.popularity;
  return {
    filters,
    ...(maxPositions === undefined ? {} : { maxPositions }),
  };
}

export interface StrategicFitToolHostMetadata {
  readonly repertoireColor: Color | null;
  readonly repertoireRevision: string;
  readonly openingTable?: OpeningTable | null;
  readonly generatedAt?: string;
}

const TOOL_INPUT_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:tool-input",
  kind: "user-profile",
  state: "available",
  version: STRATEGIC_FIT_SCHEMA_VERSION,
  snapshot: null,
  reason: "Explicit Strategic Fit tool input supplied by the caller.",
});

const DEFAULT_PROFILE_PREFERENCES: StrategicFitProfilePreferences = Object.freeze({
  maximum_engine_loss_cp: null,
  opponent_popularity_importance: 0,
  personal_game_frequency_importance: 0,
  manual_weight_importance: 0,
  additional_memorization_tolerance: 0.5,
  preferred_concept_ids: [],
  avoided_concept_ids: [],
  preferred_tactical_character: [],
  minimum_opponent_coverage: null,
});

function profilePreferences(
  input: StrategicFitToolProfilePreferencesInput | undefined,
): StrategicFitProfilePreferences {
  return {
    ...DEFAULT_PROFILE_PREFERENCES,
    ...(input ?? {}),
    maximum_engine_loss_cp: input?.maximum_engine_loss_cp ?? null,
    preferred_concept_ids: [...(input?.preferred_concept_ids ?? [])],
    avoided_concept_ids: [...(input?.avoided_concept_ids ?? [])],
    preferred_tactical_character: [...(input?.preferred_tactical_character ?? [])],
    minimum_opponent_coverage: input?.minimum_opponent_coverage ?? null,
  };
}

function withToolProvenance<T extends object>(
  input: T,
): T & { readonly provenance: readonly StrategicFitSourceProvenance[] } {
  return {
    ...input,
    provenance: [TOOL_INPUT_PROVENANCE],
  };
}

/** Map validated public arguments to the shared analyzer without introducing host decisions. */
export function strategicFitOptionsFromToolArguments(
  args: StrategicFitToolArguments,
  metadata: StrategicFitToolHostMetadata,
): AnalyzeStrategicFitOptions {
  const profile = args.profile
    ? {
        schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
        mode: args.profile.mode,
        source: "explicit" as const,
        provisional: false,
        preferences: profilePreferences(args.profile.preferences),
      }
    : undefined;
  const weighting = args.weighting
    ? {
        mode: args.weighting.mode,
        route_weights: args.weighting.route_weights?.map(withToolProvenance),
        decision_weights: args.weighting.decision_weights?.map(withToolProvenance),
      }
    : undefined;
  const cohortOverrides = args.cohort_overrides?.map(withToolProvenance);
  const explicitTargets = args.explicit_targets?.map(withToolProvenance);

  return {
    repertoireColor: metadata.repertoireColor,
    repertoireRevision: metadata.repertoireRevision,
    openingTable: metadata.openingTable,
    ...(metadata.generatedAt === undefined ? {} : { generatedAt: metadata.generatedAt }),
    ...(profile === undefined ? {} : { profile }),
    ...(weighting === undefined ? {} : { weighting }),
    ...(args.page === undefined ? {} : { page: { ...args.page } }),
    ...(args.sort === undefined ? {} : { sort: args.sort }),
    ...(cohortOverrides === undefined ? {} : { cohorts: { overrides: cohortOverrides } }),
    ...(explicitTargets === undefined ? {} : { modes: { explicit_targets: explicitTargets } }),
    ...(args.route_assessments === undefined
      ? {}
      : { routeAssessments: args.route_assessments.map((assessment) => ({ ...assessment })) }),
  };
}
