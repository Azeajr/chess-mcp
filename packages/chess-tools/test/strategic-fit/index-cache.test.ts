import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  StrategicFitIndexCache,
  analyzeStrategicFit,
  buildRepertoireGraph,
  completeStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
  strategicFitIndexGeneration,
  type AnalyzeStrategicFitOptions,
  type StrategicFitAnalysisManifest,
  type StrategicFitAnalysisResult,
  type StrategicFitManifestComponent,
  type StrategicFitRecomputationScope,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE, WHITE_TRANSPOSITION_FIXTURE } from "./fixtures.ts";

type Overrides = Omit<Partial<AnalyzeStrategicFitOptions>, "repertoireColor">;

function analyze(
  pgn: string,
  repertoireColor: "white" | "black",
  overrides: Overrides = {},
): StrategicFitAnalysisResult {
  return analyzeStrategicFit(GameTree.fromPgn(pgn), {
    repertoireColor,
    repertoireRevision: "rev-1",
    ...overrides,
  });
}

/** Equivalence is exact: the same values in the same order, not a tolerance. */
function assertIdentical(actual: StrategicFitAnalysisResult, expected: StrategicFitAnalysisResult): void {
  assert.deepStrictEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

const ENGLISH_LINE = "1. c4 e5 2. Nc3 Nf6 3. g3 d5 *";
const EDITED_ENGLISH_LINE = "1. c4 e5 2. Nc3 Nf6 3. g3 g6 *";

function editedBroadEcoPgn(): string {
  const edited = BROAD_ECO_FIXTURE.pgn.replace(ENGLISH_LINE, EDITED_ENGLISH_LINE);
  assert.notEqual(edited, BROAD_ECO_FIXTURE.pgn, "the fixture edit must change one line");
  return edited;
}

/** Build the affected-cohort scope exactly as the host's Task 6.4 comparison does. */
function affectedCohortScope(
  previous: StrategicFitAnalysisResult,
  previousPgn: string,
  currentPgn: string,
): StrategicFitRecomputationScope {
  const previousRoutes = buildRepertoireGraph(GameTree.fromPgn(previousPgn), "white").routes;
  const currentRoutes = new Set(
    buildRepertoireGraph(GameTree.fromPgn(currentPgn), "white").routes.map((route) => route.route_id),
  );
  const removed = previousRoutes
    .map((route) => route.route_id)
    .filter((routeId) => !currentRoutes.has(routeId));
  const cohortIds = previous.cohorts
    .filter((cohort) => cohort.route_ids.some((routeId) => removed.includes(routeId)))
    .map((cohort) => cohort.cohort_id);
  assert.ok(cohortIds.length > 0, "the edit must map to at least one prior cohort");
  return {
    kind: "affected-cohorts",
    cohort_ids: cohortIds,
    reason: "Changed semantic routes map to these prior cohorts.",
  };
}

test("an indexed analysis is identical to a full scan and reuses its own generation", () => {
  const cold = analyze(BROAD_ECO_FIXTURE.pgn, "white");
  const index = new StrategicFitIndexCache();

  const first = analyze(BROAD_ECO_FIXTURE.pgn, "white", { index });
  assertIdentical(first, cold);
  assert.equal(index.lastPlan?.mode, "full-scan");
  assert.match(index.lastPlan?.reason ?? "", /No prior index snapshot/);
  const afterFirst = index.stats;
  assert.ok(afterFirst.size > 0, "the first analysis must populate the index");

  const second = analyze(BROAD_ECO_FIXTURE.pgn, "white", { index });
  assertIdentical(second, cold);
  assert.ok(index.stats.hits > afterFirst.hits, "an unchanged document must reuse indexed values");
  assert.equal(index.stats.misses, afterFirst.misses, "an unchanged document must recompute nothing");
  assert.deepStrictEqual(index.lastPlan?.changed_route_ids, []);
});

test("an unrelated edit recomputes the affected cohort and reuses the cached ones", () => {
  const edited = editedBroadEcoPgn();
  const before = analyze(BROAD_ECO_FIXTURE.pgn, "white");
  const coldAfter = analyze(edited, "white", { repertoireRevision: "rev-2" });
  const scope = affectedCohortScope(before, BROAD_ECO_FIXTURE.pgn, edited);

  const index = new StrategicFitIndexCache();
  analyze(BROAD_ECO_FIXTURE.pgn, "white", { index });
  const warm = index.stats;

  const incremental = analyze(edited, "white", {
    repertoireRevision: "rev-2",
    index,
    recomputationScope: scope,
  });
  assertIdentical(incremental, coldAfter);

  const plan = index.lastPlan;
  assert.ok(plan, "an indexed run records its plan");
  assert.equal(plan.mode, "incremental");
  assert.deepStrictEqual(plan.recomputed_cohort_ids, [...scope.cohort_ids]);
  assert.equal(plan.reused_cohort_ids.length, before.cohorts.length - scope.cohort_ids.length);
  for (const cohortId of scope.cohort_ids) {
    assert.ok(!plan.reused_cohort_ids.includes(cohortId), "an affected cohort is never reused");
  }
  assert.equal(plan.reused_route_ids.length, before.trajectories.length - 1);
  assert.equal(plan.invalidated_entry_count, 1, "only the removed route's entry is dropped");
  assert.ok(
    index.stats.hits - warm.hits >= plan.reused_route_ids.length,
    "every unchanged route must answer from the index rather than recompute",
  );
});

test("an empty affected-cohort scope still recomputes the routes that changed", () => {
  const edited = editedBroadEcoPgn();
  const coldAfter = analyze(edited, "white", { repertoireRevision: "rev-2" });
  const index = new StrategicFitIndexCache();
  analyze(BROAD_ECO_FIXTURE.pgn, "white", { index });

  const incremental = analyze(edited, "white", {
    repertoireRevision: "rev-2",
    index,
    recomputationScope: {
      kind: "affected-cohorts",
      cohort_ids: [],
      reason: "A scope that claims no cohort was affected.",
    },
  });

  // The scope bounds claimed reuse; the content identity decides every returned value.
  assertIdentical(incremental, coldAfter);
  assert.equal(index.lastPlan?.recomputed_cohort_ids.length, 1);
  assert.equal(index.lastPlan?.changed_route_ids.length, 2);
});

test("transposing routes share one canonical position entry", () => {
  const cold = analyze(WHITE_TRANSPOSITION_FIXTURE.pgn, "white");
  const index = new StrategicFitIndexCache();
  const indexed = analyze(WHITE_TRANSPOSITION_FIXTURE.pgn, "white", { index });
  assertIdentical(indexed, cold);

  const routes = buildRepertoireGraph(GameTree.fromPgn(WHITE_TRANSPOSITION_FIXTURE.pgn), "white").routes;
  assert.equal(routes.length, 2);
  assert.equal(routes[0]!.terminal_position_id, routes[1]!.terminal_position_id);
  assert.notEqual(routes[0]!.route_id, routes[1]!.route_id);
  assert.ok(
    index.stats.hits > 0,
    "two move orders reaching one canonical position must extract its signals once",
  );
});

test("the index is explicitly bounded and evicts without changing results", () => {
  const cold = analyze(BROAD_ECO_FIXTURE.pgn, "white");
  const index = new StrategicFitIndexCache({ maximumEntries: 2 });
  const bounded = analyze(BROAD_ECO_FIXTURE.pgn, "white", { index });

  assertIdentical(bounded, cold);
  assert.equal(index.maximumEntries, 2);
  assert.ok(index.stats.size <= 2, "the bound holds during and after an analysis");
  assert.ok(index.stats.evictions > 0, "a bound smaller than the working set must evict");

  const repeated = analyze(BROAD_ECO_FIXTURE.pgn, "white", { index });
  assertIdentical(repeated, cold);
  assert.ok(index.stats.size <= 2);
});

test("an invalid index bound is rejected", () => {
  for (const maximumEntries of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => new StrategicFitIndexCache({ maximumEntries }),
      /strategic_fit_invalid_index_cache_size/,
    );
  }
});

test("every manifest version participates in the index generation", () => {
  const settings = { repertoire_color: "white" as const, trajectory: null, opening_table: [] };
  const base = strategicFitIndexGeneration(settings);

  const components = Object.keys(STRATEGIC_FIT_ANALYSIS_MANIFEST.components) as StrategicFitManifestComponent[];
  assert.ok(components.length > 0);
  for (const component of components) {
    const manifest: StrategicFitAnalysisManifest = {
      ...STRATEGIC_FIT_ANALYSIS_MANIFEST,
      components: { ...STRATEGIC_FIT_ANALYSIS_MANIFEST.components, [component]: "99.0.0" },
    };
    assert.notEqual(
      strategicFitIndexGeneration(settings, manifest),
      base,
      `advancing ${component} must retire the generation`,
    );
  }
  for (const field of ["schema_version", "analysis_version"] as const) {
    assert.notEqual(
      strategicFitIndexGeneration(settings, { ...STRATEGIC_FIT_ANALYSIS_MANIFEST, [field]: "99.0.0" }),
      base,
    );
  }
});

test("a deep-frozen cached report does not prevent later reuse of its indexed values", () => {
  // The MCP handle path freezes the analyzer result while the index still holds the same graph and
  // trajectory objects, so reuse must survive an immutable consumer.
  const index = new StrategicFitIndexCache();
  const first = completeStrategicFitReport(analyzeStrategicFit(
    GameTree.fromPgn(BROAD_ECO_FIXTURE.pgn),
    { ...strategicFitCompleteAnalysisOptions({ repertoireColor: "white", repertoireRevision: "mcp:1" }), index },
  ));
  assert.ok(Object.isFrozen(first));

  const later = { repertoireColor: "white" as const, repertoireRevision: "mcp:2" };
  const reused = completeStrategicFitReport(analyzeStrategicFit(
    GameTree.fromPgn(BROAD_ECO_FIXTURE.pgn),
    { ...strategicFitCompleteAnalysisOptions(later), index },
  ));
  const cold = completeStrategicFitReport(analyzeStrategicFit(
    GameTree.fromPgn(BROAD_ECO_FIXTURE.pgn),
    strategicFitCompleteAnalysisOptions(later),
  ));

  assert.deepStrictEqual(reused, cold);
  assert.equal(JSON.stringify(reused), JSON.stringify(cold));
  assert.ok(index.stats.hits > 0);
});

test("an analysis settings change retires the generation and recomputes", () => {
  const settings = { repertoire_color: "white" as const, trajectory: null, opening_table: [] };
  const base = strategicFitIndexGeneration(settings);
  assert.notEqual(strategicFitIndexGeneration({ ...settings, repertoire_color: "black" }), base);
  assert.notEqual(
    strategicFitIndexGeneration({ ...settings, trajectory: { configuredPlies: [6, 10] } }),
    base,
  );
  assert.notEqual(
    strategicFitIndexGeneration({ ...settings, opening_table: [["position", "A00", "Irregular"]] }),
    base,
  );

  const index = new StrategicFitIndexCache();
  analyze(BROAD_ECO_FIXTURE.pgn, "white", { index });
  const warm = index.stats;
  assert.ok(warm.size > 0);

  const trajectory = { configuredPlies: [6, 10] };
  const cold = analyze(BROAD_ECO_FIXTURE.pgn, "white", { trajectory });
  const afterSettingsChange = analyze(BROAD_ECO_FIXTURE.pgn, "white", { index, trajectory });

  assertIdentical(afterSettingsChange, cold);
  assert.notEqual(index.stats.generation, warm.generation);
  assert.ok(
    index.stats.invalidations >= warm.size,
    "a retired generation drops every entry it could have produced",
  );
  assert.equal(index.lastPlan?.mode, "full-scan");
  assert.deepStrictEqual(index.lastPlan?.reused_cohort_ids, []);
});
