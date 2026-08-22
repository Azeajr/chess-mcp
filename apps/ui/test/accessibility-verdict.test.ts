import assert from "node:assert/strict";
import test from "node:test";
import type { AtClaim, EvidenceBundle } from "./accessibility/evidence-schema";
import { computeTreeVerdict, type TreeScenarioExpectation } from "./accessibility/verdict";

const snapshot =
  '- tree "Repertoire moves":\n  - group:\n    - treeitem "2. Nf3" [level=1]\n    - treeitem "Nc6" [expanded] [level=1]';

const expectation: TreeScenarioExpectation = {
  treeName: "Repertoire moves",
  entryMoveSan: "Nf3",
  branchMoveSan: "Nc6",
  expectedLevel: "1",
  traversalTargetSan: "Nf3",
  otherMoveSans: ["e4", "e5", "Nc6", "d6", "d4", "Nf6", "Nxe5", "Bb5"],
  floodThreshold: 4,
};

const observations = (source: "nvda" | "voiceover") => {
  const role = source === "voiceover" ? "Nf3, outline" : "Nf3, tree view";
  const utterances: Record<AtClaim, readonly string[]> = {
    "tree-role": [role],
    "item-level": ["Nf3, level 1"],
    "expanded-state": ["Nc6, expanded", "Nc6, collapsed"],
    "traversal-verbosity": ["Nf3"],
    "dialog-announcement": [],
    "background-unreachable": [],
    "focus-report": [],
    "focus-return": [],
  };
  return (["tree-role", "item-level", "expanded-state", "traversal-verbosity"] as const).map(
    (claim) => ({
      source,
      claim,
      atVersion: null,
      os: source === "nvda" ? "win32" : "darwin",
      browser: source === "nvda" ? "chromium" : "webkit",
      command: "fixture",
      utterances: utterances[claim],
      capturedAt: "2026-08-21T00:00:00.000Z",
    }),
  );
};

const bundle = (): EvidenceBundle => ({
  scenarioId: "ag-3-move-tree",
  runId: "fixture",
  stateFingerprint: "fixture",
  ariaSnapshots: (["chromium", "firefox", "webkit"] as const).map((browser) => ({
    source: "playwright-aria-snapshot",
    browser,
    locatorDescription: "tree",
    snapshot,
    capturedAt: "2026-08-21T00:00:00.000Z",
  })),
  cdpAxTrees: [],
  axe: [],
  keyboardTraces: [],
  atObservations: [...observations("nvda"), ...observations("voiceover")],
  infrastructureLimitations: [],
});

test("AG-3 verdict confirms complete browser and real-AT evidence", () => {
  const verdict = computeTreeVerdict(bundle(), expectation);
  assert.equal(verdict.overallStatus, "confirmed-pass");
  assert.ok(verdict.findings.every((finding) => finding.status === "confirmed-pass"));
});

test("AG-3 verdict fails closed when one AT source is absent", () => {
  const evidence = bundle();
  const verdict = computeTreeVerdict(
    {
      ...evidence,
      atObservations: evidence.atObservations.filter((entry) => entry.source === "nvda"),
    },
    expectation,
  );
  assert.equal(verdict.overallStatus, "automation-inconclusive");
});

test("AG-3 verdict rejects traversal speech containing another move", () => {
  const evidence = bundle();
  const atObservations = evidence.atObservations.map((entry) =>
    entry.source === "nvda" && entry.claim === "traversal-verbosity"
      ? { ...entry, utterances: ["Nf3", "Nc6"] }
      : entry,
  );
  const verdict = computeTreeVerdict({ ...evidence, atObservations }, expectation);
  assert.equal(verdict.overallStatus, "confirmed-failure");
});

test("AG-3 verdict accepts screen-reader spacing inside SAN tokens", () => {
  const evidence = bundle();
  const atObservations = evidence.atObservations.map((entry) => {
    if (entry.source !== "nvda") return entry;
    return {
      ...entry,
      utterances: entry.utterances.map((utterance) =>
        utterance.replaceAll("Nf3", "Nf 3").replaceAll("Nc6", "Nc 6"),
      ),
    };
  });
  const verdict = computeTreeVerdict({ ...evidence, atObservations }, expectation);
  assert.equal(verdict.overallStatus, "confirmed-pass");
});
