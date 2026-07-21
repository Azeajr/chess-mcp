/**
 * Document-scoped Strategic Fit resolutions and analysis overrides.
 *
 * The shared package owns record contracts, graph reconciliation, and analyzer projection. This
 * browser facade owns only user mutation semantics, persistence through the canonical metadata
 * boundary, cache invalidation, and current-document injection.
 */
import {
  INTENTIONAL_RESOLUTION_REASONS,
  RESOLUTION_INVALIDATION_RULES,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  reconcileStrategicFitDocumentMetadata,
  strategicFitAnalysisInputsFromMetadata,
  strategicFitProfileSnapshot,
  type RepertoireGraph,
  type ResolutionInvalidationRule,
  type SemanticReferences,
  type StrategicFitDocumentMetadata,
  type StrategicFitMetadataAnalysisInputs,
  type StrategicFitMetadataNormalizationResult,
  type StrategicFitPersistedResolution,
  type StrategicFitPersistedCohortLabel,
  type StrategicFitPersistedResolutionState,
  type StrategicFitSourceProvenance,
} from "@chess-mcp/chess-tools";
import { invalidateCachedStrategicFitReports } from "../application/strategic-fit-report-cache";
import { color, currentTree, version } from "./game";
import { replaceStrategicFitMetadata, strategicFitMetadata } from "./strategic-fit-metadata";
import { strategicFitProfile } from "./strategic-fit-profile";

export type StrategicFitSettingsMutationState = "updated" | "unchanged" | "removed" | "missing";

export interface StrategicFitSettingsMutationResult {
  readonly state: StrategicFitSettingsMutationState;
  readonly metadata: StrategicFitDocumentMetadata;
}

export interface StrategicFitResolutionMutationInput {
  readonly resolution_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly state: StrategicFitPersistedResolutionState;
  readonly references: SemanticReferences;
  readonly intentional_reason?: StrategicFitPersistedResolution["intentional_reason"];
  readonly note?: string | null;
  readonly reason?: string | null;
  readonly invalidation_rules?: readonly ResolutionInvalidationRule[];
  readonly expires_at?: string | null;
  readonly linked_training_ids?: readonly string[];
  readonly linked_staged_edit_ids?: readonly string[];
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitCohortOverrideMutationInput {
  readonly override_id: string;
  readonly kind: "merge" | "split" | "exclude";
  readonly route_ids?: readonly string[];
  readonly decision_ids?: readonly string[];
  readonly reason?: string | null;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitManualWeightMutationInput {
  readonly target_id: string;
  readonly weight: number;
  readonly reason?: string | null;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitCohortLabelMutationInput {
  readonly label_id: string;
  readonly cohort_id: string;
  readonly display_name: string;
  readonly reason?: string | null;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicFitAnalysisSettingsSnapshot {
  readonly identity: string;
  readonly inputs: StrategicFitMetadataAnalysisInputs;
}

export interface StrategicFitResolutionStateBoundary {
  currentMetadata(): StrategicFitDocumentMetadata;
  currentGraph(): RepertoireGraph;
  currentProfile(): ReturnType<typeof strategicFitProfile>;
  currentRepertoireRevision(): string;
  replaceMetadata(input: StrategicFitDocumentMetadata): StrategicFitMetadataNormalizationResult;
  invalidateReports(): void;
  now(): string;
}

export interface StrategicFitResolutionState {
  upsertResolution(input: StrategicFitResolutionMutationInput): StrategicFitSettingsMutationResult;
  removeResolution(resolutionId: string): StrategicFitSettingsMutationResult;
  reopenResolution(resolutionId: string): StrategicFitSettingsMutationResult;
  upsertCohortOverride(input: StrategicFitCohortOverrideMutationInput): StrategicFitSettingsMutationResult;
  removeCohortOverride(overrideId: string): StrategicFitSettingsMutationResult;
  upsertCohortLabel(input: StrategicFitCohortLabelMutationInput): StrategicFitSettingsMutationResult;
  removeCohortLabel(labelId: string): StrategicFitSettingsMutationResult;
  upsertRouteWeight(input: StrategicFitManualWeightMutationInput): StrategicFitSettingsMutationResult;
  removeRouteWeight(routeId: string): StrategicFitSettingsMutationResult;
  upsertDecisionWeight(input: StrategicFitManualWeightMutationInput): StrategicFitSettingsMutationResult;
  removeDecisionWeight(decisionId: string): StrategicFitSettingsMutationResult;
  reconcile(): StrategicFitSettingsMutationResult;
  analysisSettings(): StrategicFitAnalysisSettingsSnapshot;
  analysisSettingsIdentity(): string;
}

const PERSISTED_RESOLUTION_STATES = new Set<StrategicFitPersistedResolutionState>([
  "change-repertoire",
  "keep-intentionally",
  "train-as-exception",
  "reclassify-cohort",
  "exclude-from-analysis",
  "defer",
  "insufficient-evidence",
  "automatically-resolved-by-another-edit",
  "invalid-comparison",
]);
const INTENTIONAL_REASONS = new Set(INTENTIONAL_RESOLUTION_REASONS);
const INVALIDATION_RULES = new Set(RESOLUTION_INVALIDATION_RULES);

function nonEmpty(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(code);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function stringList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function paths(values: readonly (readonly string[])[]): string[][] {
  const unique = new Map<string, string[]>();
  for (const path of values) {
    const normalized = path.map((move) => move.trim()).filter(Boolean);
    unique.set(JSON.stringify(normalized), normalized);
  }
  return [...unique.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function references(value: SemanticReferences): SemanticReferences {
  return {
    position_ids: stringList(value.position_ids),
    decision_ids: stringList(value.decision_ids),
    route_ids: stringList(value.route_ids),
    source_san_paths: paths(value.source_san_paths),
  };
}

function defaultProvenance(
  boundary: StrategicFitResolutionStateBoundary,
  supplied: readonly StrategicFitSourceProvenance[] | undefined,
): readonly StrategicFitSourceProvenance[] {
  if (supplied && supplied.length > 0) return supplied.map((entry) => ({ ...entry }));
  return [{
    source_id: "strategic-fit:browser-user-metadata",
    kind: "user-profile",
    state: "available",
    version: STRATEGIC_FIT_SCHEMA_VERSION,
    snapshot: boundary.currentRepertoireRevision(),
    reason: "Explicit user-authored Strategic Fit resolution or analysis override.",
  }];
}

function meaningfulRecord(record: Record<string, unknown>): string {
  const { updated_at: _updatedAt, record_state: _recordState, stale_reasons: _staleReasons, ...meaningful } = record;
  return JSON.stringify(meaningful);
}

function resolutionRules(
  input: StrategicFitResolutionMutationInput,
  normalizedReferences: SemanticReferences,
): ResolutionInvalidationRule[] {
  if (
    normalizedReferences.position_ids.length === 0 &&
    normalizedReferences.decision_ids.length === 0 &&
    normalizedReferences.route_ids.length === 0
  ) throw new Error("strategic_fit_resolution_requires_semantic_reference");
  const explicit = input.invalidation_rules?.map((rule) => {
    if (!INVALIDATION_RULES.has(rule)) throw new Error("strategic_fit_invalid_resolution_rule");
    return rule;
  });
  const result = explicit ?? [
    ...(normalizedReferences.position_ids.length > 0 ? ["referenced-position-changed" as const] : []),
    ...(normalizedReferences.decision_ids.length > 0 ? ["referenced-decision-changed" as const] : []),
    ...(normalizedReferences.route_ids.length > 0 ? ["referenced-route-changed" as const] : []),
  ];
  const unique = [...new Set(result)];
  if (unique.length === 0) throw new Error("strategic_fit_invalid_resolution_rule");
  if (unique.includes("never") && (unique.length !== 1 || input.expires_at != null)) {
    throw new Error("strategic_fit_invalid_resolution_rule");
  }
  return unique.sort();
}

function settingsIdentity(inputs: StrategicFitMetadataAnalysisInputs): string {
  const stable = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  };
  return stable(inputs);
}

function hasAnalysisRecords(metadata: StrategicFitDocumentMetadata): boolean {
  return metadata.resolutions.length > 0 || metadata.cohort_overrides.length > 0 ||
    metadata.exclusions.length > 0 || metadata.manual_weights.route_weights.length > 0 ||
    metadata.manual_weights.decision_weights.length > 0;
}

export function createStrategicFitResolutionState(
  boundary: StrategicFitResolutionStateBoundary,
): StrategicFitResolutionState {
  const commit = (
    next: StrategicFitDocumentMetadata,
    unchanged: StrategicFitSettingsMutationState = "unchanged",
  ): StrategicFitSettingsMutationResult => {
    const current = boundary.currentMetadata();
    if (JSON.stringify(current) === JSON.stringify(next)) return { state: unchanged, metadata: current };
    const result = boundary.replaceMetadata(next);
    boundary.invalidateReports();
    return { state: "updated", metadata: result.metadata };
  };

  const remove = <T>(
    collection: readonly T[],
    matches: (entry: T) => boolean,
    update: (next: T[]) => StrategicFitDocumentMetadata,
  ): StrategicFitSettingsMutationResult => {
    const next = collection.filter((entry) => !matches(entry));
    if (next.length === collection.length) {
      return { state: "missing", metadata: boundary.currentMetadata() };
    }
    const result = commit(update(next));
    return { ...result, state: result.state === "updated" ? "removed" : result.state };
  };

  const analysisSettingsSnapshot = (persistReconciliation: boolean): StrategicFitAnalysisSettingsSnapshot => {
    const before = boundary.currentMetadata();
    if (!hasAnalysisRecords(before)) return { identity: settingsIdentity({}), inputs: {} };
    let graph: RepertoireGraph;
    try {
      graph = boundary.currentGraph();
    } catch {
      return { identity: JSON.stringify(before), inputs: {} };
    }
    const reconciliation = reconcileStrategicFitDocumentMetadata(before, {
      graph,
      profile: boundary.currentProfile(),
      repertoire_revision: boundary.currentRepertoireRevision(),
      now: boundary.now(),
    });
    if (persistReconciliation && reconciliation.changed) commit(reconciliation.metadata);
    const inputs = strategicFitAnalysisInputsFromMetadata(
      reconciliation.changed
        ? persistReconciliation
          ? boundary.currentMetadata()
          : reconciliation.metadata
        : before,
      graph,
    );
    return { identity: settingsIdentity(inputs), inputs };
  };

  return {
    upsertResolution(input) {
      if (!PERSISTED_RESOLUTION_STATES.has(input.state)) throw new Error("strategic_fit_invalid_resolution_state");
      const metadata = boundary.currentMetadata();
      const resolutionId = nonEmpty(input.resolution_id, "strategic_fit_invalid_resolution_id");
      const findingId = nonEmpty(input.finding_id, "strategic_fit_invalid_finding_id");
      const semanticFindingId = nonEmpty(
        input.semantic_finding_id,
        "strategic_fit_invalid_semantic_finding_id",
      );
      const normalizedReferences = references(input.references);
      const rules = resolutionRules(input, normalizedReferences);
      const existing = metadata.resolutions.find((entry) => entry.resolution_id === resolutionId);
      const intentionalReason = input.state === "keep-intentionally"
        ? input.intentional_reason ?? null
        : null;
      if (intentionalReason !== null && !INTENTIONAL_REASONS.has(intentionalReason)) {
        throw new Error("strategic_fit_invalid_intentional_reason");
      }
      const now = boundary.now();
      const next: StrategicFitPersistedResolution = {
        schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
        resolution_id: resolutionId,
        finding_id: findingId,
        semantic_finding_id: semanticFindingId,
        repertoire_revision: boundary.currentRepertoireRevision(),
        state: input.state,
        intentional_reason: intentionalReason,
        note: optionalText(input.note),
        references: normalizedReferences,
        invalidation_rules: rules,
        expires_at: input.expires_at ?? null,
        linked_training_ids: stringList(input.linked_training_ids),
        linked_staged_edit_ids: stringList(input.linked_staged_edit_ids),
        created_at: existing?.created_at ?? now,
        profile_snapshot: rules.includes("profile-changed")
          ? strategicFitProfileSnapshot(boundary.currentProfile())
          : null,
        record_state: "active",
        stale_reasons: [],
        reason: optionalText(input.reason),
        updated_at: existing?.updated_at ?? now,
        provenance: defaultProvenance(boundary, input.provenance),
      };
      if (existing && existing.record_state === "active" &&
        metadata.resolutions.filter((entry) => entry.semantic_finding_id === semanticFindingId).length === 1 &&
        meaningfulRecord(existing as unknown as Record<string, unknown>) ===
          meaningfulRecord(next as unknown as Record<string, unknown>)) {
        return { state: "unchanged", metadata };
      }
      const updated = { ...next, updated_at: now };
      return commit({
        ...metadata,
        resolutions: [...metadata.resolutions.filter((entry) =>
          entry.resolution_id !== resolutionId && entry.semantic_finding_id !== semanticFindingId
        ), updated]
          .sort((left, right) => left.resolution_id.localeCompare(right.resolution_id)),
      });
    },

    removeResolution(resolutionId) {
      const metadata = boundary.currentMetadata();
      return remove(
        metadata.resolutions,
        (entry) => entry.resolution_id === resolutionId,
        (resolutions) => ({ ...metadata, resolutions }),
      );
    },

    reopenResolution(resolutionId) {
      return this.removeResolution(resolutionId);
    },

    upsertCohortOverride(input) {
      const metadata = boundary.currentMetadata();
      const overrideId = nonEmpty(input.override_id, "strategic_fit_invalid_override_id");
      const routeIds = stringList(input.route_ids);
      const decisionIds = stringList(input.decision_ids);
      if (input.kind !== "exclude" && routeIds.length === 0) {
        throw new Error("strategic_fit_override_requires_route");
      }
      if (input.kind !== "exclude" && decisionIds.length > 0) {
        throw new Error("strategic_fit_structural_override_rejects_decision");
      }
      if (input.kind === "exclude" && routeIds.length === 0 && decisionIds.length === 0) {
        throw new Error("strategic_fit_exclusion_requires_reference");
      }
      const now = boundary.now();
      const existing = [...metadata.cohort_overrides, ...metadata.exclusions]
        .find((entry) => entry.override_id === overrideId);
      const lifecycle = {
        record_state: "active" as const,
        stale_reasons: [],
        reason: optionalText(input.reason),
        updated_at: existing?.updated_at ?? now,
        provenance: defaultProvenance(boundary, input.provenance),
      };
      const next = input.kind === "exclude"
        ? { override_id: overrideId, kind: input.kind, route_ids: routeIds, decision_ids: decisionIds, ...lifecycle }
        : { override_id: overrideId, kind: input.kind, route_ids: routeIds, ...lifecycle };
      if (existing && existing.record_state === "active" &&
        meaningfulRecord(existing as unknown as Record<string, unknown>) ===
          meaningfulRecord(next as unknown as Record<string, unknown>)) {
        return { state: "unchanged", metadata };
      }
      if (input.kind === "exclude") {
        const updated = { ...next, kind: "exclude" as const, updated_at: now };
        return commit({
          ...metadata,
          cohort_overrides: metadata.cohort_overrides.filter((entry) => entry.override_id !== overrideId),
          exclusions: [...metadata.exclusions.filter((entry) => entry.override_id !== overrideId), updated]
            .sort((left, right) => left.override_id.localeCompare(right.override_id)),
        });
      }
      const updated = { ...next, kind: input.kind, updated_at: now } as
        StrategicFitDocumentMetadata["cohort_overrides"][number];
      return commit({
        ...metadata,
        cohort_overrides: [
          ...metadata.cohort_overrides.filter((entry) => entry.override_id !== overrideId),
          updated,
        ].sort((left, right) => left.override_id.localeCompare(right.override_id)),
        exclusions: metadata.exclusions.filter((entry) => entry.override_id !== overrideId),
      });
    },

    removeCohortOverride(overrideId) {
      const metadata = boundary.currentMetadata();
      const cohortOverrides = metadata.cohort_overrides.filter((entry) => entry.override_id !== overrideId);
      const exclusions = metadata.exclusions.filter((entry) => entry.override_id !== overrideId);
      if (
        cohortOverrides.length === metadata.cohort_overrides.length &&
        exclusions.length === metadata.exclusions.length
      ) return { state: "missing", metadata };
      const result = commit({ ...metadata, cohort_overrides: cohortOverrides, exclusions });
      return { ...result, state: result.state === "updated" ? "removed" : result.state };
    },

    upsertCohortLabel(input) {
      const metadata = boundary.currentMetadata();
      const labelId = nonEmpty(input.label_id, "strategic_fit_invalid_cohort_label_id");
      const cohortId = nonEmpty(input.cohort_id, "strategic_fit_invalid_cohort_id");
      const displayName = nonEmpty(input.display_name, "strategic_fit_invalid_cohort_display_name");
      if (displayName.length > 120) throw new Error("strategic_fit_cohort_display_name_too_long");
      const existing = metadata.cohort_labels.find((entry) =>
        entry.label_id === labelId || entry.cohort_id === cohortId
      );
      const now = boundary.now();
      const next: StrategicFitPersistedCohortLabel = {
        label_id: labelId,
        cohort_id: cohortId,
        display_name: displayName,
        record_state: "active",
        stale_reasons: [],
        reason: optionalText(input.reason),
        updated_at: existing?.updated_at ?? now,
        provenance: defaultProvenance(boundary, input.provenance),
      };
      if (
        existing?.record_state === "active" &&
        metadata.cohort_labels.filter((entry) => entry.cohort_id === cohortId).length === 1 &&
        meaningfulRecord(existing as unknown as Record<string, unknown>) ===
          meaningfulRecord(next as unknown as Record<string, unknown>)
      ) return { state: "unchanged", metadata };
      return commit({
        ...metadata,
        cohort_labels: [
          ...metadata.cohort_labels.filter((entry) =>
            entry.label_id !== labelId && entry.cohort_id !== cohortId
          ),
          { ...next, updated_at: now },
        ].sort((left, right) => left.label_id.localeCompare(right.label_id)),
      });
    },

    removeCohortLabel(labelId) {
      const metadata = boundary.currentMetadata();
      return remove(
        metadata.cohort_labels,
        (entry) => entry.label_id === labelId,
        (cohortLabels) => ({ ...metadata, cohort_labels: cohortLabels }),
      );
    },

    upsertRouteWeight(input) {
      const metadata = boundary.currentMetadata();
      const routeId = nonEmpty(input.target_id, "strategic_fit_invalid_route_id");
      if (!Number.isFinite(input.weight) || input.weight < 0) throw new Error("strategic_fit_invalid_weight");
      const existing = metadata.manual_weights.route_weights.find((entry) => entry.route_id === routeId);
      const now = boundary.now();
      const next = {
        route_id: routeId,
        weight: input.weight,
        record_state: "active" as const,
        stale_reasons: [],
        reason: optionalText(input.reason),
        updated_at: existing?.updated_at ?? now,
        provenance: defaultProvenance(boundary, input.provenance),
      };
      if (existing && existing.record_state === "active" &&
        meaningfulRecord(existing as unknown as Record<string, unknown>) ===
          meaningfulRecord(next as unknown as Record<string, unknown>)) {
        return { state: "unchanged", metadata };
      }
      return commit({
        ...metadata,
        manual_weights: {
          ...metadata.manual_weights,
          route_weights: [
            ...metadata.manual_weights.route_weights.filter((entry) => entry.route_id !== routeId),
            { ...next, updated_at: now },
          ].sort((left, right) => left.route_id.localeCompare(right.route_id)),
        },
      });
    },

    removeRouteWeight(routeId) {
      const metadata = boundary.currentMetadata();
      return remove(
        metadata.manual_weights.route_weights,
        (entry) => entry.route_id === routeId,
        (routeWeights) => ({
          ...metadata,
          manual_weights: { ...metadata.manual_weights, route_weights: routeWeights },
        }),
      );
    },

    upsertDecisionWeight(input) {
      const metadata = boundary.currentMetadata();
      const decisionId = nonEmpty(input.target_id, "strategic_fit_invalid_decision_id");
      if (!Number.isFinite(input.weight) || input.weight < 0) throw new Error("strategic_fit_invalid_weight");
      const existing = metadata.manual_weights.decision_weights.find((entry) => entry.decision_id === decisionId);
      const now = boundary.now();
      const next = {
        decision_id: decisionId,
        weight: input.weight,
        record_state: "active" as const,
        stale_reasons: [],
        reason: optionalText(input.reason),
        updated_at: existing?.updated_at ?? now,
        provenance: defaultProvenance(boundary, input.provenance),
      };
      if (existing && existing.record_state === "active" &&
        meaningfulRecord(existing as unknown as Record<string, unknown>) ===
          meaningfulRecord(next as unknown as Record<string, unknown>)) {
        return { state: "unchanged", metadata };
      }
      return commit({
        ...metadata,
        manual_weights: {
          ...metadata.manual_weights,
          decision_weights: [
            ...metadata.manual_weights.decision_weights.filter((entry) => entry.decision_id !== decisionId),
            { ...next, updated_at: now },
          ].sort((left, right) => left.decision_id.localeCompare(right.decision_id)),
        },
      });
    },

    removeDecisionWeight(decisionId) {
      const metadata = boundary.currentMetadata();
      return remove(
        metadata.manual_weights.decision_weights,
        (entry) => entry.decision_id === decisionId,
        (decisionWeights) => ({
          ...metadata,
          manual_weights: { ...metadata.manual_weights, decision_weights: decisionWeights },
        }),
      );
    },

    reconcile() {
      const metadata = boundary.currentMetadata();
      if (!hasAnalysisRecords(metadata)) return { state: "unchanged", metadata };
      let graph: RepertoireGraph;
      try {
        graph = boundary.currentGraph();
      } catch {
        // Unsupported/custom starts are reported by Strategic Fit preflight. They provide no
        // canonical graph against which durable semantic records can be invalidated safely.
        return { state: "unchanged", metadata };
      }
      const result = reconcileStrategicFitDocumentMetadata(metadata, {
        graph,
        profile: boundary.currentProfile(),
        repertoire_revision: boundary.currentRepertoireRevision(),
        now: boundary.now(),
      });
      return result.changed ? commit(result.metadata) : { state: "unchanged", metadata };
    },

    analysisSettings() {
      return analysisSettingsSnapshot(true);
    },

    analysisSettingsIdentity() {
      return analysisSettingsSnapshot(false).identity;
    },
  };
}

const browserResolutionState = createStrategicFitResolutionState({
  currentMetadata: strategicFitMetadata,
  currentGraph: () => buildRepertoireGraph(currentTree(), color()),
  currentProfile: strategicFitProfile,
  currentRepertoireRevision: () => `browser:${version()}`,
  replaceMetadata: replaceStrategicFitMetadata,
  invalidateReports: invalidateCachedStrategicFitReports,
  now: () => new Date().toISOString(),
});

export const upsertStrategicFitResolution = (input: StrategicFitResolutionMutationInput) =>
  browserResolutionState.upsertResolution(input);
export const removeStrategicFitResolution = (resolutionId: string) =>
  browserResolutionState.removeResolution(resolutionId);
export const reopenStrategicFitResolution = (resolutionId: string) =>
  browserResolutionState.reopenResolution(resolutionId);
export const upsertStrategicFitCohortOverride = (input: StrategicFitCohortOverrideMutationInput) =>
  browserResolutionState.upsertCohortOverride(input);
export const removeStrategicFitCohortOverride = (overrideId: string) =>
  browserResolutionState.removeCohortOverride(overrideId);
export const upsertStrategicFitCohortLabel = (input: StrategicFitCohortLabelMutationInput) =>
  browserResolutionState.upsertCohortLabel(input);
export const removeStrategicFitCohortLabel = (labelId: string) =>
  browserResolutionState.removeCohortLabel(labelId);
export const upsertStrategicFitRouteWeight = (input: StrategicFitManualWeightMutationInput) =>
  browserResolutionState.upsertRouteWeight(input);
export const removeStrategicFitRouteWeight = (routeId: string) =>
  browserResolutionState.removeRouteWeight(routeId);
export const upsertStrategicFitDecisionWeight = (input: StrategicFitManualWeightMutationInput) =>
  browserResolutionState.upsertDecisionWeight(input);
export const removeStrategicFitDecisionWeight = (decisionId: string) =>
  browserResolutionState.removeDecisionWeight(decisionId);
export const reconcileStrategicFitSettings = () => browserResolutionState.reconcile();
export const strategicFitAnalysisSettings = () => browserResolutionState.analysisSettings();
export const strategicFitAnalysisSettingsIdentity = () =>
  browserResolutionState.analysisSettingsIdentity();
