import { expect, test, type Page } from "playwright/test";

type ChessHarness = {
  loadPgn(pgn: string, name?: string): void;
  appendToolResultForTesting(operation: string, result: unknown): void;
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

const basis = (overrides: Record<string, unknown> = {}) => ({
  kind: "strategic_fit_plan_basis",
  report_id: "report:plan",
  finding_id: "finding:plan",
  semantic_finding_id: "semantic:finding:plan",
  repertoire_revision: "browser:1",
  training_id: "strategic-fit-training:abc",
  concept_ids: ["concept:center-control"],
  omitted_concept_count: 0,
  checkpoints: [
    {
      checkpoint_id: "checkpoint:second",
      kind: "configured-ply",
      ply: 2,
      comparability: "comparable",
    },
  ],
  omitted_checkpoint_count: 0,
  drills: [
    {
      drill_id: "strategic-fit-drill:one",
      expected_san: "Nf3",
      source: "causal-move",
      checkpoint_id: null,
    },
  ],
  omitted_drill_count: 0,
  causal_move_san: "Nf3",
  san_paths: [["e4", "e5", "Nf3"]],
  omitted_san_path_count: 0,
  moves: ["Nf3", "e4", "e5"],
  omitted_move_count: 0,
  persisted: false,
  next_step: "Nothing is saved.",
  ...overrides,
});

const planCard = (overrides: Record<string, unknown> = {}) => ({
  kind: "strategic_fit_plan_card",
  plan_id: "strategic-fit-plan:1",
  status: "pending",
  revision: 1,
  report_id: "report:plan",
  finding_id: "finding:plan",
  semantic_finding_id: "semantic:finding:plan",
  title: "Hold the Nf3 setup",
  sections: [
    {
      kind: "strategic-plan",
      text: "Answer with Nf3 and finish development.",
      concept_ids: ["concept:center-control"],
      checkpoint_ids: [],
      drill_ids: [],
      cited_moves: ["Nf3"],
    },
    {
      kind: "danger-sign",
      text: "Recount the defenders if the queenside expands first.",
      concept_ids: [],
      checkpoint_ids: ["checkpoint:second"],
      drill_ids: [],
      cited_moves: [],
    },
  ],
  persisted: false,
  scope: "training-metadata-only",
  next_step: "Nothing has been saved.",
  ...overrides,
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
});

test("the plan evidence card shows only deterministic material and names what was withheld", async ({
  page,
}) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_plan", result),
    basis(),
  );

  const card = page.getByRole("region", { name: "Strategic Fit plan evidence" });
  await expect(card).toContainText("Plan evidence · finding:plan");
  await expect(card).toContainText(
    "1 concept · 1 checkpoint · 1 drill position · 3 validated moves",
  );
  await expect(card).toContainText("Concepts: concept:center-control");
  await expect(card).toContainText("Causal move: Nf3");
  await expect(card.locator('[data-drill-id="strategic-fit-drill:one"]')).toContainText("Nf3");
  await expect(card).toContainText("Nothing is saved.");
  await expect(card.locator(".strategic-fit-plan-omitted")).toHaveCount(0);

  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_plan", result),
    basis({
      omitted_concept_count: 4,
      omitted_drill_count: 2,
    }),
  );
  const bounded = page.getByRole("region", { name: "Strategic Fit plan evidence" }).last();
  await expect(bounded.locator(".strategic-fit-plan-omitted")).toContainText("4 concepts");
  await expect(bounded.locator(".strategic-fit-plan-omitted")).toContainText(
    "Withheld evidence exists; it is not absent",
  );
});

test("a staged plan card shows each section's supporting evidence and that nothing is saved yet", async ({
  page,
}) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_plan", result),
    planCard(),
  );

  const card = page.getByRole("region", { name: "Strategic Fit plan card" });
  await expect(card).toContainText("Plan · Hold the Nf3 setup");
  await expect(card.locator('[data-section-kind="strategic-plan"]')).toContainText(
    "Answer with Nf3 and finish development.",
  );
  await expect(card.locator('[data-section-kind="strategic-plan"]')).toContainText(
    "Evidence: concept:center-control · moves Nf3",
  );
  await expect(card.locator('[data-section-kind="danger-sign"]')).toContainText("Danger sign");
  await expect(card.locator('[data-section-kind="danger-sign"]')).toContainText(
    "Evidence: checkpoint:second",
  );
  await expect(card).toContainText("Nothing is saved until you accept.");
  await expect(card).toContainText("does not edit repertoire lines");
});

test("a plan card from an earlier session cannot be saved and says so", async ({ page }) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_plan", result),
    planCard(),
  );

  const card = page.getByRole("region", { name: "Strategic Fit plan card" });
  await expect(card).toContainText("Plan is not available in this session");
  await expect(card.getByRole("button", { name: "Save plan" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Reject" })).toHaveCount(0);
});

test("an unsupported plan is reported as a structured refusal rather than rendered content", async ({
  page,
}) => {
  await chess(page, (api) =>
    api.appendToolResultForTesting("propose_strategic_fit_plan", {
      error: "strategic_fit_plan_unsupported_move",
      reason:
        "plan.sections[0].text mentions f5, which is not a move on any validated path for this finding.",
    }),
  );

  const alert = page.getByRole("alert").last();
  await expect(alert).toContainText("Move is not on a validated path");
  await expect(alert).toContainText("not a move on any validated path");
  await expect(page.getByRole("region", { name: "Strategic Fit plan card" })).toHaveCount(0);
});
