import assert from "node:assert/strict";
import test from "node:test";

import {
  REPLACEMENT_TOOL_V2_CONTRACT,
  contractsForHost,
  jsonSchemaForTool,
  produceReplacementToolV2Previews,
  validateToolArguments,
  type ReplacementToolV2Input,
  type StrategicFitProfile,
} from "@chess-mcp/chess-tools";
import { replacementFixture } from "../../../packages/chess-tools/test/strategic-fit/replacement-change-set.fixtures.ts";
import { streamChat } from "../src/llm/openrouter.ts";
import { executeBrowserCommand } from "../src/application/browser-commands/client.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import type { StrategicFitPortfolioEvidence } from "../src/application/strategic-fit-portfolio-source.ts";
import {
  createStrategicFitPortfolioState,
  type StrategicFitPortfolioConstraintResult,
  type StrategicFitPortfolioSelectionResult,
  type StrategicFitPortfolioViewResult,
} from "../src/store/strategic-fit-portfolio.ts";

type StageCall = { readonly candidate_id: string; readonly action: string };

/**
 * The store is exercised over the real Task 8.7 safety evidence and real Task 8.8 previews, with the
 * staging boundary recorded rather than replaced by a second staging path. "Nothing is applied" is
 * therefore asserted against the same evidence the product builds a portfolio from.
 */
function portfolioFixture(options: { readonly conflicts?: boolean } = {}) {
  const values = replacementFixture("portfolio");
  const request = values.request;
  const input: ReplacementToolV2Input = {
    contract: REPLACEMENT_TOOL_V2_CONTRACT,
    replacement_request: request,
    finding: {
      report_id: request.report_id,
      finding_id: request.finding_id,
      semantic_finding_id: request.semantic_finding_id,
      cohort_id: request.cohort_id,
      repertoire_revision: request.repertoire_revision,
    },
    pivot: request.pivot_selection,
    profile: request.profile,
    sources: request.candidate_sources,
    budget: request.budget,
    engine: {
      depth: request.budget.engine_depth,
      multipv: request.budget.engine_multipv,
      allow_unavailable_evidence: true,
    },
    coverage: {
      minimum_expected_opponent_coverage: request.minimum_expected_opponent_coverage,
      require_all_forcing_replies: request.budget.include_all_forcing_replies,
    },
    retention: [
      {
        candidate_id: values.candidate.candidate_id,
        action: "replace",
        prune_explicitly_confirmed: true,
      },
    ],
    candidate_ids: [values.candidate.candidate_id],
    safety: values.safety,
  };
  const previews = produceReplacementToolV2Previews(values.tree, input);
  assert.equal(previews.status, "complete");

  const evidence: StrategicFitPortfolioEvidence = {
    document_id: "document:portfolio",
    repertoire_revision: 4,
    report_id: request.report_id,
    finding_id: request.finding_id,
    semantic_finding_id: request.semantic_finding_id,
    safety: values.safety,
    previews: previews.items,
  };

  const profile: StrategicFitProfile = {
    ...request.profile,
    preferences: {
      ...request.profile.preferences,
      maximum_engine_loss_cp: options.conflicts ? 10 : null,
      minimum_opponent_coverage: null,
    },
  };

  let documentId = "document:portfolio";
  let revision = 4;
  let available = true;
  let outcome = {
    ok: true,
    stage_id: "stage:portfolio",
    code: null as string | null,
    message: "staged",
  };
  const stageCalls: StageCall[] = [];
  const state = createStrategicFitPortfolioState({
    currentDocumentId: () => documentId,
    currentRevision: () => revision,
    currentProfile: () => profile,
    evidence: () => (available ? evidence : null),
    stageOption: async (candidateId, action) => {
      stageCalls.push({ candidate_id: candidateId, action });
      return outcome;
    },
    now: () => "2026-07-31T00:00:00.000Z",
  });

  return {
    state,
    stageCalls,
    candidateId: values.candidate.candidate_id,
    setDocument: (next: string) => {
      documentId = next;
    },
    setRevision: (next: number) => {
      revision = next;
    },
    setAvailable: (next: boolean) => {
      available = next;
    },
    setOutcome: (next: typeof outcome) => {
      outcome = next;
    },
  };
}

const LOOSE = {
  maximum_engine_loss_cp: 50,
  minimum_expected_opponent_coverage: 0.5,
  maximum_added_theory_nodes: 40,
};

test("bounds are staged for confirmation and bind nothing until the user confirms them", () => {
  const subject = portfolioFixture();
  const proposal = subject.state.propose({ constraints: LOOSE, rationale: "keep it cheap" });
  assert.equal(proposal.kind, "strategic_fit_portfolio_constraints");
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.persisted, false);
  assert.equal(proposal.scope, "one-redesign-only");
  assert.equal(proposal.revision, 4);
  assert.equal(proposal.constraints.length, 3);
  assert.deepEqual(proposal.conflicts, []);
  assert.match(proposal.next_step, /confirms these bounds/);

  assert.throws(
    () => subject.state.portfolio(proposal.constraint_set_id),
    (error: { code?: string }) => error.code === "strategic_fit_portfolio_unconfirmed_constraints",
    "unconfirmed bounds cannot produce a portfolio",
  );

  assert.deepEqual(subject.state.confirm(proposal.constraint_set_id), {
    ok: true,
    status: "confirmed",
  });
  const portfolio = subject.state.portfolio(proposal.constraint_set_id);
  assert.equal(portfolio.kind, "strategic_fit_portfolio");
  assert.equal(portfolio.status, "available");
  assert.equal(portfolio.persisted, false);
  assert.equal(portfolio.automatic_selection, false);
  assert.equal(portfolio.applied, false);
  assert.equal(portfolio.constraint_set_id, proposal.constraint_set_id);
  assert.equal(subject.state.selection(), null, "producing a portfolio selects nothing");
  assert.deepEqual(subject.stageCalls, [], "producing a portfolio stages nothing");

  assert.deepEqual(
    subject.state.confirm(proposal.constraint_set_id),
    { ok: false, status: "confirmed" },
    "a set is confirmed once; a second confirmation is not a new decision",
  );
});

test("a contradiction is reported with the question to ask and never silently applied", () => {
  const subject = portfolioFixture({ conflicts: true });
  const proposal = subject.state.propose({ constraints: { maximum_engine_loss_cp: 60 } });
  assert.equal(proposal.conflicts.length, 1);
  assert.equal(proposal.conflicts[0]!.source, "declared-preference");
  assert.match(proposal.next_step, /put each contradiction to the user/i);
  assert.equal(proposal.constraints[0]!.value, 60, "the requested bound is reported as requested");
  assert.equal(
    subject.state.constraintSet(proposal.constraint_set_id)?.status,
    "pending",
    "a contradiction does not confirm or reject the bounds on the user's behalf",
  );
});

test("rejected bounds persist nothing and cannot be reused", () => {
  const subject = portfolioFixture();
  const proposal = subject.state.propose({ constraints: LOOSE });
  assert.deepEqual(subject.state.reject(proposal.constraint_set_id), {
    ok: true,
    status: "rejected",
  });
  assert.throws(
    () => subject.state.portfolio(proposal.constraint_set_id),
    (error: { code?: string }) => error.code === "strategic_fit_portfolio_unconfirmed_constraints",
  );
  assert.deepEqual(subject.stageCalls, []);
  assert.equal(subject.state.selection(), null);
});

test("confirmed bounds go stale when the document or repertoire moves under them", () => {
  const moved = portfolioFixture();
  const first = moved.state.propose({ constraints: LOOSE });
  moved.state.confirm(first.constraint_set_id);
  moved.setRevision(5);
  assert.throws(
    () => moved.state.portfolio(first.constraint_set_id),
    (error: { code?: string }) => error.code === "strategic_fit_portfolio_stale",
  );
  assert.equal(moved.state.constraintSet(first.constraint_set_id)?.status, "stale");

  const swapped = portfolioFixture();
  const second = swapped.state.propose({ constraints: LOOSE });
  swapped.state.confirm(second.constraint_set_id);
  swapped.setDocument("document:other");
  assert.throws(
    () => swapped.state.portfolio(second.constraint_set_id),
    (error: { code?: string }) => error.code === "strategic_fit_portfolio_stale",
  );

  const pending = portfolioFixture();
  const third = pending.state.propose({ constraints: LOOSE });
  pending.setRevision(9);
  assert.deepEqual(
    pending.state.confirm(third.constraint_set_id),
    { ok: false, status: "stale" },
    "bounds cannot be confirmed against a repertoire they were not measured against",
  );
});

test("without a lab result the portfolio reports unavailable evidence instead of describing lines", () => {
  const subject = portfolioFixture();
  const proposal = subject.state.propose({ constraints: LOOSE });
  subject.state.confirm(proposal.constraint_set_id);
  subject.setAvailable(false);
  assert.throws(
    () => subject.state.portfolio(proposal.constraint_set_id),
    (error: { code?: string; message?: string }) =>
      error.code === "strategic_fit_portfolio_evidence_unavailable" &&
      /do not describe alternatives from chess knowledge/.test(error.message ?? ""),
  );
});

test("selecting an option stages the existing change set and applies nothing", async () => {
  const subject = portfolioFixture();
  const proposal = subject.state.propose({ constraints: LOOSE });
  subject.state.confirm(proposal.constraint_set_id);
  const portfolio = subject.state.portfolio(proposal.constraint_set_id);
  const option = portfolio.options[0]!;

  const selected = (await subject.state.select(
    proposal.constraint_set_id,
    option.option_id,
  )) as Extract<
    StrategicFitPortfolioSelectionResult,
    { kind: "strategic_fit_portfolio_selection" }
  >;
  assert.equal(selected.kind, "strategic_fit_portfolio_selection");
  assert.equal(selected.status, "staged");
  assert.equal(selected.applied, false);
  assert.equal(selected.persisted, false);
  assert.equal(selected.stage_id, "stage:portfolio");
  assert.match(selected.next_step, /staged, not applied/);
  assert.deepEqual(
    subject.stageCalls,
    [{ candidate_id: option.candidate_id, action: option.action }],
    "staging is delegated to the existing review path exactly once",
  );
  assert.equal(subject.state.selection()?.status, "staged");

  const unknown = (await subject.state.select(
    proposal.constraint_set_id,
    "strategic-fit-portfolio-option:invented",
  )) as { error: string };
  assert.equal(unknown.error, "strategic_fit_portfolio_unknown_option");
  assert.equal(
    subject.stageCalls.length,
    1,
    "an option the portfolio never returned stages nothing",
  );

  const unconfirmed = portfolioFixture();
  const pending = unconfirmed.state.propose({ constraints: LOOSE });
  const refused = (await unconfirmed.state.select(pending.constraint_set_id, option.option_id)) as {
    error: string;
  };
  assert.equal(refused.error, "strategic_fit_portfolio_unconfirmed_constraints");
  assert.deepEqual(unconfirmed.stageCalls, []);
});

test("a failed stage leaves nothing selected and reports the change controller's own code", async () => {
  const subject = portfolioFixture();
  const proposal = subject.state.propose({ constraints: LOOSE });
  subject.state.confirm(proposal.constraint_set_id);
  const option = subject.state.portfolio(proposal.constraint_set_id).options[0]!;
  subject.setOutcome({
    ok: false,
    stage_id: null,
    code: "stale-result",
    message: "Replacement context is stale.",
  });

  const failed = (await subject.state.select(proposal.constraint_set_id, option.option_id)) as {
    error: string;
    reason: string;
  };
  assert.equal(failed.error, "stale-result");
  assert.equal(failed.reason, "Replacement context is stale.");
  assert.equal(
    subject.state.selection()?.status,
    "failed",
    "a failure is not presented as a pending staged change",
  );
  assert.equal(subject.state.selection()?.stage_id, null);
});

test("choosing a second option supersedes the first so only one change is ever staged", async () => {
  const subject = portfolioFixture();
  const proposal = subject.state.propose({ constraints: LOOSE });
  subject.state.confirm(proposal.constraint_set_id);
  const option = subject.state.portfolio(proposal.constraint_set_id).options[0]!;

  await subject.state.select(proposal.constraint_set_id, option.option_id);
  assert.equal(subject.state.selection()?.status, "staged");
  subject.setOutcome({ ok: true, stage_id: "stage:portfolio-2", code: null, message: "staged" });
  await subject.state.select(proposal.constraint_set_id, option.option_id);
  assert.equal(subject.state.selection()?.stage_id, "stage:portfolio-2");
  assert.equal(
    subject.stageCalls.length,
    2,
    "each selection goes through the review path, which discards the prior stage as it takes the new one",
  );
});

test("the portfolio operation exists only where a lab result and staging exist", () => {
  assert.ok(
    contractsForHost("browser").some((entry) => entry.name === "propose_strategic_fit_portfolio"),
    "the browser holds the retained lab result and the change controller",
  );
  assert.ok(
    !contractsForHost("mcp").some((entry) => entry.name === "propose_strategic_fit_portfolio"),
    "an MCP session has no lab result, staging, archive, or undo to build a portfolio on",
  );
  assert.equal(jsonSchemaForTool("propose_strategic_fit_portfolio", "mcp"), null);

  const schema = jsonSchemaForTool("propose_strategic_fit_portfolio", "browser")!;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const constraints = properties.constraints!.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(constraints).sort(), [
    "maximum_added_theory_nodes",
    "maximum_engine_loss_cp",
    "maximum_homogenization_cost",
    "maximum_memorization_burden",
    "maximum_new_concept_count",
    "minimum_expected_opponent_coverage",
    "minimum_strategic_fit_delta",
  ]);
  for (const key of ["evaluation", "score", "coverage_estimate", "line", "moves", "pgn", "fen"]) {
    assert.equal(
      properties[key],
      undefined,
      `the schema has nowhere to put a model-authored ${key}`,
    );
  }
});

test("argument shapes that could smuggle an unconfirmed bound are rejected before the store", () => {
  const invalid = (args: Record<string, unknown>) =>
    validateToolArguments("propose_strategic_fit_portfolio", args, "browser") as {
      ok: boolean;
      reason?: string;
    };

  assert.equal(invalid({ constraints: LOOSE }).ok, true);
  assert.equal(invalid({ constraint_set_id: "strategic-fit-portfolio-constraints:1" }).ok, true);
  assert.equal(
    invalid({
      constraint_set_id: "strategic-fit-portfolio-constraints:1",
      option_id: "strategic-fit-portfolio-option:candidate",
    }).ok,
    true,
  );

  assert.equal(
    invalid({ constraints: LOOSE, constraint_set_id: "strategic-fit-portfolio-constraints:1" }).ok,
    false,
    "bounds cannot be stated and used in the same call, which would skip confirmation",
  );
  assert.equal(
    invalid({ constraints: LOOSE, option_id: "strategic-fit-portfolio-option:candidate" }).ok,
    false,
  );
  assert.equal(invalid({ constraints: {} }).ok, false);
  assert.equal(invalid({ rationale: "because" }).ok, false);
  assert.equal(invalid({ constraint_set_id: "  " }).ok, false);
  assert.equal(invalid({ option_id: "strategic-fit-portfolio-option:candidate" }).ok, false);
  assert.equal(invalid({ constraints: { maximum_engine_loss_cp: 5000 } }).ok, false);
  assert.equal(invalid({ constraints: { maximum_engine_loss_cp: "30" } }).ok, false);
  assert.equal(
    invalid({ constraints: { danger: 3 } }).ok,
    false,
    "a bound with no measurement behind it never reaches the store",
  );
  assert.equal(
    validateToolArguments("propose_strategic_fit_portfolio", { constraints: LOOSE }, "mcp").ok,
    false,
    "the operation is refused on a host that cannot stage anything",
  );
});

test("a fake model's portfolio call stages only and never edits the repertoire", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: { location: { origin: "http://test" } },
    configurable: true,
  });
  const portfolioArguments = JSON.stringify({
    constraint_set_id: "strategic-fit-portfolio-constraints:1",
    option_id: "strategic-fit-portfolio-option:candidate:safe-replacement",
  });
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "p1",
                          function: {
                            name: "propose_strategic_fit_portfolio",
                            arguments: portfolioArguments,
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      { status: 200 },
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  });

  const stream = await streamChat({
    apiKey: "x",
    model: "fake",
    messages: [],
    tools: [],
    onText() {},
  });
  assert.equal(stream.toolCalls.length, 1);
  const call = stream.toolCalls[0]!;
  assert.equal(call.function.name, "propose_strategic_fit_portfolio");

  const requested: unknown[] = [];
  const pgnBefore = defaultBrowserCommandDependencies.currentPgn();
  const revisionBefore = defaultBrowserCommandDependencies.currentRevision();
  const result = (await executeBrowserCommand(
    call.function.name,
    JSON.parse(call.function.arguments) as Record<string, unknown>,
    {},
    {
      ...defaultBrowserCommandDependencies,
      proposeStrategicFitPortfolio: (input) => {
        requested.push(input);
        return {
          kind: "strategic_fit_portfolio_selection",
          status: "staged",
          applied: false,
          stage_id: "stage:portfolio",
        };
      },
      stageEdit: () => assert.fail("a portfolio selection must never stage a repertoire edit"),
      proposeLine: () => assert.fail("a portfolio selection must never propose a line"),
      stageReplacementChangeSet: () => assert.fail("a portfolio adds no staging path of its own"),
    },
  )) as { kind: string; applied: boolean };
  assert.equal(result.kind, "strategic_fit_portfolio_selection");
  assert.equal(result.applied, false);
  assert.deepEqual(requested, [JSON.parse(portfolioArguments)]);
  assert.equal(
    defaultBrowserCommandDependencies.currentPgn(),
    pgnBefore,
    "the repertoire PGN is unchanged",
  );
  assert.equal(defaultBrowserCommandDependencies.currentRevision(), revisionBefore);

  const smuggled = (await executeBrowserCommand(
    "propose_strategic_fit_portfolio",
    {
      constraints: { maximum_engine_loss_cp: 30 },
      constraint_set_id: "strategic-fit-portfolio-constraints:1",
    },
    {},
    defaultBrowserCommandDependencies,
  )) as { error: string };
  assert.equal(
    smuggled.error,
    "invalid_arguments",
    "stating bounds and using them in one call never reaches the store",
  );

  const unconfirmed = (await executeBrowserCommand(
    "propose_strategic_fit_portfolio",
    { constraint_set_id: "strategic-fit-portfolio-constraints:never-confirmed" },
    {},
    defaultBrowserCommandDependencies,
  )) as { error: string };
  assert.equal(
    unconfirmed.error,
    "strategic_fit_portfolio_unconfirmed_constraints",
    "a constraint set the user never confirmed produces no portfolio in the real store",
  );
});

test("the constraint and portfolio results the model sees carry no writable state", () => {
  const subject = portfolioFixture();
  const proposal: StrategicFitPortfolioConstraintResult = subject.state.propose({
    constraints: LOOSE,
  });
  subject.state.confirm(proposal.constraint_set_id);
  const portfolio: StrategicFitPortfolioViewResult = subject.state.portfolio(
    proposal.constraint_set_id,
  );
  for (const key of ["applied", "persisted", "automatic_selection"] as const) {
    if (key in portfolio)
      assert.equal((portfolio as unknown as Record<string, unknown>)[key], false);
  }
  for (const option of portfolio.options) {
    assert.ok(
      option.evidence_identity.length > 0,
      "an option names the retained evidence it stands on",
    );
    assert.ok(option.change_set_id.length > 0, "an option stages an already-validated change set");
    for (const measurement of option.measurements) {
      assert.ok(
        measurement.state === "available" || measurement.value === null,
        "an unmeasured metric never reports a number",
      );
    }
  }
});
