import assert from "node:assert/strict";
import test from "node:test";

import {
  DECISION_FLOW_PROJECTION_VERSION,
  GameTree,
  analyzeStrategicFit,
  buildDecisionFlowProjection,
  buildRepertoireGraph,
  type DecisionFlowProjection,
  type StrategicFitAnalysisResult,
  type StrategicFinding,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

/**
 * One comparable Queen's Gambit cohort with two converging move orders and two later opponent
 * choices, so the flow has real branch points, a real transposition, and one shared strategic end.
 */
const FORCED_DIVERSITY_PGN = `[Event "Flow: move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6 *

[Event "Flow: move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6 *

[Event "Flow: early h6"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 h6 6. Bh4 O-O 7. e3 b6 *

[Event "Flow: Nbd7 setup"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. Bg5 O-O 6. e3 Nbd7 7. Rc1 c6 *`;

const TRANSPOSITION_PGN = FORCED_DIVERSITY_PGN;

function analyze(pgn: string, revision: string): StrategicFitAnalysisResult {
  return analyzeStrategicFit(GameTree.fromPgn(pgn), {
    repertoireColor: "white",
    repertoireRevision: revision,
  });
}

function graphFor(pgn: string) {
  return buildRepertoireGraph(GameTree.fromPgn(pgn), "white");
}

function project(
  pgn: string,
  revision: string,
  overrides: {
    report?: (report: StrategicFitAnalysisResult) => StrategicFitAnalysisResult;
    findings?: readonly StrategicFinding[];
    graphRevision?: string | null;
    maxDepth?: number;
  } = {},
): { report: StrategicFitAnalysisResult; projection: DecisionFlowProjection } {
  const base = analyze(pgn, revision);
  const report = overrides.report ? overrides.report(base) : base;
  return {
    report,
    projection: buildDecisionFlowProjection(report, {
      graph: graphFor(pgn),
      graph_revision: overrides.graphRevision === undefined ? revision : overrides.graphRevision,
      findings: overrides.findings,
      max_depth: overrides.maxDepth,
    }),
  };
}

function analyzeFixture(revision = "revision:broad-eco"): StrategicFitAnalysisResult {
  return analyzeStrategicFit(parseStrategicFitFixture(BROAD_ECO_FIXTURE), {
    repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
    repertoireRevision: revision,
  });
}

test("the flow is deterministic, versioned, and its weights reconcile at every node", () => {
  const { report, projection } = project(FORCED_DIVERSITY_PGN, "revision:flow");
  const repeat = project(FORCED_DIVERSITY_PGN, "revision:flow").projection;

  assert.equal(projection.state, "available");
  assert.equal(projection.projection_version, DECISION_FLOW_PROJECTION_VERSION);
  assert.equal(projection.repertoire_revision, report.repertoire_revision);
  assert.deepEqual({ ...projection, report_id: null }, { ...repeat, report_id: null });
  assert.ok(projection.cohorts.length > 0);
  assert.ok(projection.nodes.length > 0);
  assert.ok(projection.links.length > 0);

  const weightsByCohort = new Map(
    report.cohorts.map((cohort) => [
      cohort.cohort_id,
      new Map(cohort.route_weights.map((weight) => [weight.route_id, weight.normalized_weight])),
    ]),
  );
  const nodesById = new Map(projection.nodes.map((node) => [node.node_id, node]));

  for (const node of projection.nodes) {
    const cohortWeights = weightsByCohort.get(node.cohort_id)!;
    const expected = node.route_ids.reduce(
      (sum, routeId) => sum + (cohortWeights.get(routeId) ?? 0),
      0,
    );
    assert.ok(
      Math.abs(node.weight - expected) < 1e-6,
      `${node.node_id} weight must equal its routes`,
    );
    assert.ok(node.route_ids.length > 0);
    assert.deepEqual([...node.route_ids], [...node.route_ids].sort());
  }

  for (const cohort of projection.cohorts) {
    const cohortNodes = projection.nodes.filter((node) => node.cohort_id === cohort.cohort_id);
    const cohortLinks = projection.links.filter((link) => link.cohort_id === cohort.cohort_id);
    const start = cohortNodes.find((node) => node.kind === "start")!;
    assert.equal(start.depth, 0);
    assert.ok(Math.abs(start.weight - cohort.total_weight) < 1e-6);

    for (const node of cohortNodes) {
      const outgoing = cohortLinks.filter((link) => link.from_node_id === node.node_id);
      const incoming = cohortLinks.filter((link) => link.to_node_id === node.node_id);
      const outgoingWeight = outgoing.reduce((sum, link) => sum + link.weight, 0);
      const incomingWeight = incoming.reduce((sum, link) => sum + link.weight, 0);
      if (node.kind !== "mode") {
        assert.ok(
          Math.abs(outgoingWeight - node.weight) < 1e-6,
          `${node.node_id} must pass on exactly the weight it receives`,
        );
      }
      if (node.kind !== "start") {
        assert.ok(
          Math.abs(incomingWeight - node.weight) < 1e-6,
          `${node.node_id} must receive exactly its own weight`,
        );
      }
      assert.equal(node.branching, outgoing.length > 1);
    }

    const modeWeight = cohortNodes
      .filter((node) => node.kind === "mode")
      .reduce((sum, node) => sum + node.weight, 0);
    assert.ok(
      Math.abs(modeWeight - cohort.total_weight) < 1e-6,
      "every expected game must arrive at a strategic mode outcome",
    );

    for (const link of cohortLinks) {
      const from = nodesById.get(link.from_node_id)!;
      const to = nodesById.get(link.to_node_id)!;
      assert.ok(to.depth > from.depth, "links must always run to a strictly deeper layer");
      assert.equal(link.link_id, `${link.from_node_id}->${link.to_node_id}`);
    }
  }
});

test("player and opponent decisions are labelled from canonical graph ownership", () => {
  const { projection } = project(FORCED_DIVERSITY_PGN, "revision:flow-actors");
  const graph = graphFor(FORCED_DIVERSITY_PGN);
  const decisions = new Map(graph.decisions.map((decision) => [decision.decision_id, decision]));

  const decisionNodes = projection.nodes.filter((node) => node.kind === "decision");
  assert.ok(decisionNodes.length > 0);
  for (const node of decisionNodes) {
    const decision = decisions.get(node.decision_id!)!;
    assert.equal(node.actor, decision.owner === "repertoire" ? "player" : "opponent");
    assert.equal(node.san, decision.san);
    assert.equal(node.from_position_id, decision.from_position_id);
    assert.ok(node.plies.length > 0);
  }
  assert.ok(decisionNodes.some((node) => node.actor === "player"));
  assert.ok(decisionNodes.some((node) => node.actor === "opponent"));
  for (const node of projection.nodes) {
    if (node.kind !== "decision") assert.equal(node.actor, "none");
  }

  const branchingSources = projection.nodes.filter((node) => node.branching);
  assert.ok(branchingSources.length > 0, "forced diversity requires at least one branch point");
  for (const source of branchingSources) {
    const successors = projection.links.filter((link) => link.from_node_id === source.node_id);
    assert.ok(successors.length > 1);
    const actors = new Set(
      successors.map(
        (link) => projection.nodes.find((node) => node.node_id === link.to_node_id)!.actor,
      ),
    );
    assert.equal(actors.size, 1, "a split offers one side's alternatives, never a mixed layer");
  }
});

test("a real transposition is marked only with canonical graph evidence and converging predecessors", () => {
  const { projection } = project(TRANSPOSITION_PGN, "revision:flow-transposition");
  const graph = graphFor(TRANSPOSITION_PGN);
  assert.ok(graph.transposition_links.length > 0, "fixture must produce a canonical transposition");

  const converging = projection.nodes.filter((node) => node.transposition !== null);
  assert.ok(converging.length > 0, "the converging decision must be marked");
  const linkPositions = new Set(graph.transposition_links.map((link) => link.position_id));
  for (const node of converging) {
    assert.equal(node.kind, "decision");
    assert.ok(linkPositions.has(node.transposition!.position_id));
    assert.equal(node.transposition!.position_id, node.from_position_id);
    assert.ok(node.transposition!.incoming_node_ids.length > 1);
    const incoming = projection.links.filter((link) => link.to_node_id === node.node_id);
    assert.deepEqual(
      [...node.transposition!.incoming_node_ids],
      [...new Set(incoming.map((link) => link.from_node_id))].sort(),
    );
  }
  for (const node of projection.nodes) {
    if (node.transposition !== null) continue;
    const incoming = new Set(
      projection.links
        .filter((link) => link.to_node_id === node.node_id)
        .map((link) => link.from_node_id),
    );
    assert.ok(
      node.kind !== "decision" ||
        incoming.size <= 1 ||
        !linkPositions.has(node.from_position_id ?? ""),
      "a decision with converging predecessors and canonical evidence must be marked",
    );
  }
});

test("causal ownership comes only from findings that name the exact decision", () => {
  const report = analyzeFixture("revision:flow-causality");
  const graph = buildRepertoireGraph(
    parseStrategicFitFixture(BROAD_ECO_FIXTURE),
    BROAD_ECO_FIXTURE.repertoireColor,
  );
  const projection = buildDecisionFlowProjection(report, {
    graph,
    graph_revision: report.repertoire_revision,
  });
  assert.equal(projection.state, "available");

  const findingsById = new Map(report.findings.map((finding) => [finding.finding_id, finding]));
  for (const node of projection.nodes) {
    if (node.kind !== "decision") {
      assert.equal(node.causality.label, "not-referenced");
      assert.equal(node.causality.controllability, null);
      assert.equal(node.causality.qualified, false);
      continue;
    }
    for (const findingId of node.causality.finding_ids) {
      const finding = findingsById.get(findingId)!;
      assert.ok(finding.evidence.causality.likely_causal_decision_ids.includes(node.decision_id!));
      assert.ok(finding.references.route_ids.some((routeId) => node.route_ids.includes(routeId)));
    }
    if (node.causality.label === "not-referenced") {
      assert.equal(node.causality.finding_ids.length, 0);
      assert.equal(node.causality.controllability, null);
      assert.ok(node.causality.reason !== null);
    } else {
      assert.ok(node.causality.finding_ids.length > 0);
    }
    if (node.causality.controllability === null && node.causality.label !== "not-referenced") {
      assert.equal(node.causality.qualified, true);
    }
  }
});

test("uncertain, conflicting, and low-confidence causal evidence stays visibly qualified", () => {
  const base = analyzeFixture("revision:flow-uncertain");
  const graph = buildRepertoireGraph(
    parseStrategicFitFixture(BROAD_ECO_FIXTURE),
    BROAD_ECO_FIXTURE.repertoireColor,
  );
  const seed = buildDecisionFlowProjection(base, {
    graph,
    graph_revision: base.repertoire_revision,
  });
  const decisionNode = seed.nodes.find(
    (node) => node.kind === "decision" && node.route_ids.length > 0,
  )!;
  const routeId = decisionNode.route_ids[0]!;
  const template = base.findings[0]!;
  const findingFor = (
    suffix: string,
    label: "mostly-player-controlled" | "shared-or-uncertain" | "mostly-opponent-forced",
    controllability: number | null,
    confidence: "low" | "high",
  ): StrategicFinding => ({
    ...template,
    finding_id: `finding:flow-${suffix}`,
    references: { ...template.references, route_ids: [routeId] },
    confidence: { ...template.confidence, label: confidence },
    evidence: {
      ...template.evidence,
      causality: {
        ...template.evidence.causality,
        label,
        controllability,
        likely_causal_decision_ids: [decisionNode.decision_id!],
      },
    },
  });
  const flowFor = (findings: readonly StrategicFinding[]) =>
    buildDecisionFlowProjection(base, {
      graph,
      graph_revision: base.repertoire_revision,
      findings,
    }).nodes.find((node) => node.node_id === decisionNode.node_id)!;

  const single = flowFor([findingFor("single", "mostly-player-controlled", 0.8, "high")]);
  assert.equal(single.causality.label, "mostly-player-controlled");
  assert.equal(single.causality.controllability, 0.8);
  assert.equal(single.causality.qualified, false);
  assert.deepEqual([...single.causality.finding_ids], ["finding:flow-single"]);

  const lowConfidence = flowFor([findingFor("low", "mostly-player-controlled", 0.8, "low")]);
  assert.equal(lowConfidence.causality.qualified, true);
  assert.ok(lowConfidence.causality.reason?.includes("low confidence"));

  const unsupported = flowFor([findingFor("null", "mostly-player-controlled", null, "high")]);
  assert.equal(unsupported.causality.controllability, null);
  assert.equal(unsupported.causality.qualified, true);

  const uncertain = flowFor([findingFor("uncertain", "shared-or-uncertain", 0.5, "high")]);
  assert.equal(uncertain.causality.label, "shared-or-uncertain");
  assert.equal(uncertain.causality.qualified, true);

  const conflicting = flowFor([
    findingFor("player", "mostly-player-controlled", 0.8, "high"),
    findingFor("opponent", "mostly-opponent-forced", 0.1, "high"),
  ]);
  assert.equal(conflicting.causality.label, "shared-or-uncertain");
  assert.equal(conflicting.causality.controllability, null);
  assert.equal(conflicting.causality.qualified, true);
  assert.deepEqual(
    [...conflicting.causality.finding_ids],
    ["finding:flow-opponent", "finding:flow-player"],
  );
  assert.ok(conflicting.causality.reason?.includes("disagree"));
});

test("nodes and links expose the findings of their routes for selection", () => {
  const report = analyzeFixture("revision:flow-selection");
  const graph = buildRepertoireGraph(
    parseStrategicFitFixture(BROAD_ECO_FIXTURE),
    BROAD_ECO_FIXTURE.repertoireColor,
  );
  const projection = buildDecisionFlowProjection(report, {
    graph,
    graph_revision: report.repertoire_revision,
  });
  const findingsByRoute = new Map<string, string[]>();
  for (const finding of report.findings) {
    for (const routeId of finding.references.route_ids) {
      findingsByRoute.set(routeId, [...(findingsByRoute.get(routeId) ?? []), finding.finding_id]);
    }
  }
  const expectedFor = (routeIds: readonly string[]) =>
    [...new Set(routeIds.flatMap((routeId) => findingsByRoute.get(routeId) ?? []))].sort();

  for (const node of projection.nodes) {
    assert.deepEqual([...node.finding_ids], expectedFor(node.route_ids));
  }
  for (const link of projection.links) {
    assert.deepEqual([...link.finding_ids], expectedFor(link.route_ids));
  }
  assert.ok(projection.nodes.some((node) => node.finding_ids.length > 0));

  const withoutFindings = buildDecisionFlowProjection(report, {
    graph,
    graph_revision: report.repertoire_revision,
    findings: [],
  });
  for (const node of withoutFindings.nodes) assert.deepEqual([...node.finding_ids], []);
  assert.deepEqual(
    withoutFindings.nodes.map((node) => [node.node_id, node.weight]),
    projection.nodes.map((node) => [node.node_id, node.weight]),
  );
});

test("routes are assigned to exactly one strategic mode without splitting their weight", () => {
  const { report, projection } = project(FORCED_DIVERSITY_PGN, "revision:flow-modes");
  const plotted = new Set(projection.nodes.flatMap((node) => node.route_ids));
  assert.equal(projection.mode_assignments.length, plotted.size);

  const modesByCohort = new Map(report.cohorts.map((cohort) => [cohort.cohort_id, cohort.modes]));
  for (const assignment of projection.mode_assignments) {
    const modes = modesByCohort.get(assignment.cohort_id) ?? [];
    const supporting = modes.filter((mode) =>
      mode.supporting_route_ids.includes(assignment.route_id),
    );
    if (assignment.mode_id === null) {
      assert.equal(supporting.length, 0);
      assert.equal(assignment.rule, "no-supporting-mode");
    } else {
      assert.ok(supporting.some((mode) => mode.mode_id === assignment.mode_id));
      assert.equal(
        assignment.rule,
        supporting.length === 1 ? "single-supporting-mode" : "heaviest-supporting-mode",
      );
      assert.equal(assignment.alternative_mode_ids.length, supporting.length - 1);
    }
    assert.ok(assignment.explanation.length > 0);
    const modeNode = projection.nodes.find(
      (node) =>
        node.cohort_id === assignment.cohort_id &&
        node.kind === "mode" &&
        node.mode_id === assignment.mode_id,
    )!;
    assert.ok(modeNode.route_ids.includes(assignment.route_id));
  }

  const cohort = report.cohorts[0]!;
  const [firstRoute, secondRoute] = [...cohort.route_ids].sort();
  const mode = (modeId: string, weight: number, routeIds: readonly string[]) => ({
    analysis_version: cohort.analysis_version,
    mode_id: modeId,
    cohort_id: cohort.cohort_id,
    representative_route_id: routeIds[0]!,
    supporting_route_ids: [...routeIds],
    concept_ids: [`concept:${modeId}`],
    normalized_weight: weight,
    effective_sample_size: 2,
    source: "inferred-medoid" as const,
    provenance: [],
  });
  const withModes = buildDecisionFlowProjection(
    {
      ...report,
      cohorts: report.cohorts.map((candidate) =>
        candidate.cohort_id === cohort.cohort_id
          ? {
              ...candidate,
              modes: [
                mode("mode:light", 0.3, [firstRoute!, secondRoute!]),
                mode("mode:heavy", 0.7, [secondRoute!]),
              ],
            }
          : candidate,
      ),
    },
    {
      graph: graphFor(FORCED_DIVERSITY_PGN),
      graph_revision: report.repertoire_revision,
    },
  );
  const byRoute = new Map(
    withModes.mode_assignments.map((assignment) => [assignment.route_id, assignment]),
  );
  assert.equal(byRoute.get(firstRoute!)!.mode_id, "mode:light");
  assert.equal(byRoute.get(firstRoute!)!.rule, "single-supporting-mode");
  assert.equal(byRoute.get(secondRoute!)!.mode_id, "mode:heavy");
  assert.equal(byRoute.get(secondRoute!)!.rule, "heaviest-supporting-mode");
  assert.deepEqual([...byRoute.get(secondRoute!)!.alternative_mode_ids], ["mode:light"]);

  const heavyNode = withModes.nodes.find((node) => node.mode_id === "mode:heavy")!;
  assert.deepEqual([...heavyNode.concept_ids], ["concept:mode:heavy"]);
  assert.ok(heavyNode.route_ids.includes(secondRoute!));
  assert.ok(!heavyNode.route_ids.includes(firstRoute!));
  const weights = new Map(
    cohort.route_weights.map((weight) => [weight.route_id, weight.normalized_weight]),
  );
  assert.ok(Math.abs(heavyNode.weight - (weights.get(secondRoute!) ?? 0)) < 1e-6);
});

test("the depth limit truncates the diagram, never the expected weight", () => {
  const full = project(FORCED_DIVERSITY_PGN, "revision:flow-depth").projection;
  const limited = project(FORCED_DIVERSITY_PGN, "revision:flow-depth", { maxDepth: 3 }).projection;

  assert.equal(limited.state, "available");
  assert.ok(limited.nodes.length < full.nodes.length);
  assert.ok(limited.truncations.length > 0);
  for (const truncation of limited.truncations) {
    assert.ok(truncation.omitted_decision_count > 0);
    assert.ok(truncation.explanation.length > 0);
  }
  assert.ok(limited.links.some((link) => link.truncated));
  assert.equal(full.truncations.length, 0);
  assert.ok(!full.links.some((link) => link.truncated));

  for (const cohort of limited.cohorts) {
    const start = limited.nodes.find(
      (node) => node.cohort_id === cohort.cohort_id && node.kind === "start",
    )!;
    const modeWeight = limited.nodes
      .filter((node) => node.cohort_id === cohort.cohort_id && node.kind === "mode")
      .reduce((sum, node) => sum + node.weight, 0);
    assert.ok(Math.abs(modeWeight - start.weight) < 1e-6);
    assert.ok(cohort.max_depth <= 4);
  }
});

test("a missing or stale graph and an empty report yield explicit unavailable projections", () => {
  const report = analyzeFixture("revision:flow-unavailable");
  const graph = buildRepertoireGraph(
    parseStrategicFitFixture(BROAD_ECO_FIXTURE),
    BROAD_ECO_FIXTURE.repertoireColor,
  );

  const missing = buildDecisionFlowProjection(report);
  assert.equal(missing.state, "unavailable");
  assert.ok(missing.reason?.includes("repertoire graph"));
  assert.equal(missing.nodes.length, 0);
  assert.equal(missing.links.length, 0);
  assert.ok(
    missing.provenance.some(
      (source) => source.kind === "repertoire" && source.state === "unavailable",
    ),
  );

  const stale = buildDecisionFlowProjection(report, {
    graph,
    graph_revision: "revision:something-else",
  });
  assert.equal(stale.state, "unavailable");
  assert.ok(stale.reason?.includes("revision:something-else"));
  assert.equal(stale.nodes.length, 0);
  const staleGraphSource = stale.provenance.find((source) => source.kind === "repertoire")!;
  assert.equal(staleGraphSource.state, "unavailable");
  assert.equal(staleGraphSource.snapshot, graph.graph_id);
  assert.ok(staleGraphSource.reason?.includes("revision:something-else"));

  const empty = buildDecisionFlowProjection(
    { ...report, cohorts: [], findings: [] },
    {
      graph,
      graph_revision: report.repertoire_revision,
    },
  );
  assert.equal(empty.state, "unavailable");
  assert.ok(empty.reason !== null);
  assert.equal(empty.cohorts.length, 0);
  assert.ok(
    empty.provenance.some((source) => source.kind === "repertoire" && source.state === "available"),
    "an accepted graph stays available even when the report has nothing to distribute",
  );
});

test("excluded cohorts, excluded routes, and unknown graph routes become structured exclusions", () => {
  const report = analyzeFixture("revision:flow-exclusions");
  const graph = buildRepertoireGraph(
    parseStrategicFitFixture(BROAD_ECO_FIXTURE),
    BROAD_ECO_FIXTURE.repertoireColor,
  );
  const excludedCohortId = report.cohorts[0]!.cohort_id;
  const lastCohort = report.cohorts.at(-1)!;
  const excludedRouteId = lastCohort.route_ids[0]!;
  const projection = buildDecisionFlowProjection(
    {
      ...report,
      cohorts: report.cohorts.map((cohort) => {
        if (cohort.cohort_id === excludedCohortId) return { ...cohort, state: "excluded" as const };
        if (cohort.cohort_id === lastCohort.cohort_id) {
          return { ...cohort, excluded_route_ids: [excludedRouteId] };
        }
        return cohort;
      }),
    },
    { graph, graph_revision: report.repertoire_revision },
  );

  assert.ok(!projection.nodes.some((node) => node.cohort_id === excludedCohortId));
  assert.ok(!projection.nodes.some((node) => node.route_ids.includes(excludedRouteId)));
  assert.ok(
    projection.exclusions.some(
      (exclusion) =>
        exclusion.cohort_id === excludedCohortId && exclusion.reason === "excluded-from-cohort",
    ),
  );
  assert.ok(
    projection.exclusions.some(
      (exclusion) =>
        exclusion.route_id === excludedRouteId && exclusion.reason === "excluded-from-cohort",
    ),
  );
  for (const exclusion of projection.exclusions) assert.ok(exclusion.explanation.length > 0);

  const missingRoutes = buildDecisionFlowProjection(report, {
    graph: { ...graph, routes: [] },
    graph_revision: report.repertoire_revision,
  });
  assert.equal(missingRoutes.state, "unavailable");
  assert.ok(
    missingRoutes.exclusions.every(
      (exclusion) =>
        exclusion.reason === "missing-graph-route" || exclusion.reason === "excluded-from-cohort",
    ),
  );
  assert.ok(
    missingRoutes.exclusions.some((exclusion) => exclusion.reason === "missing-graph-route"),
  );
});
