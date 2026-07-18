import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultStrategicFitDocumentMetadata,
  type StrategicFitProfile,
  type StrategicFitProfileMode,
} from "@chess-mcp/chess-tools";
import {
  createStrategicFitProfileSetupState,
  type StrategicFitProfileSetupBoundary,
} from "../src/store/strategic-fit-profile-setup.ts";
import type {
  StrategicFitProfileMutationResult,
  StrategicFitProfilePreferencesInput,
} from "../src/store/strategic-fit-profile.ts";

function setupFixture(initial = createDefaultStrategicFitDocumentMetadata().profile) {
  let currentDocumentId = "document:a";
  const profiles = new Map<string, StrategicFitProfile>([[currentDocumentId, structuredClone(initial)]]);
  const inferredCalls: Array<{ mode: StrategicFitProfileMode; preferences?: StrategicFitProfilePreferencesInput }> = [];
  const selectCalls: Array<{ mode: StrategicFitProfileMode; preferences?: StrategicFitProfilePreferencesInput }> = [];

  const result = (profile: StrategicFitProfile): StrategicFitProfileMutationResult => ({
    state: "updated",
    profile: structuredClone(profile),
  });
  const boundary: StrategicFitProfileSetupBoundary = {
    currentDocumentId: () => currentDocumentId,
    currentProfile: () => structuredClone(
      profiles.get(currentDocumentId) ?? createDefaultStrategicFitDocumentMetadata().profile,
    ),
    applyInferred: (mode, preferences) => {
      inferredCalls.push({ mode, preferences });
      const current = boundary.currentProfile();
      const profile: StrategicFitProfile = {
        ...current,
        mode,
        source: "inferred",
        provisional: true,
        preferences: preferences as StrategicFitProfile["preferences"] ?? current.preferences,
      };
      profiles.set(currentDocumentId, structuredClone(profile));
      return result(profile);
    },
    selectProfile: (mode, preferences) => {
      selectCalls.push({ mode, preferences });
      const current = boundary.currentProfile();
      const profile: StrategicFitProfile = {
        ...current,
        mode,
        source: "explicit",
        provisional: false,
        preferences: preferences as StrategicFitProfile["preferences"] ?? current.preferences,
      };
      profiles.set(currentDocumentId, structuredClone(profile));
      return result(profile);
    },
  };

  return {
    boundary,
    state: createStrategicFitProfileSetupState(boundary),
    newSession: () => createStrategicFitProfileSetupState(boundary),
    switchDocument(id: string, profile?: StrategicFitProfile) {
      currentDocumentId = id;
      if (profile) profiles.set(id, structuredClone(profile));
    },
    inferredCalls,
    selectCalls,
  };
}

test("Balanced is initially required and skip advances only the current session", () => {
  const fixture = setupFixture();
  assert.equal(fixture.boundary.currentProfile().mode, "balanced");
  assert.equal(fixture.state.required(), true);

  const skipped = fixture.state.skip();
  assert.equal(skipped.profile.mode, "balanced");
  assert.equal(skipped.profile.source, "inferred");
  assert.equal(skipped.profile.provisional, true);
  assert.equal(fixture.inferredCalls.length, 1);
  assert.equal(fixture.selectCalls.length, 0, "skip must not persist explicit intent");
  assert.equal(fixture.state.required(), false);

  assert.equal(fixture.newSession().required(), true, "a skipped inference must return next session");
});

test("session completion is document-scoped and never hides another provisional profile", () => {
  const fixture = setupFixture();
  fixture.state.skip();
  fixture.switchDocument("document:b");
  assert.equal(fixture.state.required(), true);
  fixture.state.skip();
  fixture.switchDocument("document:a");
  assert.equal(fixture.state.required(), false);
});

test("an explicit selection uses the canonical mutation boundary and survives a new session", () => {
  const fixture = setupFixture();
  const completed = fixture.state.complete("versatile");
  assert.equal(completed.profile.mode, "versatile");
  assert.equal(completed.profile.source, "explicit");
  assert.equal(completed.profile.provisional, false);
  assert.deepEqual(fixture.selectCalls, [{ mode: "versatile", preferences: undefined }]);
  assert.equal(fixture.newSession().required(), false);
});

test("Custom forwards every advanced preference through the existing canonical profile API", () => {
  const fixture = setupFixture();
  const preferences = {
    maximum_engine_loss_cp: 180,
    opponent_popularity_importance: 0.8,
    personal_game_frequency_importance: 0.65,
    manual_weight_importance: 0.35,
    additional_memorization_tolerance: 0.25,
    preferred_concept_ids: ["minority-attack"],
    avoided_concept_ids: ["isolated-queen-pawn"],
    preferred_tactical_character: ["forcing", "sharp"],
    minimum_opponent_coverage: 0.9,
  };

  fixture.state.complete("custom", preferences);
  assert.deepEqual(fixture.selectCalls, [{ mode: "custom", preferences }]);
});
