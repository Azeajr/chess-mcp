import assert from "node:assert/strict";
import test from "node:test";

import {
  REPLACEMENT_TOOL_V2_CONTRACT,
  STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS,
  STRATEGIC_FIT_PORTFOLIO_LIMITS,
  STRATEGIC_FIT_PORTFOLIO_VERSION,
  StrategicFitPortfolioError,
  applyReplacementChangeSet,
  buildStrategicFitPortfolio,
  detectStrategicFitPortfolioConflicts,
  produceReplacementToolV2Previews,
  resolveStrategicFitPortfolioConstraints,
  strategicFitPortfolioConstraintIdentity,
  strategicFitPortfolioErrorResult,
  type ReplacementCandidateSafetySimulation,
  type ReplacementSafetySimulationResult,
  type ReplacementToolV2Input,
  type ReplacementToolV2Item,
  type StrategicFitPortfolioConstraintKind,
  type StrategicFitProfile,
} from "../../src/index.ts";
import { replacementFixture } from "./replacement-change-set.fixtures.ts";

/**
 * Portfolio evidence is the real Task 8.7 safety simulation and the real Task 8.8 previews, so
 * "every option is backed by retained evidence" is asserted against the artifacts the product
 * builds rather than a hand-written stand-in.
 */
function evidence(): {
  readonly safety: ReplacementSafetySimulationResult;
  readonly previews: readonly ReplacementToolV2Item[];
} {
  const fixture = replacementFixture("portfolio");
  const request = fixture.request;
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
    retention: [{
      candidate_id: fixture.candidate.candidate_id,
      action: "replace",
      prune_explicitly_confirmed: true,
    }],
    candidate_ids: [fixture.candidate.candidate_id],
    safety: fixture.safety,
  };
  const result = produceReplacementToolV2Previews(fixture.tree, input);
  assert.equal(result.status, "complete");
  return { safety: fixture.safety, previews: result.items };
}

/** Clone one candidate and its preview under a new identity so multi-candidate cases stay real. */
function withClone(
  base: { readonly safety: ReplacementSafetySimulationResult; readonly previews: readonly ReplacementToolV2Item[] },
  candidateId: string,
  mutate: (candidate: ReplacementCandidateSafetySimulation, item: ReplacementToolV2Item) => void,
) {
  const source = base.safety.candidates[0]!;
  const sourceItem = base.previews.find((item) => item.candidate_id === source.candidate_id)!;
  const candidate = structuredClone(source) as { candidate_id: string } & ReplacementCandidateSafetySimulation;
  const item = structuredClone(sourceItem) as { candidate_id: string } & ReplacementToolV2Item;
  candidate.candidate_id = candidateId;
  item.candidate_id = candidateId;
  mutate(candidate as ReplacementCandidateSafetySimulation, item as ReplacementToolV2Item);
  return {
    safety: { ...base.safety, candidates: [...base.safety.candidates, candidate] } as ReplacementSafetySimulationResult,
    previews: [...base.previews, item] as readonly ReplacementToolV2Item[],
  };
}

const LOOSE: Record<string, number> = {
  maximum_engine_loss_cp: 50,
  minimum_expected_opponent_coverage: 0.5,
  maximum_added_theory_nodes: 40,
  maximum_new_concept_count: 8,
  maximum_homogenization_cost: 0.9,
  maximum_memorization_burden: 40,
  minimum_strategic_fit_delta: 0,
};

const set = (constraints: Record<string, unknown>, rationale?: unknown) =>
  resolveStrategicFitPortfolioConstraints(
    rationale === undefined ? { constraints } : { constraints, rationale },
  );

const profileBase = replacementFixture("profile").request.profile;

/** Declared preferences default to unset so each conflict case states exactly what it declared. */
const profile = (overrides: Partial<StrategicFitProfile["preferences"]> = {}): StrategicFitProfile => ({
  ...profileBase,
  preferences: {
    ...profileBase.preferences,
    maximum_engine_loss_cp: null,
    minimum_opponent_coverage: null,
    ...overrides,
  },
});

const code = (error: unknown): string | undefined =>
  error instanceof StrategicFitPortfolioError ? error.code : undefined;

test("constraint parsing rejects model-authored bounds it cannot check instead of repairing them", () => {
  assert.throws(() => set({}), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_empty_constraints");
  assert.throws(() => resolveStrategicFitPortfolioConstraints({}), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_empty_constraints");
  assert.throws(() => resolveStrategicFitPortfolioConstraints({ constraints: [] }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_empty_constraints");

  assert.throws(() => set({ maximum_practical_danger: 3 }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_unknown_constraint",
    "a bound with no deterministic measurement behind it is refused, not approximated");
  assert.throws(() => set({ maximum_engine_loss_cp: "30" }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_invalid_value");
  assert.throws(() => set({ maximum_engine_loss_cp: Number.NaN }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_invalid_value");
  assert.throws(() => set({ maximum_engine_loss_cp: Number.POSITIVE_INFINITY }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_invalid_value");
  assert.throws(() => set({ maximum_engine_loss_cp: 5000 }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_invalid_value");
  assert.throws(() => set({ maximum_engine_loss_cp: -1 }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_invalid_value");
  assert.throws(() => set({ maximum_engine_loss_cp: 12.5 }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_invalid_value",
    "an integral bound cannot be given a fractional value");
  assert.throws(() => set({ minimum_expected_opponent_coverage: 2 }), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_invalid_value");
  assert.throws(() => set({ maximum_engine_loss_cp: 30 }, 41), (error: unknown) =>
    code(error) === "strategic_fit_portfolio_invalid_value");
  assert.throws(
    () => set({ maximum_engine_loss_cp: 30 }, "x".repeat(STRATEGIC_FIT_PORTFOLIO_LIMITS.rationale_characters + 1)),
    (error: unknown) => code(error) === "strategic_fit_portfolio_invalid_value",
  );

  const parsed = set({ maximum_engine_loss_cp: 30, minimum_expected_opponent_coverage: 0.8 }, "  keep it tight  ");
  assert.equal(parsed.constraints.length, 2);
  assert.equal(parsed.rationale, "keep it tight");
  assert.deepEqual(
    parsed.constraints.map((constraint) => constraint.kind),
    ["maximum_engine_loss_cp", "minimum_expected_opponent_coverage"],
    "constraints are ordered by the canonical kind list, not by the model's key order",
  );
  assert.equal(parsed.constraints[0]!.direction, "maximum");
  assert.equal(parsed.constraints[1]!.direction, "minimum");
  assert.match(parsed.constraints[0]!.label, /at most 30 centipawns/);
  assert.match(parsed.constraints[1]!.label, /at least 0\.8/);

  assert.equal(set({ maximum_engine_loss_cp: 30 }).rationale, null);
  assert.equal(
    strategicFitPortfolioConstraintIdentity(set({ maximum_engine_loss_cp: 30 }, "one reason")),
    strategicFitPortfolioConstraintIdentity(set({ maximum_engine_loss_cp: 30 }, "another reason")),
    "identity is the bounds themselves; prose does not change what was requested",
  );
  assert.notEqual(
    strategicFitPortfolioConstraintIdentity(set({ maximum_engine_loss_cp: 30 })),
    strategicFitPortfolioConstraintIdentity(set({ maximum_engine_loss_cp: 31 })),
  );
});

test("more bounds than the limit are refused rather than truncated", () => {
  const all: Record<string, number> = {};
  for (const kind of STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS) all[kind] = LOOSE[kind]!;
  assert.equal(
    resolveStrategicFitPortfolioConstraints({ constraints: all }).constraints.length,
    STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS.length,
    "every canonical bound may be requested at once",
  );
  assert.ok(STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS.length <= STRATEGIC_FIT_PORTFOLIO_LIMITS.constraints);
});

test("a contradiction is reported as the user's decision and never resolved by relaxing a bound", () => {
  const declared = profile({ maximum_engine_loss_cp: 20, minimum_opponent_coverage: 0.9 });

  const wider = set({ maximum_engine_loss_cp: 60 });
  const lossConflicts = detectStrategicFitPortfolioConflicts(wider, { profile: declared });
  assert.equal(lossConflicts.length, 1);
  assert.equal(lossConflicts[0]!.source, "declared-preference");
  assert.deepEqual(lossConflicts[0]!.constraint_kinds, ["maximum_engine_loss_cp"]);
  assert.ok(lossConflicts[0]!.question.endsWith("?"), "a contradiction is put as a question");
  assert.deepEqual(wider.constraints.map((constraint) => constraint.value), [60],
    "detection reports; it does not rewrite the requested bound");

  const lower = set({ minimum_expected_opponent_coverage: 0.4 });
  const coverageConflicts = detectStrategicFitPortfolioConflicts(lower, { profile: declared });
  assert.equal(coverageConflicts.length, 1);
  assert.equal(coverageConflicts[0]!.source, "declared-preference");

  const selfContradictory = set({ maximum_added_theory_nodes: 0, minimum_expected_opponent_coverage: 0.9 });
  const requested = detectStrategicFitPortfolioConflicts(selfContradictory, { profile: profile() });
  assert.equal(requested.length, 1);
  assert.equal(requested[0]!.source, "requested-constraints");
  assert.deepEqual(requested[0]!.constraint_kinds,
    ["maximum_added_theory_nodes", "minimum_expected_opponent_coverage"]);

  const conceptContradiction = detectStrategicFitPortfolioConflicts(
    set({ maximum_new_concept_count: 0, minimum_strategic_fit_delta: 0.2 }),
    { profile: profile() },
  );
  assert.equal(conceptContradiction.length, 1);
  assert.equal(conceptContradiction[0]!.source, "requested-constraints");

  assert.deepEqual(
    detectStrategicFitPortfolioConflicts(set({ maximum_engine_loss_cp: 10 }), { profile: declared }),
    [],
    "a bound stricter than the declared preference is not a contradiction",
  );
});

test("a feasible portfolio returns options bound to retained evidence and selects nothing", () => {
  const base = evidence();
  const before = structuredClone({ safety: base.safety, previews: base.previews });
  const result = buildStrategicFitPortfolio({ constraint_set: set(LOOSE), safety: base.safety, previews: base.previews });

  assert.equal(result.portfolio_version, STRATEGIC_FIT_PORTFOLIO_VERSION);
  assert.equal(result.status, "available");
  assert.equal(result.options.length, 1);
  assert.equal(result.automatic_selection, false);
  assert.equal(result.applied, false);
  assert.deepEqual(result.binding_constraint_kinds, []);
  assert.equal(result.report_id, base.safety.report_id);
  assert.equal(result.repertoire_revision, base.safety.repertoire_revision);

  const option = result.options[0]!;
  const candidate = base.safety.candidates[0]!;
  const item = base.previews.find((entry) => entry.candidate_id === candidate.candidate_id)!;
  assert.equal(option.candidate_id, candidate.candidate_id);
  assert.equal(option.change_set_id, item.change_set!.change_set_id,
    "an option stages the change set the preview already validated");
  assert.equal(option.pareto_status, candidate.scored_candidate.pareto.status,
    "Task 8.6 status is carried through, not recomputed over the constrained subset");
  assert.ok(option.evidence_identity.startsWith("strategic-fit-portfolio-evidence:"));
  assert.equal(option.measurements.length, STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS.length);
  const loss = option.measurements.find((measurement) => measurement.kind === "maximum_engine_loss_cp")!;
  assert.equal(loss.value, candidate.scored_candidate.objective_quality.repertoire_pov_loss_from_best_cp,
    "the reported value is read out of the retained score, never supplied");
  assert.equal(loss.constraint_value, LOOSE.maximum_engine_loss_cp);
  assert.equal(loss.satisfies_constraint, true);
  const unconstrained = buildStrategicFitPortfolio({
    constraint_set: set({ maximum_engine_loss_cp: LOOSE.maximum_engine_loss_cp! }),
    safety: base.safety,
    previews: base.previews,
  }).options[0]!.measurements.find((measurement) => measurement.kind === "maximum_added_theory_nodes")!;
  assert.equal(unconstrained.constraint_value, null);
  assert.equal(unconstrained.satisfies_constraint, null, "an unconstrained metric is neither passed nor failed");

  assert.deepEqual({ safety: base.safety, previews: base.previews }, before,
    "building a portfolio mutates no retained evidence");
});

test("an infeasible bound set names the binding bound instead of relaxing it", () => {
  const base = evidence();
  const measured = base.safety.candidates[0]!.scored_candidate.objective_quality.repertoire_pov_loss_from_best_cp!;
  const result = buildStrategicFitPortfolio({
    constraint_set: set({ ...LOOSE, maximum_engine_loss_cp: Math.max(0, measured - 1) }),
    safety: base.safety,
    previews: base.previews,
  });
  assert.equal(result.status, "infeasible");
  assert.deepEqual(result.options, []);
  assert.equal(result.omitted_option_count, 0);
  assert.deepEqual(result.binding_constraint_kinds, ["maximum_engine_loss_cp"]);
  assert.match(result.explanation, /Evaluation loss from best/);
  assert.match(result.explanation, /which bound to move/);
  assert.equal(result.eliminations.length, 1);
  assert.equal(result.eliminations[0]!.reason, "constraint-not-met");
  assert.deepEqual(result.eliminations[0]!.constraint_kinds, ["maximum_engine_loss_cp"]);
  assert.match(result.eliminations[0]!.explanation, new RegExp(`${measured} centipawns`));
});

test("a coverage floor above the measured coverage excludes the candidate rather than rounding to it", () => {
  const base = evidence();
  const thin = withClone(base, "candidate:thin-coverage", (candidate) => {
    (candidate.scored_candidate.strategic_score as { expected_opponent_coverage: number | null })
      .expected_opponent_coverage = 0.4;
  });
  const onlyThin = {
    safety: {
      ...thin.safety,
      candidates: thin.safety.candidates.filter((candidate) => candidate.candidate_id === "candidate:thin-coverage"),
    } as ReplacementSafetySimulationResult,
    previews: thin.previews,
  };
  const result = buildStrategicFitPortfolio({
    constraint_set: set({ minimum_expected_opponent_coverage: 0.9 }),
    safety: onlyThin.safety,
    previews: onlyThin.previews,
  });
  assert.equal(result.status, "infeasible");
  assert.deepEqual(result.binding_constraint_kinds, ["minimum_expected_opponent_coverage"]);
  assert.match(result.eliminations[0]!.explanation, /0\.4 share of expected opponent replies, outside the requested 0\.9/);

  const met = buildStrategicFitPortfolio({
    constraint_set: set({ minimum_expected_opponent_coverage: 0.4 }),
    safety: onlyThin.safety,
    previews: onlyThin.previews,
  });
  assert.equal(met.status, "available", "a floor exactly met is met");
});

test("two bounds missed at once leave no single binding bound to blame", () => {
  const base = evidence();
  const scored = base.safety.candidates[0]!.scored_candidate;
  const result = buildStrategicFitPortfolio({
    constraint_set: set({
      maximum_engine_loss_cp: Math.max(0, scored.objective_quality.repertoire_pov_loss_from_best_cp! - 1),
      maximum_added_theory_nodes: Math.max(0, scored.strategic_score.theory_nodes_added! - 1),
    }),
    safety: base.safety,
    previews: base.previews,
  });
  assert.equal(result.status, "infeasible");
  assert.deepEqual(result.binding_constraint_kinds, []);
  assert.match(result.explanation, /no single bound is responsible/);
  assert.deepEqual(result.eliminations[0]!.constraint_kinds,
    ["maximum_engine_loss_cp", "maximum_added_theory_nodes"]);
});

test("unmeasurable evidence never satisfies a bound", () => {
  const base = evidence();
  const withUnavailable = withClone(base, "candidate:unmeasured", (candidate) => {
    (candidate.scored_candidate.strategic_score as { memorization_burden: number | null })
      .memorization_burden = null;
  });
  const constrained = buildStrategicFitPortfolio({
    constraint_set: set({ maximum_memorization_burden: 10_000 }),
    safety: withUnavailable.safety,
    previews: withUnavailable.previews,
  });
  assert.deepEqual(constrained.options.map((option) => option.candidate_id), ["candidate:safe-replacement"]);
  const elimination = constrained.eliminations.find((entry) => entry.candidate_id === "candidate:unmeasured")!;
  assert.equal(elimination.reason, "unavailable-evidence");
  assert.deepEqual(elimination.constraint_kinds, ["maximum_memorization_burden"]);
  assert.match(elimination.explanation, /could not be measured/);

  const unconstrained = buildStrategicFitPortfolio({
    constraint_set: set({ maximum_engine_loss_cp: LOOSE.maximum_engine_loss_cp! }),
    safety: withUnavailable.safety,
    previews: withUnavailable.previews,
  });
  const option = unconstrained.options.find((entry) => entry.candidate_id === "candidate:unmeasured")!;
  const measurement = option.measurements.find((entry) => entry.kind === "maximum_memorization_burden")!;
  assert.equal(measurement.state, "unavailable");
  assert.equal(measurement.value, null);
  assert.equal(measurement.satisfies_constraint, null);
  assert.match(measurement.reason!, /Missing evidence cannot satisfy a bound/);
});

test("blocked, unscored, and unpreviewed candidates cannot become options", () => {
  const base = evidence();
  let combined = withClone(base, "candidate:blocked", (candidate) => {
    (candidate as { status: string }).status = "blocked";
  });
  combined = withClone(combined, "candidate:unscored", (candidate) => {
    (candidate.scored_candidate.pareto as { status: string }).status = "unscored";
  });
  combined = withClone(combined, "candidate:unpreviewed", (_candidate, item) => {
    (item as { status: string }).status = "rejected";
    (item as { change_set: unknown }).change_set = null;
  });
  const result = buildStrategicFitPortfolio({
    constraint_set: set(LOOSE),
    safety: combined.safety,
    previews: combined.previews,
  });
  assert.deepEqual(result.options.map((option) => option.candidate_id), ["candidate:safe-replacement"]);
  const reason = (candidateId: string) =>
    result.eliminations.find((entry) => entry.candidate_id === candidateId)!.reason;
  assert.equal(reason("candidate:blocked"), "blocked-safety-check");
  assert.equal(reason("candidate:unscored"), "unscored-candidate");
  assert.equal(reason("candidate:unpreviewed"), "no-validated-change-set");
  for (const elimination of result.eliminations) {
    assert.deepEqual(elimination.constraint_kinds, [],
      "a candidate the evidence itself excluded is never blamed on a bound the user chose");
  }
  assert.deepEqual(result.binding_constraint_kinds, []);
});

test("a portfolio without candidates reports unavailable evidence rather than an empty answer", () => {
  const base = evidence();
  const result = buildStrategicFitPortfolio({
    constraint_set: set(LOOSE),
    safety: { ...base.safety, candidates: [] } as ReplacementSafetySimulationResult,
    previews: [],
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.options, []);
  assert.match(result.explanation, /from chess knowledge/);
});

test("options and eliminations are bounded and disclose what they withheld", () => {
  const base = evidence();
  let many = base;
  for (let index = 0; index < STRATEGIC_FIT_PORTFOLIO_LIMITS.options + 2; index++) {
    many = withClone(many, `candidate:extra-${index}`, () => {});
  }
  const result = buildStrategicFitPortfolio({
    constraint_set: set(LOOSE),
    safety: many.safety,
    previews: many.previews,
    limit: 2,
  });
  assert.equal(result.options.length, 2);
  assert.equal(result.omitted_option_count, STRATEGIC_FIT_PORTFOLIO_LIMITS.options + 1);

  let blocked = base;
  for (let index = 0; index < STRATEGIC_FIT_PORTFOLIO_LIMITS.eliminations + 3; index++) {
    blocked = withClone(blocked, `candidate:blocked-${index}`, (candidate) => {
      (candidate as { status: string }).status = "blocked";
    });
  }
  const bounded = buildStrategicFitPortfolio({
    constraint_set: set(LOOSE),
    safety: blocked.safety,
    previews: blocked.previews,
  });
  assert.equal(bounded.eliminations.length, STRATEGIC_FIT_PORTFOLIO_LIMITS.eliminations);
  assert.equal(bounded.omitted_elimination_count, 3);
});

test("Pareto-optimal options are listed before dominated ones without re-racing the subset", () => {
  const base = evidence();
  const withDominated = withClone(base, "candidate:aaa-dominated", (candidate) => {
    (candidate.scored_candidate.pareto as { status: string }).status = "dominated";
    (candidate.scored_candidate.pareto as { dominated_by_candidate_ids: string[] })
      .dominated_by_candidate_ids = ["candidate:safe-replacement"];
  });
  const result = buildStrategicFitPortfolio({
    constraint_set: set(LOOSE),
    safety: withDominated.safety,
    previews: withDominated.previews,
  });
  assert.deepEqual(result.options.map((option) => option.option_id), [
    "strategic-fit-portfolio-option:candidate:safe-replacement",
    "strategic-fit-portfolio-option:candidate:aaa-dominated",
  ], "candidate order is deterministic and Pareto status ranks ahead of the identifier");
  assert.equal(result.options[1]!.pareto_status, "dominated");
  assert.deepEqual(result.options[1]!.dominated_by_candidate_ids, ["candidate:safe-replacement"],
    "domination is reported against the full generated set, not the constrained one");
});

test("the same bounds over the same evidence produce the same portfolio", () => {
  const base = evidence();
  const build = () => buildStrategicFitPortfolio({
    constraint_set: set(LOOSE),
    safety: base.safety,
    previews: base.previews,
  });
  assert.deepEqual(build(), build());
});

test("an option's change set stays atomic: a stale application changes nothing at all", () => {
  const fixture = replacementFixture("portfolio");
  const base = evidence();
  const option = buildStrategicFitPortfolio({
    constraint_set: set(LOOSE),
    safety: base.safety,
    previews: base.previews,
  }).options[0]!;
  const item = base.previews.find((entry) => entry.candidate_id === option.candidate_id)!;
  const changeSet = item.change_set!;
  assert.equal(changeSet.change_set_id, option.change_set_id);
  assert.ok(changeSet.operations.length > 1, "this option carries more than one change to roll back");

  const pgnBefore = fixture.tree.toPgn();
  const stale = applyReplacementChangeSet({
    source_tree: fixture.tree,
    current_repertoire_revision: "browser:moved-on",
    safety: base.safety,
    change_set: changeSet,
  });
  assert.notEqual(stale.status, "success");
  assert.equal(fixture.tree.toPgn(), pgnBefore,
    "a rejected multi-operation change set leaves no partial edit behind");

  const applied = applyReplacementChangeSet({
    source_tree: fixture.tree,
    current_repertoire_revision: fixture.request.repertoire_revision,
    safety: base.safety,
    change_set: changeSet,
  });
  assert.equal(applied.status, "success");
  assert.equal(fixture.tree.toPgn(), pgnBefore,
    "even a successful application produces a new tree rather than mutating the source");
});

test("validation failures map to one structured, code-bearing result", () => {
  const mapped = strategicFitPortfolioErrorResult(
    new StrategicFitPortfolioError("strategic_fit_portfolio_unknown_option", "no such option"),
  );
  assert.deepEqual(mapped, { error: "strategic_fit_portfolio_unknown_option", reason: "no such option" });
  assert.throws(() => strategicFitPortfolioErrorResult(new TypeError("unrelated")), TypeError,
    "an unrelated failure is not disguised as a portfolio error");
});

test("every constraint kind measures a metric the retained evidence actually reports", () => {
  const base = evidence();
  const result = buildStrategicFitPortfolio({
    constraint_set: set({ maximum_engine_loss_cp: LOOSE.maximum_engine_loss_cp! }),
    safety: base.safety,
    previews: base.previews,
  });
  const option = result.options[0]!;
  const measured = new Set(option.measurements
    .filter((measurement) => measurement.state === "available")
    .map((measurement) => measurement.kind as StrategicFitPortfolioConstraintKind));
  for (const kind of STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS) {
    assert.ok(measured.has(kind), `${kind} has no measurement in complete retained evidence`);
  }
});
