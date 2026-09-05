import type { RepertoireGraph, RepertoireGraphDecision } from "./graph.js";
import type {
  CausalControlLabel,
  StrategicCohort,
  StrategicFinding,
  StrategicFitSourceProvenance,
} from "./types.js";
import { assertDefined } from "../assert.js";

export const DECISION_FLOW_PROJECTION_VERSION = "1.0.0";

export const DECISION_FLOW_STATES = ["available", "unavailable"] as const;
export type DecisionFlowState = (typeof DECISION_FLOW_STATES)[number];

export const DECISION_FLOW_NODE_KINDS = ["start", "decision", "mode"] as const;
export type DecisionFlowNodeKind = (typeof DECISION_FLOW_NODE_KINDS)[number];

export const DECISION_FLOW_ACTORS = ["player", "opponent", "none"] as const;
export type DecisionFlowActor = (typeof DECISION_FLOW_ACTORS)[number];

export const DECISION_FLOW_CAUSAL_LABELS = [
  "mostly-opponent-forced",
  "shared-or-uncertain",
  "mostly-player-controlled",
  "unknown",
  "not-referenced",
] as const;
export type DecisionFlowCausalLabel = (typeof DECISION_FLOW_CAUSAL_LABELS)[number];

export const DECISION_FLOW_EXCLUSION_REASONS = [
  "excluded-from-cohort",
  "missing-graph-route",
  "cyclic-flow-evidence",
] as const;
export type DecisionFlowExclusionReason = (typeof DECISION_FLOW_EXCLUSION_REASONS)[number];

export const DECISION_FLOW_MODE_ASSIGNMENT_RULES = [
  "single-supporting-mode",
  "heaviest-supporting-mode",
  "no-supporting-mode",
] as const;
export type DecisionFlowModeAssignmentRule = (typeof DECISION_FLOW_MODE_ASSIGNMENT_RULES)[number];

export interface DecisionFlowCausality {
  readonly label: DecisionFlowCausalLabel;
  readonly controllability: number | null;
  readonly qualified: boolean;
  readonly finding_ids: readonly string[];
  readonly reason: string | null;
}

export interface DecisionFlowTransposition {
  readonly transposition_id: string;
  readonly position_id: string;
  readonly incoming_node_ids: readonly string[];
}

export interface DecisionFlowNode {
  readonly node_id: string;
  readonly kind: DecisionFlowNodeKind;
  readonly cohort_id: string;
  readonly actor: DecisionFlowActor;
  readonly depth: number;
  readonly weight: number;
  readonly decision_id: string | null;
  readonly from_position_id: string | null;
  readonly to_position_id: string | null;
  readonly san: string | null;
  readonly plies: readonly number[];
  readonly mode_id: string | null;
  readonly concept_ids: readonly string[];
  readonly branching: boolean;
  readonly transposition: DecisionFlowTransposition | null;
  readonly causality: DecisionFlowCausality;
  readonly route_ids: readonly string[];
  readonly finding_ids: readonly string[];
  readonly reason: string | null;
}

export interface DecisionFlowLink {
  readonly link_id: string;
  readonly cohort_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly weight: number;
  readonly route_ids: readonly string[];
  readonly finding_ids: readonly string[];
  readonly truncated: boolean;
}

export interface DecisionFlowModeAssignment {
  readonly route_id: string;
  readonly cohort_id: string;
  readonly mode_id: string | null;
  readonly alternative_mode_ids: readonly string[];
  readonly rule: DecisionFlowModeAssignmentRule;
  readonly explanation: string;
}

export interface DecisionFlowTruncation {
  readonly route_id: string;
  readonly cohort_id: string;
  readonly omitted_decision_count: number;
  readonly explanation: string;
}

export interface DecisionFlowExclusion {
  readonly route_id: string;
  readonly cohort_id: string;
  readonly reason: DecisionFlowExclusionReason;
  readonly explanation: string;
}

export interface DecisionFlowCohort {
  readonly cohort_id: string;
  readonly total_weight: number;
  readonly route_count: number;
  readonly node_count: number;
  readonly link_count: number;
  readonly mode_count: number;
  readonly max_depth: number;
  readonly branch_point_count: number;
}

export interface DecisionFlowProjection {
  readonly projection_version: string;
  readonly analysis_version: string;
  readonly graph_version: string | null;
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly state: DecisionFlowState;
  readonly reason: string | null;
  readonly cohorts: readonly DecisionFlowCohort[];
  readonly nodes: readonly DecisionFlowNode[];
  readonly links: readonly DecisionFlowLink[];
  readonly mode_assignments: readonly DecisionFlowModeAssignment[];
  readonly truncations: readonly DecisionFlowTruncation[];
  readonly exclusions: readonly DecisionFlowExclusion[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface DecisionFlowReportInput {
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly analysis_version: string;
  readonly cohorts: readonly StrategicCohort[];
  readonly findings: readonly StrategicFinding[];
}

export interface DecisionFlowOptions {
  readonly graph?: RepertoireGraph | null;
  readonly graph_revision?: string | null;
  readonly findings?: readonly StrategicFinding[];
  readonly max_depth?: number;
}

const DEFAULT_MAX_DEPTH = 24;

const FLOW_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:decision-flow",
  kind: "deterministic-core",
  state: "available",
  version: DECISION_FLOW_PROJECTION_VERSION,
  snapshot: null,
  reason: null,
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function graphProvenance(
  graph: RepertoireGraph | null,
  reason: string | null,
): StrategicFitSourceProvenance {
  if (graph === null || reason !== null) {
    return {
      source_id: "strategic-fit:repertoire-graph",
      kind: "repertoire",
      state: "unavailable",
      version: graph?.analysis_version ?? null,
      snapshot: graph?.graph_id ?? null,
      reason,
    };
  }
  return {
    source_id: "strategic-fit:repertoire-graph",
    kind: "repertoire",
    state: "available",
    version: graph.analysis_version,
    snapshot: graph.graph_id,
    reason: null,
  };
}

function unavailableProjection(
  input: DecisionFlowReportInput,
  graph: RepertoireGraph | null,
  reason: string,
  exclusions: readonly DecisionFlowExclusion[],
  graphReason: string | null = null,
): DecisionFlowProjection {
  return {
    projection_version: DECISION_FLOW_PROJECTION_VERSION,
    analysis_version: input.analysis_version,
    graph_version: graph?.analysis_version ?? null,
    report_id: input.report_id,
    repertoire_revision: input.repertoire_revision,
    state: "unavailable",
    reason,
    cohorts: [],
    nodes: [],
    links: [],
    mode_assignments: [],
    truncations: [],
    exclusions,
    provenance: [FLOW_PROVENANCE, graphProvenance(graph, graphReason)],
  };
}

interface MutableNode {
  readonly node_id: string;
  readonly kind: DecisionFlowNodeKind;
  readonly cohort_id: string;
  readonly actor: DecisionFlowActor;
  readonly decision_id: string | null;
  readonly from_position_id: string | null;
  readonly to_position_id: string | null;
  readonly san: string | null;
  readonly plies: readonly number[];
  readonly mode_id: string | null;
  readonly concept_ids: readonly string[];
  readonly reason: string | null;
  readonly route_ids: Set<string>;
}

interface MutableLink {
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly route_ids: Set<string>;
  truncated: boolean;
}

interface CohortFlow {
  readonly cohort_id: string;
  readonly nodes: Map<string, MutableNode>;
  readonly links: Map<string, MutableLink>;
  readonly startNodeId: string;
  readonly modeNodeIds: Set<string>;
}

function weightOf(routeIds: Iterable<string>, weights: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const routeId of [...routeIds].sort(compareStrings)) total += weights.get(routeId) ?? 0;
  return round(total);
}

function layerCohort(flow: CohortFlow): Map<string, number> | null {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const nodeId of flow.nodes.keys()) {
    incoming.set(nodeId, 0);
    outgoing.set(nodeId, []);
  }
  for (const link of flow.links.values()) {
    incoming.set(link.to_node_id, (incoming.get(link.to_node_id) ?? 0) + 1);
    assertDefined(outgoing.get(link.from_node_id)).push(link.to_node_id);
  }
  const depth = new Map<string, number>();
  const ready = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([nodeId]) => nodeId)
    .sort(compareStrings);
  for (const nodeId of ready) depth.set(nodeId, 0);
  let index = 0;
  while (index < ready.length) {
    const nodeId = assertDefined(ready[index]);
    index += 1;
    for (const nextId of [...assertDefined(outgoing.get(nodeId))].sort(compareStrings)) {
      depth.set(nextId, Math.max(depth.get(nextId) ?? 0, (depth.get(nodeId) ?? 0) + 1));
      const remaining = (incoming.get(nextId) ?? 0) - 1;
      incoming.set(nextId, remaining);
      if (remaining === 0) ready.push(nextId);
    }
  }
  return ready.length === flow.nodes.size ? depth : null;
}

function decisionActor(decision: RepertoireGraphDecision): DecisionFlowActor {
  return decision.owner === "repertoire" ? "player" : "opponent";
}

function causalityFor(
  decisionId: string,
  routeIds: ReadonlySet<string>,
  findings: readonly StrategicFinding[],
): DecisionFlowCausality {
  const attributing = findings
    .filter(
      (finding) =>
        finding.evidence.causality.likely_causal_decision_ids.includes(decisionId) &&
        finding.references.route_ids.some((routeId) => routeIds.has(routeId)),
    )
    .sort((left, right) => compareStrings(left.finding_id, right.finding_id));
  if (attributing.length === 0) {
    return {
      label: "not-referenced",
      controllability: null,
      qualified: false,
      finding_ids: [],
      reason:
        "No finding attributes a strategic difference to this decision, so no causal claim is made.",
    };
  }
  const findingIds = attributing.map((finding) => finding.finding_id);
  const labels = [...new Set(attributing.map((finding) => finding.evidence.causality.label))].sort(
    compareStrings,
  ) as readonly CausalControlLabel[];
  const lowConfidence = attributing.some((finding) => finding.confidence.label === "low");
  if (labels.length > 1) {
    return {
      label: "shared-or-uncertain",
      controllability: null,
      qualified: true,
      finding_ids: findingIds,
      reason: `Findings disagree about who controls this decision (${labels.join(", ")}), so ownership stays uncertain.`,
    };
  }
  const label = assertDefined(labels[0]);
  const single = attributing.length === 1 ? assertDefined(attributing[0]) : null;
  const controllability = single === null ? null : single.evidence.causality.controllability;
  const uncertainLabel = label === "shared-or-uncertain" || label === "unknown";
  const reasons: string[] = [];
  if (single === null) {
    reasons.push(
      "Several findings attribute a difference to this decision, so no single controllability value is claimed.",
    );
  } else if (controllability === null) {
    reasons.push("The attributing finding could not support a numerical controllability value.");
  }
  if (uncertainLabel) reasons.push("The causal evidence itself is shared or unknown.");
  if (lowConfidence) reasons.push("At least one attributing finding has low confidence.");
  return {
    label,
    controllability,
    qualified: uncertainLabel || controllability === null || lowConfidence,
    finding_ids: findingIds,
    reason: reasons.length === 0 ? null : reasons.join(" "),
  };
}

export function buildDecisionFlowProjection(
  input: DecisionFlowReportInput,
  options: DecisionFlowOptions = {},
): DecisionFlowProjection {
  const graph = options.graph ?? null;
  const findings = options.findings ?? input.findings;
  const maxDepth = Math.max(1, Math.trunc(options.max_depth ?? DEFAULT_MAX_DEPTH));
  if (graph === null) {
    const reason =
      "No repertoire graph was supplied, so the report's routes cannot be expanded into decisions.";
    return unavailableProjection(input, null, reason, [], reason);
  }
  const graphRevision = options.graph_revision ?? null;
  if (graphRevision !== null && graphRevision !== input.repertoire_revision) {
    const reason = `The supplied repertoire graph is at revision ${graphRevision} while this report is at ${input.repertoire_revision}, so its decisions cannot be attributed to this report.`;
    return unavailableProjection(input, graph, reason, [], reason);
  }

  const graphRoutes = new Map(graph.routes.map((route) => [route.route_id, route]));
  const graphDecisions = new Map(
    graph.decisions.map((decision) => [decision.decision_id, decision]),
  );
  const transpositionByPosition = new Map(
    graph.transposition_links.map((link) => [link.position_id, link]),
  );
  const sortedCohorts = [...input.cohorts].sort((left, right) =>
    compareStrings(left.cohort_id, right.cohort_id),
  );
  const findingsByRoute = new Map<string, string[]>();
  for (const finding of findings) {
    for (const routeId of finding.references.route_ids) {
      const existing = findingsByRoute.get(routeId);
      if (existing === undefined) findingsByRoute.set(routeId, [finding.finding_id]);
      else existing.push(finding.finding_id);
    }
  }
  const findingIdsFor = (routeIds: Iterable<string>): string[] =>
    [...new Set([...routeIds].flatMap((routeId) => findingsByRoute.get(routeId) ?? []))].sort(
      compareStrings,
    );

  const exclusions: DecisionFlowExclusion[] = [];
  const truncations: DecisionFlowTruncation[] = [];
  const modeAssignments: DecisionFlowModeAssignment[] = [];
  const nodes: DecisionFlowNode[] = [];
  const links: DecisionFlowLink[] = [];
  const cohortSummaries: DecisionFlowCohort[] = [];

  for (const cohort of sortedCohorts) {
    const excludedRoutes = new Set(cohort.excluded_route_ids);
    for (const routeId of [...excludedRoutes].sort(compareStrings)) {
      exclusions.push({
        route_id: routeId,
        cohort_id: cohort.cohort_id,
        reason: "excluded-from-cohort",
        explanation:
          "This route is excluded from its cohort's analysis, so it carries no expected games through the flow.",
      });
    }
    if (cohort.state === "excluded") {
      for (const routeId of [...cohort.route_ids].sort(compareStrings)) {
        if (excludedRoutes.has(routeId)) continue;
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "excluded-from-cohort",
          explanation: "This route's cohort is excluded from analysis, so it contributes no flow.",
        });
      }
      continue;
    }
    const weights = new Map(
      cohort.route_weights.map((weight) => [weight.route_id, weight.normalized_weight]),
    );
    const startNodeId = `${cohort.cohort_id}|start`;
    const flow: CohortFlow = {
      cohort_id: cohort.cohort_id,
      nodes: new Map(),
      links: new Map(),
      startNodeId,
      modeNodeIds: new Set(),
    };
    const sortedModes = [...cohort.modes].sort(
      (left, right) =>
        right.normalized_weight - left.normalized_weight ||
        compareStrings(left.mode_id, right.mode_id),
    );
    const plottedRouteIds: string[] = [];

    const ensureNode = (node: MutableNode): MutableNode => {
      const existing = flow.nodes.get(node.node_id);
      if (existing !== undefined) return existing;
      flow.nodes.set(node.node_id, node);
      return node;
    };
    const linkNodes = (fromId: string, toId: string, routeId: string, truncated: boolean) => {
      const linkId = `${fromId}->${toId}`;
      const existing = flow.links.get(linkId);
      if (existing === undefined) {
        flow.links.set(linkId, {
          from_node_id: fromId,
          to_node_id: toId,
          route_ids: new Set([routeId]),
          truncated,
        });
        return;
      }
      existing.route_ids.add(routeId);
      if (truncated) existing.truncated = true;
    };

    for (const routeId of [...cohort.route_ids].sort(compareStrings)) {
      if (excludedRoutes.has(routeId)) continue;
      const graphRoute = graphRoutes.get(routeId);
      if (graphRoute === undefined) {
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "missing-graph-route",
          explanation:
            "The supplied repertoire graph has no route with this identity, so its decisions cannot be shown.",
        });
        continue;
      }
      plottedRouteIds.push(routeId);
      ensureNode({
        node_id: startNodeId,
        kind: "start",
        cohort_id: cohort.cohort_id,
        actor: "none",
        decision_id: null,
        from_position_id: null,
        to_position_id: graph.root_position_id,
        san: null,
        plies: [],
        mode_id: null,
        concept_ids: [],
        reason: null,
        route_ids: new Set(),
      }).route_ids.add(routeId);

      const supporting = sortedModes.filter((mode) => mode.supporting_route_ids.includes(routeId));
      const chosen = supporting[0] ?? null;
      modeAssignments.push({
        route_id: routeId,
        cohort_id: cohort.cohort_id,
        mode_id: chosen?.mode_id ?? null,
        alternative_mode_ids: supporting
          .slice(1)
          .map((mode) => mode.mode_id)
          .sort(compareStrings),
        rule:
          chosen === null
            ? "no-supporting-mode"
            : supporting.length === 1
              ? "single-supporting-mode"
              : "heaviest-supporting-mode",
        explanation:
          chosen === null
            ? "No strategic mode of this cohort supports this route, so it flows into an explicit unassigned outcome."
            : supporting.length === 1
              ? "Exactly one strategic mode supports this route."
              : "Several strategic modes support this route; the heaviest one receives its full weight rather than splitting it.",
      });
      const modeNodeId = `${cohort.cohort_id}|mode:${chosen?.mode_id ?? "none"}`;
      flow.modeNodeIds.add(modeNodeId);
      ensureNode({
        node_id: modeNodeId,
        kind: "mode",
        cohort_id: cohort.cohort_id,
        actor: "none",
        decision_id: null,
        from_position_id: null,
        to_position_id: null,
        san: null,
        plies: [],
        mode_id: chosen?.mode_id ?? null,
        concept_ids: chosen === null ? [] : [...chosen.concept_ids].sort(compareStrings),
        reason:
          chosen === null ? "These branches share no strategic mode inside their cohort." : null,
        route_ids: new Set(),
      }).route_ids.add(routeId);

      const keptDecisionIds = graphRoute.decision_ids.slice(0, maxDepth);
      const omitted = graphRoute.decision_ids.length - keptDecisionIds.length;
      if (omitted > 0) {
        truncations.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          omitted_decision_count: omitted,
          explanation: `This branch continues for ${omitted} more ${omitted === 1 ? "decision" : "decisions"} beyond the flow depth limit; its full weight still reaches its strategic mode.`,
        });
      }
      let previousNodeId = startNodeId;
      for (const decisionId of keptDecisionIds) {
        const decision = graphDecisions.get(decisionId);
        if (decision === undefined) continue;
        const nodeId = `${cohort.cohort_id}|decision:${decisionId}`;
        ensureNode({
          node_id: nodeId,
          kind: "decision",
          cohort_id: cohort.cohort_id,
          actor: decisionActor(decision),
          decision_id: decisionId,
          from_position_id: decision.from_position_id,
          to_position_id: decision.to_position_id,
          san: decision.san,
          plies: [...decision.plies].sort((left, right) => left - right),
          mode_id: null,
          concept_ids: [],
          reason: null,
          route_ids: new Set(),
        }).route_ids.add(routeId);
        linkNodes(previousNodeId, nodeId, routeId, false);
        previousNodeId = nodeId;
      }
      linkNodes(previousNodeId, modeNodeId, routeId, omitted > 0);
    }

    if (plottedRouteIds.length === 0) continue;

    const depths = layerCohort(flow);
    if (depths === null) {
      for (const routeId of plottedRouteIds) {
        exclusions.push({
          route_id: routeId,
          cohort_id: cohort.cohort_id,
          reason: "cyclic-flow-evidence",
          explanation:
            "This cohort's routes revisit a semantic position, so a layered flow would misstate move order.",
        });
      }
      continue;
    }

    const incomingByNode = new Map<string, Set<string>>();
    const outgoingCount = new Map<string, number>();
    for (const link of flow.links.values()) {
      const incoming = incomingByNode.get(link.to_node_id) ?? new Set<string>();
      incoming.add(link.from_node_id);
      incomingByNode.set(link.to_node_id, incoming);
      outgoingCount.set(link.from_node_id, (outgoingCount.get(link.from_node_id) ?? 0) + 1);
    }

    const cohortNodes: DecisionFlowNode[] = [...flow.nodes.values()]
      .map((node) => {
        const routeIds = [...node.route_ids].sort(compareStrings);
        const incoming = [...(incomingByNode.get(node.node_id) ?? new Set<string>())].sort(
          compareStrings,
        );
        const canonical =
          node.from_position_id === null
            ? undefined
            : transpositionByPosition.get(node.from_position_id);
        return {
          node_id: node.node_id,
          kind: node.kind,
          cohort_id: node.cohort_id,
          actor: node.actor,
          depth: depths.get(node.node_id) ?? 0,
          weight: weightOf(routeIds, weights),
          decision_id: node.decision_id,
          from_position_id: node.from_position_id,
          to_position_id: node.to_position_id,
          san: node.san,
          plies: node.plies,
          mode_id: node.mode_id,
          concept_ids: node.concept_ids,
          branching: (outgoingCount.get(node.node_id) ?? 0) > 1,
          transposition:
            node.kind === "decision" && canonical !== undefined && incoming.length > 1
              ? {
                  transposition_id: canonical.transposition_id,
                  position_id: canonical.position_id,
                  incoming_node_ids: incoming,
                }
              : null,
          causality:
            node.decision_id === null
              ? {
                  label: "not-referenced" as const,
                  controllability: null,
                  qualified: false,
                  finding_ids: [],
                  reason: "Only decisions carry causal ownership.",
                }
              : causalityFor(node.decision_id, node.route_ids, findings),
          route_ids: routeIds,
          finding_ids: findingIdsFor(routeIds),
          reason: node.reason,
        };
      })
      .sort(
        (left, right) => left.depth - right.depth || compareStrings(left.node_id, right.node_id),
      );

    const cohortLinks: DecisionFlowLink[] = [...flow.links.values()]
      .map((link) => {
        const routeIds = [...link.route_ids].sort(compareStrings);
        return {
          link_id: `${link.from_node_id}->${link.to_node_id}`,
          cohort_id: cohort.cohort_id,
          from_node_id: link.from_node_id,
          to_node_id: link.to_node_id,
          weight: weightOf(routeIds, weights),
          route_ids: routeIds,
          finding_ids: findingIdsFor(routeIds),
          truncated: link.truncated,
        };
      })
      .sort(
        (left, right) =>
          compareStrings(left.from_node_id, right.from_node_id) ||
          compareStrings(left.to_node_id, right.to_node_id),
      );

    nodes.push(...cohortNodes);
    links.push(...cohortLinks);
    cohortSummaries.push({
      cohort_id: cohort.cohort_id,
      total_weight: weightOf(plottedRouteIds, weights),
      route_count: plottedRouteIds.length,
      node_count: cohortNodes.length,
      link_count: cohortLinks.length,
      mode_count: flow.modeNodeIds.size,
      max_depth: cohortNodes.reduce((maximum, node) => Math.max(maximum, node.depth), 0),
      branch_point_count: cohortNodes.filter((node) => node.branching).length,
    });
  }

  exclusions.sort(
    (left, right) =>
      compareStrings(left.cohort_id, right.cohort_id) ||
      compareStrings(left.route_id, right.route_id),
  );
  truncations.sort(
    (left, right) =>
      compareStrings(left.cohort_id, right.cohort_id) ||
      compareStrings(left.route_id, right.route_id),
  );
  modeAssignments.sort(
    (left, right) =>
      compareStrings(left.cohort_id, right.cohort_id) ||
      compareStrings(left.route_id, right.route_id),
  );

  if (cohortSummaries.length === 0) {
    return unavailableProjection(
      input,
      graph,
      "No analyzable cohort route survives into the flow, so no expected games can be distributed.",
      exclusions,
    );
  }

  return {
    projection_version: DECISION_FLOW_PROJECTION_VERSION,
    analysis_version: input.analysis_version,
    graph_version: graph.analysis_version,
    report_id: input.report_id,
    repertoire_revision: input.repertoire_revision,
    state: "available",
    reason: null,
    cohorts: cohortSummaries,
    nodes,
    links,
    mode_assignments: modeAssignments,
    truncations,
    exclusions,
    provenance: [FLOW_PROVENANCE, graphProvenance(graph, null)],
  };
}
