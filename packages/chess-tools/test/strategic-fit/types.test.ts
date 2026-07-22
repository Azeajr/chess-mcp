import assert from "node:assert/strict";
import test from "node:test";

import {
  FINDING_RESOLUTION_STATES,
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_CLASSIFICATIONS,
  STRATEGIC_FIT_PROFILE_MODES,
  STRATEGIC_FIT_PROGRESS_PHASES,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "../../src/index.ts";

test("Strategic Fit V2 types and versions are exported from the package root", () => {
  assert.equal(STRATEGIC_FIT_SCHEMA_VERSION, "2.0.0");
  assert.equal(STRATEGIC_FIT_ANALYSIS_VERSION, "2.0.0");
  assert.deepEqual(STRATEGIC_FIT_PROFILE_MODES, ["familiar-plans", "balanced", "versatile", "custom"]);
});

test("frozen classification, resolution, and progress enums are exhaustive and unique", () => {
  assert.deepEqual(STRATEGIC_FIT_CLASSIFICATIONS, [
    "genuine-inconsistency",
    "forced-diversity",
    "intentional-diversity",
    "productive-diversity",
    "mixed-strategic-profile",
    "uncertain",
    "data-quality-issue",
    "transpositional-equivalence",
  ]);
  assert.deepEqual(FINDING_RESOLUTION_STATES, [
    "unresolved",
    "change-repertoire",
    "keep-intentionally",
    "train-as-exception",
    "reclassify-cohort",
    "exclude-from-analysis",
    "defer",
    "insufficient-evidence",
    "automatically-resolved-by-another-edit",
  ]);
  assert.deepEqual(STRATEGIC_FIT_PROGRESS_PHASES, [
    "normalizing-move-orders",
    "identifying-comparable-branches",
    "extracting-strategic-patterns",
    "measuring-learning-burden",
    "attributing-differences-to-decisions",
    "ranking-findings",
  ]);

  for (const values of [STRATEGIC_FIT_CLASSIFICATIONS, FINDING_RESOLUTION_STATES, STRATEGIC_FIT_PROGRESS_PHASES]) {
    assert.equal(new Set(values).size, values.length);
  }
});

test("Strategic Fit analysis manifest has a stable serialization snapshot", () => {
  assert.equal(
    JSON.stringify(STRATEGIC_FIT_ANALYSIS_MANIFEST),
    '{"schema_version":"2.0.0","analysis_version":"2.0.0","components":{"graph":"1.0.0","taxonomy":"1.0.0","checkpoints":"1.0.0","pawn-signals":"1.0.0","position-signals":"1.0.0","trajectory":"1.0.0","concepts":"1.0.0","weights":"1.0.0","popularity":"1.0.0","personal-history":"1.0.0","cohorts":"1.0.0","modes":"1.0.0","distance":"1.0.0","confidence":"1.0.0","causality":"1.0.0","findings":"1.0.0","metrics":"1.0.0"}}',
  );
});
