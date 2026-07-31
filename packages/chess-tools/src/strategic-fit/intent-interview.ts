/**
 * Deterministic half of the staged AI intent interview.
 *
 * The assistant may translate a stated goal such as "low-theory Black repertoire, but an IQP is
 * fine when it is clearly best" into structured Strategic Fit preferences. It may never turn that
 * inference into durable intent. This module owns the parts of that boundary that must not depend
 * on a host: strict validation of a proposed patch, and an exact field-level diff between two
 * profiles.
 *
 * Validation here deliberately rejects rather than repairs. The interactive settings form clamps a
 * dragged slider because the user is watching the value move; a model-authored argument has no such
 * witness, so an out-of-range number, an unknown field, or an invented concept identity fails with
 * a structured code instead of being silently coerced into something the user never chose.
 *
 * This module never writes, persists, merges into stored metadata, or decides what "accept" means.
 * Preset semantics and persistence remain owned by the host profile state.
 */
import { isStrategicConceptId } from "./concepts.js";
import {
  STRATEGIC_FIT_PROFILE_MODES,
  STRATEGIC_SIGNAL_FAMILIES,
  type JsonValue,
  type StrategicFitProfile,
  type StrategicFitProfileMode,
  type StrategicFitProfilePreferences,
  type StrategicSignalFamily,
} from "./types.js";

/** Fixed bounds for a model-authored proposal. Exceeding one is an error, never a truncation. */
export const STRATEGIC_FIT_INTENT_LIMITS = Object.freeze({
  concept_ids: 32,
  tactical_character_terms: 12,
  tactical_character_characters: 32,
  rationale_characters: 400,
});

export const STRATEGIC_FIT_INTENT_ERROR_CODES = [
  "strategic_fit_intent_empty_proposal",
  "strategic_fit_intent_invalid_mode",
  "strategic_fit_intent_unknown_field",
  "strategic_fit_intent_invalid_value",
  "strategic_fit_intent_invalid_concept_id",
  "strategic_fit_intent_conflicting_concepts",
  "strategic_fit_intent_no_change",
  "strategic_fit_intent_proposal_stale",
  "strategic_fit_intent_proposal_not_pending",
] as const;
export type StrategicFitIntentErrorCode = (typeof STRATEGIC_FIT_INTENT_ERROR_CODES)[number];

export class StrategicFitIntentError extends Error {
  readonly code: StrategicFitIntentErrorCode;
  constructor(code: StrategicFitIntentErrorCode, message: string) {
    super(message);
    this.name = "StrategicFitIntentError";
    this.code = code;
  }
}

export interface StrategicFitIntentErrorResult {
  readonly error: StrategicFitIntentErrorCode;
  readonly reason: string;
}

/** Shared host mapping from a validation failure to one structured, code-bearing result. */
export function strategicFitIntentErrorResult(error: unknown): StrategicFitIntentErrorResult {
  if (error instanceof StrategicFitIntentError) return { error: error.code, reason: error.message };
  throw error;
}

export const STRATEGIC_FIT_PREFERENCE_FIELDS = [
  "maximum_engine_loss_cp",
  "opponent_popularity_importance",
  "personal_game_frequency_importance",
  "manual_weight_importance",
  "additional_memorization_tolerance",
  "preferred_concept_ids",
  "avoided_concept_ids",
  "preferred_tactical_character",
  "minimum_opponent_coverage",
  "feature_family_weights",
] as const;
export type StrategicFitPreferenceField = (typeof STRATEGIC_FIT_PREFERENCE_FIELDS)[number];

const PREFERENCE_LABELS: Readonly<Record<StrategicFitPreferenceField, string>> = {
  maximum_engine_loss_cp: "Evaluation tolerance (cp)",
  opponent_popularity_importance: "Opponent-popularity importance",
  personal_game_frequency_importance: "Personal-history importance",
  manual_weight_importance: "Manual-weight importance",
  additional_memorization_tolerance: "Memorization tolerance",
  preferred_concept_ids: "Preferred concepts",
  avoided_concept_ids: "Avoided concepts",
  preferred_tactical_character: "Preferred tactical character",
  minimum_opponent_coverage: "Minimum opponent coverage",
  feature_family_weights: "Feature-family weights",
};

const FAMILY_LABELS: Readonly<Record<StrategicSignalFamily, string>> = {
  "pawn-topology": "Pawn structure weight",
  "center-dynamics": "Center dynamics weight",
  "king-and-piece-setup": "King and piece setup weight",
  "space-and-files": "Space and open files weight",
  "dynamic-character": "Dynamic character weight",
  "learning-concepts": "Learning concepts weight",
};

const TACTICAL_CHARACTER_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface StrategicFitIntentProposalInput {
  readonly mode?: unknown;
  readonly preferences?: unknown;
  readonly rationale?: unknown;
}

export interface StrategicFitIntentPatch {
  readonly mode: StrategicFitProfileMode | null;
  readonly preferences: Partial<StrategicFitProfilePreferences> | null;
  readonly rationale: string | null;
  /**
   * True when the patch changes any preference. The host uses this to decide whether the result is
   * a named preset or a custom profile; a preference edit on top of a preset becomes custom exactly
   * as the settings form already behaves.
   */
  readonly touches_preferences: boolean;
}

function invalidValue(field: string, requirement: string): never {
  throw new StrategicFitIntentError(
    "strategic_fit_intent_invalid_value",
    `${field} ${requirement}. Propose a value the user could have set themselves; values are never adjusted to fit.`,
  );
}

function boundedNumber(field: string, value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalidValue(field, `must be a finite number from ${minimum} to ${maximum}`);
  }
  if (value < minimum || value > maximum) {
    invalidValue(field, `must be from ${minimum} to ${maximum}, but ${value} was proposed`);
  }
  return value;
}

function optionalBoundedNumber(
  field: string,
  value: unknown,
  minimum: number,
  maximum: number,
  integer: boolean,
): number | null {
  if (value === null) return null;
  const bounded = boundedNumber(field, value, minimum, maximum);
  if (integer && !Number.isInteger(bounded)) invalidValue(field, "must be a whole number of centipawns");
  return bounded;
}

function conceptIdList(field: string, value: unknown): string[] {
  if (!Array.isArray(value)) invalidValue(field, "must be an array of concept identities");
  if (value.length > STRATEGIC_FIT_INTENT_LIMITS.concept_ids) {
    invalidValue(field, `must contain at most ${STRATEGIC_FIT_INTENT_LIMITS.concept_ids} concepts`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (!isStrategicConceptId(entry)) {
      throw new StrategicFitIntentError(
        "strategic_fit_intent_invalid_concept_id",
        `${field} contains ${JSON.stringify(entry)}, which is not a Strategic Fit concept identity. Use an identity reported by the analysis, such as setup-family.castling.repertoire.kingside.`,
      );
    }
    if (!result.includes(entry)) result.push(entry);
  }
  return result;
}

function tacticalCharacterList(field: string, value: unknown): string[] {
  if (!Array.isArray(value)) invalidValue(field, "must be an array of short lowercase terms");
  if (value.length > STRATEGIC_FIT_INTENT_LIMITS.tactical_character_terms) {
    invalidValue(field, `must contain at most ${STRATEGIC_FIT_INTENT_LIMITS.tactical_character_terms} terms`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length > STRATEGIC_FIT_INTENT_LIMITS.tactical_character_characters ||
      !TACTICAL_CHARACTER_PATTERN.test(entry)
    ) {
      invalidValue(field, `entries must be lowercase terms such as forcing, sharp, or quiet, but ${JSON.stringify(entry)} was proposed`);
    }
    if (!result.includes(entry)) result.push(entry);
  }
  return result;
}

function familyWeights(value: unknown): Record<StrategicSignalFamily, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidValue("preferences.feature_family_weights", "must be an object of family weights");
  }
  const candidate = value as Record<string, unknown>;
  const result: Partial<Record<StrategicSignalFamily, number>> = {};
  for (const [family, weight] of Object.entries(candidate)) {
    if (!(STRATEGIC_SIGNAL_FAMILIES as readonly string[]).includes(family)) {
      throw new StrategicFitIntentError(
        "strategic_fit_intent_unknown_field",
        `preferences.feature_family_weights.${family} is not a Strategic Fit signal family. Valid families: ${STRATEGIC_SIGNAL_FAMILIES.join(", ")}.`,
      );
    }
    result[family as StrategicSignalFamily] = boundedNumber(
      `preferences.feature_family_weights.${family}`,
      weight,
      0,
      3,
    );
  }
  return result as Record<StrategicSignalFamily, number>;
}

function preferencePatch(value: unknown): Partial<StrategicFitProfilePreferences> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidValue("preferences", "must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    if (!(STRATEGIC_FIT_PREFERENCE_FIELDS as readonly string[]).includes(key)) {
      throw new StrategicFitIntentError(
        "strategic_fit_intent_unknown_field",
        `preferences.${key} is not a Strategic Fit preference. Valid preferences: ${STRATEGIC_FIT_PREFERENCE_FIELDS.join(", ")}.`,
      );
    }
    const field = `preferences.${key}`;
    switch (key as StrategicFitPreferenceField) {
      case "maximum_engine_loss_cp":
        patch[key] = optionalBoundedNumber(field, entry, 0, 1000, true);
        break;
      case "minimum_opponent_coverage":
        patch[key] = optionalBoundedNumber(field, entry, 0, 1, false);
        break;
      case "opponent_popularity_importance":
      case "personal_game_frequency_importance":
      case "manual_weight_importance":
      case "additional_memorization_tolerance":
        patch[key] = boundedNumber(field, entry, 0, 1);
        break;
      case "preferred_concept_ids":
      case "avoided_concept_ids":
        patch[key] = conceptIdList(field, entry);
        break;
      case "preferred_tactical_character":
        patch[key] = tacticalCharacterList(field, entry);
        break;
      case "feature_family_weights":
        patch[key] = familyWeights(entry);
        break;
    }
  }
  const preferred = patch.preferred_concept_ids as readonly string[] | undefined;
  const avoided = patch.avoided_concept_ids as readonly string[] | undefined;
  if (preferred && avoided) {
    const overlap = preferred.filter((concept) => avoided.includes(concept));
    if (overlap.length) {
      throw new StrategicFitIntentError(
        "strategic_fit_intent_conflicting_concepts",
        `${overlap.join(", ")} cannot be preferred and avoided at the same time. Ask the user which one they meant instead of choosing for them.`,
      );
    }
  }
  return patch as Partial<StrategicFitProfilePreferences>;
}

/**
 * Validate a model-authored proposal into a patch. It does not merge, apply, or persist anything;
 * an accepted patch is still only a patch until the host commits it through its own profile state.
 */
export function resolveStrategicFitIntentPatch(
  input: StrategicFitIntentProposalInput,
): StrategicFitIntentPatch {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalidValue("proposal", "must be an object");
  }
  if (input.mode === undefined && input.preferences === undefined) {
    throw new StrategicFitIntentError(
      "strategic_fit_intent_empty_proposal",
      "A profile proposal must contain a mode, preferences, or both. Ask the user what to change rather than proposing nothing.",
    );
  }
  let mode: StrategicFitProfileMode | null = null;
  if (input.mode !== undefined) {
    if (
      typeof input.mode !== "string" ||
      !(STRATEGIC_FIT_PROFILE_MODES as readonly string[]).includes(input.mode)
    ) {
      throw new StrategicFitIntentError(
        "strategic_fit_intent_invalid_mode",
        `mode must be one of: ${STRATEGIC_FIT_PROFILE_MODES.join(", ")}.`,
      );
    }
    mode = input.mode as StrategicFitProfileMode;
  }
  const preferences = input.preferences === undefined ? null : preferencePatch(input.preferences);
  if (preferences !== null && Object.keys(preferences).length === 0 && mode === null) {
    throw new StrategicFitIntentError(
      "strategic_fit_intent_empty_proposal",
      "A profile proposal must change at least one preference or the profile mode.",
    );
  }
  let rationale: string | null = null;
  if (input.rationale !== undefined) {
    if (
      typeof input.rationale !== "string" ||
      input.rationale.length > STRATEGIC_FIT_INTENT_LIMITS.rationale_characters
    ) {
      invalidValue(
        "rationale",
        `must be a string of at most ${STRATEGIC_FIT_INTENT_LIMITS.rationale_characters} characters`,
      );
    }
    const trimmed = input.rationale.trim();
    rationale = trimmed.length ? trimmed : null;
  }
  return {
    mode,
    preferences,
    rationale,
    touches_preferences: preferences !== null && Object.keys(preferences).length > 0,
  };
}

export interface StrategicFitProfileDiffEntry {
  readonly field: string;
  readonly label: string;
  readonly current: JsonValue;
  readonly proposed: JsonValue;
}

function sameValue(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Exact field-level difference between the current effective profile and a resulting profile.
 * Unchanged fields are omitted, and every remaining entry carries both sides so the user compares
 * the actual values rather than a summary of them.
 */
export function diffStrategicFitProfiles(
  current: StrategicFitProfile,
  proposed: StrategicFitProfile,
): readonly StrategicFitProfileDiffEntry[] {
  const entries: StrategicFitProfileDiffEntry[] = [];
  if (current.mode !== proposed.mode) {
    entries.push({ field: "mode", label: "Profile mode", current: current.mode, proposed: proposed.mode });
  }
  for (const field of STRATEGIC_FIT_PREFERENCE_FIELDS) {
    if (field === "feature_family_weights") continue;
    const before = current.preferences[field] as JsonValue;
    const after = proposed.preferences[field] as JsonValue;
    if (sameValue(before, after)) continue;
    entries.push({
      field: `preferences.${field}`,
      label: PREFERENCE_LABELS[field],
      current: before,
      proposed: after,
    });
  }
  for (const family of STRATEGIC_SIGNAL_FAMILIES) {
    const before = current.preferences.feature_family_weights[family];
    const after = proposed.preferences.feature_family_weights[family];
    if (before === after) continue;
    entries.push({
      field: `preferences.feature_family_weights.${family}`,
      label: FAMILY_LABELS[family],
      current: before,
      proposed: after,
    });
  }
  return entries;
}
