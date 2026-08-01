import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_CONVERSATION_LIMITS,
  StrategicFitReportProjectionError,
  analyzeStrategicFit,
  completeStrategicFitReport,
  projectStrategicFitConversation,
  strategicFitCompleteAnalysisOptions,
  strategicFitConversationErrorResult,
  strategicFitReportUnavailableResult,
  type AnalyzeStrategicFitOptions,
  type StrategicFitReport,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

const OPTIONS: AnalyzeStrategicFitOptions = {
  repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
  repertoireRevision: "revision:conversation",
};

function completeReport(options: AnalyzeStrategicFitOptions = OPTIONS): StrategicFitReport {
  return completeStrategicFitReport(
    analyzeStrategicFit(
      parseStrategicFitFixture(BROAD_ECO_FIXTURE),
      strategicFitCompleteAnalysisOptions(options),
    ),
  );
}

const request = (report: StrategicFitReport) => ({
  report_id: report.report_id,
  expected_repertoire_revision: report.repertoire_revision,
});

test("summary retrieval carries report identity and state without findings or provenance", () => {
  const report = completeReport();
  const summary = projectStrategicFitConversation(report, { view: "summary", ...request(report) });
  assert.equal(summary.retrieval, "strategic-fit-summary");
  if (summary.retrieval !== "strategic-fit-summary") return;
  assert.equal(summary.report_id, report.report_id);
  assert.equal(summary.repertoire_revision, report.repertoire_revision);
  assert.equal(summary.finding_count, report.findings.length);
  assert.equal(summary.profile_mode, report.profile.mode);
  assert.equal(summary.preflight.state, report.preflight.state);
  assert.equal(summary.preflight.route_count, report.preflight.route_count);
  assert.equal(
    summary.preflight.issue_counts.blocking +
      summary.preflight.issue_counts.degraded +
      summary.preflight.issue_counts.informational,
    report.preflight.issues.length,
  );
  assert.ok(summary.preflight.issues.length <= STRATEGIC_FIT_CONVERSATION_LIMITS.preflight_issues);
  assert.equal(
    summary.preflight.omitted_issue_count,
    report.preflight.issues.length - summary.preflight.issues.length,
  );
  assert.equal(summary.summary.unresolved_finding_count, report.summary.unresolved_finding_count);
  assert.equal(summary.metrics.length, 10);
  assert.equal(
    summary.metrics.every((metric) => metric.value === null || typeof metric.value === "number"),
    true,
  );

  const serialized = JSON.stringify(summary);
  for (const excluded of ["provenance", "findings", "manifest", "snapshot", "preferences"]) {
    assert.equal(serialized.includes(`"${excluded}"`), false, `summary must exclude ${excluded}`);
  }
});

test("finding pages are bounded, ordered, and navigable by cursor", () => {
  const report = completeReport();
  const first = projectStrategicFitConversation(report, {
    view: "findings",
    ...request(report),
    sort: "finding-id",
    page: { limit: 2 },
  });
  assert.equal(first.retrieval, "strategic-fit-findings");
  if (first.retrieval !== "strategic-fit-findings") return;
  assert.equal(first.findings.length, 2);
  assert.equal(first.page.total_count, report.findings.length);
  assert.ok(first.next_cursor);
  assert.deepEqual(
    first.findings.map((finding) => finding.finding_id),
    report.findings.slice(0, 2).map((finding) => finding.finding_id),
  );
  for (const row of first.findings) {
    assert.ok(row.source_san_paths.length <= STRATEGIC_FIT_CONVERSATION_LIMITS.san_paths);
    assert.ok(
      row.source_san_paths.every(
        (path) => path.san.length <= STRATEGIC_FIT_CONVERSATION_LIMITS.san_path_plies,
      ),
    );
    assert.equal(row.total_san_path_count >= row.source_san_paths.length, true);
    assert.equal(
      "explanation" in row,
      false,
      "list rows stay compact; explanations need the finding view",
    );
    assert.equal("evidence" in row, false);
  }

  const second = projectStrategicFitConversation(report, {
    view: "findings",
    ...request(report),
    sort: "finding-id",
    page: { limit: 2, cursor: first.next_cursor! },
  });
  if (second.retrieval !== "strategic-fit-findings") return assert.fail("expected a findings page");
  assert.equal(second.page.offset, 2);

  assert.throws(
    () =>
      projectStrategicFitConversation(report, {
        view: "findings",
        ...request(report),
        page: { limit: STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum + 1 },
      }),
    (error: unknown) =>
      error instanceof StrategicFitReportProjectionError &&
      error.code === "strategic_fit_invalid_page_limit",
  );
});

test("finding retrieval adds bounded evidence and navigable paths without full report data", () => {
  const report = completeReport();
  const selected = report.findings[0]!;
  const projection = projectStrategicFitConversation(report, {
    view: "finding",
    ...request(report),
    finding_id: selected.finding_id,
  });
  assert.equal(projection.retrieval, "strategic-fit-finding");
  if (projection.retrieval !== "strategic-fit-finding") return;
  const finding = projection.finding;
  assert.equal(finding.finding_id, selected.finding_id);
  assert.equal(finding.semantic_finding_id, selected.semantic_finding_id);
  assert.equal(
    finding.explanation.text.length <= STRATEGIC_FIT_CONVERSATION_LIMITS.text_characters + 1,
    true,
  );
  assert.equal(finding.evidence.cohort_id, selected.evidence.cohort_id);
  assert.ok(
    finding.evidence.dimensions.length <= STRATEGIC_FIT_CONVERSATION_LIMITS.evidence_dimensions,
  );
  assert.equal(
    finding.evidence.omitted_dimension_count,
    selected.evidence.dimensions.length - finding.evidence.dimensions.length,
  );
  assert.equal(
    finding.evidence.dimensions.every(
      (dimension) =>
        dimension.typical_value === null || typeof dimension.typical_value !== "object",
    ),
    true,
    "composite dimension values are disclosed as omitted rather than inlined",
  );
  assert.equal(
    finding.evidence.data_quality_issue_count,
    selected.evidence.data_quality_issue_ids.length,
  );
  assert.ok(
    finding.references.route_ids.ids.length <= STRATEGIC_FIT_CONVERSATION_LIMITS.identity_list,
  );
  assert.equal(finding.references.route_ids.total_count, selected.references.route_ids.length);
  assert.deepEqual(
    finding.source_san_paths[0]?.san,
    selected.references.source_san_paths[0]?.slice(
      0,
      STRATEGIC_FIT_CONVERSATION_LIMITS.san_path_plies,
    ),
  );

  const serialized = JSON.stringify(projection);
  for (const excluded of ["provenance", "timeline", "components", "manifest"]) {
    assert.equal(
      serialized.includes(`"${excluded}"`),
      false,
      `finding view must exclude ${excluded}`,
    );
  }
  assert.ok(
    serialized.length < 8_000,
    `finding view stays compact (${serialized.length} characters)`,
  );
});

test("truncated text and paths disclose that they were shortened", () => {
  const report = completeReport();
  const selected = report.findings[0]!;
  const longPath = Array.from({ length: 40 }, (_, index) => `move${index}`);
  const stretched: StrategicFitReport = {
    ...report,
    findings: [
      {
        ...selected,
        explanation: "x".repeat(STRATEGIC_FIT_CONVERSATION_LIMITS.text_characters + 50),
        references: { ...selected.references, source_san_paths: [longPath] },
      },
    ],
  };
  const projection = projectStrategicFitConversation(stretched, {
    view: "finding",
    report_id: stretched.report_id,
    expected_repertoire_revision: stretched.repertoire_revision,
    finding_id: selected.finding_id,
  });
  if (projection.retrieval !== "strategic-fit-finding")
    return assert.fail("expected a finding view");
  assert.equal(projection.finding.explanation.truncated, true);
  assert.equal(
    projection.finding.explanation.text.length,
    STRATEGIC_FIT_CONVERSATION_LIMITS.text_characters + 1,
  );
  assert.equal(projection.finding.source_san_paths[0]!.truncated, true);
  assert.equal(
    projection.finding.source_san_paths[0]!.san.length,
    STRATEGIC_FIT_CONVERSATION_LIMITS.san_path_plies,
  );
  assert.equal(projection.finding.total_san_path_count, 1);
});

test("stale reports, revisions, and finding identities fail closed with structured codes", () => {
  const report = completeReport();
  const other = completeReport({ ...OPTIONS, repertoireRevision: "revision:other" });
  for (const [candidate, code] of [
    [
      {
        view: "summary",
        report_id: "strategic-fit-report:stale",
        expected_repertoire_revision: report.repertoire_revision,
      },
      "strategic_fit_stale_report",
    ],
    [
      {
        view: "summary",
        report_id: report.report_id,
        expected_repertoire_revision: "revision:stale",
      },
      "strategic_fit_stale_revision",
    ],
    [
      {
        view: "findings",
        report_id: other.report_id,
        expected_repertoire_revision: report.repertoire_revision,
      },
      "strategic_fit_stale_report",
    ],
    [
      {
        view: "finding",
        report_id: report.report_id,
        expected_repertoire_revision: report.repertoire_revision,
        finding_id: "finding:missing",
      },
      "strategic_fit_finding_not_found",
    ],
    [
      {
        view: "finding",
        report_id: report.report_id,
        expected_repertoire_revision: report.repertoire_revision,
      },
      "strategic_fit_missing_finding_identity",
    ],
    [
      { view: "summary", report_id: "", expected_repertoire_revision: report.repertoire_revision },
      "strategic_fit_missing_report_identity",
    ],
  ] as const) {
    assert.throws(
      () => projectStrategicFitConversation(report, candidate),
      (error: unknown) => error instanceof StrategicFitReportProjectionError && error.code === code,
      `expected ${code}`,
    );
    assert.equal(
      strategicFitConversationErrorResult(
        (() => {
          try {
            projectStrategicFitConversation(report, candidate);
            return null;
          } catch (error) {
            return error;
          }
        })(),
      ).error,
      code,
    );
  }

  assert.deepEqual(
    strategicFitReportUnavailableResult("strategic-fit-report:gone").error,
    "strategic_fit_report_unavailable",
  );
  assert.throws(() => strategicFitConversationErrorResult(new Error("unrelated")), /unrelated/);
});
