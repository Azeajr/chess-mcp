import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  buildRepertoireGraph,
  type StrategicFitAnalysisResult,
  type StrategicFinding,
} from "@chess-mcp/chess-tools";
import {
  DECISION_FLOW_CAUSAL_LABELS_TEXT,
  DECISION_FLOW_SYMBOLS,
  buildDecisionFlowViewModel,
  decisionFlowCausalityText,
  defaultDecisionFlowCohortId,
} from "../src/components/strategic-fit/DecisionFlow.tsx";
import { createStrategicFitFindingQueueState } from "../src/store/strategic-fit-finding-queue.ts";
import {
  openStrategicFitFindingQueue,
  setStrategicFitFindingQueueIntent,
  setStrategicFitWorkspaceStage,
  strategicFitFindingQueueIntent,
  strategicFitWorkspaceStage,
} from "../src/store/ui.ts";

const FLOW_PGN = `[Event "Flow: move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6 *

[Event "Flow: move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6 *

[Event "Flow: early h6"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 h6 6. Bh4 O-O 7. e3 b6 *

[Event "Flow: Nbd7 setup"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 O-O 6. e3 Nbd7 7. Rc1 c6 *`;

const REVISION = "revision:flow";

function analyze(pgn: string, revision = REVISION): StrategicFitAnalysisResult {
  return analyzeStrategicFit(GameTree.fromPgn(pgn), {
    repertoireColor: "white",
    repertoireRevision: revision,
  });
}

function model(
  pgn = FLOW_PGN,
  options: {
    readonly revision?: string;
    readonly graphRevision?: string | null;
    readonly graph?: ReturnType<typeof buildRepertoireGraph> | null;
    readonly findings?: readonly StrategicFinding[];
  } = {},
) {
  const revision = options.revision ?? REVISION;
  const report = analyze(pgn, revision);
  return {
    report,
    view: buildDecisionFlowViewModel(report, {
      graph: options.graph === undefined
        ? buildRepertoireGraph(GameTree.fromPgn(pgn), "white")
        : options.graph,
      graphRevision: options.graphRevision === undefined ? revision : options.graphRevision,
      cohortName: (cohortId) => `Cohort ${cohortId.slice(-4)}`,
      findings: options.findings,
    }),
  };
}

test("the flow view model lays out deterministic columns whose shares reconcile", () => {
  const first = model().view;
  const second = model().view;

  assert.equal(first.projection.state, "available");
  assert.ok(first.cohorts.length > 0);
  assert.deepEqual(
    first.cohorts.map((view) => view.nodes.map((node) => [node.node.node_id, node.x, node.share_percent])),
    second.cohorts.map((view) => view.nodes.map((node) => [node.node.node_id, node.x, node.share_percent])),
  );

  for (const cohort of first.cohorts) {
    const start = cohort.nodes.find((view) => view.node.kind === "start")!;
    assert.equal(start.share_percent, 100);
    assert.equal(start.node.depth, 0);
    assert.ok(
      cohort.nodes.every((view) => view.x >= start.x),
      "the start step must sit in the leftmost column",
    );
    for (const view of cohort.nodes) {
      assert.ok(view.share_percent >= 0 && view.share_percent <= 100);
      assert.ok(view.height > 0);
      assert.ok(view.x >= 0 && view.x < cohort.chart_width);
      assert.ok(view.y >= 0);
      assert.ok(view.aria_label.includes("expected games"));
    }
    for (const link of cohort.links) {
      assert.ok(link.thickness >= 1.5);
      assert.ok(link.path.startsWith("M "));
      assert.ok(link.aria_label.includes("% of expected games"));
    }
    assert.ok(cohort.screen_reader_summary.includes("Decision flow for"));
    assert.ok(cohort.screen_reader_summary.includes("branch"));
  }
  assert.ok(first.screen_reader_summary.includes("Decision flow across"));
});

test("player, opponent, start, and outcome steps are distinguishable without color", () => {
  const cohort = model().view.cohorts[0]!;
  const symbols = new Set(cohort.nodes.map((view) => view.symbol));
  assert.ok(symbols.has(DECISION_FLOW_SYMBOLS.start));
  assert.ok(symbols.has(DECISION_FLOW_SYMBOLS.player));
  assert.ok(symbols.has(DECISION_FLOW_SYMBOLS.opponent));
  assert.ok(symbols.has(DECISION_FLOW_SYMBOLS.mode));

  for (const view of cohort.nodes) {
    if (view.node.kind === "start") {
      assert.equal(view.actor_text, "Start");
      assert.equal(view.symbol, DECISION_FLOW_SYMBOLS.start);
    } else if (view.node.kind === "mode") {
      assert.equal(view.actor_text, "Strategic outcome");
      assert.equal(view.symbol, DECISION_FLOW_SYMBOLS.mode);
    } else if (view.node.actor === "player") {
      assert.equal(view.actor_text, "You play");
      assert.equal(view.symbol, DECISION_FLOW_SYMBOLS.player);
      assert.equal(view.move_text, view.node.san);
    } else {
      assert.equal(view.actor_text, "Opponent plays");
      assert.equal(view.symbol, DECISION_FLOW_SYMBOLS.opponent);
    }
    assert.ok(view.aria_label.startsWith(view.actor_text));
  }
});

test("a transposition is presented on the converging step and in the outline", () => {
  const cohort = model().view.cohorts[0]!;
  const converging = cohort.nodes.filter((view) => view.node.transposition !== null);
  assert.ok(converging.length > 0, "the fixture must converge by two move orders");
  for (const view of converging) {
    assert.equal(view.node.kind, "decision");
    assert.ok(view.node.transposition!.incoming_node_ids.length > 1);
    assert.ok(view.aria_label.includes("transposition"));
  }
});

test("causal text always states its qualification and never invents a controllability value", () => {
  const { report, view } = model();
  const cohort = view.cohorts[0]!;
  const decision = cohort.nodes.find((candidate) => candidate.node.kind === "decision")!;
  assert.equal(decision.node.causality.label, "not-referenced");
  assert.equal(decision.causality_text, DECISION_FLOW_CAUSAL_LABELS_TEXT["not-referenced"]);
  assert.ok(!decision.causality_text.includes("%"));

  const template = report.findings[0]!;
  const findingFor = (
    suffix: string,
    label: "mostly-player-controlled" | "shared-or-uncertain",
    controllability: number | null,
    confidence: "low" | "high",
  ): StrategicFinding => ({
    ...template,
    finding_id: `finding:flow-${suffix}`,
    references: { ...template.references, route_ids: [decision.node.route_ids[0]!] },
    confidence: { ...template.confidence, label: confidence },
    evidence: {
      ...template.evidence,
      causality: {
        ...template.evidence.causality,
        label,
        controllability,
        likely_causal_decision_ids: [decision.node.decision_id!],
      },
    },
  });
  const nodeWith = (findings: readonly StrategicFinding[]) =>
    model(FLOW_PGN, { findings }).view.cohorts
      .flatMap((entry) => entry.nodes)
      .find((candidate) => candidate.node.decision_id === decision.node.decision_id)!;

  const confident = nodeWith([findingFor("plain", "mostly-player-controlled", 0.82, "high")]);
  assert.equal(confident.node.causality.qualified, false);
  assert.equal(confident.causality_text, "You chose this (controllability 82%)");
  assert.ok(!confident.causality_text.includes("qualified"));

  const uncertain = nodeWith([findingFor("uncertain", "shared-or-uncertain", 0.4, "high")]);
  assert.equal(uncertain.node.causality.qualified, true);
  assert.ok(uncertain.causality_text.includes("qualified"));
  assert.equal(decisionFlowCausalityText(uncertain.node), uncertain.causality_text);

  const unsupported = nodeWith([findingFor("null", "mostly-player-controlled", null, "high")]);
  assert.ok(unsupported.causality_text.includes("no controllability value"));
  assert.ok(!unsupported.causality_text.includes("0%"));

  const lowConfidence = nodeWith([findingFor("low", "mostly-player-controlled", 0.82, "low")]);
  assert.equal(lowConfidence.node.causality.qualified, true);
  assert.ok(lowConfidence.causality_text.includes("qualified"));
});

test("the default cohort is the heaviest and every cohort keeps its own total", () => {
  const view = model().view;
  const chosen = defaultDecisionFlowCohortId(view);
  assert.ok(chosen !== null);
  const heaviest = [...view.cohorts].sort((left, right) =>
    right.cohort.total_weight - left.cohort.total_weight
  )[0]!;
  assert.equal(chosen, heaviest.cohort.cohort_id);
  for (const cohort of view.cohorts) {
    assert.ok(cohort.cohort.total_weight > 0);
    assert.ok(cohort.name.startsWith("Cohort "));
  }
  assert.equal(defaultDecisionFlowCohortId({ ...view, cohorts: [] }), null);
});

test("selecting a flow step routes through the canonical queue intent and selection", async () => {
  const { report, view } = model();
  const withFinding = view.cohorts
    .flatMap((cohort) => cohort.nodes)
    .find((candidate) => candidate.node.finding_ids.length > 0);
  assert.ok(withFinding, "expected at least one flow step with a finding");
  const findingId = withFinding.node.finding_ids[0]!;

  setStrategicFitWorkspaceStage("overview");
  setStrategicFitFindingQueueIntent(null);
  openStrategicFitFindingQueue({
    report_id: report.report_id,
    source: "decision-flow",
    label: "Findings for the selected flow step",
    filter: { kind: "all" },
  });
  assert.equal(strategicFitWorkspaceStage(), "findings");
  assert.equal(strategicFitFindingQueueIntent()?.source, "decision-flow");

  const queue = createStrategicFitFindingQueueState(async () => {
    throw new Error("flow selection must not trigger a page reload for a one-page report");
  });
  await queue.synchronize(report, strategicFitFindingQueueIntent());
  queue.selectFinding(findingId);
  assert.equal(queue.snapshot().selected_finding_id, findingId);
  queue.dispose();
  setStrategicFitFindingQueueIntent(null);
  setStrategicFitWorkspaceStage("overview");
});

test("a missing or stale graph produces an explicit unavailable flow with no steps", () => {
  const missing = model(FLOW_PGN, { graph: null }).view;
  assert.equal(missing.projection.state, "unavailable");
  assert.equal(missing.cohorts.length, 0);
  assert.ok(missing.screen_reader_summary.includes("unavailable"));
  assert.ok(missing.projection.reason?.includes("repertoire graph"));

  const stale = model(FLOW_PGN, { graphRevision: "revision:other" }).view;
  assert.equal(stale.projection.state, "unavailable");
  assert.equal(stale.cohorts.length, 0);
  assert.ok(stale.projection.reason?.includes("revision:other"));
});
