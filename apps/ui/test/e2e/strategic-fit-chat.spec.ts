import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  appendToolResultForTesting(operation: string, result: unknown): void;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) => page.evaluate(
  ({ source, arg }) => Function("api", "arg", `return (${source})(api, arg)`)((window as unknown as { __chess: ChessHarness }).__chess, arg),
  { source: fn.toString(), arg },
);

const finding = (overrides: Record<string, unknown> = {}) => ({
  finding_id: "finding:iqp",
  repertoire_revision: "browser:1",
  schema_version: "2",
  analysis_version: "2",
  classification: "uncertain",
  plain_language_category: "Different center plan",
  opening_scope: "Sicilian · Alapin",
  affected_line_summary: "6…Nf6 branch",
  explanation: "The center evidence differs, but the current sample is incomplete.",
  references: {
    position_ids: ["position:iqp"],
    decision_ids: ["decision:iqp"],
    route_ids: ["route:iqp"],
    source_san_paths: [["e4", "c5"], ["e4", "e5", "Nf3"]],
  },
  confidence: { score: 39, label: "low" },
  difference: { magnitude: "major" },
  replacement_priority: { label: "insufficient-evidence" },
  training_priority: { label: "review-later" },
  provisional: false,
  ...overrides,
});

const report = (overrides: Record<string, unknown> = {}) => ({
  report_id: "strategic-fit-report:one",
  repertoire_revision: "browser:1",
  schema_version: "2",
  analysis_version: "2",
  preflight: {
    state: "ready",
    issues: [],
    route_count: 4,
    comparable_route_count: 4,
    incomplete_route_count: 0,
  },
  summary: {
    workload: "moderate",
    unresolved_finding_count: 1,
    insufficient_evidence_branch_count: 0,
  },
  findings: [finding()],
  finding_page: { total_count: 1 },
  ...overrides,
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
});

test("typed Strategic Fit cards keep signals separate and navigate through a current safe SAN reference", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6", "fit.pgn"));
  await chess(page, (api, result) => api.appendToolResultForTesting("analyze_repertoire_congruence", result), report());

  const card = page.getByRole("region", { name: "Strategic Fit report" });
  await expect(card).toContainText("Strategic Fit · Analysis complete");
  await expect(card).toContainText("strategic-fit-report:one");
  await expect(card).toContainText("Confidence Low 39");
  await expect(card).toContainText("Difference Major");
  await expect(card).toContainText("Replace Insufficient Evidence");
  await expect(card).toContainText("Train Review Later");
  await expect(card.locator('[data-finding-id="finding:iqp"]')).toBeVisible();

  await card.getByRole("button", { name: "Go to line for Different center plan" }).click();
  await expect(page.locator(".move.current").first()).toContainText("Nf3");
});

test("blocked and error results remain explicit without implying consistency", async ({ page }) => {
  await chess(page, (api, result) => api.appendToolResultForTesting("analyze_repertoire_congruence", result), report({
    preflight: {
      state: "blocked",
      issues: [{ severity: "blocking", message: "Custom starting positions are unsupported." }],
      route_count: 0,
      comparable_route_count: 0,
      incomplete_route_count: 0,
    },
    summary: { workload: "unavailable", unresolved_finding_count: 0, insufficient_evidence_branch_count: 0 },
    findings: [],
    finding_page: { total_count: 0 },
  }));

  const card = page.getByRole("region", { name: "Strategic Fit report" });
  await expect(card).toContainText("Analysis blocked");
  await expect(card).toContainText("Preflight Blocked");
  await expect(card).toContainText("Custom starting positions are unsupported.");
  await expect(card).toContainText("Review the preflight evidence before drawing a conclusion.");
  await expect(card).not.toContainText(/consistent/i);

  await chess(page, (api) => api.appendToolResultForTesting("analyze_repertoire_congruence", {
    error: "strategic_fit_stale_report",
    reason: "The repertoire changed while analysis was running.",
  }));
  await expect(page.getByRole("alert").last()).toContainText("Strategic Fit report is stale");
  await expect(page.getByRole("alert").last()).toContainText("The repertoire changed while analysis was running.");
});

test("legacy projected congruence results still render and navigate during migration", async ({ page }) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6", "legacy.pgn"));
  await chess(page, (api) => api.appendToolResultForTesting("analyze_repertoire_congruence", {
    incongruencies: [{
      type: "uncertain",
      severity: "low",
      description: "Legacy compatibility finding",
      paths: [["e4", "e5", "Nf3"]],
      source_finding_id: "finding:legacy",
    }],
  }));

  const card = page.locator(".strategic-fit-legacy-card");
  await expect(card).toContainText("Legacy projected result");
  await expect(card).toContainText("Legacy compatibility finding");
  await card.getByRole("button", { name: /Go to line/ }).click();
  await expect(page.locator(".move.current").first()).toContainText("Nf3");
});

test("a fake model can follow up by the compacted Strategic Fit finding ID", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("chess.openrouter.key", "fake-key"));
  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api) => api.loadPgn(`[Event "Ruy Lopez"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *

[Event "Open Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 *

[Event "French"]
[Result "*"]

1. e4 e6 2. d4 d5 3. Nc3 Bb4 *

[Event "Queen's Gambit"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 *

[Event "English"]
[Result "*"]

1. c4 e5 2. Nc3 Nf6 3. g3 d5 *`, "broad.pgn"));

  let compacted = false;
  let followedFindingId = "";
  let rounds = 0;
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    rounds++;
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: string | null }> };
    const toolMessage = [...body.messages].reverse().find((message) => message.role === "tool");
    let frame: unknown;
    if (!toolMessage) {
      frame = {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: "fit-call", function: { name: "analyze_repertoire_congruence", arguments: "{\"page\":{\"limit\":50}}" } }] },
          finish_reason: "tool_calls",
        }],
      };
    } else {
      const value = JSON.parse(toolMessage.content ?? "null") as { compacted?: boolean; references?: Record<string, unknown>[] };
      compacted = value.compacted === true;
      followedFindingId = String(value.references?.find((reference) => typeof reference.finding_id === "string")?.finding_id ?? "");
      frame = {
        choices: [{ delta: { content: `Follow-up grounded in finding ${followedFindingId}.` }, finish_reason: "stop" }],
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`,
    });
  });

  const input = page.getByPlaceholder("Ask about this position, game, or repertoire…");
  await input.fill("Analyze strategic fit and follow up on the top finding.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Follow-up grounded in finding/)).toBeVisible();

  expect(rounds).toBe(2);
  expect(compacted).toBe(true);
  expect(followedFindingId).toMatch(/^finding:/);
});
