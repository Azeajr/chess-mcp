import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_EXPLANATIONS,
  WORKFLOW_CONTRACTS,
  analyzeStrategicFit,
  completeStrategicFitReport,
  contractsForHost,
  projectStrategicFitConversation,
  renderWorkflowExplanations,
  renderWorkflowGuidance,
  renderWorkflowOverview,
  strategicFitCompleteAnalysisOptions,
  validateToolArguments,
  type AnalyzeStrategicFitOptions,
  type StrategicFitReport,
  type WorkflowGroundedQuery,
  type WorkflowHost,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

const OPTIONS: AnalyzeStrategicFitOptions = {
  repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
  repertoireRevision: "revision:explanations",
};

const report: StrategicFitReport = completeStrategicFitReport(
  analyzeStrategicFit(
    parseStrategicFitFixture(BROAD_ECO_FIXTURE),
    strategicFitCompleteAnalysisOptions(OPTIONS),
  ),
);
const findingId = report.findings[0]!.finding_id;
const base = {
  report_id: report.report_id,
  expected_repertoire_revision: report.repertoire_revision,
};

const summaryView = projectStrategicFitConversation(report, { view: "summary", ...base });
const findingsView = projectStrategicFitConversation(report, { view: "findings", ...base });
const findingView = projectStrategicFitConversation(report, {
  view: "finding",
  finding_id: findingId,
  ...base,
});

function resolves(root: unknown, path: string): boolean {
  let current = root;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return false;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

function resolvesInView(view: WorkflowGroundedQuery["view"], path: string): boolean {
  if (view === "summary") return resolves(summaryView, path);
  if (view === "finding") {
    return findingView.retrieval === "strategic-fit-finding" && resolves(findingView.finding, path);
  }
  if (findingsView.retrieval !== "strategic-fit-findings") return false;
  return resolves(findingsView, path) || findingsView.findings.every((row) => resolves(row, path));
}

function retrievalArguments(query: WorkflowGroundedQuery, host: WorkflowHost) {
  return {
    ...(host === "mcp" ? { repertoire_id: "repertoire:one" } : {}),
    report_id: report.report_id,
    view: query.view,
    ...(query.sort === undefined ? {} : { sort: query.sort }),
    ...(query.view === "finding" ? { finding_id: findingId } : {}),
  };
}

test("the guidance covers exactly the four canonical explanation depths", () => {
  const ids = STRATEGIC_FIT_EXPLANATIONS.levels.map((level) => level.id);
  assert.deepEqual(ids, ["intermediate", "expert", "concise", "training"]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    STRATEGIC_FIT_EXPLANATIONS.levels.every((level) => level.cite.length > 0),
    true,
  );
});

test("every explanation level cites fields the finding retrieval actually returns", () => {
  assert.equal(findingView.retrieval, "strategic-fit-finding");
  for (const level of STRATEGIC_FIT_EXPLANATIONS.levels) {
    for (const path of level.cite) {
      assert.equal(resolvesInView("finding", path), true, `${level.id} cites missing ${path}`);
    }
  }
});

test("every grounded question cites fields its own retrieval view returns", () => {
  assert.equal(findingsView.retrieval, "strategic-fit-findings");
  assert.ok(
    findingsView.retrieval === "strategic-fit-findings" && findingsView.findings.length > 0,
    "the fixture returns rows, so row citations are checked against real rows",
  );
  for (const view of ["summary", "findings", "finding"] as const) {
    assert.equal(resolvesInView(view, "invented_field"), false, `${view} rejects an unknown field`);
    assert.equal(
      resolvesInView(view, "evidence.invented"),
      false,
      `${view} rejects a nested guess`,
    );
  }
  for (const query of STRATEGIC_FIT_EXPLANATIONS.queries) {
    const view = query.view ?? "findings";
    for (const path of query.cite) {
      assert.equal(resolvesInView(view, path), true, `${query.id} cites missing ${path}`);
    }
  }
});

test("every recommended retrieval is accepted by the canonical schema on both hosts", () => {
  const reported = STRATEGIC_FIT_EXPLANATIONS.queries.filter((query) => query.view !== null);
  assert.ok(reported.length >= 3, "the guidance routes most questions to the retrieval operation");
  for (const query of reported) {
    for (const host of ["browser", "mcp"] as const) {
      const validation = validateToolArguments(
        "get_strategic_fit_report",
        retrievalArguments(query, host),
        host,
      );
      assert.equal(validation.ok, true, `${query.id} on ${host}: ${validation.reason ?? ""}`);
    }
    assert.equal(query.tools.includes("get_strategic_fit_report"), true, `${query.id} names it`);
  }
});

test("every operation the guidance names exists on both hosts", () => {
  const available = (host: WorkflowHost) =>
    new Set(contractsForHost(host).map((contract) => contract.name));
  const browser = available("browser");
  const mcp = available("mcp");
  for (const query of STRATEGIC_FIT_EXPLANATIONS.queries) {
    assert.ok(query.tools.length > 0, `${query.id} names an operation`);
    for (const tool of query.tools) {
      assert.equal(browser.has(tool), true, `${query.id}: ${tool} is missing on browser`);
      assert.equal(mcp.has(tool), true, `${query.id}: ${tool} is missing on mcp`);
    }
  }
});

test("every question states what to say when its evidence is missing", () => {
  const rendered = renderWorkflowExplanations(STRATEGIC_FIT_EXPLANATIONS);
  for (const query of STRATEGIC_FIT_EXPLANATIONS.queries) {
    assert.ok(query.missing.length > 0, `${query.id} declares a missing-evidence rule`);
    assert.equal(rendered.includes(query.question), true, `${query.id} question is rendered`);
    assert.equal(rendered.includes(query.missing), true, `${query.id} missing rule is rendered`);
  }
  for (const rule of STRATEGIC_FIT_EXPLANATIONS.rules) assert.equal(rendered.includes(rule), true);
  for (const level of STRATEGIC_FIT_EXPLANATIONS.levels) {
    assert.equal(rendered.includes(level.instruction), true, `${level.id} instruction is rendered`);
  }
});

test("only the repertoire family carries the explanation contract", () => {
  assert.equal(WORKFLOW_CONTRACTS.repertoire.explanations, STRATEGIC_FIT_EXPLANATIONS);
  for (const family of ["position", "review", "annotation"] as const) {
    assert.equal(WORKFLOW_CONTRACTS[family].explanations, undefined);
    assert.equal(
      renderWorkflowGuidance(family, "mcp").includes("Explanation and exploration contract"),
      false,
      `${family} guidance stays scoped`,
    );
  }
  for (const host of ["browser", "mcp"] as const) {
    assert.equal(
      renderWorkflowGuidance("repertoire", host).includes("Explanation and exploration contract"),
      true,
    );
    assert.equal(
      renderWorkflowOverview(host).includes("Explanation and exploration contract"),
      true,
      "the preset-free overview keeps the explanation contract",
    );
  }
});
