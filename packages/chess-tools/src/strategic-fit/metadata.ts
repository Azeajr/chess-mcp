/**
 * Versioned, document-scoped Strategic Fit metadata.
 *
 * This module owns only the deterministic sidecar contract and its migrations. It deliberately
 * has no document identity or persistence behavior: browser identity begins in Task 4.2 and
 * IndexedDB storage begins in Task 4.3. Every normalization path constructs output from an
 * explicit whitelist so host credentials and unknown fields cannot enter the durable contract.
 */
import type {
  StrategicCohortExclusionOverride,
  StrategicCohortMergeOverride,
  StrategicCohortOverride,
  StrategicCohortSplitOverride,
} from "./cohorts.js";
import type {
  FindingResolution,
  SemanticReferences,
  StrategicFitProfile,
  StrategicFitProfileMode,
  StrategicFitProfilePreferences,
  StrategicFitProfileSource,
  StrategicFitSourceKind,
  StrategicFitSourceProvenance,
  StrategicFitSourceState,
  TerminalFindingResolutionState,
} from "./types.js";
import {
  FINDING_RESOLUTION_STATES,
  INTENTIONAL_RESOLUTION_REASONS,
  RESOLUTION_INVALIDATION_RULES,
  STRATEGIC_FIT_PROFILE_MODES,
  STRATEGIC_FIT_PROFILE_SOURCES,
  STRATEGIC_FIT_SOURCE_KINDS,
  STRATEGIC_FIT_SOURCE_STATES,
} from "./types.js";
import { STRATEGIC_FIT_SCHEMA_VERSION } from "./version.js";
import type { StrategicDecisionWeightInput, StrategicRouteWeightInput } from "./weights.js";

/** This version advances independently from analysis reports and component manifests. */
export const STRATEGIC_FIT_DOCUMENT_METADATA_VERSION = "1.0.0";
export const STRATEGIC_FIT_DOCUMENT_METADATA_KIND = "chess-mcp/strategic-fit-document-metadata";
export const STRATEGIC_FIT_DOCUMENT_METADATA_LEGACY_VERSIONS = ["0.1.0"] as const;

export type StrategicFitStructuralCohortOverride =
  | StrategicCohortMergeOverride
  | StrategicCohortSplitOverride;

export interface StrategicFitManualWeights {
  readonly route_weights: readonly StrategicRouteWeightInput[];
  readonly decision_weights: readonly StrategicDecisionWeightInput[];
}

/** Archive payloads remain outside this contract; metadata stores semantic references only. */
export interface StrategicFitArchiveReference {
  readonly archive_id: string;
  readonly repertoire_revision: string;
  readonly references: SemanticReferences;
  readonly linked_staged_edit_id: string | null;
  readonly created_at: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

/** Training records remain outside this contract; metadata stores semantic references only. */
export interface StrategicFitTrainingReference {
  readonly training_id: string;
  readonly finding_id: string | null;
  readonly repertoire_revision: string;
  readonly references: SemanticReferences;
  readonly created_at: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitDocumentMetadata {
  readonly metadata_kind: typeof STRATEGIC_FIT_DOCUMENT_METADATA_KIND;
  readonly metadata_version: typeof STRATEGIC_FIT_DOCUMENT_METADATA_VERSION;
  readonly profile: StrategicFitProfile;
  readonly manual_weights: StrategicFitManualWeights;
  readonly cohort_overrides: readonly StrategicFitStructuralCohortOverride[];
  readonly exclusions: readonly StrategicCohortExclusionOverride[];
  readonly resolutions: readonly FindingResolution[];
  readonly archive_references: readonly StrategicFitArchiveReference[];
  readonly training_references: readonly StrategicFitTrainingReference[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const STRATEGIC_FIT_METADATA_NORMALIZATION_STATES = ["valid", "migrated", "fallback"] as const;
export type StrategicFitMetadataNormalizationState =
  (typeof STRATEGIC_FIT_METADATA_NORMALIZATION_STATES)[number];

export const STRATEGIC_FIT_METADATA_ISSUE_CODES = [
  "invalid-root",
  "missing-version",
  "unsupported-version",
  "invalid-field",
  "invalid-entry",
  "duplicate-id",
  "unknown-field-ignored",
] as const;
export type StrategicFitMetadataIssueCode = (typeof STRATEGIC_FIT_METADATA_ISSUE_CODES)[number];

export interface StrategicFitMetadataIssue {
  readonly code: StrategicFitMetadataIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface StrategicFitMetadataNormalizationResult {
  readonly state: StrategicFitMetadataNormalizationState;
  readonly source_version: string | null;
  readonly target_version: typeof STRATEGIC_FIT_DOCUMENT_METADATA_VERSION;
  readonly metadata: StrategicFitDocumentMetadata;
  readonly issues: readonly StrategicFitMetadataIssue[];
}

/** Explicit migration graph; no best-effort migration is attempted for unknown versions. */
export const STRATEGIC_FIT_DOCUMENT_METADATA_MIGRATIONS: Readonly<Record<string, string>> =
  Object.freeze({
    "0.1.0": STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
  });

const DEFAULT_PROFILE_PREFERENCES: StrategicFitProfilePreferences = Object.freeze({
  maximum_engine_loss_cp: null,
  opponent_popularity_importance: 0,
  personal_game_frequency_importance: 0,
  manual_weight_importance: 0,
  additional_memorization_tolerance: 0.5,
  preferred_concept_ids: Object.freeze([]),
  avoided_concept_ids: Object.freeze([]),
  preferred_tactical_character: Object.freeze([]),
  minimum_opponent_coverage: null,
});

interface NormalizationContext {
  readonly issues: StrategicFitMetadataIssue[];
  fallback: boolean;
}

type UnknownRecord = Record<string, unknown>;

const PROFILE_MODES = new Set<string>(STRATEGIC_FIT_PROFILE_MODES);
const PROFILE_SOURCES = new Set<string>(STRATEGIC_FIT_PROFILE_SOURCES);
const SOURCE_KINDS = new Set<string>(STRATEGIC_FIT_SOURCE_KINDS);
const SOURCE_STATES = new Set<string>(STRATEGIC_FIT_SOURCE_STATES);
const TERMINAL_RESOLUTION_STATES = new Set<string>(
  FINDING_RESOLUTION_STATES.filter((state) => state !== "unresolved"),
);
const INTENTIONAL_REASONS = new Set<string>(INTENTIONAL_RESOLUTION_REASONS);
const INVALIDATION_RULES = new Set<string>(RESOLUTION_INVALIDATION_RULES);

function defaultProfile(): StrategicFitProfile {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    mode: "balanced",
    source: "inferred",
    provisional: true,
    preferences: {
      ...DEFAULT_PROFILE_PREFERENCES,
      preferred_concept_ids: [],
      avoided_concept_ids: [],
      preferred_tactical_character: [],
    },
  };
}

/** A fresh, complete default object suitable for one document. */
export function createDefaultStrategicFitDocumentMetadata(): StrategicFitDocumentMetadata {
  return {
    metadata_kind: STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
    metadata_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
    profile: defaultProfile(),
    manual_weights: { route_weights: [], decision_weights: [] },
    cohort_overrides: [],
    exclusions: [],
    resolutions: [],
    archive_references: [],
    training_references: [],
    provenance: [],
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  context: NormalizationContext,
  code: StrategicFitMetadataIssueCode,
  path: string,
  message: string,
  fallback = true,
): void {
  context.issues.push({ code, path, message });
  if (fallback) context.fallback = true;
}

function unknownFields(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
  context: NormalizationContext,
): void {
  for (const key of Object.keys(value).sort()) {
    if (allowed.has(key)) continue;
    issue(
      context,
      "unknown-field-ignored",
      `${path}.${key}`,
      "Unknown metadata field was ignored by the current explicit whitelist.",
      false,
    );
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown, minimum: number, maximum = Number.POSITIVE_INFINITY): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function stringArray(value: unknown, path: string, context: NormalizationContext): string[] {
  if (!Array.isArray(value)) {
    issue(context, "invalid-field", path, "Expected an array of non-empty strings.");
    return [];
  }
  const result: string[] = [];
  for (const [index, entry] of value.entries()) {
    const parsed = nonEmptyString(entry);
    if (parsed === null) {
      issue(context, "invalid-entry", `${path}[${index}]`, "Expected a non-empty string.");
      continue;
    }
    result.push(parsed);
  }
  return result;
}

function sourcePathArray(value: unknown, path: string, context: NormalizationContext): string[][] {
  if (!Array.isArray(value)) {
    issue(context, "invalid-field", path, "Expected an array of SAN paths.");
    return [];
  }
  const result: string[][] = [];
  for (const [index, entry] of value.entries()) {
    if (!Array.isArray(entry)) {
      issue(context, "invalid-entry", `${path}[${index}]`, "Expected a SAN path array.");
      continue;
    }
    result.push(stringArray(entry, `${path}[${index}]`, context));
  }
  return result;
}

function provenanceSource(
  value: unknown,
  path: string,
  context: NormalizationContext,
): StrategicFitSourceProvenance | null {
  if (!isRecord(value)) {
    issue(context, "invalid-entry", path, "Expected a provenance object.");
    return null;
  }
  unknownFields(
    value,
    new Set(["source_id", "kind", "state", "version", "snapshot", "reason"]),
    path,
    context,
  );
  const sourceId = nonEmptyString(value.source_id);
  const kind = nonEmptyString(value.kind);
  const state = nonEmptyString(value.state);
  const version = nullableString(value.version);
  const snapshot = nullableString(value.snapshot);
  const reason = nullableString(value.reason);
  if (
    sourceId === null || kind === null || !SOURCE_KINDS.has(kind) || state === null ||
    !SOURCE_STATES.has(state) || version === undefined || snapshot === undefined || reason === undefined
  ) {
    issue(context, "invalid-entry", path, "Provenance fields do not match the current contract.");
    return null;
  }
  return {
    source_id: sourceId,
    kind: kind as StrategicFitSourceKind,
    state: state as StrategicFitSourceState,
    version,
    snapshot,
    reason,
  };
}

function provenanceArray(
  value: unknown,
  path: string,
  context: NormalizationContext,
): StrategicFitSourceProvenance[] {
  if (!Array.isArray(value)) {
    issue(context, "invalid-field", path, "Expected an array of provenance records.");
    return [];
  }
  const result: StrategicFitSourceProvenance[] = [];
  for (const [index, entry] of value.entries()) {
    const parsed = provenanceSource(entry, `${path}[${index}]`, context);
    if (parsed !== null) result.push(parsed);
  }
  return result;
}

function profilePreferences(
  value: unknown,
  path: string,
  context: NormalizationContext,
): StrategicFitProfilePreferences | null {
  if (!isRecord(value)) {
    issue(context, "invalid-field", path, "Expected a profile preferences object.");
    return null;
  }
  unknownFields(
    value,
    new Set([
      "maximum_engine_loss_cp",
      "opponent_popularity_importance",
      "personal_game_frequency_importance",
      "manual_weight_importance",
      "additional_memorization_tolerance",
      "preferred_concept_ids",
      "avoided_concept_ids",
      "preferred_tactical_character",
      "minimum_opponent_coverage",
    ]),
    path,
    context,
  );
  const maximumEngineLoss = value.maximum_engine_loss_cp === null
    ? null
    : finiteNumber(value.maximum_engine_loss_cp, 0);
  const opponentPopularity = finiteNumber(value.opponent_popularity_importance, 0, 1);
  const personalFrequency = finiteNumber(value.personal_game_frequency_importance, 0, 1);
  const manualWeight = finiteNumber(value.manual_weight_importance, 0, 1);
  const memorizationTolerance = finiteNumber(value.additional_memorization_tolerance, 0, 1);
  const minimumCoverage = value.minimum_opponent_coverage === null
    ? null
    : finiteNumber(value.minimum_opponent_coverage, 0, 1);
  if (
    maximumEngineLoss === null && value.maximum_engine_loss_cp !== null ||
    opponentPopularity === null || personalFrequency === null || manualWeight === null ||
    memorizationTolerance === null || minimumCoverage === null && value.minimum_opponent_coverage !== null
  ) {
    issue(context, "invalid-field", path, "Profile preference numbers are outside the supported ranges.");
    return null;
  }
  return {
    maximum_engine_loss_cp: maximumEngineLoss,
    opponent_popularity_importance: opponentPopularity,
    personal_game_frequency_importance: personalFrequency,
    manual_weight_importance: manualWeight,
    additional_memorization_tolerance: memorizationTolerance,
    preferred_concept_ids: stringArray(value.preferred_concept_ids, `${path}.preferred_concept_ids`, context),
    avoided_concept_ids: stringArray(value.avoided_concept_ids, `${path}.avoided_concept_ids`, context),
    preferred_tactical_character: stringArray(
      value.preferred_tactical_character,
      `${path}.preferred_tactical_character`,
      context,
    ),
    minimum_opponent_coverage: minimumCoverage,
  };
}

function profile(value: unknown, path: string, context: NormalizationContext): StrategicFitProfile {
  if (!isRecord(value)) {
    issue(context, "invalid-field", path, "Expected a Strategic Fit profile object.");
    return defaultProfile();
  }
  unknownFields(value, new Set(["schema_version", "mode", "source", "provisional", "preferences"]), path, context);
  const mode = nonEmptyString(value.mode);
  const source = nonEmptyString(value.source);
  const preferences = profilePreferences(value.preferences, `${path}.preferences`, context);
  if (
    value.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION || mode === null || !PROFILE_MODES.has(mode) ||
    source === null || !PROFILE_SOURCES.has(source) || typeof value.provisional !== "boolean" ||
    (source === "inferred") !== value.provisional || preferences === null
  ) {
    issue(context, "invalid-field", path, "Profile fields do not match the current Strategic Fit contract.");
    return defaultProfile();
  }
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    mode: mode as StrategicFitProfileMode,
    source: source as StrategicFitProfileSource,
    provisional: value.provisional,
    preferences,
  };
}

function optionalProvenance(
  value: UnknownRecord,
  path: string,
  context: NormalizationContext,
): StrategicFitSourceProvenance[] {
  return value.provenance === undefined ? [] : provenanceArray(value.provenance, `${path}.provenance`, context);
}

function routeWeight(
  value: unknown,
  path: string,
  context: NormalizationContext,
): StrategicRouteWeightInput | null {
  if (!isRecord(value)) {
    issue(context, "invalid-entry", path, "Expected a route weight object.");
    return null;
  }
  unknownFields(value, new Set(["route_id", "weight", "provenance"]), path, context);
  const routeId = nonEmptyString(value.route_id);
  const weight = finiteNumber(value.weight, 0);
  if (routeId === null || weight === null) {
    issue(context, "invalid-entry", path, "Route weight requires a semantic route ID and a non-negative weight.");
    return null;
  }
  return { route_id: routeId, weight, provenance: optionalProvenance(value, path, context) };
}

function decisionWeight(
  value: unknown,
  path: string,
  context: NormalizationContext,
): StrategicDecisionWeightInput | null {
  if (!isRecord(value)) {
    issue(context, "invalid-entry", path, "Expected a decision weight object.");
    return null;
  }
  unknownFields(value, new Set(["decision_id", "weight", "provenance"]), path, context);
  const decisionId = nonEmptyString(value.decision_id);
  const weight = finiteNumber(value.weight, 0);
  if (decisionId === null || weight === null) {
    issue(context, "invalid-entry", path, "Decision weight requires a semantic decision ID and a non-negative weight.");
    return null;
  }
  return { decision_id: decisionId, weight, provenance: optionalProvenance(value, path, context) };
}

function uniqueEntries<T>(
  value: unknown,
  path: string,
  identity: (entry: T) => string,
  parse: (entry: unknown, path: string, context: NormalizationContext) => T | null,
  context: NormalizationContext,
): T[] {
  if (!Array.isArray(value)) {
    issue(context, "invalid-field", path, "Expected an array.");
    return [];
  }
  const result: T[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const parsed = parse(entry, `${path}[${index}]`, context);
    if (parsed === null) continue;
    const id = identity(parsed);
    if (seen.has(id)) {
      issue(context, "duplicate-id", `${path}[${index}]`, `Duplicate metadata identity: ${id}`);
      continue;
    }
    seen.add(id);
    result.push(parsed);
  }
  return result;
}

function manualWeights(value: unknown, path: string, context: NormalizationContext): StrategicFitManualWeights {
  if (!isRecord(value)) {
    issue(context, "invalid-field", path, "Expected a manual weights object.");
    return { route_weights: [], decision_weights: [] };
  }
  unknownFields(value, new Set(["route_weights", "decision_weights"]), path, context);
  return {
    route_weights: uniqueEntries(
      value.route_weights,
      `${path}.route_weights`,
      (entry: StrategicRouteWeightInput) => entry.route_id,
      routeWeight,
      context,
    ),
    decision_weights: uniqueEntries(
      value.decision_weights,
      `${path}.decision_weights`,
      (entry: StrategicDecisionWeightInput) => entry.decision_id,
      decisionWeight,
      context,
    ),
  };
}

function cohortOverride(
  value: unknown,
  path: string,
  context: NormalizationContext,
): StrategicCohortOverride | null {
  if (!isRecord(value)) {
    issue(context, "invalid-entry", path, "Expected a cohort override object.");
    return null;
  }
  const overrideId = nonEmptyString(value.override_id);
  const kind = nonEmptyString(value.kind);
  if (overrideId === null || !["merge", "split", "exclude"].includes(kind ?? "")) {
    issue(context, "invalid-entry", path, "Cohort override identity or kind is invalid.");
    return null;
  }
  if (kind === "merge" || kind === "split") {
    unknownFields(value, new Set(["override_id", "kind", "route_ids", "provenance"]), path, context);
    const routeIds = stringArray(value.route_ids, `${path}.route_ids`, context);
    if (routeIds.length === 0) {
      issue(context, "invalid-entry", path, "Structural cohort overrides require at least one route.");
      return null;
    }
    return {
      override_id: overrideId,
      kind,
      route_ids: routeIds,
      provenance: optionalProvenance(value, path, context),
    } as StrategicCohortMergeOverride | StrategicCohortSplitOverride;
  }
  unknownFields(
    value,
    new Set(["override_id", "kind", "route_ids", "decision_ids", "provenance"]),
    path,
    context,
  );
  const routeIds = value.route_ids === undefined ? [] : stringArray(value.route_ids, `${path}.route_ids`, context);
  const decisionIds = value.decision_ids === undefined
    ? []
    : stringArray(value.decision_ids, `${path}.decision_ids`, context);
  if (routeIds.length === 0 && decisionIds.length === 0) {
    issue(context, "invalid-entry", path, "Exclusions require at least one semantic route or decision ID.");
    return null;
  }
  return {
    override_id: overrideId,
    kind: "exclude",
    route_ids: routeIds,
    decision_ids: decisionIds,
    provenance: optionalProvenance(value, path, context),
  };
}

function exclusionOverrides(
  value: unknown,
  path: string,
  structuralOverrideIds: ReadonlySet<string>,
  context: NormalizationContext,
): StrategicCohortExclusionOverride[] {
  if (!Array.isArray(value)) {
    issue(context, "invalid-field", path, "Expected an array.");
    return [];
  }
  const result: StrategicCohortExclusionOverride[] = [];
  const seen = new Set(structuralOverrideIds);
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    const parsed = cohortOverride(entry, entryPath, context);
    if (parsed === null) continue;
    if (parsed.kind !== "exclude") {
      issue(context, "invalid-entry", entryPath, "Only exclusion overrides belong in exclusions.");
      continue;
    }
    if (seen.has(parsed.override_id)) {
      const message = structuralOverrideIds.has(parsed.override_id)
        ? `Duplicate cohort override identity across cohort_overrides and exclusions: ${parsed.override_id}`
        : `Duplicate metadata identity: ${parsed.override_id}`;
      issue(context, "duplicate-id", entryPath, message);
      continue;
    }
    seen.add(parsed.override_id);
    result.push(parsed);
  }
  return result;
}

function semanticReferences(
  value: unknown,
  path: string,
  context: NormalizationContext,
): SemanticReferences | null {
  if (!isRecord(value)) {
    issue(context, "invalid-field", path, "Expected semantic references.");
    return null;
  }
  unknownFields(value, new Set(["position_ids", "decision_ids", "route_ids", "source_san_paths"]), path, context);
  return {
    position_ids: stringArray(value.position_ids, `${path}.position_ids`, context),
    decision_ids: stringArray(value.decision_ids, `${path}.decision_ids`, context),
    route_ids: stringArray(value.route_ids, `${path}.route_ids`, context),
    source_san_paths: sourcePathArray(value.source_san_paths, `${path}.source_san_paths`, context),
  };
}

function resolution(
  value: unknown,
  path: string,
  context: NormalizationContext,
): FindingResolution | null {
  if (!isRecord(value)) {
    issue(context, "invalid-entry", path, "Expected a finding resolution object.");
    return null;
  }
  unknownFields(
    value,
    new Set([
      "schema_version",
      "resolution_id",
      "finding_id",
      "repertoire_revision",
      "state",
      "intentional_reason",
      "note",
      "references",
      "invalidation_rules",
      "expires_at",
      "linked_training_ids",
      "linked_staged_edit_ids",
      "created_at",
      "provenance",
    ]),
    path,
    context,
  );
  const resolutionId = nonEmptyString(value.resolution_id);
  const findingId = nonEmptyString(value.finding_id);
  const repertoireRevision = nonEmptyString(value.repertoire_revision);
  const state = nonEmptyString(value.state);
  const intentionalReason = nullableString(value.intentional_reason);
  const note = nullableString(value.note);
  const references = semanticReferences(value.references, `${path}.references`, context);
  const expiresAt = nullableString(value.expires_at);
  const createdAt = nonEmptyString(value.created_at);
  if (
    value.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION || resolutionId === null || findingId === null ||
    repertoireRevision === null || state === null || !TERMINAL_RESOLUTION_STATES.has(state) ||
    intentionalReason === undefined || intentionalReason !== null && !INTENTIONAL_REASONS.has(intentionalReason) ||
    note === undefined || references === null || expiresAt === undefined || createdAt === null
  ) {
    issue(context, "invalid-entry", path, "Finding resolution fields do not match the current contract.");
    return null;
  }
  const invalidationRules = stringArray(value.invalidation_rules, `${path}.invalidation_rules`, context);
  if (invalidationRules.some((rule) => !INVALIDATION_RULES.has(rule))) {
    issue(context, "invalid-entry", `${path}.invalidation_rules`, "Unknown resolution invalidation rule.");
    return null;
  }
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    resolution_id: resolutionId,
    finding_id: findingId,
    repertoire_revision: repertoireRevision,
    state: state as TerminalFindingResolutionState,
    intentional_reason: intentionalReason as FindingResolution["intentional_reason"],
    note,
    references,
    invalidation_rules: invalidationRules as FindingResolution["invalidation_rules"],
    expires_at: expiresAt,
    linked_training_ids: stringArray(value.linked_training_ids, `${path}.linked_training_ids`, context),
    linked_staged_edit_ids: stringArray(
      value.linked_staged_edit_ids,
      `${path}.linked_staged_edit_ids`,
      context,
    ),
    created_at: createdAt,
    provenance: provenanceArray(value.provenance, `${path}.provenance`, context),
  };
}

function archiveReference(
  value: unknown,
  path: string,
  context: NormalizationContext,
): StrategicFitArchiveReference | null {
  if (!isRecord(value)) {
    issue(context, "invalid-entry", path, "Expected an archive reference object.");
    return null;
  }
  unknownFields(
    value,
    new Set([
      "archive_id",
      "repertoire_revision",
      "references",
      "linked_staged_edit_id",
      "created_at",
      "provenance",
    ]),
    path,
    context,
  );
  const archiveId = nonEmptyString(value.archive_id);
  const repertoireRevision = nonEmptyString(value.repertoire_revision);
  const references = semanticReferences(value.references, `${path}.references`, context);
  const linkedStagedEditId = nullableString(value.linked_staged_edit_id);
  const createdAt = nonEmptyString(value.created_at);
  if (
    archiveId === null || repertoireRevision === null || references === null ||
    linkedStagedEditId === undefined || createdAt === null
  ) {
    issue(context, "invalid-entry", path, "Archive reference fields do not match the current contract.");
    return null;
  }
  return {
    archive_id: archiveId,
    repertoire_revision: repertoireRevision,
    references,
    linked_staged_edit_id: linkedStagedEditId,
    created_at: createdAt,
    provenance: provenanceArray(value.provenance, `${path}.provenance`, context),
  };
}

function trainingReference(
  value: unknown,
  path: string,
  context: NormalizationContext,
): StrategicFitTrainingReference | null {
  if (!isRecord(value)) {
    issue(context, "invalid-entry", path, "Expected a training reference object.");
    return null;
  }
  unknownFields(
    value,
    new Set(["training_id", "finding_id", "repertoire_revision", "references", "created_at", "provenance"]),
    path,
    context,
  );
  const trainingId = nonEmptyString(value.training_id);
  const findingId = nullableString(value.finding_id);
  const repertoireRevision = nonEmptyString(value.repertoire_revision);
  const references = semanticReferences(value.references, `${path}.references`, context);
  const createdAt = nonEmptyString(value.created_at);
  if (
    trainingId === null || findingId === undefined || repertoireRevision === null ||
    references === null || createdAt === null
  ) {
    issue(context, "invalid-entry", path, "Training reference fields do not match the current contract.");
    return null;
  }
  return {
    training_id: trainingId,
    finding_id: findingId,
    repertoire_revision: repertoireRevision,
    references,
    created_at: createdAt,
    provenance: provenanceArray(value.provenance, `${path}.provenance`, context),
  };
}

function normalizedCurrent(
  value: UnknownRecord,
  context: NormalizationContext,
): StrategicFitDocumentMetadata {
  unknownFields(
    value,
    new Set([
      "metadata_kind",
      "metadata_version",
      "profile",
      "manual_weights",
      "cohort_overrides",
      "exclusions",
      "resolutions",
      "archive_references",
      "training_references",
      "provenance",
    ]),
    "$",
    context,
  );
  if (value.metadata_kind !== STRATEGIC_FIT_DOCUMENT_METADATA_KIND) {
    issue(context, "invalid-field", "$.metadata_kind", "Metadata kind is missing or unsupported.");
  }
  const structuralOverrides = uniqueEntries(
    value.cohort_overrides,
    "$.cohort_overrides",
    (entry: StrategicCohortOverride) => entry.override_id,
    cohortOverride,
    context,
  ).filter((override): override is StrategicFitStructuralCohortOverride => override.kind !== "exclude");
  const exclusions = exclusionOverrides(
    value.exclusions,
    "$.exclusions",
    new Set(structuralOverrides.map((override) => override.override_id)),
    context,
  );
  if (structuralOverrides.length !== (Array.isArray(value.cohort_overrides) ? value.cohort_overrides.length : 0)) {
    const misplaced = Array.isArray(value.cohort_overrides) && value.cohort_overrides.some(
      (entry) => isRecord(entry) && entry.kind === "exclude",
    );
    if (misplaced) issue(context, "invalid-entry", "$.cohort_overrides", "Exclusions belong in the exclusions field.");
  }
  return {
    metadata_kind: STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
    metadata_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
    profile: profile(value.profile, "$.profile", context),
    manual_weights: manualWeights(value.manual_weights, "$.manual_weights", context),
    cohort_overrides: structuralOverrides,
    exclusions,
    resolutions: uniqueEntries(
      value.resolutions,
      "$.resolutions",
      (entry: FindingResolution) => entry.resolution_id,
      resolution,
      context,
    ),
    archive_references: uniqueEntries(
      value.archive_references,
      "$.archive_references",
      (entry: StrategicFitArchiveReference) => entry.archive_id,
      archiveReference,
      context,
    ),
    training_references: uniqueEntries(
      value.training_references,
      "$.training_references",
      (entry: StrategicFitTrainingReference) => entry.training_id,
      trainingReference,
      context,
    ),
    provenance: provenanceArray(value.provenance, "$.provenance", context),
  };
}

function legacyToCurrent(value: UnknownRecord, context: NormalizationContext): UnknownRecord {
  unknownFields(
    value,
    new Set([
      "metadata_version",
      "profile",
      "route_weights",
      "decision_weights",
      "cohort_overrides",
      "exclusions",
      "resolutions",
      "archives",
      "training",
      "provenance",
    ]),
    "$",
    context,
  );
  const defaults = createDefaultStrategicFitDocumentMetadata();
  return {
    metadata_kind: STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
    metadata_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
    profile: value.profile ?? defaults.profile,
    manual_weights: {
      route_weights: value.route_weights ?? [],
      decision_weights: value.decision_weights ?? [],
    },
    cohort_overrides: value.cohort_overrides ?? [],
    exclusions: value.exclusions ?? [],
    resolutions: value.resolutions ?? [],
    archive_references: value.archives ?? [],
    training_references: value.training ?? [],
    provenance: value.provenance ?? [],
  };
}

function fallbackResult(
  sourceVersion: string | null,
  issues: readonly StrategicFitMetadataIssue[],
): StrategicFitMetadataNormalizationResult {
  return {
    state: "fallback",
    source_version: sourceVersion,
    target_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
    metadata: createDefaultStrategicFitDocumentMetadata(),
    issues,
  };
}

/**
 * Normalize trusted or untrusted structured-clone input without throwing.
 *
 * Unknown versions fall back as a whole. Known versions are reconstructed field-by-field; invalid
 * sections fall back to their empty/default value and are disclosed through `state` and `issues`.
 */
export function normalizeStrategicFitDocumentMetadata(
  input: unknown,
): StrategicFitMetadataNormalizationResult {
  const context: NormalizationContext = { issues: [], fallback: false };
  if (!isRecord(input)) {
    issue(context, "invalid-root", "$", "Strategic Fit metadata must be an object.");
    return fallbackResult(null, context.issues);
  }
  const sourceVersion = nonEmptyString(input.metadata_version);
  if (sourceVersion === null) {
    issue(context, "missing-version", "$.metadata_version", "Metadata version is missing or corrupt.");
    return fallbackResult(null, context.issues);
  }
  if (sourceVersion === STRATEGIC_FIT_DOCUMENT_METADATA_VERSION) {
    const metadata = normalizedCurrent(input, context);
    return {
      state: context.fallback ? "fallback" : "valid",
      source_version: sourceVersion,
      target_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
      metadata,
      issues: context.issues,
    };
  }
  if (Object.hasOwn(STRATEGIC_FIT_DOCUMENT_METADATA_MIGRATIONS, sourceVersion)) {
    const metadata = normalizedCurrent(legacyToCurrent(input, context), context);
    return {
      state: context.fallback ? "fallback" : "migrated",
      source_version: sourceVersion,
      target_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
      metadata,
      issues: context.issues,
    };
  }
  issue(
    context,
    "unsupported-version",
    "$.metadata_version",
    `Unsupported Strategic Fit document metadata version: ${sourceVersion}`,
  );
  return fallbackResult(sourceVersion, context.issues);
}
