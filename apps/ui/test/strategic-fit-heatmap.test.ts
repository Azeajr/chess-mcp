import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  buildRepertoireGraph,
  createStrategicFitTrainingPerformanceData,
  deriveStrategicFitTrainingMastery,
  recordStrategicFitTrainingAttempt,
  upsertStrategicFitTrainingTarget,
  type StrategicFitAnalysisResult,
} from "@chess-mcp/chess-tools";
import {
  CONCEPT_HEATMAP_INTENT_LABELS,
  CONCEPT_HEATMAP_MASTERY_LABELS,
  buildConceptHeatmapViewModel,
  conceptHeatmapCellKey,
  sortConceptHeatmapColumns,
} from "../src/components/strategic-fit/ConceptHeatmap.tsx";
import { createStrategicFitFindingQueueState } from "../src/store/strategic-fit-finding-queue.ts";
import {
  openStrategicFitFindingQueue,
  setStrategicFitFindingQueueIntent,
  setStrategicFitWorkspaceStage,
  strategicFitFindingQueueIntent,
  strategicFitWorkspaceStage,
} from "../src/store/ui.ts";

const HEATMAP_PGN = `[Event "Heatmap: Queen's Gambit"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *

[Event "Heatmap: Ruy Lopez"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *

[Event "Heatmap: Open Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 *

[Event "Heatmap: French Advance"]
[Result "*"]

1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3 Nh6 7. b4 *`;

function analyze(pgn: string, revision = "revision:heatmap"): StrategicFitAnalysisResult {
  return analyzeStrategicFit(GameTree.fromPgn(pgn), {
    repertoireColor: "white",
    repertoireRevision: revision,
  });
}

test("the heatmap view model shows deterministic frequency, confidence, mastery, and intent", () => {
  const report = analyze(HEATMAP_PGN);
  const first = buildConceptHeatmapViewModel(report, {
    cohortName: (id) => `Cohort ${id.slice(-4)}`,
  });
  const second = buildConceptHeatmapViewModel(analyze(HEATMAP_PGN), {
    cohortName: (id) => `Cohort ${id.slice(-4)}`,
  });

  assert.equal(first.projection.state, "available");
  assert.ok(first.columns.length > 0);
  assert.ok(first.cells.size > 0);
  assert.deepEqual(
    [...first.cells.entries()].map(([key, view]) => [
      key,
      view.frequency_percent,
      view.confidence_percent,
    ]),
    [...second.cells.entries()].map(([key, view]) => [
      key,
      view.frequency_percent,
      view.confidence_percent,
    ]),
  );
  for (const view of first.cells.values()) {
    assert.ok(view.frequency_percent >= 0 && view.frequency_percent <= 100);
    assert.ok(view.confidence_percent >= 0 && view.confidence_percent <= 100);
    assert.ok(view.intensity >= 0 && view.intensity <= 1);
    assert.ok(view.aria_label.includes("expected in"));
    assert.ok(view.aria_label.includes("classifier confidence"));
    assert.ok(view.aria_label.includes("mastery"));
    assert.ok(view.aria_label.includes("intent"));
  }
  for (const column of first.columns) {
    assert.ok(column.header_label.includes(column.column.label));
    assert.ok(column.header_label.includes(column.mastery_text));
    assert.ok(column.header_label.includes(column.intent_text));
    assert.equal(column.intent_text, CONCEPT_HEATMAP_INTENT_LABELS[column.column.intent]);
  }
  assert.ok(first.screen_reader_summary.includes("Concept heatmap"));
  assert.ok(first.screen_reader_summary.includes("cohorts"));
});

test("missing training evidence stays distinct from zero mastery in every presentation", () => {
  const report = analyze(HEATMAP_PGN);

  const unavailable = buildConceptHeatmapViewModel(report, { mastery: null });
  for (const column of unavailable.columns) {
    assert.equal(column.column.mastery.value, null);
    assert.equal(column.mastery_text, CONCEPT_HEATMAP_MASTERY_LABELS.unavailable);
    assert.ok(!column.mastery_text.includes("0%"));
  }

  const emptyMastery = deriveStrategicFitTrainingMastery(
    createStrategicFitTrainingPerformanceData("document:heatmap-test"),
    buildRepertoireGraph(GameTree.fromPgn(HEATMAP_PGN), "white"),
    "2026-07-30T00:00:00.000Z",
  );
  const untrained = buildConceptHeatmapViewModel(report, { mastery: emptyMastery });
  for (const column of untrained.columns) {
    assert.equal(column.column.mastery.state, "untrained");
    assert.equal(column.column.mastery.value, null);
    assert.equal(column.mastery_text, CONCEPT_HEATMAP_MASTERY_LABELS.untrained);
  }
});

test("recorded training attempts surface observed mastery for the trained concept only", () => {
  const report = analyze(HEATMAP_PGN);
  const graph = buildRepertoireGraph(GameTree.fromPgn(HEATMAP_PGN), "white");
  const trainedConceptId = buildConceptHeatmapViewModel(report).columns[0]!.column.concept_id;
  const decision = graph.decisions[0]!;

  let data = createStrategicFitTrainingPerformanceData("document:heatmap-test");
  data = upsertStrategicFitTrainingTarget(data, {
    training_id: "training:heatmap-test",
    position_id: decision.from_position_id,
    decision_id: decision.decision_id,
    concept_ids: [trainedConceptId],
    created_at: "2026-07-01T00:00:00.000Z",
  });
  const targetId = data.targets[0]!.target_id;
  data = recordStrategicFitTrainingAttempt(data, {
    target_id: targetId,
    attempted_at: "2026-07-10T00:00:00.000Z",
    recalled: true,
    response_time_ms: 3500,
  });
  const mastery = deriveStrategicFitTrainingMastery(data, graph, "2026-07-30T00:00:00.000Z");

  const model = buildConceptHeatmapViewModel(report, { mastery });
  const trained = model.columns.find((column) => column.column.concept_id === trainedConceptId)!;
  assert.equal(trained.column.mastery.state, "observed");
  assert.ok(trained.column.mastery.value !== null && trained.column.mastery.value > 0);
  assert.ok(trained.mastery_text.endsWith("%"));
  for (const column of model.columns) {
    if (column.column.concept_id === trainedConceptId) continue;
    assert.equal(column.column.mastery.state, "untrained");
    assert.equal(column.column.mastery.value, null);
  }
});

test("column sorting is deterministic for every mode and never loses a concept", () => {
  const model = buildConceptHeatmapViewModel(analyze(HEATMAP_PGN));
  const conceptIds = model.columns.map((column) => column.column.concept_id).sort();

  const byConcept = sortConceptHeatmapColumns(model.columns, "concept");
  assert.deepEqual(
    byConcept.map((column) => column.column.concept_id),
    conceptIds,
  );

  const byFrequency = sortConceptHeatmapColumns(model.columns, "frequency");
  assert.deepEqual([...byFrequency.map((c) => c.column.concept_id)].sort(), conceptIds);
  for (let index = 1; index < byFrequency.length; index++) {
    const previous = byFrequency[index - 1]!.column;
    const current = byFrequency[index]!.column;
    assert.ok(
      previous.max_expected_frequency > current.max_expected_frequency ||
        (previous.max_expected_frequency === current.max_expected_frequency &&
          previous.concept_id < current.concept_id),
    );
  }

  const byMastery = sortConceptHeatmapColumns(model.columns, "mastery");
  assert.deepEqual([...byMastery.map((c) => c.column.concept_id)].sort(), conceptIds);
});

test("selecting a heatmap finding routes through the canonical queue intent and selection", async () => {
  const report = analyze(HEATMAP_PGN);
  const model = buildConceptHeatmapViewModel(report);
  const withFinding = [...model.cells.values()].find((view) => view.cell.finding_ids.length > 0);
  assert.ok(withFinding, "expected at least one heatmap cell with a finding");
  const findingId = withFinding.cell.finding_ids[0]!;
  assert.equal(
    conceptHeatmapCellKey(withFinding.cell.cohort_id, withFinding.cell.concept_id),
    `${withFinding.cell.cohort_id}|${withFinding.cell.concept_id}`,
  );

  setStrategicFitWorkspaceStage("overview");
  setStrategicFitFindingQueueIntent(null);
  openStrategicFitFindingQueue({
    report_id: report.report_id,
    source: "concept-heatmap",
    label: "Findings for the selected heatmap cell",
    filter: { kind: "all" },
  });
  assert.equal(strategicFitWorkspaceStage(), "findings");
  assert.equal(strategicFitFindingQueueIntent()?.source, "concept-heatmap");

  const queue = createStrategicFitFindingQueueState(async () => {
    throw new Error("heatmap selection must not trigger a page reload for a one-page report");
  });
  await queue.synchronize(report, strategicFitFindingQueueIntent());
  queue.selectFinding(findingId);
  assert.equal(queue.snapshot().selected_finding_id, findingId);
  queue.dispose();
  setStrategicFitFindingQueueIntent(null);
  setStrategicFitWorkspaceStage("overview");
});

test("a report without concept evidence produces an explicit unavailable heatmap", () => {
  const model = buildConceptHeatmapViewModel(analyze("1. e4 *", "revision:heatmap-shallow"));
  assert.equal(model.projection.state, "unavailable");
  assert.equal(model.cells.size, 0);
  assert.ok(model.projection.reason !== null);
  assert.ok(model.screen_reader_summary.includes("unavailable"));
});
