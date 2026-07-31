import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  analyzeStrategicFit,
  buildRepertoireGraph,
  type StrategicFitAnalysisResult,
} from "@chess-mcp/chess-tools";
import {
  DECISION_FLOW_MINIMUM_SCALE,
  VIRTUAL_WINDOW_OVERSCAN,
  VISUALIZATION_RENDER_LIMITS,
  boundedWindow,
  clusterStrategicMapEdges,
  clusterStrategicMapPoints,
  decisionFlowScale,
  mergeDecisionFlowLinks,
  splitDecisionFlowColumn,
  virtualWindow,
  type ClusterablePoint,
  type MergeableFlowLink,
} from "../src/components/strategic-fit/visualization-limits.ts";
import { buildStrategicMapViewModel } from "../src/components/strategic-fit/StrategicMap.tsx";
import { buildDecisionFlowViewModel } from "../src/components/strategic-fit/DecisionFlow.tsx";

const RESOLUTIONS = ["unresolved-finding", "resolved-finding", "no-finding"] as const;

/** A 1,000-branch fixture spread across the plotted coordinate space by a deterministic sequence. */
function largePointFixture(count = 1_000): readonly ClusterablePoint[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `route:${String(index).padStart(4, "0")}`,
    cx: 8 + ((index * 37) % 84),
    cy: 8 + ((index * 53) % 84),
    weight: Math.round((0.001 + ((index * 7) % 100) / 1000) * 1000) / 1000,
    resolution: RESOLUTIONS[index % RESOLUTIONS.length]!,
    finding_ids: index % 5 === 0 ? [`finding:${index}`] : [],
  }));
}

test("a 1,000-point map fixture aggregates into a bounded, exactly reconciled set of clusters", () => {
  const points = largePointFixture();
  const started = Date.now();
  const clustering = clusterStrategicMapPoints(points, VISUALIZATION_RENDER_LIMITS.map_points);
  const elapsed = Date.now() - started;

  assert.equal(clustering.mode, "clusters");
  assert.equal(clustering.clustered_point_count, points.length);
  assert.ok(
    clustering.clusters.length <= clustering.grid_size * clustering.grid_size,
    "clusters never exceed the deterministic grid",
  );
  assert.ok(clustering.clusters.length < points.length, "aggregation must reduce drawn marks");
  assert.ok(elapsed < 1_000, `clustering 1,000 points took ${elapsed}ms`);

  const memberCount = clustering.clusters.reduce((sum, cluster) => sum + cluster.point_count, 0);
  assert.equal(memberCount, points.length, "every branch belongs to exactly one cluster");
  const memberIds = new Set(clustering.clusters.flatMap((cluster) => cluster.route_ids));
  assert.equal(memberIds.size, points.length, "no branch is duplicated or dropped");

  for (const cluster of clustering.clusters) {
    assert.equal(
      cluster.unresolved_count + cluster.resolved_count + cluster.no_finding_count,
      cluster.point_count,
      "resolution counts partition the cluster",
    );
    assert.ok(cluster.aria_label.includes(`${cluster.point_count} branches`));
    assert.ok(cluster.cx >= 0 && cluster.cx <= 100);
    assert.ok(cluster.cy >= 0 && cluster.cy <= 100);
  }

  for (const [index, cluster] of clustering.clusters.entries()) {
    for (const other of clustering.clusters.slice(index + 1)) {
      const distance = Math.hypot(cluster.cx - other.cx, cluster.cy - other.cy);
      assert.ok(
        distance >= cluster.radius + other.radius,
        `clusters ${cluster.cluster_id} and ${other.cluster_id} overlap and would steal each other's clicks`,
      );
    }
  }
});

test("map clustering is deterministic and orders clusters stably", () => {
  const first = clusterStrategicMapPoints(largePointFixture());
  const second = clusterStrategicMapPoints(largePointFixture());
  assert.deepEqual(
    first.clusters.map((cluster) => [cluster.cluster_id, cluster.cx, cluster.cy, cluster.point_count]),
    second.clusters.map((cluster) => [cluster.cluster_id, cluster.cx, cluster.cy, cluster.point_count]),
  );
  const ids = first.clusters.map((cluster) => cluster.cluster_id);
  assert.deepEqual(ids, [...ids].sort());
});

test("a set at or under the drawing limit keeps every point individually plotted", () => {
  const clustering = clusterStrategicMapPoints(
    largePointFixture(VISUALIZATION_RENDER_LIMITS.map_points),
  );
  assert.equal(clustering.mode, "points");
  assert.equal(clustering.clusters.length, 0);
});

test("clustered transposition lines merge between clusters and disclose the ones inside a cluster", () => {
  const points = largePointFixture();
  const clustering = clusterStrategicMapPoints(points);
  const clusterByRoute = new Map<string, string>();
  for (const cluster of clustering.clusters) {
    for (const routeId of cluster.route_ids) clusterByRoute.set(routeId, cluster.cluster_id);
  }
  const withinPair = clustering.clusters.find((cluster) => cluster.point_count >= 2)!;
  const edges = [
    { from_route_id: withinPair.route_ids[0]!, to_route_id: withinPair.route_ids[1]!, shared_position_count: 3 },
    { from_route_id: points[0]!.id, to_route_id: points[1]!.id, shared_position_count: 2 },
    { from_route_id: points[1]!.id, to_route_id: points[0]!.id, shared_position_count: 4 },
  ];
  const clustered = clusterStrategicMapEdges(edges, clustering.clusters);

  assert.equal(clustered.within_cluster_count, 1, "a link inside one cluster cannot be drawn");
  for (const edge of clustered.edges) {
    assert.notEqual(edge.from_cluster_id, edge.to_cluster_id);
  }
  const reciprocal = clustered.edges.find((edge) =>
    edge.from_cluster_id === clusterByRoute.get(points[0]!.id) ||
    edge.to_cluster_id === clusterByRoute.get(points[0]!.id)
  );
  assert.ok(reciprocal);
  assert.equal(reciprocal.edge_count, 2, "both directions merge into one drawn line");
  assert.equal(reciprocal.shared_position_count, 6, "shared positions are summed, not sampled");
});

test("a bounded window reports exactly what it withheld and expands without reordering", () => {
  const items = Array.from({ length: 250 }, (_unused, index) => index);
  const capped = boundedWindow(items, 100);
  assert.equal(capped.shown, 100);
  assert.equal(capped.total, 250);
  assert.equal(capped.withheld, 150);
  assert.equal(capped.complete, false);
  assert.deepEqual([...capped.items], items.slice(0, 100));

  const expanded = boundedWindow(items, 100, true);
  assert.equal(expanded.complete, true);
  assert.equal(expanded.withheld, 0);
  assert.deepEqual([...expanded.items], items);

  const small = boundedWindow(items.slice(0, 12), 100);
  assert.equal(small.complete, true);
  assert.equal(small.shown, 12);
});

test("a crowded flow column keeps its heaviest steps and folds only the lightest ones", () => {
  const column = Array.from({ length: 30 }, (_unused, index) => ({
    node_id: `node:${String(index).padStart(2, "0")}`,
    weight: index / 100,
  }));
  const limit = VISUALIZATION_RENDER_LIMITS.flow_nodes_per_column;
  const split = splitDecisionFlowColumn(column, limit, (node) => node.weight, (node) => node.node_id);

  assert.equal(split.rendered.length, limit - 1);
  assert.equal(split.aggregated.length, column.length - (limit - 1));
  const lightestRendered = Math.min(...split.rendered.map((node) => node.weight));
  const heaviestAggregated = Math.max(...split.aggregated.map((node) => node.weight));
  assert.ok(lightestRendered > heaviestAggregated, "aggregation takes the lightest steps");
  assert.deepEqual(
    split.rendered.map((node) => node.node_id),
    column.filter((node) => split.rendered.includes(node)).map((node) => node.node_id),
    "the drawn subset keeps the column's own order",
  );

  const under = splitDecisionFlowColumn(column.slice(0, limit), limit, (n) => n.weight, (n) => n.node_id);
  assert.equal(under.aggregated.length, 0);
  assert.equal(under.rendered.length, limit);
});

test("merging links onto an aggregate sums weight exactly and drops only collapsed self-links", () => {
  const links: readonly MergeableFlowLink[] = [
    { link_id: "l1", from_node_id: "a", to_node_id: "x", weight: 0.2, route_ids: ["r1"], finding_ids: ["f1"], truncated: false },
    { link_id: "l2", from_node_id: "a", to_node_id: "y", weight: 0.3, route_ids: ["r2"], finding_ids: [], truncated: true },
    { link_id: "l3", from_node_id: "x", to_node_id: "y", weight: 0.1, route_ids: ["r3"], finding_ids: [], truncated: false },
    { link_id: "l4", from_node_id: "b", to_node_id: "x", weight: 0.4, route_ids: ["r1", "r4"], finding_ids: ["f2"], truncated: false },
  ];
  const replacement = new Map([["x", "agg"], ["y", "agg"]]);
  const merged = mergeDecisionFlowLinks(links, replacement);

  assert.equal(merged.length, 2, "l3 collapsed inside the aggregate and a to b stayed distinct");
  const fromA = merged.find((link) => link.from_node_id === "a")!;
  assert.equal(fromA.to_node_id, "agg");
  assert.equal(Math.round(fromA.weight * 100) / 100, 0.5, "both steps into the aggregate are summed");
  assert.deepEqual([...fromA.merged_link_ids], ["l1", "l2"]);
  assert.deepEqual([...fromA.route_ids], ["r1", "r2"]);
  assert.deepEqual([...fromA.finding_ids], ["f1"]);
  assert.equal(fromA.truncated, true, "truncation of any merged step is kept");
  assert.equal(fromA.link_id, "aggregate-link:a|agg");

  const fromB = merged.find((link) => link.from_node_id === "b")!;
  assert.equal(fromB.link_id, "l4", "a single-member merge keeps its own identity");

  const untouched = mergeDecisionFlowLinks(links, new Map());
  assert.equal(untouched.length, links.length);
  assert.deepEqual(
    untouched.map((link) => link.link_id),
    links.map((link) => link.link_id),
  );
});

test("the flow scales to a measured container down to a legibility floor, then scrolls", () => {
  assert.equal(decisionFlowScale(800, 400), 1, "a chart that already fits is never enlarged");
  assert.equal(decisionFlowScale(400, 400), 1);
  assert.equal(decisionFlowScale(600, 800), 0.75, "a wide chart shrinks to the container");
  assert.equal(decisionFlowScale(400, 800), DECISION_FLOW_MINIMUM_SCALE, "shrinking stops at the floor");
  assert.equal(decisionFlowScale(320, 1_600), DECISION_FLOW_MINIMUM_SCALE);
  assert.equal(decisionFlowScale(null, 800), 1, "an unmeasured container renders unscaled");
  assert.equal(decisionFlowScale(0, 800), 1);
});

/** Four transposing Queen's Gambit move orders that share one cohort with branching columns. */
const BRANCHING_PGN = `[Event "Flow: move order A"]
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

function analyze(pgn: string, revision: string): StrategicFitAnalysisResult {
  return analyzeStrategicFit(GameTree.fromPgn(pgn), {
    repertoireColor: "white",
    repertoireRevision: revision,
  });
}

test("a crowded flow column aggregates while every step stays in the outline and shares still add up", () => {
  const revision = "revision:hardening-flow";
  const report = analyze(BRANCHING_PGN, revision);
  const view = buildDecisionFlowViewModel(report, {
    graph: buildRepertoireGraph(GameTree.fromPgn(BRANCHING_PGN), "white"),
    graphRevision: revision,
    cohortName: (cohortId) => `Cohort ${cohortId.slice(-4)}`,
    /** A deliberately small cap so real projection data exercises the aggregation path. */
    nodesPerColumn: 2,
  });

  assert.equal(view.projection.state, "available");
  const crowded = view.cohorts.find((cohort) => cohort.aggregates.length > 0);
  assert.ok(crowded, "the wide-reply fixture must produce at least one aggregated column");

  for (const aggregate of crowded.aggregates) {
    assert.ok(aggregate.member_node_ids.length >= 2, "a marker never stands in for one step");
    const members = crowded.nodes.filter((view) =>
      aggregate.member_node_ids.includes(view.node.node_id)
    );
    assert.equal(members.length, aggregate.member_node_ids.length);
    const memberWeight = members.reduce((sum, member) => sum + member.node.weight, 0);
    assert.ok(
      Math.abs(memberWeight - aggregate.weight) < 1e-9,
      "the marker's weight is the exact sum of its members",
    );
    for (const member of members) {
      assert.ok(
        !crowded.rendered_nodes.some((drawn) => drawn.node.node_id === member.node.node_id),
        "an aggregated step is not also drawn on its own",
      );
    }
  }

  const aggregatedCount = crowded.aggregates.reduce(
    (sum, aggregate) => sum + aggregate.member_node_ids.length,
    0,
  );
  assert.equal(
    crowded.rendered_nodes.length + aggregatedCount,
    crowded.nodes.length,
    "drawn plus aggregated accounts for every step",
  );
  assert.equal(
    crowded.nodes.length,
    view.projection.nodes.filter((node) => node.cohort_id === crowded.cohort.cohort_id).length,
    "the outline still carries the complete projection",
  );

  const drawnWeight = crowded.rendered_links.reduce((sum, link) => sum + link.weight, 0);
  const collapsed = crowded.links.filter((view) => {
    const inside = (nodeId: string) => crowded.aggregates.some((aggregate) =>
      aggregate.member_node_ids.includes(nodeId)
    );
    return inside(view.link.from_node_id) && inside(view.link.to_node_id) &&
      crowded.aggregates.some((aggregate) =>
        aggregate.member_node_ids.includes(view.link.from_node_id) &&
        aggregate.member_node_ids.includes(view.link.to_node_id)
      );
  });
  const collapsedWeight = collapsed.reduce((sum, view) => sum + view.link.weight, 0);
  const completeWeight = crowded.links.reduce((sum, view) => sum + view.link.weight, 0);
  assert.ok(
    Math.abs(drawnWeight - (completeWeight - collapsedWeight)) < 1e-9,
    "merging preserves total drawn weight apart from links collapsed inside one marker",
  );
  assert.ok(crowded.screen_reader_summary.includes("grouped into"));
});

test("a report under every cap renders individually and claims no aggregation", () => {
  const pgn = BRANCHING_PGN;
  const revision = "revision:hardening-small";
  const report = analyze(pgn, revision);

  const map = buildStrategicMapViewModel(report);
  const clustering = clusterStrategicMapPoints(map.points.map((view) => ({
    id: view.point.route_id,
    cx: view.cx,
    cy: view.cy,
    weight: view.point.normalized_weight,
    resolution: view.point.resolution,
    finding_ids: view.point.finding_ids,
  })));
  assert.equal(clustering.mode, "points");

  const flow = buildDecisionFlowViewModel(report, {
    graph: buildRepertoireGraph(GameTree.fromPgn(pgn), "white"),
    graphRevision: revision,
  });
  for (const cohort of flow.cohorts) {
    assert.equal(cohort.aggregates.length, 0);
    assert.equal(cohort.rendered_nodes.length, cohort.nodes.length);
    assert.equal(cohort.rendered_links.length, cohort.links.length);
    assert.ok(!cohort.screen_reader_summary.includes("grouped into"));
  }
});

test("a virtualized list mounts a bounded window of a complete list, however long it is", () => {
  const items = Array.from({ length: 5_000 }, (_unused, index) => `row:${index}`);
  const rowSize = 36;
  const top = virtualWindow(items, { rowSize, viewportSize: 400, scrollOffset: 0 });
  assert.equal(top.total, 5_000);
  assert.ok(
    top.mounted <= VISUALIZATION_RENDER_LIMITS.virtual_rows,
    "a virtualized list never mounts more rows than the mount cap",
  );
  assert.equal(top.start, 0);
  assert.equal(top.lead, 0);
  assert.equal(top.trail, (5_000 - top.mounted) * rowSize);
  assert.equal(top.complete, false);
  assert.deepEqual([...top.items], items.slice(0, top.mounted));

  // Scrolling moves the window without reordering, filtering, or losing a row.
  const middle = virtualWindow(items, { rowSize, viewportSize: 400, scrollOffset: 100 * rowSize });
  assert.equal(middle.start, 100 - VIRTUAL_WINDOW_OVERSCAN);
  assert.equal(middle.mounted, top.mounted);
  assert.equal(middle.lead, (100 - VIRTUAL_WINDOW_OVERSCAN) * rowSize);
  assert.equal(middle.lead + middle.mounted * rowSize + middle.trail, 5_000 * rowSize);
  assert.deepEqual(
    [...middle.items],
    items.slice(middle.start, middle.start + middle.mounted),
  );

  const end = virtualWindow(items, { rowSize, viewportSize: 400, scrollOffset: 5_000 * rowSize });
  assert.equal(end.start, 5_000 - end.mounted);
  assert.equal(end.trail, 0);
  assert.equal(end.items.at(-1), "row:4999", "the last row stays reachable by scrolling");

  // An unmeasured viewport still bounds the DOM rather than mounting the whole list.
  const unmeasured = virtualWindow(items, { rowSize, viewportSize: 0, scrollOffset: 0 });
  assert.equal(unmeasured.mounted, VISUALIZATION_RENDER_LIMITS.virtual_rows);

  const grid = virtualWindow(items, {
    rowSize,
    viewportSize: 4_000,
    scrollOffset: 0,
    maximumMounted: VISUALIZATION_RENDER_LIMITS.virtual_grid_rows,
  });
  assert.equal(grid.mounted, VISUALIZATION_RENDER_LIMITS.virtual_grid_rows);
});

test("a list that fits is mounted whole, with no spacers and no borrowed geometry", () => {
  const items = Array.from({ length: 12 }, (_unused, index) => index);
  const window = virtualWindow(items, { rowSize: 36, viewportSize: 800, scrollOffset: 0 });
  assert.equal(window.complete, true);
  assert.equal(window.mounted, 12);
  assert.equal(window.lead, 0);
  assert.equal(window.trail, 0);
  assert.equal(window.items, items);
});

test("mounted heatmap cells stay bounded by the row and column mount caps", () => {
  const rows = Array.from({ length: 900 }, (_unused, index) => `cohort:${index}`);
  const columns = Array.from({ length: 700 }, (_unused, index) => `concept:${index}`);
  const mountedRows = virtualWindow(rows, {
    rowSize: 36,
    viewportSize: 0,
    scrollOffset: 0,
    maximumMounted: VISUALIZATION_RENDER_LIMITS.virtual_grid_rows,
  });
  const mountedColumns = virtualWindow(columns, {
    rowSize: 132,
    viewportSize: 0,
    scrollOffset: 0,
    maximumMounted: VISUALIZATION_RENDER_LIMITS.virtual_columns,
  });
  assert.equal(
    mountedRows.mounted * mountedColumns.mounted,
    VISUALIZATION_RENDER_LIMITS.virtual_grid_rows * VISUALIZATION_RENDER_LIMITS.virtual_columns,
  );
  assert.ok(mountedRows.mounted * mountedColumns.mounted < rows.length * columns.length / 100);
});
