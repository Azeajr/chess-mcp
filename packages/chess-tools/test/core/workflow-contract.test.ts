import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKFLOW_CONTRACTS,
  WORKFLOW_INVARIANTS,
  renderWorkflowGuidance,
  renderWorkflowOverview,
  renderWorkflowExplanations,
  type WorkflowFamily,
  type WorkflowHost,
} from "../../src/workflow-contract.ts";

const FAMILIES = Object.keys(WORKFLOW_CONTRACTS) as WorkflowFamily[];
const HOSTS: WorkflowHost[] = ["browser", "mcp"];

test("every declared family renders guidance for both hosts", () => {
  assert.ok(FAMILIES.length > 0, "there is at least one family to render");
  for (const family of FAMILIES) {
    for (const host of HOSTS) {
      const rendered = renderWorkflowGuidance(family, host);
      assert.ok(rendered.length > 0, `${family}/${host} rendered nothing`);
      assert.match(rendered, /## Shared grounding contract/u);
      assert.match(rendered, /## Shared method/u);
      assert.match(rendered, /## Shared report contract/u);
    }
  }
});

test("guidance carries every shared invariant verbatim", () => {
  const rendered = renderWorkflowGuidance("position", "mcp");
  for (const invariant of WORKFLOW_INVARIANTS) {
    assert.ok(rendered.includes(invariant), `missing invariant: ${invariant}`);
  }
});

test("guidance numbers the method steps in order", () => {
  const contract = WORKFLOW_CONTRACTS.position;
  const rendered = renderWorkflowGuidance("position", "mcp");
  contract.steps.forEach((step, index) => {
    assert.ok(
      rendered.includes(`${index + 1}. ${step.title}`),
      `step ${index + 1} (${step.title}) is not numbered in place`,
    );
  });
});

test("the browser and MCP renderings name each host's own operations", () => {
  const differing = FAMILIES.filter(
    (family) => renderWorkflowGuidance(family, "browser") !== renderWorkflowGuidance(family, "mcp"),
  );
  assert.ok(differing.length > 0, "no family distinguished its host at all");

  for (const family of FAMILIES) {
    const contract = WORKFLOW_CONTRACTS[family];
    const browser = renderWorkflowGuidance(family, "browser");
    const mcp = renderWorkflowGuidance(family, "mcp");
    for (const step of contract.steps) {
      for (const tool of step.browserTools) {
        assert.ok(browser.includes(`\`${tool}\``), `${family}: browser is missing ${tool}`);
      }
      for (const tool of step.mcpTools) {
        assert.ok(mcp.includes(`\`${tool}\``), `${family}: mcp is missing ${tool}`);
      }
    }
  }
});

test("every step declares at least one operation for each host", () => {
  for (const family of FAMILIES) {
    for (const step of WORKFLOW_CONTRACTS[family].steps) {
      assert.ok(step.browserTools.length > 0, `${family}/${step.title} has no browser operation`);
      assert.ok(step.mcpTools.length > 0, `${family}/${step.title} has no MCP operation`);
    }
  }
});

test("the overview names every family and both hosts render one", () => {
  for (const host of HOSTS) {
    const overview = renderWorkflowOverview(host);
    assert.match(overview, /## Shared method index/u);
    for (const family of FAMILIES) {
      assert.ok(overview.includes(`### ${family}`), `${host} overview omits ${family}`);
    }
  }
});

test("the overview lists each family's goal so it can stand alone without a preset", () => {
  const overview = renderWorkflowOverview("mcp");
  for (const family of FAMILIES) {
    assert.ok(overview.includes(WORKFLOW_CONTRACTS[family].goal), `${family}'s goal is missing`);
  }
});

test("explanation contracts render their levels and grounded questions", () => {
  const withExplanations = FAMILIES.map((family) => WORKFLOW_CONTRACTS[family]).filter(
    (contract) => contract.explanations !== undefined,
  );
  assert.ok(withExplanations.length > 0, "at least one family carries an explanation contract");

  for (const contract of withExplanations) {
    const explanations = contract.explanations;
    if (explanations === undefined) continue;
    const rendered = renderWorkflowExplanations(explanations);
    assert.match(rendered, /## Explanation and exploration contract/u);
    assert.ok(rendered.includes(explanations.goal));
    for (const level of explanations.levels) {
      assert.ok(rendered.includes(`\`${level.id}\``), `level ${level.id} is not rendered`);
    }
    for (const query of explanations.queries) {
      assert.ok(rendered.includes(query.question), `query "${query.question}" is not rendered`);
      assert.ok(
        rendered.includes(`Missing evidence: ${query.missing}`),
        "every grounded question must say what it cannot answer without",
      );
    }
  }
});

test("a grounded question without a view renders as not-a-report rather than an empty view", () => {
  for (const family of FAMILIES) {
    const explanations = WORKFLOW_CONTRACTS[family].explanations;
    if (explanations === undefined) continue;
    const rendered = renderWorkflowExplanations(explanations);
    for (const query of explanations.queries.filter((item) => item.view === null)) {
      assert.ok(
        rendered.includes(`Not a report question; use`),
        `"${query.question}" has no view but did not say so`,
      );
    }
    assert.equal(rendered.includes("with view `null`"), false, "a null view must never be printed");
  }
});
