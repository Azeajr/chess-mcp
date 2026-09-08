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
import { GAPS_SCOPE } from "../src/content/repertoire.ts";
import { STRATEGIC_FIT_VISUALIZATION_UNAVAILABLE } from "../src/content/strategicFit.ts";
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

test("gap scan scope copy never lets a partial scan read as a whole one", () => {
  // The scan checks 12 decision nodes; the CT repertoires have 96 and 265 of them, so the counts
  // the panel prints are the difference between "your repertoire is clean" and "12 nodes are".
  assert.equal(
    GAPS_SCOPE.checked(12, 96),
    "Checked the first 12 of 96 positions; the rest were not scanned.",
  );
  assert.equal(
    GAPS_SCOPE.checked(12, 265),
    "Checked the first 12 of 265 positions; the rest were not scanned.",
  );
  // A tree small enough to finish makes no claim about an unscanned remainder.
  assert.equal(GAPS_SCOPE.checked(8, 8), "Checked all 8 positions.");
  assert.equal(GAPS_SCOPE.truncated(12, 30), "Showing the 12 most severe of 30 gaps found.");
  assert.equal(GAPS_SCOPE.note(12), "Up to 12 positions · local engine");

  // The chat card's one-liner, which reported nothing at all before.
  assert.equal(
    GAPS_SCOPE.cardSummary(1, 1, 12, 265),
    "1 gap · checked the first 12 of 265 positions",
  );
  assert.equal(
    GAPS_SCOPE.cardSummary(12, 30, 12, 96),
    "12 of 30 gaps · checked the first 12 of 96 positions",
  );
  assert.equal(GAPS_SCOPE.cardSummary(0, 0, 8, 8), "0 gaps · checked all 8 positions");
  // A payload from before the counts existed must not invent a denominator.
  assert.equal(GAPS_SCOPE.cardSummary(2, 2, 12, null), "2 gaps · 12 positions checked");
});

test("an unavailable visualization names itself only where no section heading does", () => {
  // The concept heatmap and the decision flow each render their own <h3>, so repeating the name
  // below it stacked two headings differing by one word. The strategic map renders no heading, so
  // its empty state is the only thing identifying which visualization is missing.
  const { titledSection, untitledMap } = STRATEGIC_FIT_VISUALIZATION_UNAVAILABLE;
  assert.equal(titledSection, "Not available for this report");
  assert.equal(untitledMap, "Strategic map unavailable");
  for (const name of ["heatmap", "flow", "map"]) {
    assert.equal(
      titledSection.toLowerCase().includes(name),
      false,
      `a titled section must not name itself again, found "${name}"`,
    );
  }
  assert.match(untitledMap, /strategic map/i);
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
