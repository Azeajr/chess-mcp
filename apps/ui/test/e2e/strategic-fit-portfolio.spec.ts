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

const constraints = (overrides: Record<string, unknown> = {}) => ({
  kind: "strategic_fit_portfolio_constraints",
  constraint_set_id: "strategic-fit-portfolio-constraints:1",
  status: "pending",
  revision: 1,
  constraints: [
    {
      kind: "maximum_engine_loss_cp",
      direction: "maximum",
      value: 30,
      unit: "centipawns",
      label: "Evaluation loss from best, repertoire POV: at most 30 centipawns",
    },
    {
      kind: "minimum_expected_opponent_coverage",
      direction: "minimum",
      value: 0.8,
      unit: "share of expected opponent replies",
      label: "Expected opponent coverage: at least 0.8 share of expected opponent replies",
    },
  ],
  rationale: "Keep the preparation cheap.",
  conflicts: [],
  persisted: false,
  scope: "one-redesign-only",
  next_step: "Nothing is bound and no preference was saved.",
  ...overrides,
});

const measurement = (overrides: Record<string, unknown> = {}) => ({
  kind: "maximum_engine_loss_cp",
  label: "Evaluation loss from best, repertoire POV",
  unit: "centipawns",
  value: 20,
  state: "available",
  reason: null,
  constraint_value: 30,
  satisfies_constraint: true,
  ...overrides,
});

const portfolio = (overrides: Record<string, unknown> = {}) => ({
  kind: "strategic_fit_portfolio",
  constraint_set_id: "strategic-fit-portfolio-constraints:1",
  portfolio_version: "1.0.0",
  status: "available",
  explanation: "1 of 3 generated candidates satisfy every requested bound.",
  constraint_identity: "strategic-fit-portfolio-constraints:abc",
  constraints: constraints().constraints,
  options: [
    {
      option_id: "strategic-fit-portfolio-option:candidate:safe",
      candidate_id: "candidate:safe",
      change_set_id: "change-set:abc",
      action: "replace",
      action_label: "Replace existing line",
      pareto_status: "pareto-optimal",
      dominated_by_candidate_ids: [],
      measurements: [
        measurement(),
        measurement({
          kind: "maximum_memorization_burden",
          label: "Memorization burden",
          unit: "burden points",
          value: null,
          state: "unavailable",
          reason: "Memorization burden is unavailable in the retained evidence for this candidate.",
          constraint_value: null,
          satisfies_constraint: null,
        }),
      ],
      safety_checks: [{ kind: "transposition-integrity", status: "passed" }],
      unresolved_risk_count: 0,
      evidence_identity: "strategic-fit-portfolio-evidence:9f1",
    },
  ],
  omitted_option_count: 0,
  eliminations: [
    {
      candidate_id: "candidate:costly",
      reason: "constraint-not-met",
      constraint_kinds: ["maximum_engine_loss_cp"],
      explanation:
        "Evaluation loss from best, repertoire POV is 55 centipawns, outside the requested 30.",
    },
  ],
  omitted_elimination_count: 0,
  binding_constraint_kinds: ["maximum_engine_loss_cp"],
  request_id: "request:portfolio",
  report_id: "report:portfolio",
  finding_id: "finding:portfolio",
  semantic_finding_id: "semantic:finding:portfolio",
  cohort_id: "cohort:portfolio",
  repertoire_revision: "browser:1",
  repertoire_color: "white",
  automatic_selection: false,
  applied: false,
  persisted: false,
  next_step: "Nothing is selected and nothing is applied.",
  ...overrides,
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => chess(page, (api) => Boolean(api))).toBe(true);
});

test("redesign bounds are shown for confirmation and state that they bind nothing", async ({
  page,
}) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_portfolio", result),
    constraints(),
  );

  const card = page.getByRole("region", { name: "Strategic Fit redesign bounds" });
  await expect(card).toContainText("Redesign bounds");
  await expect(card).toContainText("Keep the preparation cheap.");
  await expect(card.locator('[data-constraint-kind="maximum_engine_loss_cp"]')).toContainText(
    "at most 30 centipawns",
  );
  await expect(
    card.locator('[data-constraint-kind="minimum_expected_opponent_coverage"]'),
  ).toContainText("at least 0.8");
  await expect(card).toContainText("Nothing is bound and no preference was saved.");
  await expect(card).toContainText("confirming them changes no profile setting");
});

test("a contradiction is presented as the user's question and never resolved for them", async ({
  page,
}) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_portfolio", result),
    constraints({
      conflicts: [
        {
          source: "declared-preference",
          constraint_kinds: ["maximum_engine_loss_cp"],
          explanation:
            "The request accepts up to 30 centipawns of loss, but the confirmed profile allows at most 15.",
          question:
            "Should this redesign use the wider tolerance just this once, or should the profile change?",
        },
      ],
    }),
  );

  const card = page.getByRole("region", { name: "Strategic Fit redesign bounds" });
  await expect(card.locator(".strategic-fit-portfolio-conflicts")).toContainText(
    "1 contradiction to settle",
  );
  const conflict = card.locator('[data-conflict-source="declared-preference"]');
  await expect(conflict).toContainText("the confirmed profile allows at most 15");
  await expect(conflict).toContainText(
    "Should this redesign use the wider tolerance just this once",
  );
  await expect(card.locator('[data-constraint-kind="maximum_engine_loss_cp"]')).toContainText(
    "at most 30 centipawns",
  );
});

test("bounds from an earlier session cannot be confirmed and say so", async ({ page }) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_portfolio", result),
    constraints(),
  );

  const card = page.getByRole("region", { name: "Strategic Fit redesign bounds" });
  await expect(card).toContainText("These bounds are not available in this session");
  await expect(card.getByRole("button", { name: "Confirm bounds" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Reject" })).toHaveCount(0);
});

test("every portfolio option shows the measured value behind each bound and selects nothing", async ({
  page,
}) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_portfolio", result),
    portfolio(),
  );

  const card = page.getByRole("region", { name: "Strategic Fit redesign portfolio" });
  await expect(card).toContainText("Redesign portfolio · 1 option");
  const option = card.locator('[data-option-id="strategic-fit-portfolio-option:candidate:safe"]');
  await expect(option).toContainText("Replace existing line · pareto-optimal");
  await expect(option.locator('[data-measurement-kind="maximum_engine_loss_cp"]')).toContainText(
    "20 centipawns",
  );
  await expect(option.locator('[data-measurement-kind="maximum_engine_loss_cp"]')).toContainText(
    "(bound 30)",
  );
  await expect(
    option.locator('[data-measurement-kind="maximum_memorization_burden"]'),
  ).toContainText("not measured");
  await expect(card).toContainText("Nothing is selected and nothing is applied.");
  await expect(card.locator(".strategic-fit-portfolio-binding")).toContainText(
    "maximum_engine_loss_cp",
  );
  await expect(card.locator('[data-candidate-id="candidate:costly"]')).toContainText(
    "outside the requested 30",
  );
});

test("an infeasible portfolio names the binding bound instead of offering a line", async ({
  page,
}) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_portfolio", result),
    portfolio({
      status: "infeasible",
      explanation:
        "No candidate satisfies every requested bound. Evaluation loss from best, repertoire POV alone excluded 2 candidate(s). Ask the user which bound to move.",
      options: [],
      next_step: "No portfolio option exists.",
    }),
  );

  const card = page.getByRole("region", { name: "Strategic Fit redesign portfolio" });
  await expect(card).toContainText("Redesign portfolio · 0 options");
  await expect(card).toContainText("Ask the user which bound to move");
  await expect(card.locator(".strategic-fit-portfolio-option")).toHaveCount(0);
  await expect(card).toContainText("Nothing is selected and nothing is applied.");
});

test("withheld options are disclosed as withheld rather than read as the whole portfolio", async ({
  page,
}) => {
  await chess(
    page,
    (api, result) => api.appendToolResultForTesting("propose_strategic_fit_portfolio", result),
    portfolio({
      omitted_option_count: 3,
      omitted_elimination_count: 2,
    }),
  );

  const card = page.getByRole("region", { name: "Strategic Fit redesign portfolio" });
  await expect(card.locator(".strategic-fit-portfolio-omitted").first()).toContainText(
    "3 further qualifying option(s) withheld",
  );
  await expect(card.locator(".strategic-fit-portfolio-omitted").first()).toContainText(
    "They exist and are not",
  );
  await expect(card.locator(".strategic-fit-portfolio-omitted").last()).toContainText(
    "2 further exclusion(s) withheld",
  );
});

test("an unconfirmed constraint set is reported as a structured refusal rather than a portfolio", async ({
  page,
}) => {
  await chess(page, (api) =>
    api.appendToolResultForTesting("propose_strategic_fit_portfolio", {
      error: "strategic_fit_portfolio_unconfirmed_constraints",
      reason: "These bounds are still waiting for the user's confirmation.",
    }),
  );

  const alert = page.getByRole("alert").last();
  await expect(alert).toContainText("Redesign bounds are not confirmed");
  await expect(alert).toContainText("still waiting for the user's confirmation");
  await expect(page.getByRole("region", { name: "Strategic Fit redesign portfolio" })).toHaveCount(
    0,
  );
});
