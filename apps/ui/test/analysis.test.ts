import assert from "node:assert/strict";
import test from "node:test";
import { deriveAnalysisState } from "../src/store/analysis.ts";

test("analysisState distinguishes engine off, startup, active, ready, and offline states", () => {
  const base = { evalEnabled: true, analysing: false, engineOffline: false, hasLines: false };

  assert.equal(deriveAnalysisState({ ...base, evalEnabled: false }), "off");
  assert.equal(deriveAnalysisState(base), "starting");
  assert.equal(deriveAnalysisState({ ...base, analysing: true, hasLines: true }), "analysing");
  assert.equal(deriveAnalysisState({ ...base, hasLines: true }), "ready");
  assert.equal(deriveAnalysisState({ ...base, engineOffline: true }), "offline");
});
