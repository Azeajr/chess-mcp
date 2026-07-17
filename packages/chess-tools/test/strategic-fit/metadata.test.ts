import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
  STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  type SemanticReferences,
  type StrategicFitDocumentMetadata,
  type StrategicFitSourceProvenance,
} from "../../src/index.ts";

const SOURCE: StrategicFitSourceProvenance = {
  source_id: "metadata:user",
  kind: "user-profile",
  state: "available",
  version: "1",
  snapshot: "revision:7",
  reason: "Confirmed by the user.",
};

const LIFECYCLE = {
  record_state: "active" as const,
  stale_reasons: [],
  reason: null,
  updated_at: "2026-07-17T12:00:00.000Z",
  provenance: [SOURCE],
};

const REFERENCES: SemanticReferences = {
  position_ids: ["position:semantic"],
  decision_ids: ["decision:semantic"],
  route_ids: ["route:semantic"],
  source_san_paths: [["e4", "c5", "Nf3"]],
};

function supportedMetadata(): StrategicFitDocumentMetadata {
  return {
    metadata_kind: STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
    metadata_version: STRATEGIC_FIT_DOCUMENT_METADATA_VERSION,
    profile: {
      schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
      mode: "custom",
      source: "explicit",
      provisional: false,
      preferences: {
        maximum_engine_loss_cp: 32,
        opponent_popularity_importance: 0.7,
        personal_game_frequency_importance: 0.4,
        manual_weight_importance: 0.8,
        additional_memorization_tolerance: 0.25,
        preferred_concept_ids: ["concept:iqp"],
        avoided_concept_ids: ["concept:opposite-castling"],
        preferred_tactical_character: ["quiet"],
        minimum_opponent_coverage: 0.94,
      },
    },
    manual_weights: {
      route_weights: [{ route_id: "route:semantic", weight: 2, ...LIFECYCLE }],
      decision_weights: [{ decision_id: "decision:semantic", weight: 3, ...LIFECYCLE }],
    },
    cohort_overrides: [
      {
        override_id: "override:merge",
        kind: "merge",
        route_ids: ["route:semantic", "route:other"],
        ...LIFECYCLE,
      },
      {
        override_id: "override:split",
        kind: "split",
        route_ids: ["route:third"],
        ...LIFECYCLE,
      },
    ],
    exclusions: [{
      override_id: "override:exclude",
      kind: "exclude",
      route_ids: ["route:excluded"],
      decision_ids: ["decision:excluded"],
      ...LIFECYCLE,
    }],
    resolutions: [{
      schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
      resolution_id: "resolution:semantic",
      finding_id: "finding:semantic",
      repertoire_revision: "revision:7",
      state: "keep-intentionally",
      intentional_reason: "strategically-desirable",
      note: "Keep this structure.",
      references: REFERENCES,
      invalidation_rules: ["referenced-position-changed", "referenced-decision-changed"],
      expires_at: null,
      linked_training_ids: ["training:semantic"],
      linked_staged_edit_ids: [],
      created_at: "2026-07-17T12:00:00.000Z",
      profile_snapshot: null,
      ...LIFECYCLE,
    }],
    archive_references: [{
      archive_id: "archive:semantic",
      repertoire_revision: "revision:7",
      references: REFERENCES,
      linked_staged_edit_id: "edit:semantic",
      created_at: "2026-07-17T12:01:00.000Z",
      provenance: [SOURCE],
    }],
    training_references: [{
      training_id: "training:semantic",
      finding_id: "finding:semantic",
      repertoire_revision: "revision:7",
      references: REFERENCES,
      created_at: "2026-07-17T12:02:00.000Z",
      provenance: [SOURCE],
    }],
    provenance: [SOURCE],
  };
}

test("empty metadata defaults are complete, deterministic, and independently allocated", () => {
  const first = createDefaultStrategicFitDocumentMetadata();
  const second = createDefaultStrategicFitDocumentMetadata();
  const emptyInput = normalizeStrategicFitDocumentMetadata(undefined);

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.profile, second.profile);
  assert.equal(first.metadata_kind, "chess-mcp/strategic-fit-document-metadata");
  assert.equal(first.metadata_version, "1.1.0");
  assert.deepEqual(first.profile, {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    mode: "balanced",
    source: "inferred",
    provisional: true,
    preferences: {
      maximum_engine_loss_cp: null,
      opponent_popularity_importance: 0,
      personal_game_frequency_importance: 0,
      manual_weight_importance: 0,
      additional_memorization_tolerance: 0.5,
      preferred_concept_ids: [],
      avoided_concept_ids: [],
      preferred_tactical_character: [],
      minimum_opponent_coverage: null,
    },
  });
  assert.deepEqual({
    manual_weights: first.manual_weights,
    cohort_overrides: first.cohort_overrides,
    exclusions: first.exclusions,
    resolutions: first.resolutions,
    archive_references: first.archive_references,
    training_references: first.training_references,
    provenance: first.provenance,
  }, {
    manual_weights: { route_weights: [], decision_weights: [] },
    cohort_overrides: [],
    exclusions: [],
    resolutions: [],
    archive_references: [],
    training_references: [],
    provenance: [],
  });
  assert.equal(emptyInput.state, "fallback");
  assert.deepEqual(emptyInput.metadata, first);
  assert.deepEqual(emptyInput.issues.map((entry) => entry.code), ["invalid-root"]);
});

test("supported metadata round-trips without losing canonical semantic IDs", () => {
  const supported = supportedMetadata();
  const jsonRoundTrip: unknown = JSON.parse(JSON.stringify(supported));
  const result = normalizeStrategicFitDocumentMetadata(jsonRoundTrip);

  assert.equal(result.state, "valid");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.metadata, supported);
  assert.equal(result.metadata.resolutions[0]?.references.position_ids[0], "position:semantic");
  assert.equal(result.metadata.exclusions[0]?.decision_ids?.[0], "decision:excluded");
  assert.equal(result.metadata.archive_references[0]?.references.route_ids[0], "route:semantic");
});

test("the explicit 0.1.0 migration maps draft flat collections deterministically", () => {
  const supported = supportedMetadata();
  const legacy = {
    metadata_version: "0.1.0",
    profile: supported.profile,
    route_weights: supported.manual_weights.route_weights,
    decision_weights: supported.manual_weights.decision_weights,
    cohort_overrides: supported.cohort_overrides,
    exclusions: supported.exclusions,
    resolutions: supported.resolutions,
    archives: supported.archive_references,
    training: supported.training_references,
    provenance: supported.provenance,
  };

  const first = normalizeStrategicFitDocumentMetadata(legacy);
  const second = normalizeStrategicFitDocumentMetadata(structuredClone(legacy));
  const minimal = normalizeStrategicFitDocumentMetadata({ metadata_version: "0.1.0" });
  assert.equal(first.state, "migrated");
  assert.equal(first.source_version, "0.1.0");
  assert.equal(first.target_version, STRATEGIC_FIT_DOCUMENT_METADATA_VERSION);
  assert.deepEqual(first, second);
  assert.deepEqual(first.metadata, supported);
  assert.equal(minimal.state, "migrated");
  assert.deepEqual(minimal.metadata, createDefaultStrategicFitDocumentMetadata());
});

test("unknown and corrupt versions fall back wholesale with structured evidence", () => {
  const unknown = normalizeStrategicFitDocumentMetadata({
    metadata_kind: STRATEGIC_FIT_DOCUMENT_METADATA_KIND,
    metadata_version: "99.0.0",
    profile: supportedMetadata().profile,
  });
  const corrupt = normalizeStrategicFitDocumentMetadata({ metadata_version: 1 });

  assert.equal(unknown.state, "fallback");
  assert.equal(unknown.source_version, "99.0.0");
  assert.deepEqual(unknown.metadata, createDefaultStrategicFitDocumentMetadata());
  assert.deepEqual(unknown.issues.map((entry) => entry.code), ["unsupported-version"]);
  assert.equal(corrupt.state, "fallback");
  assert.equal(corrupt.source_version, null);
  assert.deepEqual(corrupt.metadata, createDefaultStrategicFitDocumentMetadata());
  assert.deepEqual(corrupt.issues.map((entry) => entry.code), ["missing-version"]);
});

test("corrupt current data falls back by section and never throws or trusts malformed entries", () => {
  const supported = supportedMetadata();
  const input = structuredClone(supported) as unknown as Record<string, unknown>;
  input.profile = { ...supported.profile, provisional: true };
  input.manual_weights = {
    route_weights: [{ route_id: "route:bad", weight: Number.NaN }],
    decision_weights: supported.manual_weights.decision_weights,
  };
  input.resolutions = [{ ...supported.resolutions[0], state: "unresolved" }];

  const result = normalizeStrategicFitDocumentMetadata(input);
  assert.equal(result.state, "fallback");
  assert.deepEqual(result.metadata.profile, createDefaultStrategicFitDocumentMetadata().profile);
  assert.deepEqual(result.metadata.manual_weights.route_weights, []);
  assert.equal(result.metadata.manual_weights.decision_weights[0]?.decision_id, "decision:semantic");
  assert.deepEqual(result.metadata.resolutions, []);
  assert.equal(result.metadata.training_references[0]?.training_id, "training:semantic");
  assert.equal(result.issues.some((entry) => entry.code === "invalid-entry"), true);
  assert.equal(result.issues.some((entry) => entry.path === "$.profile"), true);
});

test("cohort override identities stay unique across structural overrides and exclusions", () => {
  const input = createDefaultStrategicFitDocumentMetadata();
  const result = normalizeStrategicFitDocumentMetadata({
    ...input,
    cohort_overrides: [{
      override_id: "override:same",
      kind: "split",
      route_ids: ["route:a"],
      ...LIFECYCLE,
    }],
    exclusions: [null, {
      override_id: "override:same",
      kind: "exclude",
      route_ids: ["route:b"],
      decision_ids: [],
      ...LIFECYCLE,
    }],
  });

  assert.equal(result.state, "fallback");
  assert.deepEqual(result.metadata.cohort_overrides.map((override) => override.override_id), ["override:same"]);
  assert.deepEqual(result.metadata.exclusions, []);
  assert.deepEqual(result.issues, [
    {
      code: "invalid-entry",
      path: "$.exclusions[0]",
      message: "Expected a cohort override object.",
    },
    {
      code: "duplicate-id",
      path: "$.exclusions[1]",
      message: "Duplicate cohort override identity across cohort_overrides and exclusions: override:same",
    },
  ]);
});

test("unknown future fields are ignored while every supported field survives", () => {
  const supported = supportedMetadata();
  const input = structuredClone(supported) as unknown as Record<string, any>;
  input.future_summary = { format: 2 };
  input.profile.future_profile_setting = true;
  input.profile.preferences.future_weight = 0.9;
  input.manual_weights.route_weights[0].future_source = "new-provider";
  input.resolutions[0].references.future_position_alias = "alias:1";

  const result = normalizeStrategicFitDocumentMetadata(input);
  assert.equal(result.state, "valid");
  assert.equal(result.issues.every((entry) => entry.code === "unknown-field-ignored"), true);
  assert.deepEqual(result.metadata, supported);
});

test("defaults and normalized metadata are JSON and structured-clone safe", () => {
  const defaults = createDefaultStrategicFitDocumentMetadata();
  const normalized = normalizeStrategicFitDocumentMetadata(supportedMetadata()).metadata;

  assert.deepEqual(JSON.parse(JSON.stringify(defaults)), defaults);
  assert.deepEqual(structuredClone(defaults), defaults);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), normalized);
  assert.deepEqual(structuredClone(normalized), normalized);
});

test("explicit whitelists prevent credentials and secret-bearing fields from surviving normalization", () => {
  const secret = "secret-value-that-must-not-survive";
  const input = structuredClone(supportedMetadata()) as unknown as Record<string, any>;
  input.api_key = secret;
  input.token = secret;
  input.profile.authorization = secret;
  input.profile.preferences.openrouter_api_key = secret;
  input.manual_weights.route_weights[0].access_token = secret;
  input.cohort_overrides[0].credentials = { password: secret };
  input.exclusions[0].apiKey = secret;
  input.resolutions[0].secret = secret;
  input.resolutions[0].references.bearer = secret;
  input.archive_references[0].token = secret;
  input.training_references[0].api_key = secret;
  input.provenance[0].authorization = secret;

  const result = normalizeStrategicFitDocumentMetadata(input);
  const serializedMetadata = JSON.stringify(result.metadata);
  assert.equal(result.state, "valid");
  assert.equal(serializedMetadata.includes(secret), false);
  assert.equal(/api[_-]?key|access[_-]?token|authorization|credentials|password|bearer/i.test(serializedMetadata), false);
  assert.deepEqual(result.metadata, supportedMetadata());
});
