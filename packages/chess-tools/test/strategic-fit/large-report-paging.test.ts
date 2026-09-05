import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_CONVERSATION_LIMITS,
  STRATEGIC_FIT_MAX_PAGE_SIZE,
  StrategicFitReportProjectionError,
  analyzeStrategicFit,
  completeStrategicFitReport,
  projectStrategicFitConversation,
  projectStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
  type AnalyzeStrategicFitOptions,
  type StrategicFinding,
  type StrategicFitFindingSort,
  type StrategicFitReport,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

const OPTIONS: AnalyzeStrategicFitOptions = {
  repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
  repertoireRevision: "revision:large",
};

const LARGE_FINDING_COUNT = 5_000;

function largeReport(): StrategicFitReport {
  const report = completeStrategicFitReport(
    analyzeStrategicFit(
      parseStrategicFitFixture(BROAD_ECO_FIXTURE),
      strategicFitCompleteAnalysisOptions(OPTIONS),
    ),
  );
  const template = report.findings;
  assert.ok(template.length > 0, "the fixture produces at least one finding to replicate");
  const findings = Array.from({ length: LARGE_FINDING_COUNT }, (_, index) => {
    const source = template[index % template.length]!;
    return {
      ...source,
      finding_id: `${source.finding_id}:clone-${String(index).padStart(5, "0")}`,
      replacement_priority: { ...source.replacement_priority, score: (index % 97) / 100 },
      training_priority: { ...source.training_priority, score: (index % 89) / 100 },
    } as StrategicFinding;
  });
  return { ...report, findings } as StrategicFitReport;
}

const SORTS: readonly StrategicFitFindingSort[] = [
  "replacement-priority",
  "training-priority",
  "expected-frequency",
  "opening-scope",
  "finding-id",
];

function page(
  report: StrategicFitReport,
  sort: StrategicFitFindingSort,
  page: { readonly limit?: number; readonly offset?: number; readonly cursor?: string },
) {
  const projection = projectStrategicFitReport(report, {
    kind: "page",
    expected_repertoire_revision: report.repertoire_revision,
    sort,
    page,
  });
  assert.equal(projection.projection, "page");
  if (projection.projection !== "page") throw new Error("unreachable");
  return projection;
}

function walkByCursor(report: StrategicFitReport, sort: StrategicFitFindingSort): string[] {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const projection = page(
      report,
      sort,
      cursor === null
        ? { limit: STRATEGIC_FIT_MAX_PAGE_SIZE }
        : { limit: STRATEGIC_FIT_MAX_PAGE_SIZE, cursor },
    );
    pages++;
    assert.ok(pages <= LARGE_FINDING_COUNT, "cursor paging terminates");
    for (const finding of projection.report.findings) ids.push(finding.finding_id);
    cursor = projection.next_cursor;
    if (cursor === null) break;
  }
  return ids;
}

test("a large report pages by cursor in one stable canonical order under every sort", () => {
  const report = largeReport();
  assert.equal(report.findings.length, LARGE_FINDING_COUNT);
  for (const sort of SORTS) {
    const walked = walkByCursor(report, sort);
    assert.equal(walked.length, LARGE_FINDING_COUNT, `${sort} walks every finding exactly once`);
    assert.equal(new Set(walked).size, LARGE_FINDING_COUNT, `${sort} never repeats a finding`);
    assert.deepEqual(walkByCursor(report, sort), walked, `${sort} repeats the same order`);
  }
});

test("a cursor names one page for as long as the report lives, whatever was paged in between", () => {
  const report = largeReport();
  const first = page(report, "replacement-priority", { limit: STRATEGIC_FIT_MAX_PAGE_SIZE });
  const second = page(report, "replacement-priority", {
    limit: STRATEGIC_FIT_MAX_PAGE_SIZE,
    cursor: first.next_cursor!,
  });
  const third = page(report, "replacement-priority", {
    limit: STRATEGIC_FIT_MAX_PAGE_SIZE,
    cursor: second.next_cursor!,
  });
  assert.equal(third.report.finding_page.offset, STRATEGIC_FIT_MAX_PAGE_SIZE * 2);

  page(report, "replacement-priority", {
    offset: LARGE_FINDING_COUNT - STRATEGIC_FIT_MAX_PAGE_SIZE,
    limit: STRATEGIC_FIT_MAX_PAGE_SIZE,
  });
  const revisited = page(report, "replacement-priority", {
    limit: STRATEGIC_FIT_MAX_PAGE_SIZE,
    cursor: third.cursor,
  });
  assert.equal(revisited.cursor, third.cursor);
  assert.deepEqual(
    revisited.report.findings.map((finding) => finding.finding_id),
    third.report.findings.map((finding) => finding.finding_id),
  );
  assert.deepEqual(
    revisited.report.findings.map((finding) => finding.finding_id),
    page(report, "replacement-priority", {
      offset: STRATEGIC_FIT_MAX_PAGE_SIZE * 2,
      limit: STRATEGIC_FIT_MAX_PAGE_SIZE,
    }).report.findings.map((finding) => finding.finding_id),
    "a cursor and the equivalent offset name the same window of the same order",
  );
});

test("a large report never widens a page or a full projection", () => {
  const report = largeReport();
  const widest = page(report, "replacement-priority", { limit: LARGE_FINDING_COUNT });
  assert.equal(widest.report.findings.length, STRATEGIC_FIT_MAX_PAGE_SIZE);
  assert.equal(widest.report.finding_page.total_count, LARGE_FINDING_COUNT);
  assert.equal(widest.report.finding_page.has_more, true);

  assert.throws(
    () =>
      projectStrategicFitReport(report, {
        kind: "full",
        expected_repertoire_revision: report.repertoire_revision,
      }),
    (error: unknown) =>
      error instanceof StrategicFitReportProjectionError &&
      error.code === "strategic_fit_full_projection_too_large",
  );
});

test("the conversation projection of a large report stays a bounded message", () => {
  const report = largeReport();
  const identity = {
    report_id: report.report_id,
    expected_repertoire_revision: report.repertoire_revision,
  };
  const defaulted = projectStrategicFitConversation(report, { view: "findings", ...identity });
  assert.equal(defaulted.retrieval, "strategic-fit-findings");
  if (defaulted.retrieval !== "strategic-fit-findings") return;
  assert.equal(defaulted.findings.length, STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_default);
  assert.equal(defaulted.page.total_count, LARGE_FINDING_COUNT);
  assert.ok(defaulted.next_cursor);
  assert.ok(
    JSON.stringify(defaulted).length < 200_000,
    "a 5,000-finding report still projects one bounded conversation page",
  );

  const widest = projectStrategicFitConversation(report, {
    view: "findings",
    ...identity,
    page: { limit: STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum },
  });
  assert.equal(widest.retrieval, "strategic-fit-findings");
  if (widest.retrieval !== "strategic-fit-findings") return;
  assert.equal(widest.findings.length, STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum);

  assert.throws(
    () =>
      projectStrategicFitConversation(report, {
        view: "findings",
        ...identity,
        page: { limit: LARGE_FINDING_COUNT },
      }),
    (error: unknown) =>
      error instanceof StrategicFitReportProjectionError &&
      error.code === "strategic_fit_invalid_page_limit",
    "an oversized conversation page is refused rather than quietly trimmed",
  );
});

test("a conversation cursor walks the large report without crossing sorts", () => {
  const report = largeReport();
  const identity = {
    report_id: report.report_id,
    expected_repertoire_revision: report.repertoire_revision,
  };
  const first = projectStrategicFitConversation(report, {
    view: "findings",
    ...identity,
    sort: "finding-id",
    page: { limit: STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum },
  });
  assert.equal(first.retrieval, "strategic-fit-findings");
  if (first.retrieval !== "strategic-fit-findings") return;
  const second = projectStrategicFitConversation(report, {
    view: "findings",
    ...identity,
    sort: "finding-id",
    page: {
      limit: STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum,
      cursor: first.next_cursor!,
    },
  });
  assert.equal(second.retrieval, "strategic-fit-findings");
  if (second.retrieval !== "strategic-fit-findings") return;
  assert.equal(second.page.offset, STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum);
  const seen = new Set(first.findings.map((finding) => finding.finding_id));
  assert.equal(
    second.findings.some((finding) => seen.has(finding.finding_id)),
    false,
    "consecutive conversation pages do not repeat a finding",
  );

  assert.throws(
    () =>
      projectStrategicFitConversation(report, {
        view: "findings",
        ...identity,
        sort: "replacement-priority",
        page: { cursor: first.next_cursor! },
      }),
    (error: unknown) =>
      error instanceof StrategicFitReportProjectionError &&
      error.code === "strategic_fit_stale_page_cursor",
  );
});
