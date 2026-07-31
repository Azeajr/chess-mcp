import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_CONVERSATION_LIMITS,
  analyzeStrategicFit,
  completeStrategicFitReport,
  contractsForHost,
  jsonSchemaForTool,
  strategicFitCompleteAnalysisOptions,
  toolContract,
  validateToolArguments,
  type AnalyzeStrategicFitOptions,
  type StrategicFitConversationFinding,
  type StrategicFitConversationFindings,
  type StrategicFitConversationSummary,
  type StrategicFitReport,
} from "@chess-mcp/chess-tools";
import { executeBrowserCommand } from "../src/application/browser-commands/client.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import { StrategicFitReportCache } from "../src/application/strategic-fit-report-cache.ts";

const PGN = `
[Event "King pawn"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *

[Event "Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 *

[Event "Closed"]
[Result "*"]

1. e4 c5 2. Nc3 Nc6 3. g3 g6 *`;

const tree = GameTree.fromPgn(PGN);
const REVISION = 12;

const analyze = (pgn: string, options: AnalyzeStrategicFitOptions): StrategicFitReport =>
  completeStrategicFitReport(analyzeStrategicFit(
    GameTree.fromPgn(pgn),
    strategicFitCompleteAnalysisOptions(options),
  ));

const cachedReport = () => analyze(PGN, {
  repertoireColor: "white",
  repertoireRevision: `browser:${REVISION}`,
});

function dependencies(
  report: StrategicFitReport | null,
  overrides: Partial<typeof defaultBrowserCommandDependencies> = {},
) {
  return {
    ...defaultBrowserCommandDependencies,
    currentTree: () => tree,
    currentPgn: () => PGN,
    currentColor: () => "white" as const,
    currentRevision: () => REVISION,
    openings: async () => new Map(),
    strategicFitReport: async (pgn: string, options: AnalyzeStrategicFitOptions) => analyze(pgn, options),
    strategicFitReportById: (reportId: string) =>
      report && report.report_id === reportId ? report : null,
    ...overrides,
  };
}

test("canonical retrieval schema is shared by both hosts with host-appropriate identity", () => {
  for (const host of ["mcp", "browser"] as const) {
    assert.equal(
      contractsForHost(host).some((contract) => contract.name === "get_strategic_fit_report"),
      true,
      `${host} exposes get_strategic_fit_report`,
    );
  }
  const browser = jsonSchemaForTool("get_strategic_fit_report", "browser")!;
  const mcp = jsonSchemaForTool("get_strategic_fit_report", "mcp")!;
  assert.equal("repertoire_id" in (browser.properties as Record<string, unknown>), false);
  assert.deepEqual(browser.required, ["report_id"]);
  assert.deepEqual(mcp.required, ["repertoire_id", "report_id"]);
  assert.deepEqual(
    Object.keys(browser.properties as Record<string, unknown>).sort(),
    ["finding_id", "page", "report_id", "sort", "view"],
  );
  assert.match(toolContract("get_strategic_fit_report").result.semantics ?? "", /Never the full report/);
  assert.equal(toolContract("get_strategic_fit_report").result.kind, "data");
});

test("retrieval arguments reject blank, cross-view, and oversized requests", () => {
  const ok = (args: Record<string, unknown>) =>
    validateToolArguments("get_strategic_fit_report", args, "browser");
  assert.equal(ok({ report_id: "strategic-fit-report:a" }).ok, true);
  assert.equal(ok({ report_id: "strategic-fit-report:a", view: "findings", page: { limit: 25 }, sort: "finding-id" }).ok, true);
  assert.equal(ok({ report_id: "strategic-fit-report:a", view: "finding", finding_id: "finding:a" }).ok, true);
  assert.equal(ok({ report_id: "   " }).reason, "report_id must not be blank");
  assert.equal(ok({ report_id: "r", view: "finding" }).reason, "view finding requires a non-blank finding_id");
  assert.equal(ok({ report_id: "r", finding_id: "finding:a" }).reason, "finding_id is only valid with view finding");
  assert.equal(ok({ report_id: "r", view: "summary", page: { limit: 5 } }).reason, "page is only valid with view findings");
  assert.equal(
    ok({ report_id: "r", view: "findings", page: { limit: 5, offset: 0, cursor: "c" } }).reason,
    "page.cursor and page.offset are mutually exclusive",
  );
  assert.equal(ok({ report_id: "r", view: "findings", page: { limit: 26 } }).ok, false);
  assert.equal(ok({ report_id: "r", view: "everything" }).ok, false);
  assert.equal(validateToolArguments("get_strategic_fit_report", { report_id: "r" }, "mcp").ok, false);
});

test("browser retrieval returns bounded summary, findings, and finding views for a cached report", async () => {
  const report = cachedReport();
  const deps = dependencies(report);
  const summary = await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: report.report_id },
    {},
    deps,
  ) as StrategicFitConversationSummary;
  assert.equal(summary.retrieval, "strategic-fit-summary");
  assert.equal(summary.report_id, report.report_id);
  assert.equal(summary.repertoire_revision, `browser:${REVISION}`);
  assert.equal(summary.finding_count, report.findings.length);
  assert.equal(JSON.stringify(summary).includes("\"provenance\""), false);

  const findings = await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: report.report_id, view: "findings", sort: "finding-id", page: { limit: 1 } },
    {},
    deps,
  ) as StrategicFitConversationFindings;
  assert.equal(findings.retrieval, "strategic-fit-findings");
  assert.equal(findings.findings.length, 1);
  assert.equal(findings.page.total_count, report.findings.length);
  assert.equal(findings.findings[0]!.finding_id, report.findings[0]!.finding_id);
  assert.ok(findings.findings.every((row) =>
    row.source_san_paths.length <= STRATEGIC_FIT_CONVERSATION_LIMITS.san_paths));

  const next = findings.next_cursor;
  if (next) {
    const second = await executeBrowserCommand(
      "get_strategic_fit_report",
      { report_id: report.report_id, view: "findings", sort: "finding-id", page: { limit: 1, cursor: next } },
      {},
      deps,
    ) as StrategicFitConversationFindings;
    assert.equal(second.page.offset, 1);
  }

  const detail = await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: report.report_id, view: "finding", finding_id: report.findings[0]!.finding_id },
    {},
    deps,
  ) as StrategicFitConversationFinding;
  assert.equal(detail.retrieval, "strategic-fit-finding");
  assert.equal(detail.finding.finding_id, report.findings[0]!.finding_id);
  assert.ok(detail.finding.evidence.dimensions.length <= STRATEGIC_FIT_CONVERSATION_LIMITS.evidence_dimensions);
  const serialized = JSON.stringify(detail);
  assert.equal(serialized.includes("\"provenance\""), false);
  assert.equal(serialized.includes(PGN.trim()), false, "no document artifact reaches the model");
});

test("unknown, stale, and revision-mismatched identities fail closed", async () => {
  const report = cachedReport();
  const unavailable = await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: "strategic-fit-report:gone" },
    {},
    dependencies(report),
  ) as { error: string; reason: string };
  assert.equal(unavailable.error, "strategic_fit_report_unavailable");

  const staleRevision = await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: report.report_id },
    {},
    dependencies(report, { currentRevision: () => REVISION + 1 }),
  ) as { error: string };
  assert.equal(staleRevision.error, "strategic_fit_stale_revision");

  const missingFinding = await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: report.report_id, view: "finding", finding_id: "finding:missing" },
    {},
    dependencies(report),
  ) as { error: string };
  assert.equal(missingFinding.error, "strategic_fit_finding_not_found");

  const noReport = await executeBrowserCommand(
    "get_strategic_fit_report",
    { report_id: report.report_id },
    {},
    dependencies(null),
  ) as { error: string };
  assert.equal(noReport.error, "strategic_fit_report_unavailable");
});

test("the report cache resolves identities only while their entry is live", async () => {
  const options = (revision: string): AnalyzeStrategicFitOptions => ({
    repertoireColor: "white",
    repertoireRevision: revision,
  });
  const cache = new StrategicFitReportCache(
    async (pgn, analysisOptions) => analyzeStrategicFit(GameTree.fromPgn(pgn), analysisOptions),
    1,
  );
  const first = await cache.getReport(PGN, options("browser:1"));
  assert.equal(cache.reportById(first.report_id)?.report_id, first.report_id);

  const second = await cache.getReport(PGN, options("browser:2"));
  assert.notEqual(second.report_id, first.report_id);
  assert.equal(cache.reportById(first.report_id), null, "an evicted report is not retrievable");
  assert.equal(cache.reportById(second.report_id)?.report_id, second.report_id);

  cache.clear();
  assert.equal(cache.reportById(second.report_id), null);
});

test("history compaction preserves retrieval identities and paging cursors", async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const { compactToolResult } = await import("../src/store/chat.ts");
  const compacted = compactToolResult(JSON.stringify({
    retrieval: "strategic-fit-findings",
    report_id: "strategic-fit-report:abc",
    repertoire_revision: "browser:12",
    cursor: "strategic-fit-page%7Cabc%7Cfinding-id%7C0",
    next_cursor: "strategic-fit-page%7Cabc%7Cfinding-id%7C10",
    findings: [{
      finding_id: "finding:one",
      semantic_finding_id: "semantic-finding:one",
      source_san_paths: [{ san: ["e4", "c5"], truncated: false }],
      padding: "x".repeat(7000),
    }],
  }));
  for (const identity of [
    "strategic-fit-report:abc", "finding:one", "semantic-finding:one", "browser:12",
    "next_cursor", "source_san_paths", "strategic-fit-findings",
  ]) assert.equal(compacted.includes(identity), true, `missing ${identity}`);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
