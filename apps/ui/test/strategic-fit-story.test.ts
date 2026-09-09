import assert from "node:assert/strict";
import test from "node:test";

import type {
  FindingPriorityLabel,
  StrategicFinding,
  StrategicFitAnalysisResult,
  StrategicFitClassification,
} from "@chess-mcp/chess-tools";
import { buildStrategicAssessmentPresentation } from "../src/components/strategic-fit/StrategicAssessment.tsx";
import {
  buildStrategicFindingStory,
  findingNeedsDecision,
} from "../src/components/strategic-fit/finding-story.ts";
import type { StrategicFitDisplayedResolutionState } from "../src/store/strategic-fit-finding-resolutions.ts";

function finding(
  id: string,
  patch: {
    classification?: StrategicFitClassification;
    causalLabel?: StrategicFinding["evidence"]["causality"]["label"];
    replacementLabel?: FindingPriorityLabel;
    replacementScore?: number;
    trainingLabel?: FindingPriorityLabel;
    trainingScore?: number;
    frequency?: number | null;
    confidence?: StrategicFinding["confidence"]["label"];
  } = {},
): StrategicFinding {
  return {
    finding_id: id,
    classification: patch.classification ?? "genuine-inconsistency",
    opening_scope: "Fixture opening",
    expected_frequency: patch.frequency === undefined ? 0.05 : patch.frequency,
    confidence: { label: patch.confidence ?? "high" },
    replacement_priority: {
      label: patch.replacementLabel ?? "informational",
      score: patch.replacementScore ?? 0.2,
    },
    training_priority: {
      label: patch.trainingLabel ?? "informational",
      score: patch.trainingScore ?? 0.2,
    },
    evidence: {
      causality: { label: patch.causalLabel ?? "mostly-player-controlled" },
    },
  } as unknown as StrategicFinding;
}

function report(
  findings: readonly StrategicFinding[],
  patch: {
    workload?: StrategicFitAnalysisResult["summary"]["workload"];
    conceptReuse?: number | null;
    conceptReuseState?: "available" | "partial" | "unavailable";
    routeCount?: number;
    comparableRouteCount?: number;
    incompleteRouteCount?: number;
  } = {},
): StrategicFitAnalysisResult {
  return {
    report_id: "report:story",
    findings,
    summary: {
      workload: patch.workload ?? "moderate",
      metrics: {
        concept_reuse: {
          state: patch.conceptReuseState ?? "available",
          value: patch.conceptReuse === undefined ? 0.75 : patch.conceptReuse,
        },
      },
    },
    preflight: {
      route_count: patch.routeCount ?? 4,
      comparable_route_count: patch.comparableRouteCount ?? 3,
      incomplete_route_count: patch.incompleteRouteCount ?? 1,
    },
  } as unknown as StrategicFitAnalysisResult;
}

const unresolved = (): StrategicFitDisplayedResolutionState => "unresolved";

test("a low-workload White-style report leads with familiarity and no change choice", () => {
  const findings = [
    finding("transposition", {
      classification: "transpositional-equivalence",
      causalLabel: "unknown",
    }),
    finding("short-line", {
      classification: "uncertain",
      causalLabel: "unknown",
      replacementLabel: "insufficient-evidence",
      trainingLabel: "insufficient-evidence",
    }),
  ];
  const source = report(findings, {
    workload: "low",
    conceptReuse: 0.85,
    conceptReuseState: "partial",
    routeCount: 19,
    comparableRouteCount: 11,
    incompleteRouteCount: 8,
  });
  const before = structuredClone(source);

  const presentation = buildStrategicAssessmentPresentation(source, findings, unresolved);

  assert.equal(presentation.headline, "Your repertoire mostly returns to familiar plans");
  assert.match(presentation.explanation, /85% of identified ideas repeat/);
  assert.match(presentation.explanation, /partial coverage/);
  assert.equal(
    presentation.coverage,
    "11 of 19 repertoire branches are long enough to compare. 8 need more moves.",
  );
  assert.deepEqual(
    {
      decisions: presentation.decision_count,
      context: presentation.context_count,
      gaps: presentation.gap_count,
      focus: presentation.focus,
    },
    { decisions: 0, context: 1, gaps: 1, focus: [] },
  );
  assert.deepEqual(source, before);
});

test("mixed strategic modes distinguish a player choice from opponent-forced context", () => {
  const playerChoice = finding("player-choice", {
    classification: "mixed-strategic-profile",
    causalLabel: "mostly-player-controlled",
    replacementLabel: "review-now",
    replacementScore: 0.9,
    confidence: "low",
  });
  const opponentContext = finding("opponent-context", {
    classification: "mixed-strategic-profile",
    causalLabel: "mostly-opponent-forced",
  });

  assert.deepEqual(buildStrategicFindingStory(playerChoice), {
    title: "This branch can lead to several kinds of positions",
    situation:
      "The available lines support more than one kind of middlegame instead of one clear typical plan.",
    control: "This difference mostly follows from moves you choose.",
    next_step:
      "Decide whether to keep and train this plan or compare it with a more familiar line.",
    kind: "choice",
    action_label: "Review this choice",
    frequency: "About 5 in 100 expected games",
    uncertainty: "Treat this conclusion as tentative because the supporting lines are limited.",
  });
  assert.equal(findingNeedsDecision(playerChoice, "unresolved"), true);
  assert.equal(findingNeedsDecision(playerChoice, "keep-intentionally"), false);

  const opponentStory = buildStrategicFindingStory(opponentContext);
  assert.equal(opponentStory.kind, "context");
  assert.equal(opponentStory.action_label, "Understand and keep");
  assert.equal(
    opponentStory.control,
    "Your opponent mostly decides whether this position appears.",
  );
  assert.equal(
    opponentStory.next_step,
    "Keep the coverage. Train this exception if the position still feels unfamiliar.",
  );
});

test("incomplete and unreliable branches remain evidence gaps", () => {
  for (const candidate of [
    finding("incomplete", {
      classification: "uncertain",
      replacementLabel: "insufficient-evidence",
      trainingLabel: "insufficient-evidence",
    }),
    finding("unreliable", {
      classification: "data-quality-issue",
      replacementLabel: "insufficient-evidence",
      trainingLabel: "insufficient-evidence",
    }),
  ]) {
    const story = buildStrategicFindingStory(candidate);
    assert.equal(story.kind, "gap");
    assert.equal(story.action_label, "Needs more moves");
    assert.equal(story.next_step, "Add more moves to this line, then run the review again.");
    assert.equal(findingNeedsDecision(candidate, "unresolved"), false);
  }
});

test("transpositions explicitly need no repertoire action", () => {
  const story = buildStrategicFindingStory(
    finding("transposition", {
      classification: "transpositional-equivalence",
      causalLabel: "unknown",
      frequency: null,
    }),
  );

  assert.equal(story.kind, "context");
  assert.equal(story.action_label, "No action needed");
  assert.equal(story.next_step, "No repertoire change is needed for this move-order difference.");
  assert.equal(story.frequency, null);
});

test("resolved choices leave the report untouched and disappear from assessment focus", () => {
  const first = finding("first-choice", {
    replacementLabel: "review-now",
    replacementScore: 0.9,
  });
  const second = finding("second-choice", {
    replacementLabel: "review-later",
    replacementScore: 0.5,
  });
  const context = finding("forced-context", {
    classification: "forced-diversity",
    causalLabel: "mostly-opponent-forced",
  });
  const findings = [first, second, context];
  const source = report(findings);
  const before = structuredClone(source);
  const resolutionState = (candidate: StrategicFinding): StrategicFitDisplayedResolutionState =>
    candidate.finding_id === first.finding_id ? "keep-intentionally" : "unresolved";

  const presentation = buildStrategicAssessmentPresentation(source, findings, resolutionState);

  assert.equal(presentation.decision_count, 1);
  assert.equal(presentation.context_count, 1);
  assert.deepEqual(
    presentation.focus.map((candidate) => candidate.finding_id),
    [second.finding_id],
  );
  assert.deepEqual(source, before);
});
