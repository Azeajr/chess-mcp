import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_SCHEMA_VERSION,
  strategicFitOptionsFromToolArguments,
  type StrategicFitToolArguments,
} from "../../src/index.ts";

test("public Strategic Fit arguments map deterministically to shared analyzer options", () => {
  const args: StrategicFitToolArguments = {
    profile: {
      mode: "custom",
      preferences: {
        maximum_engine_loss_cp: 35,
        opponent_popularity_importance: 0.7,
        preferred_concept_ids: ["concept:iqp"],
      },
    },
    weighting: {
      mode: "manual",
      route_weights: [{ route_id: "route:one", weight: 2 }],
      decision_weights: [{ decision_id: "decision:one", weight: 3 }],
    },
    page: { offset: 4, limit: 8 },
    sort: "expected-frequency",
    cohort_overrides: [{
      override_id: "override:one",
      kind: "exclude",
      route_ids: ["route:one"],
    }],
    explicit_targets: [{
      target_id: "target:one",
      cohort_id: "cohort:one",
      representative_route_id: "route:one",
    }],
    route_assessments: [{
      route_id: "route:one",
      matches_declared_objective: true,
    }],
  };
  const before = structuredClone(args);
  const options = strategicFitOptionsFromToolArguments(args, {
    repertoireColor: "black",
    repertoireRevision: "revision:host",
    openingTable: new Map(),
    generatedAt: "2026-07-17T00:00:00.000Z",
  });

  assert.deepEqual(args, before, "mapping must not mutate public inputs");
  assert.equal(options.repertoireColor, "black");
  assert.equal(options.repertoireRevision, "revision:host");
  assert.deepEqual(options.page, { offset: 4, limit: 8 });
  assert.equal(options.sort, "expected-frequency");
  assert.deepEqual(options.profile, {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    mode: "custom",
    source: "explicit",
    provisional: false,
    preferences: {
      maximum_engine_loss_cp: 35,
      opponent_popularity_importance: 0.7,
      personal_game_frequency_importance: 0,
      manual_weight_importance: 0,
      additional_memorization_tolerance: 0.5,
      preferred_concept_ids: ["concept:iqp"],
      avoided_concept_ids: [],
      preferred_tactical_character: [],
      minimum_opponent_coverage: null,
    },
  });
  assert.equal(options.weighting?.route_weights?.[0]?.provenance?.[0]?.source_id, "strategic-fit:tool-input");
  assert.equal(options.weighting?.decision_weights?.[0]?.provenance?.[0]?.kind, "user-profile");
  assert.equal(options.cohorts?.overrides?.[0]?.provenance?.[0]?.state, "available");
  assert.equal(options.modes?.explicit_targets?.[0]?.provenance?.[0]?.version, STRATEGIC_FIT_SCHEMA_VERSION);
  assert.deepEqual(options.routeAssessments, [{
    route_id: "route:one",
    matches_declared_objective: true,
  }]);
});

test("omitted public profile and weighting preserve analyzer inference defaults", () => {
  const options = strategicFitOptionsFromToolArguments(
    { min_severity: "low", limit: 4, acknowledged_weaknesses: [["e4"]] },
    { repertoireColor: "white", repertoireRevision: "revision:legacy" },
  );

  assert.equal(options.profile, undefined);
  assert.equal(options.weighting, undefined);
  assert.equal(options.page, undefined);
  assert.equal(options.repertoireRevision, "revision:legacy");
});
