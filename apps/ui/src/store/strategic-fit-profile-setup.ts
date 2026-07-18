import { createSignal } from "solid-js";
import type {
  StrategicFitProfile,
  StrategicFitProfileMode,
} from "@chess-mcp/chess-tools";
import { documentId } from "./game";
import {
  applyInferredStrategicFitProfile,
  selectStrategicFitProfile,
  strategicFitProfile,
  type StrategicFitProfileMutationResult,
  type StrategicFitProfilePreferencesInput,
} from "./strategic-fit-profile";

export interface StrategicFitProfileSetupBoundary {
  currentDocumentId(): string;
  currentProfile(): StrategicFitProfile;
  applyInferred(
    mode: StrategicFitProfileMode,
    preferences?: StrategicFitProfilePreferencesInput,
  ): StrategicFitProfileMutationResult;
  selectProfile(
    mode: StrategicFitProfileMode,
    preferences?: StrategicFitProfilePreferencesInput,
  ): StrategicFitProfileMutationResult;
}

export interface StrategicFitProfileSetupState {
  required(): boolean;
  skip(): StrategicFitProfileMutationResult;
  complete(
    mode: StrategicFitProfileMode,
    preferences?: StrategicFitProfilePreferencesInput,
  ): StrategicFitProfileMutationResult;
}

/**
 * First-run completion is deliberately session-only. Durable setup is represented exclusively by
 * an explicit canonical profile; skipping must never turn an inference into persisted user intent.
 */
export function createStrategicFitProfileSetupState(
  boundary: StrategicFitProfileSetupBoundary,
): StrategicFitProfileSetupState {
  const [completedDocumentIds, setCompletedDocumentIds] = createSignal<ReadonlySet<string>>(new Set());

  const markComplete = () => {
    const id = boundary.currentDocumentId();
    setCompletedDocumentIds((current) => new Set(current).add(id));
  };

  return {
    required() {
      const profile = boundary.currentProfile();
      return profile.source === "inferred"
        && profile.provisional
        && !completedDocumentIds().has(boundary.currentDocumentId());
    },

    skip() {
      const current = boundary.currentProfile();
      const result = boundary.applyInferred(current.mode, current.preferences);
      markComplete();
      return result;
    },

    complete(mode, preferences) {
      const result = boundary.selectProfile(mode, preferences);
      markComplete();
      return result;
    },
  };
}

const browserProfileSetupState = createStrategicFitProfileSetupState({
  currentDocumentId: documentId,
  currentProfile: strategicFitProfile,
  applyInferred: applyInferredStrategicFitProfile,
  selectProfile: selectStrategicFitProfile,
});

export const strategicFitProfileSetupRequired = () => browserProfileSetupState.required();
export const skipStrategicFitProfileSetup = () => browserProfileSetupState.skip();
export const completeStrategicFitProfileSetup = (
  mode: StrategicFitProfileMode,
  preferences?: StrategicFitProfilePreferencesInput,
) => browserProfileSetupState.complete(mode, preferences);
