import assert from "node:assert/strict";
import test from "node:test";

import { BROWSER_COMMAND_NAMES } from "../src/application/browser-commands/types.ts";
import { ERROR_CONTENT, errorContent } from "../src/content/errors.ts";
import {
  centipawnDelta,
  centipawnText,
  cloudEvaluationText,
  countLabel,
  diffValue,
  evaluationText,
  numbered,
  titleCase,
} from "../src/content/format.ts";
import { TOOL_LABELS, taskLabel } from "../src/content/tools.ts";
import { assertContentCoverage } from "../../../scripts/check-content.mjs";

test("shared formatters preserve the previous component output byte-for-byte", () => {
  assert.equal(evaluationText({ mate: -3, cp: 900 }), "M3");
  assert.equal(evaluationText({ mate: null, cp: 23 }), "+0.23");
  assert.equal(evaluationText({ mate: null, cp: -157 }), "-1.57");
  assert.equal(evaluationText({ mate: null, cp: null }), "+0.00");
  assert.equal(centipawnText(0), "+0.00");
  assert.equal(centipawnText(-1), "-0.01");
  assert.equal(cloudEvaluationText(null), "—");
  assert.equal(cloudEvaluationText({ mate: null, cp: 34, depth: 22 }), "+0.34  ·  depth 22");
  assert.equal(cloudEvaluationText({ mate: 2, cp: null, depth: 30 }), "M2  ·  depth 30");
  assert.equal(numbered(["e4", "c6", "Nf3", "d5"]), "1. e4 c6 2. Nf3 d5");
  assert.equal(numbered(["c5", "Nf3"], 1), "1... c5 2. Nf3");
  assert.equal(centipawnDelta(null), "");
  assert.equal(centipawnDelta(25), " Δ−0.25");
  assert.equal(centipawnDelta(-25), " Δ+0.25");
  assert.equal(titleCase("review-now"), "Review Now");
  assert.equal(diffValue(null), "not set");
  assert.equal(diffValue([]), "none");
  assert.equal(diffValue(["one", "two"]), "one, two");
  assert.equal(diffValue(1.234), "1.23");
  assert.equal(countLabel(1, "move"), "1 move");
  assert.equal(countLabel(2, "move"), "2 moves");
});

test("content records preserve current labels and fallback error rendering", () => {
  assert.equal(taskLabel("compare_moves"), "Compare Moves");
  assert.equal(errorContent("engine_unavailable").title, "Local engine unavailable");
  assert.equal(errorContent("command_failed").title, "command failed");
  assert.deepEqual(Object.keys(TOOL_LABELS).sort(), [...BROWSER_COMMAND_NAMES].sort());
});

test("content gate rejects a browser contract without a user-facing label", () => {
  assert.throws(
    () =>
      assertContentCoverage({
        contractNames: [...BROWSER_COMMAND_NAMES, "fake_browser_contract"],
        toolLabels: TOOL_LABELS,
        errorCodes: [],
        errors: ERROR_CONTENT,
      }),
    /browser tools without labels: fake_browser_contract/,
  );
});
