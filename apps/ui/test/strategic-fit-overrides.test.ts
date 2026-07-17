import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  buildRepertoireGraph,
  completeStrategicFitReport,
  createDefaultStrategicFitDocumentMetadata,
  strategicFitCompleteAnalysisOptions,
  type AnalyzeStrategicFitOptions,
  type StrategicFitMetadataAnalysisInputs,
} from "@chess-mcp/chess-tools";
import { repertoireCommands } from "../src/application/browser-commands/repertoire.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";

const PGN = `1. e4 e5 *

1. d4 d5 2. c4 *

1. c4 e5 *`;

function harness() {
  const tree = GameTree.fromPgn(PGN);
  const graph = buildRepertoireGraph(tree, "white");
  const route = graph.routes[0]!;
  const documentInputs: StrategicFitMetadataAnalysisInputs = {
    weighting: {
      mode: "manual",
      route_weights: [{ route_id: route.route_id, weight: 3 }],
      decision_weights: [],
    },
    cohort_overrides: [{
      override_id: "override:document",
      kind: "split",
      route_ids: [route.route_id],
    }],
    route_assessments: [{ route_id: route.route_id, resolution_state: "defer" }],
  };
  let currentInputs = documentInputs;
  let captured: AnalyzeStrategicFitOptions | undefined;
  let artifacts = 0;
  const report = completeStrategicFitReport(analyzeStrategicFit(
    GameTree.fromPgn(PGN),
    strategicFitCompleteAnalysisOptions({
      repertoireColor: "white",
      repertoireRevision: "browser:7",
    }),
  ));
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    currentTree: () => tree,
    currentPgn: () => PGN,
    currentColor: () => "white" as const,
    currentRevision: () => 7,
    currentFileName: () => "overrides.pgn",
    currentStrategicFitProfile: () => createDefaultStrategicFitDocumentMetadata().profile,
    currentStrategicFitAnalysisSettings: () => ({
      identity: JSON.stringify(currentInputs),
      inputs: currentInputs,
    }),
    openings: async () => new Map(),
    analyse: async () => { throw new Error("Strategic Fit base analysis must remain engine-free"); },
    strategicFitReport: async (_pgn: string, options: AnalyzeStrategicFitOptions) => {
      captured = options;
      return report;
    },
    createArtifact: () => ({ artifact_id: `artifact:${++artifacts}` }),
  };
  return {
    dependencies,
    route,
    documentInputs,
    captured: () => captured,
    setInputs: (inputs: StrategicFitMetadataAnalysisInputs) => { currentInputs = inputs; },
  };
}

test("browser analysis inherits persisted weights, overrides, and resolutions", async () => {
  const h = harness();
  await repertoireCommands.analyze_repertoire_congruence({}, h.dependencies);

  assert.deepEqual(h.captured()?.weighting, h.documentInputs.weighting);
  assert.deepEqual(h.captured()?.cohorts?.overrides, h.documentInputs.cohort_overrides);
  assert.deepEqual(h.captured()?.routeAssessments, h.documentInputs.route_assessments);
});

test("one-off command settings replace the corresponding persisted setting without mutation", async () => {
  const h = harness();
  const oneOff = {
    weighting: { mode: "equal" as const },
    cohort_overrides: [{
      override_id: "override:one-off",
      kind: "exclude" as const,
      route_ids: [h.route.route_id],
    }],
    route_assessments: [{
      route_id: h.route.route_id,
      resolution_state: "train-as-exception" as const,
    }],
  };
  await repertoireCommands.analyze_repertoire_congruence(oneOff, h.dependencies);

  assert.equal(h.captured()?.weighting?.mode, "equal");
  assert.equal(h.captured()?.cohorts?.overrides?.[0]?.override_id, "override:one-off");
  assert.equal(h.captured()?.routeAssessments?.[0]?.resolution_state, "train-as-exception");
  assert.deepEqual(h.dependencies.currentStrategicFitAnalysisSettings().inputs, h.documentInputs);
});

test("congruence annotation receives every active document analysis setting", async () => {
  const h = harness();
  await repertoireCommands.export_annotated_repertoire({ include: ["congruence"] }, h.dependencies);

  assert.deepEqual(h.captured()?.weighting, h.documentInputs.weighting);
  assert.deepEqual(h.captured()?.cohorts?.overrides, h.documentInputs.cohort_overrides);
  assert.deepEqual(h.captured()?.routeAssessments, h.documentInputs.route_assessments);
});

test("late reports are rejected only when their effective settings change", async () => {
  const h = harness();
  const originalReport = h.dependencies.strategicFitReport;
  h.dependencies.strategicFitReport = async (pgn, options, execution) => {
    const report = await originalReport(pgn, options, execution);
    h.setInputs({
      ...h.documentInputs,
      route_assessments: [{ route_id: h.route.route_id, resolution_state: "keep-intentionally" }],
    });
    return report;
  };

  assert.deepEqual(await repertoireCommands.analyze_repertoire_congruence({}, h.dependencies), {
    error: "strategic_fit_stale_report",
    reason: "Document Strategic Fit resolutions or analysis overrides changed while analysis was running; request a fresh report.",
  });

  const oneOffHarness = harness();
  const oneOffReport = oneOffHarness.dependencies.strategicFitReport;
  oneOffHarness.dependencies.strategicFitReport = async (pgn, options, execution) => {
    const report = await oneOffReport(pgn, options, execution);
    oneOffHarness.setInputs({});
    return report;
  };
  const result = await repertoireCommands.analyze_repertoire_congruence({
    weighting: { mode: "equal" },
    cohort_overrides: [],
    route_assessments: [],
  }, oneOffHarness.dependencies) as { error?: string };
  assert.equal(result.error, undefined, "request-local replacements are unaffected by document setting edits");
});
