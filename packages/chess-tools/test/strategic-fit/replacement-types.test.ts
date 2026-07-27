import assert from "node:assert/strict";
import test from "node:test";

import {
  REPLACEMENT_CANDIDATE_SOURCE_KINDS,
  REPLACEMENT_CANDIDATE_SOURCE_STATUSES,
  REPLACEMENT_CANDIDATE_STATUSES,
  REPLACEMENT_CHANGE_SET_RESULT_STATUSES,
  REPLACEMENT_CHANGE_SET_STATUSES,
  REPLACEMENT_PARETO_STATUSES,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "../../src/index.ts";
import {
  BLACK_REPLACEMENT_CANDIDATE,
  BLACK_REPLACEMENT_CHANGE_SET,
  BLACK_REPLACEMENT_CHANGE_SET_APPLIED_SUCCESS,
  BLACK_REPLACEMENT_CHANGE_SET_FAILURE,
  BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS,
  BLACK_REPLACEMENT_OBJECTIVE_QUALITY,
  BLACK_REPLACEMENT_REQUEST,
} from "./replacement-types.compile.ts";

test("Replacement Lab contracts and exhaustive enums export from the package root", () => {
  assert.equal(STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION, "1.0.0");
  assert.deepEqual(REPLACEMENT_CANDIDATE_SOURCE_KINDS, [
    "existing-repertoire-transposition",
    "opening-database",
    "engine-multipv",
    "user-defined",
    "structurally-similar-repertoire",
    "move-order-shortcut",
  ]);
  assert.deepEqual(REPLACEMENT_CANDIDATE_SOURCE_STATUSES, [
    "available",
    "partial",
    "unavailable",
    "stale",
    "rejected",
    "cancelled",
  ]);
  assert.deepEqual(REPLACEMENT_CANDIDATE_STATUSES, [
    "viable",
    "partial",
    "blocked",
    "rejected",
    "cancelled",
  ]);
  assert.deepEqual(REPLACEMENT_PARETO_STATUSES, ["unscored", "pareto-optimal", "dominated"]);
  assert.deepEqual(REPLACEMENT_CHANGE_SET_STATUSES, ["draft", "validated", "blocked"]);
  assert.deepEqual(REPLACEMENT_CHANGE_SET_RESULT_STATUSES, [
    "previewed",
    "applied",
    "rejected",
    "failed",
    "stale",
  ]);

  for (const values of [
    REPLACEMENT_CANDIDATE_SOURCE_KINDS,
    REPLACEMENT_CANDIDATE_SOURCE_STATUSES,
    REPLACEMENT_CANDIDATE_STATUSES,
    REPLACEMENT_PARETO_STATUSES,
    REPLACEMENT_CHANGE_SET_STATUSES,
    REPLACEMENT_CHANGE_SET_RESULT_STATUSES,
  ]) {
    assert.equal(new Set(values).size, values.length);
  }
});

test("replacement request, full candidate subtree, and atomic change set serialize losslessly", () => {
  for (const value of [
    BLACK_REPLACEMENT_REQUEST,
    BLACK_REPLACEMENT_CANDIDATE,
    BLACK_REPLACEMENT_CHANGE_SET,
    BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS,
    BLACK_REPLACEMENT_CHANGE_SET_APPLIED_SUCCESS,
    BLACK_REPLACEMENT_CHANGE_SET_FAILURE,
  ]) {
    const serialized = JSON.stringify(value);
    assert.deepEqual(JSON.parse(serialized), value);
    assert.match(serialized, /"schema_version":"2\.0\.0"/);
    assert.match(serialized, /"analysis_version":"2\.0\.0"/);
    assert.match(serialized, /"replacement_schema_version":"1\.0\.0"/);
  }

  assert.ok(BLACK_REPLACEMENT_CANDIDATE.subtree.nodes.length > 1);
  assert.ok(BLACK_REPLACEMENT_CANDIDATE.subtree.routes.length > 0);
  assert.equal(BLACK_REPLACEMENT_CANDIDATE.subtree.completion.kind, "immediate-transposition");
  assert.equal(BLACK_REPLACEMENT_CHANGE_SET.atomic, true);
  assert.equal(BLACK_REPLACEMENT_CHANGE_SET.staged, true);
  assert.equal(BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS.result.repertoire_revision, null);
  assert.equal(BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS.result.preview.before.route_count, 4);
  assert.equal(BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS.result.preview.after.route_count, 5);
  assert.equal(
    BLACK_REPLACEMENT_CHANGE_SET_APPLIED_SUCCESS.result.repertoire_revision,
    "revision:black-fixture:applied",
  );
  assert.equal(BLACK_REPLACEMENT_CHANGE_SET_FAILURE.result, null);
  assert.equal(BLACK_REPLACEMENT_CHANGE_SET_FAILURE.source_tree_unchanged, true);
});

test("Black replacement scores label White transport and repertoire POV independently", () => {
  assert.equal(BLACK_REPLACEMENT_REQUEST.repertoire_color, "black");
  assert.equal(BLACK_REPLACEMENT_OBJECTIVE_QUALITY.white_pov_evaluation_cp, -42);
  assert.equal(BLACK_REPLACEMENT_OBJECTIVE_QUALITY.white_pov_best_evaluation_cp, -50);
  assert.equal(BLACK_REPLACEMENT_OBJECTIVE_QUALITY.repertoire_pov_evaluation_cp, 42);
  assert.equal(BLACK_REPLACEMENT_OBJECTIVE_QUALITY.repertoire_pov_loss_from_best_cp, 8);
  assert.equal(BLACK_REPLACEMENT_OBJECTIVE_QUALITY.repertoire_pov_verdict, "within-tolerance");
});

test("all top-level replacement results carry current contract versions", () => {
  for (const value of [
    BLACK_REPLACEMENT_REQUEST,
    BLACK_REPLACEMENT_CANDIDATE,
    BLACK_REPLACEMENT_CHANGE_SET,
    BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS,
    BLACK_REPLACEMENT_CHANGE_SET_APPLIED_SUCCESS,
    BLACK_REPLACEMENT_CHANGE_SET_FAILURE,
  ]) {
    assert.equal(value.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
    assert.equal(value.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
    assert.equal(value.replacement_schema_version, STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION);
  }
});
