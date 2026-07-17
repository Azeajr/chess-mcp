import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  annotateRepertoire,
  completeStrategicFitReport,
  strategicFitAnnotationText,
  strategicFitCompleteAnalysisOptions,
  strategicFitPortableAnnotations,
  type StrategicFinding,
} from "../../src/index.ts";
import {
  SHALLOW_LINES_FIXTURE,
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

const noEngine = async (): Promise<never> => {
  throw new Error("Strategic Fit repertoire annotations must remain engine-free");
};

function completeReport(
  tree: GameTree,
  repertoireColor: "white" | "black",
  repertoireRevision: string,
) {
  return completeStrategicFitReport(analyzeStrategicFit(tree, strategicFitCompleteAnalysisOptions({
    repertoireColor,
    repertoireRevision,
  })));
}

test("multi-path V2 findings annotate every relevant source SAN path", async () => {
  const tree = parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE);
  const revision = "annotation:multi-path";
  const report = completeReport(tree, WHITE_TRANSPOSITION_FIXTURE.repertoireColor, revision);
  const multiPath = report.findings.find((finding) => finding.references.source_san_paths.length > 1);
  assert.ok(multiPath, "transposition fixture must produce a multi-path finding");

  const result = await annotateRepertoire(
    tree,
    WHITE_TRANSPOSITION_FIXTURE.repertoireColor,
    { include: ["congruence"], repertoireRevision: revision },
    noEngine,
    undefined,
    () => report,
  );
  assert.ok(!("error" in result) && !("cancelled" in result));

  const expectedTargets = strategicFitPortableAnnotations(report)
    .reduce((count, annotation) => count + annotation.source_san_paths.length, 0);
  assert.equal(result.annotated.congruence, expectedTargets);
  const findingMarker = `finding=${multiPath.finding_id}`;
  assert.equal(result.pgn.split(findingMarker).length - 1, multiPath.references.source_san_paths.length);
});

test("uncertain observations are clearly exported as evidence only, never as defects", async () => {
  const tree = parseStrategicFitFixture(SHALLOW_LINES_FIXTURE);
  const revision = "annotation:uncertain";
  const result = await annotateRepertoire(
    tree,
    SHALLOW_LINES_FIXTURE.repertoireColor,
    { include: ["congruence"], repertoireRevision: revision },
    noEngine,
  );
  assert.ok(!("error" in result) && !("cancelled" in result));
  assert.ok(result.annotated.congruence > 0);
  assert.match(result.pgn, /category=uncertain/);
  assert.match(result.pgn, /status=uncertain-evidence-only/);
  assert.doesNotMatch(result.pgn, /congruence:|strategic defect|warning:/i);
});

test("intentional exceptions retain explicit status with separate confidence and difference", () => {
  const report = completeReport(
    parseStrategicFitFixture(SHALLOW_LINES_FIXTURE),
    SHALLOW_LINES_FIXTURE.repertoireColor,
    "annotation:intentional",
  );
  const seed = report.findings[0];
  assert.ok(seed);
  const intentional: StrategicFinding = {
    ...seed,
    classification: "intentional-diversity",
    resolution_state: "keep-intentionally",
    plain_language_category: "Intentional strategic diversity",
  };

  const text = strategicFitAnnotationText(intentional);
  assert.match(text, /category=intentional-diversity/);
  assert.match(text, /status=intentional-exception/);
  assert.match(text, /confidence=low \(\d+\/100\)/);
  assert.match(text, /difference=minor \(\d\.\d{3}\)/);
  assert.match(text, new RegExp(`cohort=${intentional.evidence.cohort_id}`));
  assert.match(text, new RegExp(`analysis=${intentional.analysis_version}`));
});

test("annotation exports mutate only the clone and reject stale injected evidence", async () => {
  const tree = parseStrategicFitFixture(SHALLOW_LINES_FIXTURE);
  const before = tree.toPgn();
  const report = completeReport(tree, SHALLOW_LINES_FIXTURE.repertoireColor, "annotation:stale");

  const stale = await annotateRepertoire(
    tree,
    SHALLOW_LINES_FIXTURE.repertoireColor,
    { include: ["congruence"], repertoireRevision: "annotation:current" },
    noEngine,
    undefined,
    () => report,
  );
  assert.deepEqual(stale, {
    error: "strategic_fit_stale_report",
    reason: "Strategic Fit report belongs to annotation:stale, not annotation:current.",
  });
  assert.equal(tree.toPgn(), before);

  const exported = await annotateRepertoire(
    tree,
    SHALLOW_LINES_FIXTURE.repertoireColor,
    { include: ["congruence"], repertoireRevision: "annotation:clone" },
    noEngine,
  );
  assert.ok(!("error" in exported) && !("cancelled" in exported));
  assert.notEqual(exported.pgn, before);
  assert.equal(tree.toPgn(), before, "the source tree remains byte-identical after export");
  assert.deepEqual(exported.annotated, { audit: 0, only_moves: 0, gaps: 0, congruence: 3 });
});

test("direct Strategic Fit annotation cancellation returns without an artifact", async () => {
  const tree = parseStrategicFitFixture(SHALLOW_LINES_FIXTURE);
  let cancelled = false;
  const result = await annotateRepertoire(
    tree,
    SHALLOW_LINES_FIXTURE.repertoireColor,
    {
      include: ["congruence"],
      repertoireRevision: "annotation:cancelled",
      shouldCancel: () => cancelled,
      onProgress: () => { cancelled = true; },
    },
    noEngine,
  );

  assert.deepEqual(result, { cancelled: true });
});
