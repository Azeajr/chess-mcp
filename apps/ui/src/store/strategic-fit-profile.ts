/**
 * Document-scoped Strategic Fit profile state.
 *
 * The shared metadata contract remains canonical. This module adds only user/inference mutation
 * semantics, deterministic input normalization, report invalidation, and the browser singleton
 * wired through Task 4.3's debounced metadata boundary.
 */
import {
  STRATEGIC_FIT_PROFILE_MODES,
  createDefaultStrategicFitDocumentMetadata,
  type StrategicFitDocumentMetadata,
  type StrategicFitMetadataNormalizationResult,
  type StrategicFitProfile,
  type StrategicFitProfileMode,
  type StrategicFitProfilePreferences,
} from "@chess-mcp/chess-tools";
import { invalidateCachedStrategicFitReports } from "../application/strategic-fit-report-cache";
import { documentId } from "./game";
import {
  replaceStrategicFitMetadata,
  strategicFitMetadata,
} from "./strategic-fit-metadata";

export type StrategicFitProfilePreferencesInput = Readonly<
  Partial<Record<keyof StrategicFitProfilePreferences, unknown>>
>;

export type StrategicFitProfileMutationState = "updated" | "unchanged" | "ignored-explicit";

export interface StrategicFitProfileMutationResult {
  readonly state: StrategicFitProfileMutationState;
  readonly profile: StrategicFitProfile;
}

export interface StrategicFitProfileStateBoundary {
  currentDocumentId(): string;
  currentMetadata(): StrategicFitDocumentMetadata;
  replaceMetadata(input: StrategicFitDocumentMetadata): StrategicFitMetadataNormalizationResult;
  invalidateReports(): void;
}

export interface StrategicFitProfileState {
  profile(): StrategicFitProfile;
  select(
    mode: StrategicFitProfileMode,
    preferences?: StrategicFitProfilePreferencesInput,
  ): StrategicFitProfileMutationResult;
  updateCustom(preferences: StrategicFitProfilePreferencesInput): StrategicFitProfileMutationResult;
  applyInferred(
    mode: StrategicFitProfileMode,
    preferences?: StrategicFitProfilePreferencesInput,
  ): StrategicFitProfileMutationResult;
  confirmInferred(): StrategicFitProfileMutationResult;
}

const DEFAULT_PROFILE = createDefaultStrategicFitDocumentMetadata().profile;
const PROFILE_MODE_SET = new Set<StrategicFitProfileMode>(STRATEGIC_FIT_PROFILE_MODES);

function clonePreferences(preferences: StrategicFitProfilePreferences): StrategicFitProfilePreferences {
  return {
    ...preferences,
    preferred_concept_ids: [...preferences.preferred_concept_ids],
    avoided_concept_ids: [...preferences.avoided_concept_ids],
    preferred_tactical_character: [...preferences.preferred_tactical_character],
  };
}

function cloneProfile(profile: StrategicFitProfile): StrategicFitProfile {
  return { ...profile, preferences: clonePreferences(profile.preferences) };
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function optionalBoundedNumber(
  value: unknown,
  fallback: number | null,
  minimum: number,
  maximum: number,
  integer = false,
): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.min(maximum, Math.max(minimum, value));
  return integer ? Math.round(bounded) : bounded;
}

function stringList(value: unknown, fallback: readonly string[]): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) return [...fallback];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Normalize an advanced preference patch without allowing one malformed value to reset siblings. */
export function normalizeStrategicFitProfilePreferences(
  input: StrategicFitProfilePreferencesInput | undefined,
  base: StrategicFitProfilePreferences = DEFAULT_PROFILE.preferences,
): StrategicFitProfilePreferences {
  const patch = input ?? {};
  return {
    maximum_engine_loss_cp: optionalBoundedNumber(
      patch.maximum_engine_loss_cp,
      base.maximum_engine_loss_cp,
      0,
      1000,
      true,
    ),
    opponent_popularity_importance: boundedNumber(
      patch.opponent_popularity_importance,
      base.opponent_popularity_importance,
      0,
      1,
    ),
    personal_game_frequency_importance: boundedNumber(
      patch.personal_game_frequency_importance,
      base.personal_game_frequency_importance,
      0,
      1,
    ),
    manual_weight_importance: boundedNumber(
      patch.manual_weight_importance,
      base.manual_weight_importance,
      0,
      1,
    ),
    additional_memorization_tolerance: boundedNumber(
      patch.additional_memorization_tolerance,
      base.additional_memorization_tolerance,
      0,
      1,
    ),
    preferred_concept_ids: stringList(patch.preferred_concept_ids, base.preferred_concept_ids),
    avoided_concept_ids: stringList(patch.avoided_concept_ids, base.avoided_concept_ids),
    preferred_tactical_character: stringList(
      patch.preferred_tactical_character,
      base.preferred_tactical_character,
    ),
    minimum_opponent_coverage: optionalBoundedNumber(
      patch.minimum_opponent_coverage,
      base.minimum_opponent_coverage,
      0,
      1,
    ),
  };
}

/** Named profiles intentionally use canonical optional defaults until distinct values are designed. */
export function strategicFitPresetProfile(mode: StrategicFitProfileMode): StrategicFitProfile {
  if (!PROFILE_MODE_SET.has(mode)) throw new Error("strategic_fit_invalid_profile_mode");
  return {
    schema_version: DEFAULT_PROFILE.schema_version,
    mode,
    source: "explicit",
    provisional: false,
    preferences: clonePreferences(DEFAULT_PROFILE.preferences),
  };
}

/** Stable enough for normalized profile snapshots and browser stale-result guards. */
export function strategicFitProfileIdentity(profile: StrategicFitProfile): string {
  return JSON.stringify(profile);
}

export function createStrategicFitProfileState(
  boundary: StrategicFitProfileStateBoundary,
): StrategicFitProfileState {
  const inferredProfiles = new Map<string, StrategicFitProfile>();
  const effectiveProfile = (): StrategicFitProfile => {
    const id = boundary.currentDocumentId();
    const persisted = boundary.currentMetadata().profile;
    // An external metadata restore/import may publish explicit intent while an old session-only
    // inference exists. Explicit durable intent wins and clears only this document's inference.
    if (persisted.source === "explicit" || !persisted.provisional) {
      inferredProfiles.delete(id);
      return persisted;
    }
    return inferredProfiles.get(id) ?? persisted;
  };

  const commit = (next: StrategicFitProfile): StrategicFitProfileMutationResult => {
    const id = boundary.currentDocumentId();
    const currentMetadata = boundary.currentMetadata();
    const current = effectiveProfile();
    if (
      inferredProfiles.has(id) === false &&
      strategicFitProfileIdentity(currentMetadata.profile) === strategicFitProfileIdentity(next)
    ) {
      return { state: "unchanged", profile: cloneProfile(current) };
    }
    const normalized = boundary.replaceMetadata({ ...currentMetadata, profile: next });
    inferredProfiles.delete(id);
    boundary.invalidateReports();
    return { state: "updated", profile: cloneProfile(normalized.metadata.profile) };
  };

  return {
    profile: () => cloneProfile(effectiveProfile()),

    select(mode, preferences) {
      const preset = strategicFitPresetProfile(mode);
      return commit(mode === "custom"
        ? { ...preset, preferences: normalizeStrategicFitProfilePreferences(preferences) }
        : preset);
    },

    updateCustom(preferences) {
      const current = effectiveProfile();
      return commit({
        ...current,
        mode: "custom",
        source: "explicit",
        provisional: false,
        preferences: normalizeStrategicFitProfilePreferences(preferences, current.preferences),
      });
    },

    applyInferred(mode, preferences) {
      const persisted = boundary.currentMetadata().profile;
      if (persisted.source === "explicit" || !persisted.provisional) {
        return { state: "ignored-explicit", profile: cloneProfile(persisted) };
      }
      if (!PROFILE_MODE_SET.has(mode)) throw new Error("strategic_fit_invalid_profile_mode");
      const current = effectiveProfile();
      const next: StrategicFitProfile = {
        schema_version: DEFAULT_PROFILE.schema_version,
        mode,
        source: "inferred",
        provisional: true,
        preferences: normalizeStrategicFitProfilePreferences(preferences, current.preferences),
      };
      if (strategicFitProfileIdentity(current) === strategicFitProfileIdentity(next)) {
        return { state: "unchanged", profile: cloneProfile(current) };
      }
      inferredProfiles.set(boundary.currentDocumentId(), next);
      boundary.invalidateReports();
      return { state: "updated", profile: cloneProfile(next) };
    },

    confirmInferred() {
      const current = effectiveProfile();
      if (current.source === "explicit" && !current.provisional) {
        return { state: "unchanged", profile: cloneProfile(current) };
      }
      return commit({ ...current, source: "explicit", provisional: false });
    },
  };
}

const browserProfileState = createStrategicFitProfileState({
  currentDocumentId: documentId,
  currentMetadata: strategicFitMetadata,
  replaceMetadata: replaceStrategicFitMetadata,
  invalidateReports: invalidateCachedStrategicFitReports,
});

export const strategicFitProfile = () => browserProfileState.profile();
export const selectStrategicFitProfile = (
  mode: StrategicFitProfileMode,
  preferences?: StrategicFitProfilePreferencesInput,
) => browserProfileState.select(mode, preferences);
export const updateCustomStrategicFitProfile = (preferences: StrategicFitProfilePreferencesInput) =>
  browserProfileState.updateCustom(preferences);
export const applyInferredStrategicFitProfile = (
  mode: StrategicFitProfileMode,
  preferences?: StrategicFitProfilePreferencesInput,
) => browserProfileState.applyInferred(mode, preferences);
export const confirmInferredStrategicFitProfile = () => browserProfileState.confirmInferred();
