import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  type StrategicFitAnalysisResult,
} from "@chess-mcp/chess-tools";
import {
  STRATEGIC_MAP_RESOLUTION_LABELS,
  buildStrategicMapViewModel,
} from "../src/components/strategic-fit/StrategicMap.tsx";
import { createStrategicFitFindingQueueState } from "../src/store/strategic-fit-finding-queue.ts";
import {
  openStrategicFitFindingQueue,
  setStrategicFitFindingQueueIntent,
  setStrategicFitWorkspaceStage,
  strategicFitFindingQueueIntent,
  strategicFitWorkspaceStage,
} from "../src/store/ui.ts";

const BROAD_PGN = `[Event "Map: Queen's Gambit"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *

[Event "Map: Ruy Lopez"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *

[Event "Map: Open Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 *

[Event "Map: French Advance"]
[Result "*"]

1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3 Nh6 7. b4 *`;

function analyze(pgn: string, revision = "revision:map"): StrategicFitAnalysisResult {
  return analyzeStrategicFit(GameTree.fromPgn(pgn), {
    repertoireColor: "white",
    repertoireRevision: revision,
  });
}

test("the map view model plots deterministic explainable points with size, opacity, and labels", () => {
  const report = analyze(BROAD_PGN);
  const first = buildStrategicMapViewModel(report, {
    cohortName: (id) => `Cohort ${id.slice(-4)}`,
  });
  const second = buildStrategicMapViewModel(analyze(BROAD_PGN), {
    cohortName: (id) => `Cohort ${id.slice(-4)}`,
  });

  assert.notEqual(first.projection.state, "unavailable");
  assert.ok(first.points.length > 0);
  assert.deepEqual(
    first.points.map((view) => [view.point.route_id, view.cx, view.cy, view.radius, view.opacity]),
    second.points.map((view) => [view.point.route_id, view.cx, view.cy, view.radius, view.opacity]),
  );
  for (const view of first.points) {
    assert.ok(view.cx >= 8 && view.cx <= 92);
    assert.ok(view.cy >= 8 && view.cy <= 92);
    assert.ok(view.radius >= 1.4 && view.radius <= 5);
    assert.ok(view.opacity >= 0.35 && view.opacity <= 1);
    assert.ok(view.label.length > 0);
    assert.ok(view.cohort_name.startsWith("Cohort "));
    assert.ok(view.aria_label.includes(STRATEGIC_MAP_RESOLUTION_LABELS[view.point.resolution]));
  }
  assert.ok(first.screen_reader_summary.includes("Strategic map"));
  assert.ok(first.screen_reader_summary.includes("unresolved"));
});

test("selecting a map finding routes through the canonical queue intent and selection", async () => {
  const report = analyze(BROAD_PGN);
  const withFinding = buildStrategicMapViewModel(report).points.find(
    (view) => view.point.finding_ids.length > 0,
  );
  assert.ok(withFinding, "expected at least one plotted branch with a finding");
  const findingId = withFinding.point.finding_ids[0]!;

  setStrategicFitWorkspaceStage("overview");
  setStrategicFitFindingQueueIntent(null);
  openStrategicFitFindingQueue({
    report_id: report.report_id,
    source: "strategic-map",
    label: "Findings for the selected map branch",
    filter: { kind: "all" },
  });
  assert.equal(strategicFitWorkspaceStage(), "findings");
  assert.equal(strategicFitFindingQueueIntent()?.source, "strategic-map");

  const queue = createStrategicFitFindingQueueState(async () => {
    throw new Error("map selection must not trigger a page reload for a one-page report");
  });
  await queue.synchronize(report, strategicFitFindingQueueIntent());
  queue.selectFinding(findingId);
  assert.equal(queue.snapshot().selected_finding_id, findingId);
  queue.dispose();
  setStrategicFitFindingQueueIntent(null);
  setStrategicFitWorkspaceStage("overview");
});

test("a report without comparable evidence produces an explicit unavailable map, not an empty chart", () => {
  const report = analyze("1. e4 *", "revision:map-shallow");
  const model = buildStrategicMapViewModel(report);
  assert.equal(model.projection.state, "unavailable");
  assert.equal(model.points.length, 0);
  assert.ok(model.projection.reason !== null);
  assert.ok(model.screen_reader_summary.includes("unavailable"));
  assert.ok(model.projection.exclusions.length > 0);
});

test("complete findings decide border presentation without moving any point", () => {
  const report = analyze(BROAD_PGN);
  const base = buildStrategicMapViewModel(report);
  const resolved = buildStrategicMapViewModel(report, {
    findings: report.findings.map((finding) => ({
      ...finding,
      resolution_state: "keep-intentionally" as const,
    })),
  });
  assert.deepEqual(
    resolved.points.map((view) => [view.cx, view.cy]),
    base.points.map((view) => [view.cx, view.cy]),
  );
  for (const view of resolved.points) {
    assert.notEqual(view.point.resolution, "unresolved-finding");
  }
});
