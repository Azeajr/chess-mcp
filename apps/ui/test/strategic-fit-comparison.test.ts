import assert from "node:assert/strict";
import test from "node:test";

import {
  CAUSAL_EVENT_KINDS,
  type CausalAttribution,
  type CheckpointComparabilityState,
  type StrategicCheckpointKind,
  type StrategicSnapshot,
  type StrategicTrajectory,
} from "@chess-mcp/chess-tools";
import {
  buildComparisonBoardsPresentation,
  type ComparisonFindingInput,
} from "../src/components/strategic-fit/ComparisonBoards.tsx";
import {
  buildCausalTimelinePresentation,
} from "../src/components/strategic-fit/CausalTimeline.tsx";

const FEN = "rnbqkbnr/pp1ppppp/5n2/2p5/4P3/2P5/PP1P1PPP/RNBQKBNR w KQkq - 1 3";

function snapshot(
  routeId: string,
  kind: StrategicCheckpointKind,
  ply: number,
  comparability: CheckpointComparabilityState = "comparable",
): StrategicSnapshot {
  return {
    analysis_version: "2.0.0",
    snapshot_id: `snapshot:${routeId}:${kind}:${ply}`,
    route_id: routeId,
    position_id: `position:${routeId}:${ply}`,
    fen: FEN,
    checkpoint: {
      analysis_version: "2.0.0",
      checkpoint_id: `checkpoint:${routeId}:${kind}:${ply}`,
      kind,
      ply,
      reason: `${kind} evidence for ${routeId}.`,
      comparability,
    },
    signals: [],
    classifier_confidence: 0.9,
    provenance: [],
  };
}

function trajectory(
  routeId: string,
  state: StrategicTrajectory["state"],
  snapshots: readonly StrategicSnapshot[],
  missing: StrategicTrajectory["missing_checkpoints"] = [],
): StrategicTrajectory {
  return {
    analysis_version: "2.0.0",
    trajectory_id: `trajectory:${routeId}`,
    route_id: routeId,
    state,
    snapshots,
    missing_checkpoints: missing,
    evidence_coverage: state === "complete" ? 1 : 0.5,
    stable_signal_ids: [],
    transient_signal_ids: [],
    provenance: [],
  };
}

const longPath = [
  "e4", "c5", "c3", "Nf6", "e5", "Nd5", "d4", "cxd4", "Nf3", "Nc6", "cxd4", "d6",
  "Bc4", "Nb6", "Bb5", "dxe5",
];

const finding: ComparisonFindingInput = {
  finding_id: "finding:comparison",
  references: {
    route_ids: ["affected:a", "affected:b", "affected:missing"],
    source_san_paths: [
      ["e4", "c5", "c3", "Nf6"],
      longPath,
      [],
    ],
  },
  evidence: {
    representative_route_ids: ["baseline:a", "baseline:missing"],
  },
};

const trajectories = [
  trajectory("affected:a", "complete", [
    snapshot("affected:a", "opening-exit", 5),
    snapshot("affected:a", "central-resolution", 9),
    snapshot("affected:a", "configured-ply", 12),
    snapshot("affected:a", "final-valid-position", 16, "not-comparable"),
  ]),
  trajectory("affected:b", "incomplete", [
    snapshot("affected:b", "opening-exit", 5),
    snapshot("affected:b", "central-resolution", 9, "incomplete"),
    snapshot("affected:b", "configured-ply", 14),
  ], [{
    kind: "irreversible-transformation",
    reason: "The affected route ended before an irreversible checkpoint.",
  }]),
  trajectory("baseline:a", "complete", [
    snapshot("baseline:a", "opening-exit", 7),
    snapshot("baseline:a", "central-resolution", 11),
    snapshot("baseline:a", "irreversible-transformation", 11),
    snapshot("baseline:a", "configured-ply", 12),
    snapshot("baseline:a", "final-valid-position", 18, "not-comparable"),
  ]),
];

test("comparison preserves every route and source path while preferring a genuinely matched milestone", () => {
  const presentation = buildComparisonBoardsPresentation(finding, trajectories, "black");
  assert.equal(presentation.orientation, "black");
  assert.deepEqual(presentation.affected_routes.map((route) => [route.route_id, route.state]), [
    ["affected:a", "complete"],
    ["affected:b", "incomplete"],
    ["affected:missing", "unavailable"],
  ]);
  assert.deepEqual(presentation.baseline_routes.map((route) => [route.route_id, route.state]), [
    ["baseline:a", "complete"],
    ["baseline:missing", "unavailable"],
  ]);
  assert.deepEqual(presentation.source_paths.map((source) => source.path), [
    ["e4", "c5", "c3", "Nf6"],
    longPath,
    [],
  ]);
  assert.equal(presentation.preferred_milestone_key, "opening-exit");
  assert.deepEqual(
    presentation.milestones.filter((milestone) => milestone.state === "matched").map((milestone) => milestone.key),
    ["opening-exit", "central-resolution", "configured-ply:12"],
  );
  assert.match(
    presentation.milestones.find((milestone) => milestone.key === "opening-exit")?.explanation ?? "",
    /Typical cohort ply 7.*affected branch ply 5/,
  );
  assert.equal(
    presentation.milestones.find((milestone) => milestone.key === "final-valid-position")?.state,
    "not-comparable",
  );
});

test("incomplete and mismatched route checkpoints never masquerade as synchronized boards", () => {
  const presentation = buildComparisonBoardsPresentation(
    finding,
    trajectories,
    "white",
    "affected:b",
    "baseline:a",
  );
  const incomplete = presentation.milestones.find((milestone) =>
    milestone.key === "central-resolution"
  );
  assert.equal(incomplete?.state, "incomplete");
  assert.equal(incomplete?.status_label, "Incomplete checkpoint evidence");

  const missing = presentation.milestones.find((milestone) =>
    milestone.key === "irreversible-transformation"
  );
  assert.equal(missing?.state, "incomplete");
  assert.match(missing?.status_label ?? "", /affected branch is missing/i);
  assert.match(missing?.explanation ?? "", /ended before an irreversible checkpoint/i);

  assert.deepEqual(
    presentation.milestones.filter((milestone) => milestone.key.startsWith("configured-ply"))
      .map((milestone) => [milestone.key, milestone.state]),
    [
      ["configured-ply:12", "incomplete"],
      ["configured-ply:14", "incomplete"],
    ],
  );

  const absent = buildComparisonBoardsPresentation(
    finding,
    trajectories,
    "white",
    "affected:missing",
    "baseline:missing",
  );
  assert.equal(absent.milestones.length, 1);
  assert.equal(absent.milestones[0]?.state, "unavailable");
});

test("causal timeline gives every event kind an explicit no-color label, icon, and pattern", () => {
  const attribution = {
    label: "shared-or-uncertain",
    explanation: "Several decisions interact.",
    timeline: CAUSAL_EVENT_KINDS.map((kind, index) => ({
      event_id: `event:${kind}`,
      kind,
      ply: index + 1,
      position_id: `position:${kind}`,
      decision_id: kind === "player-decision" ? "decision:player" : null,
      san: kind === "transposition" ? null : `move-${kind}`,
      explanation: `Canonical explanation for ${kind}.`,
    })),
  } satisfies Pick<CausalAttribution, "label" | "explanation" | "timeline">;
  const presentation = buildCausalTimelinePresentation(attribution);
  assert.equal(presentation.ownership, "Shared or uncertain ownership");
  assert.deepEqual(presentation.events.map((event) => event.kind), CAUSAL_EVENT_KINDS);
  assert.deepEqual(presentation.events.map((event) => event.label), [
    "Opponent divergence",
    "Player decision",
    "Irreversible event",
    "First strategic difference",
    "Difference becomes stable",
    "Transposition",
  ]);
  assert.equal(new Set(presentation.events.map((event) => event.marker)).size, 6);
  assert.equal(new Set(presentation.events.map((event) => event.pattern)).size, 6);
  assert.equal(presentation.events.at(-1)?.move, "No SAN move recorded");
});
