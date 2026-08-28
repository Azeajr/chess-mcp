import assert from "node:assert/strict";
import test from "node:test";
import type { AtClaim, EvidenceBundle } from "./accessibility/evidence-schema";
import {
  computeBoardVerdict,
  computeTreeVerdict,
  type BoardScenarioExpectation,
  type TreeScenarioExpectation,
} from "./accessibility/verdict";

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
    "grid-role": [],
    "square-description": [],
    "selection-count": [],
    "illegal-refusal": [],
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

// ---------------------------------------------------------------------------
// AG-4 — board keyboard layer (WP-014)
// ---------------------------------------------------------------------------

const boardSnapshot =
  '- grid "Chessboard. White to move.":\n  - row:\n    - gridcell "e2, white pawn"\n    - gridcell "e3, empty"';

const boardExpectation: BoardScenarioExpectation = {
  gridName: "Chessboard. White to move.",
  entrySquareDescription: "e2, white pawn",
  expectedDestinationCount: 2,
  illegalTargetSquare: "e5",
  traversalTargetSquare: "e3",
  otherSquareTokens: ["e4", "e5", "d3", "f3"],
  floodThreshold: 4,
};

const boardObservations = (source: "nvda" | "voiceover") => {
  const roleWord = source === "voiceover" ? "outline" : "grid";
  const utterances: Record<AtClaim, readonly string[]> = {
    "grid-role": [`e2, white pawn, ${roleWord}`],
    "square-description": [`e2, white pawn, ${roleWord}`],
    "selection-count": ["2 legal destinations."],
    "illegal-refusal": ["e5 is not a legal destination."],
    "traversal-verbosity": ["e3, empty"],
    "tree-role": [],
    "item-level": [],
    "expanded-state": [],
    "dialog-announcement": [],
    "background-unreachable": [],
    "focus-report": [],
    "focus-return": [],
  };
  return (
    [
      "grid-role",
      "square-description",
      "selection-count",
      "illegal-refusal",
      "traversal-verbosity",
    ] as const
  ).map((claim) => ({
    source,
    claim,
    atVersion: null,
    os: source === "nvda" ? "win32" : "darwin",
    browser: source === "nvda" ? "chromium" : "webkit",
    command: "fixture",
    utterances: utterances[claim],
    capturedAt: "2026-08-23T00:00:00.000Z",
  }));
};

const boardBundle = (): EvidenceBundle => ({
  scenarioId: "ag-4-board-keyboard",
  runId: "fixture",
  stateFingerprint: "fixture",
  ariaSnapshots: (["chromium", "firefox", "webkit"] as const).map((browser) => ({
    source: "playwright-aria-snapshot",
    browser,
    locatorDescription: "grid",
    snapshot: boardSnapshot,
    capturedAt: "2026-08-23T00:00:00.000Z",
  })),
  cdpAxTrees: [],
  axe: [],
  keyboardTraces: [],
  atObservations: [...boardObservations("nvda"), ...boardObservations("voiceover")],
  infrastructureLimitations: [],
});

test("AG-4 verdict confirms complete browser and real-AT evidence", () => {
  const verdict = computeBoardVerdict(boardBundle(), boardExpectation);
  assert.equal(verdict.overallStatus, "confirmed-pass");
  assert.ok(verdict.findings.every((finding) => finding.status === "confirmed-pass"));
});

test("AG-4 verdict fails closed when one AT source is absent", () => {
  const evidence = boardBundle();
  const verdict = computeBoardVerdict(
    {
      ...evidence,
      atObservations: evidence.atObservations.filter((entry) => entry.source === "nvda"),
    },
    boardExpectation,
  );
  assert.equal(verdict.overallStatus, "automation-inconclusive");
});

test("AG-4 verdict scores VoiceOver's grid-role by accessible-name identity, not role vocabulary", () => {
  // Real evidence (runs 32680688687, 32681168207): describeItemWithKeyboardFocus does not
  // reliably carry grid/table/row vocabulary for this widget — captureBoardObservations switched
  // to it anyway (over the racier cursor-sync chain) and the verdict scores VoiceOver's grid-role
  // by name+piece identity alone, the accessible-name proxy AG-3 already documents using for
  // VoiceOver's own omitted role/state vocabulary.
  const evidence = boardBundle();
  const atObservations = evidence.atObservations.map((entry) =>
    entry.source === "voiceover" &&
    (entry.claim === "grid-role" || entry.claim === "square-description")
      ? { ...entry, utterances: ["e2, white pawn"] }
      : entry,
  );
  const verdict = computeBoardVerdict({ ...evidence, atObservations }, boardExpectation);
  assert.equal(verdict.overallStatus, "confirmed-pass");
});

test("AG-4 verdict still rejects a VoiceOver grid-role utterance naming the wrong square", () => {
  const evidence = boardBundle();
  const atObservations = evidence.atObservations.map((entry) =>
    entry.source === "voiceover" && entry.claim === "grid-role"
      ? { ...entry, utterances: ["e8, black king"] }
      : entry,
  );
  const verdict = computeBoardVerdict({ ...evidence, atObservations }, boardExpectation);
  assert.equal(verdict.overallStatus, "confirmed-failure");
});

test("AG-4 verdict rejects a selection-count utterance that omits the count", () => {
  const evidence = boardBundle();
  const atObservations = evidence.atObservations.map((entry) =>
    entry.source === "nvda" && entry.claim === "selection-count"
      ? { ...entry, utterances: ["Selected."] }
      : entry,
  );
  const verdict = computeBoardVerdict({ ...evidence, atObservations }, boardExpectation);
  assert.equal(verdict.overallStatus, "confirmed-failure");
});

test("AG-4 verdict rejects traversal speech naming a square other than the target", () => {
  const evidence = boardBundle();
  const atObservations = evidence.atObservations.map((entry) =>
    entry.source === "voiceover" && entry.claim === "traversal-verbosity"
      ? { ...entry, utterances: ["e3, empty", "e4, empty"] }
      : entry,
  );
  const verdict = computeBoardVerdict({ ...evidence, atObservations }, boardExpectation);
  assert.equal(verdict.overallStatus, "confirmed-failure");
});

test("AG-4 verdict accepts screen-reader spacing inside a square token", () => {
  const evidence = boardBundle();
  const atObservations = evidence.atObservations.map((entry) => {
    if (entry.source !== "nvda") return entry;
    return {
      ...entry,
      utterances: entry.utterances.map((utterance) => utterance.replaceAll("e2", "e 2")),
    };
  });
  const verdict = computeBoardVerdict({ ...evidence, atObservations }, boardExpectation);
  assert.equal(verdict.overallStatus, "confirmed-pass");
});
