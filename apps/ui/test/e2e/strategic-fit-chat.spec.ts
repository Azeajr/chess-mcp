import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  appendToolResultForTesting(operation: string, result: unknown): void;
  stageEdit(
    action: "add" | "prune" | "reorder",
    path: string[],
    options?: { addMoves?: string[]; promoteMove?: string },
  ): unknown;
  toPgn(): string;
};

const chess = <T>(page: Page, fn: (api: ChessHarness, arg: T) => unknown, arg?: T) =>
  page.evaluate(
    ({ source, arg }) =>
      Function(
        "api",
        "arg",
        `return (${source})(api, arg)`,
      )((window as unknown as { __chess: ChessHarness }).__chess, arg),
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
    source_san_paths: [
      ["e4", "c5"],
      ["e4", "e5", "Nf3"],
    ],
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

async function appendStagedAdd(page: Page) {
  await chess(page, (api) => api.loadPgn("1. e4 e5 *", "staged-edit.pgn"));
  const staged = (await chess(page, (api) =>
    api.stageEdit("add", ["e4", "e5"], { addMoves: ["Nf3", "Nc6"] }),
  )) as { ok: boolean; action_id?: string };
  if (!staged.ok) throw new Error("staged edit fixture should be valid");
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("modify_repertoire_line", result),
    staged,
  );
  return staged;
}

test("WP-026 AC-1 technical details hide raw payloads and error codes until enabled", async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem("chess.chat.technical-details", "false"));
  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);

  await chess(page, (api) =>
    api.appendToolResultForTesting("get_game_summary", {
      total_moves: 1,
      white: { accuracy_pct: 100, blunders: 0 },
      black: { accuracy_pct: 100, blunders: 0 },
    }),
  );
  await chess(page, (api) =>
    api.appendToolResultForTesting("evaluate_position", {
      error: "engine_unavailable",
      reason: "The local engine did not start.",
    }),
  );

  await expect(page.locator(".chat-log .tool-result-raw")).toHaveCount(0);
  await expect(page.locator(".chat-log .result-code")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  const technicalDetails = page.getByRole("checkbox", { name: "Show technical details" });
  await expect(technicalDetails).not.toBeChecked();
  await technicalDetails.check();
  await expect(page.locator(".chat-log .tool-result-raw")).toHaveCount(2);
  await expect(page.locator(".chat-log .result-code")).toHaveText("engine_unavailable");
  expect(await page.evaluate(() => localStorage.getItem("chess.chat.technical-details"))).toBe(
    "true",
  );
});

test("WP-026 AC-2 gives mutating cards a forced-colors-safe non-colour distinction", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await chess(page, (api) =>
    api.appendToolResultForTesting("get_game_summary", {
      total_moves: 1,
      white: { accuracy_pct: 100, blunders: 0 },
      black: { accuracy_pct: 100, blunders: 0 },
    }),
  );
  await appendStagedAdd(page);

  const informational = page.locator(".result-card-informational").last();
  const mutating = page.locator(".result-card-mutating.staged-card").last();
  await expect(informational).toBeVisible();
  await expect(mutating).toBeVisible();
  await expect(mutating.locator(".result-mutation-badge")).toHaveText("Changes your repertoire");
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  expect(await mutating.evaluate((card) => getComputedStyle(card).borderLeftWidth)).toBe("4px");
  expect(await informational.evaluate((card) => getComputedStyle(card).borderLeftWidth)).toBe(
    "0px",
  );
});

test("WP-026 AC-3 staged repertoire edits state scope, browser impact, and undo", async ({
  page,
}) => {
  await appendStagedAdd(page);

  const card = page.locator(".result-card-mutating.staged-card").last();
  await expect(card).toContainText("Scope: 2 moves in 1 line.");
  await expect(card).toContainText("Current line: 1. e4 e5.");
  await expect(card).toContainText("New continuation: 2. Nf3 Nc6.");
  await expect(card).toContainText("Accepting updates the working repertoire in this browser.");
  await expect(card).toContainText("You can undo this change from the move tree after accepting.");

  await card.getByRole("button", { name: "Accept" }).click();
  expect(await chess(page, (api) => api.toPgn())).toContain("Nf3 Nc6");
});

test("WP-026 AC-4 error recovery retries chat and focuses the Lichess token setting", async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem("chess.openrouter.key", "fake-key"));
  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);

  let requests = 0;
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    requests++;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        choices: [
          {
            delta: { content: requests === 1 ? "Initial response." : "Retried response." },
            finish_reason: "stop",
          },
        ],
      })}\n\ndata: [DONE]\n\n`,
    });
  });

  const input = page.getByPlaceholder("Ask about this position, game, or repertoire…");
  await input.fill("Retry this request");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Initial response.")).toBeVisible();

  await chess(page, (api) =>
    api.appendToolResultForTesting("evaluate_position", { error: "engine_unavailable" }),
  );
  const engineError = page.getByRole("alert").filter({ hasText: "Local engine unavailable" });
  await engineError.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Retried response.")).toBeVisible();
  expect(requests).toBe(2);

  await chess(page, (api) =>
    api.appendToolResultForTesting("find_theory_depth", { error: "explorer_auth_required" }),
  );
  const explorerError = page.getByRole("alert").filter({ hasText: "Lichess token required" });
  await explorerError.getByRole("button", { name: "Add Lichess token" }).click();
  await expect(page.locator(".drawer")).toBeVisible();
  await expect(page.getByLabel("Lichess API token")).toBeFocused();
});

test("WP-026 AC-5 preserves the staged-mutation safeguards in the chat log", async ({ page }) => {
  await chess(page, (api) =>
    api.appendToolResultForTesting("propose_strategic_fit_profile", {
      kind: "strategic_fit_profile_proposal",
      proposal_id: "proposal:preserved-copy",
      current_mode: "balanced",
      resulting_mode: "custom",
      diff: [],
    }),
  );
  await chess(page, (api) =>
    api.appendToolResultForTesting("propose_strategic_fit_plan", {
      kind: "strategic_fit_plan_basis",
      report_id: "report:preserved-copy",
      finding_id: "finding:preserved-copy",
      concept_ids: [],
      checkpoints: [],
      drills: [],
      moves: [],
      omitted_concept_count: 1,
      omitted_checkpoint_count: 0,
      omitted_drill_count: 0,
      omitted_san_path_count: 0,
      omitted_move_count: 0,
    }),
  );
  await chess(page, (api) =>
    api.appendToolResultForTesting("propose_strategic_fit_portfolio", {
      kind: "strategic_fit_portfolio_constraints",
      constraint_set_id: "constraints:preserved-copy",
      status: "pending",
      constraints: [],
      conflicts: [],
    }),
  );

  const log = page.locator(".chat-log");
  await expect(log).toContainText("Nothing is saved until you accept.");
  await expect(log).toContainText("Withheld evidence exists; it is not absent");
  await expect(log).toContainText("Nothing is bound and no preference was saved.");
});

test("typed Strategic Fit cards keep signals separate and navigate through a current safe SAN reference", async ({
  page,
}) => {
  await chess(page, (api) => api.loadPgn("1. e4 e5 2. Nf3 Nc6", "fit.pgn"));
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("analyze_repertoire_congruence", result),
    report(),
  );

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
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("analyze_repertoire_congruence", result),
    report({
      preflight: {
        state: "blocked",
        issues: [{ severity: "blocking", message: "Custom starting positions are unsupported." }],
        route_count: 0,
        comparable_route_count: 0,
        incomplete_route_count: 0,
      },
      summary: {
        workload: "unavailable",
        unresolved_finding_count: 0,
        insufficient_evidence_branch_count: 0,
      },
      findings: [],
      finding_page: { total_count: 0 },
    }),
  );

  const card = page.getByRole("region", { name: "Strategic Fit report" });
  await expect(card).toContainText("Analysis blocked");
  await expect(card).toContainText("Preflight Blocked");
  await expect(card).toContainText("Custom starting positions are unsupported.");
  await expect(card).toContainText("Review the preflight evidence before drawing a conclusion.");
  await expect(card).not.toContainText(/consistent/i);

  await chess(page, (api) =>
    api.appendToolResultForTesting("analyze_repertoire_congruence", {
      error: "strategic_fit_stale_report",
      reason: "The repertoire changed while analysis was running.",
    }),
  );
  await expect(page.getByRole("alert").last()).toContainText("Strategic Fit report is stale");
  await expect(page.getByRole("alert").last()).toContainText(
    "The repertoire changed while analysis was running.",
  );
});

test("a fake model can follow up by the compacted Strategic Fit finding ID", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("chess.openrouter.key", "fake-key"));
  await page.reload();
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
  await chess(page, (api) =>
    api.loadPgn(
      `[Event "Ruy Lopez"]
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

1. c4 e5 2. Nc3 Nf6 3. g3 d5 *`,
      "broad.pgn",
    ),
  );

  let compacted = false;
  let followedFindingId = "";
  let rounds = 0;
  await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
    rounds++;
    const body = route.request().postDataJSON() as {
      messages: Array<{ role: string; content: string | null }>;
    };
    const toolMessage = [...body.messages].reverse().find((message) => message.role === "tool");
    let frame: unknown;
    if (!toolMessage) {
      frame = {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "fit-call",
                  function: {
                    name: "analyze_repertoire_congruence",
                    arguments: '{"page":{"limit":50}}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
    } else {
      const value = JSON.parse(toolMessage.content ?? "null") as {
        compacted?: boolean;
        references?: Record<string, unknown>[];
      };
      compacted = value.compacted === true;
      followedFindingId = String(
        value.references?.find((reference) => typeof reference.finding_id === "string")
          ?.finding_id ?? "",
      );
      frame = {
        choices: [
          {
            delta: { content: `Follow-up grounded in finding ${followedFindingId}.` },
            finish_reason: "stop",
          },
        ],
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
