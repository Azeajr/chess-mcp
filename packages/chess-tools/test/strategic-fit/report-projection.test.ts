import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_MAX_FULL_PROJECTION_FINDINGS,
  STRATEGIC_FIT_MAX_PAGE_SIZE,
  StrategicFitReportProjectionError,
  analyzeStrategicFit,
  completeStrategicFitReport,
  projectStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
  strategicFitReportCacheKey,
  type AnalyzeStrategicFitOptions,
  type StrategicFitReport,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

const OPTIONS: AnalyzeStrategicFitOptions = {
  repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
  repertoireRevision: "revision:projection",
};

function completeReport(options: AnalyzeStrategicFitOptions = OPTIONS): StrategicFitReport {
  return completeStrategicFitReport(analyzeStrategicFit(
    parseStrategicFitFixture(BROAD_ECO_FIXTURE),
    strategicFitCompleteAnalysisOptions(options),
  ));
}

test("summary, page, finding, and full projections preserve stable report identities", () => {
  const report = completeReport();
  const identity = { expected_repertoire_revision: report.repertoire_revision };
  const summary = projectStrategicFitReport(report, { kind: "summary", ...identity });
  assert.equal(summary.projection, "summary");
  if (summary.projection !== "summary") return;
  assert.equal(summary.report_id, report.report_id);
  assert.equal(summary.finding_count, report.findings.length);
  assert.equal("findings" in summary, false);

  const first = projectStrategicFitReport(report, {
    kind: "page",
    ...identity,
    sort: "finding-id",
    page: { limit: 2 },
  });
  assert.equal(first.projection, "page");
  if (first.projection !== "page") return;
  assert.equal(first.report.report_id, report.report_id);
  assert.equal(first.report.findings.length, 2);
  assert.ok(first.next_cursor);

  const second = projectStrategicFitReport(report, {
    kind: "page",
    ...identity,
    sort: "finding-id",
    page: { limit: 2, cursor: first.next_cursor! },
  });
  assert.equal(second.projection, "page");
  if (second.projection !== "page") return;
  assert.equal(second.report.finding_page.offset, 2);
  assert.deepEqual(
    [...first.report.findings, ...second.report.findings].map((finding) => finding.finding_id),
    report.findings.slice(0, 4).map((finding) => finding.finding_id),
  );

  const selected = report.findings[0]!;
  const finding = projectStrategicFitReport(report, {
    kind: "finding",
    ...identity,
    expected_report_id: report.report_id,
    finding_id: selected.finding_id,
  });
  assert.equal(finding.projection, "finding");
  if (finding.projection !== "finding") return;
  assert.equal(finding.finding, selected);

  const full = projectStrategicFitReport(report, { kind: "full", ...identity });
  assert.equal(full.projection, "full");
  if (full.projection !== "full") return;
  assert.equal(full.report, report);
  assert.equal(Object.isFrozen(full.report), true);
  assert.equal(Object.isFrozen(full.report.findings), true);
});

test("page projections are bounded and cursors cannot cross reports or sort orders", () => {
  const report = completeReport();
  const page = projectStrategicFitReport(report, {
    kind: "page",
    expected_repertoire_revision: report.repertoire_revision,
    page: { limit: 5_000 },
  });
  assert.equal(page.projection, "page");
  if (page.projection !== "page") return;
  assert.equal(page.report.finding_page.limit, STRATEGIC_FIT_MAX_PAGE_SIZE);

  assert.throws(
    () => projectStrategicFitReport(report, {
      kind: "page",
      expected_repertoire_revision: report.repertoire_revision,
      sort: "training-priority",
      page: { cursor: page.cursor },
    }),
    (error: unknown) =>
      error instanceof StrategicFitReportProjectionError &&
      error.code === "strategic_fit_stale_page_cursor",
  );

  const another = completeReport({ ...OPTIONS, repertoireRevision: "revision:another" });
  assert.throws(
    () => projectStrategicFitReport(another, {
      kind: "page",
      expected_repertoire_revision: another.repertoire_revision,
      page: { cursor: page.cursor },
    }),
    (error: unknown) =>
      error instanceof StrategicFitReportProjectionError &&
      error.code === "strategic_fit_stale_page_cursor",
  );
});

test("stale revisions, report IDs, and missing findings fail closed", () => {
  const report = completeReport();
  for (const [request, code] of [
    [{ kind: "summary", expected_repertoire_revision: "revision:stale" }, "strategic_fit_stale_revision"],
    [{
      kind: "finding",
      expected_repertoire_revision: report.repertoire_revision,
      expected_report_id: "strategic-fit-report:stale",
      finding_id: report.findings[0]!.finding_id,
    }, "strategic_fit_stale_report"],
    [{
      kind: "finding",
      expected_repertoire_revision: report.repertoire_revision,
      expected_report_id: report.report_id,
      finding_id: "finding:missing",
    }, "strategic_fit_finding_not_found"],
  ] as const) {
    assert.throws(
      () => projectStrategicFitReport(report, request),
      (error: unknown) => error instanceof StrategicFitReportProjectionError && error.code === code,
    );
  }
});

test("cache identity ignores projections but changes with content, revision, color, manifest settings, and profile", () => {
  const base = strategicFitReportCacheKey(BROAD_ECO_FIXTURE.pgn, OPTIONS);
  assert.equal(base, strategicFitReportCacheKey(BROAD_ECO_FIXTURE.pgn, {
    ...OPTIONS,
    sort: "opening-scope",
    page: { offset: 20, limit: 3 },
  }));
  assert.equal(base, strategicFitReportCacheKey(BROAD_ECO_FIXTURE.pgn, {
    ...OPTIONS,
    generatedAt: "2026-07-17T12:00:00.000Z",
  }), "generation time is report provenance, not an analysis setting");
  assert.notEqual(base, strategicFitReportCacheKey(`${BROAD_ECO_FIXTURE.pgn}\n`, OPTIONS));
  assert.notEqual(base, strategicFitReportCacheKey(BROAD_ECO_FIXTURE.pgn, {
    ...OPTIONS,
    repertoireRevision: "revision:changed",
  }));
  assert.notEqual(base, strategicFitReportCacheKey(BROAD_ECO_FIXTURE.pgn, {
    ...OPTIONS,
    repertoireColor: "black",
  }));
  assert.notEqual(base, strategicFitReportCacheKey(BROAD_ECO_FIXTURE.pgn, {
    ...OPTIONS,
    profile: {
      schema_version: "2.0.0",
      mode: "familiar-plans",
      source: "explicit",
      provisional: false,
      preferences: {
        maximum_engine_loss_cp: null,
        opponent_popularity_importance: 0,
        personal_game_frequency_importance: 0,
        manual_weight_importance: 0,
        additional_memorization_tolerance: 0.5,
        preferred_concept_ids: [],
        avoided_concept_ids: [],
        preferred_tactical_character: [],
        minimum_opponent_coverage: null,
      },
    },
  }));
});

test("incomplete cache inputs and oversized full projections are rejected", () => {
  const paged = analyzeStrategicFit(parseStrategicFitFixture(BROAD_ECO_FIXTURE), {
    ...OPTIONS,
    page: { offset: 0, limit: 1 },
  });
  assert.throws(
    () => completeStrategicFitReport(paged),
    (error: unknown) =>
      error instanceof StrategicFitReportProjectionError &&
      error.code === "strategic_fit_incomplete_cached_report",
  );

  const report = completeReport();
  const oversized = {
    ...report,
    findings: Array.from(
      { length: STRATEGIC_FIT_MAX_FULL_PROJECTION_FINDINGS + 1 },
      () => report.findings[0]!,
    ),
  };
  assert.throws(
    () => projectStrategicFitReport(oversized, {
      kind: "full",
      expected_repertoire_revision: report.repertoire_revision,
    }),
    (error: unknown) =>
      error instanceof StrategicFitReportProjectionError &&
      error.code === "strategic_fit_full_projection_too_large",
  );
});
