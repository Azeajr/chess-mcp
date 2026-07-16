import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildRepertoireGraph,
  buildStrategicTrajectories,
  selectStrategicCheckpoints,
  type StrategicSignal,
  type StrategicSnapshot,
  type StrategicTrajectory,
} from "../../src/index.ts";

function build(
  pgn: string,
  configuredPlies: readonly number[],
  repertoireColor: "white" | "black" = "white",
) {
  const graph = buildRepertoireGraph(GameTree.fromPgn(pgn), repertoireColor);
  const report = buildStrategicTrajectories(graph, { configuredPlies });
  assert.equal(report.trajectories.length, graph.routes.length);
  return { graph, report };
}

function onlyTrajectory(
  pgn: string,
  configuredPlies: readonly number[],
  repertoireColor: "white" | "black" = "white",
): StrategicTrajectory {
  const { report } = build(pgn, configuredPlies, repertoireColor);
  assert.equal(report.trajectories.length, 1);
  return report.trajectories[0]!;
}

function configuredSnapshot(trajectory: StrategicTrajectory, ply: number): StrategicSnapshot {
  const snapshot = trajectory.snapshots.find((candidate) =>
    candidate.checkpoint.kind === "configured-ply" && candidate.checkpoint.ply === ply
  );
  assert.ok(snapshot, `configured snapshot at ply ${ply}`);
  return snapshot;
}

function signalAt(
  snapshot: StrategicSnapshot,
  featureId: string,
  subject?: "repertoire" | "opponent",
): StrategicSignal {
  const signal = snapshot.signals.find((candidate) => {
    if (candidate.feature_id !== featureId) return false;
    if (!subject) return true;
    const value = candidate.value as Readonly<Record<string, unknown>>;
    return value.subject === subject;
  });
  assert.ok(signal, `${featureId}${subject ? `:${subject}` : ""}`);
  return signal;
}

function comparableEvidence(trajectory: StrategicTrajectory) {
  return trajectory.snapshots
    .filter((snapshot) => snapshot.checkpoint.comparability === "comparable")
    .map((snapshot) => ({
      kind: snapshot.checkpoint.kind,
      ply: snapshot.checkpoint.ply,
      position_id: snapshot.position_id,
      signals: snapshot.signals.map((signal) => ({
        feature_id: signal.feature_id,
        value: signal.value,
        confidence: signal.confidence,
        persistence: signal.persistence,
      })),
    }));
}

function persistenceSignature(snapshot: StrategicSnapshot) {
  return snapshot.signals.map((signal) => ({
    feature_id: signal.feature_id,
    persistence: signal.persistence,
  }));
}

test("terminal editing depth cannot change classification at matched checkpoints", () => {
  const short = onlyTrajectory(
    "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 *",
    [5, 7],
  );
  const deep = onlyTrajectory(
    "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bg5 O-O *",
    [5, 7],
  );

  assert.deepEqual(comparableEvidence(deep), comparableEvidence(short));
  assert.equal(deep.stable_signal_ids.length, short.stable_signal_ids.length);
  assert.equal(deep.transient_signal_ids.length, short.transient_signal_ids.length);
  assert.equal(deep.evidence_coverage, short.evidence_coverage);
  assert.equal(deep.snapshots.at(-1)!.checkpoint.kind, "final-valid-position");
  assert.equal(deep.snapshots.at(-1)!.checkpoint.comparability, "not-comparable");
  assert.ok(deep.snapshots.at(-1)!.signals.every((signal) => signal.persistence === "transient"));
});

test("temporary doubled pawns remain transient while persistent doubled pawns become stable", () => {
  const temporary = onlyTrajectory(
    "1. d4 d5 2. c4 e6 3. Nc3 Bb4 4. a3 Bxc3+ 5. bxc3 dxc4 6. e4 *",
    [9, 11],
  );
  const persistent = onlyTrajectory(
    "1. d4 d5 2. c4 e6 3. Nc3 Bb4 4. a3 Bxc3+ 5. bxc3 Nf6 6. e4 *",
    [9, 11],
  );

  const temporaryAtNine = signalAt(
    configuredSnapshot(temporary, 9),
    "pawn-topology.doubled-groups",
    "repertoire",
  );
  const temporaryAtEleven = signalAt(
    configuredSnapshot(temporary, 11),
    "pawn-topology.doubled-groups",
    "repertoire",
  );
  const persistentAtEleven = signalAt(
    configuredSnapshot(persistent, 11),
    "pawn-topology.doubled-groups",
    "repertoire",
  );

  assert.equal(temporaryAtNine.persistence, "transient");
  assert.equal(temporaryAtEleven.persistence, "transient");
  assert.deepEqual(
    (temporaryAtEleven.value as { observations: readonly unknown[] }).observations,
    [],
  );
  assert.equal(persistentAtEleven.persistence, "stable");
  assert.equal(
    (persistentAtEleven.value as { observations: readonly unknown[] }).observations.length,
    1,
  );
});

test("delayed castling transitions from stable absence to irreversible route history", () => {
  const trajectory = onlyTrajectory(
    "1. Nf3 d5 2. g3 Nf6 3. Bg2 e6 4. d3 Be7 5. O-O *",
    [5, 7, 9],
  );
  const before = signalAt(configuredSnapshot(trajectory, 5), "king.castling-history");
  const establishedAbsence = signalAt(configuredSnapshot(trajectory, 7), "king.castling-history");
  const after = signalAt(configuredSnapshot(trajectory, 9), "king.castling-history");

  assert.equal(before.persistence, "transient");
  assert.equal(establishedAbsence.persistence, "stable");
  assert.equal(after.persistence, "irreversible");
  assert.deepEqual((after.value as Readonly<Record<string, unknown>>).repertoire, {
    castled: true,
    side: "kingside",
    at_ply: 9,
  });

  for (const ply of [5, 7, 9]) {
    assert.equal(
      signalAt(configuredSnapshot(trajectory, ply), "piece.fianchetto-history").persistence,
      "irreversible",
    );
  }
});

test("a structure transition establishes a new state without erasing earlier evidence", () => {
  const trajectory = onlyTrajectory(
    "1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 *",
    [3, 5, 7, 9],
  );
  const observations = [3, 5, 7, 9].map((ply) => {
    const signal = signalAt(configuredSnapshot(trajectory, ply), "center-dynamics.openness");
    return {
      ply,
      state: (signal.value as Readonly<Record<string, unknown>>).state,
      persistence: signal.persistence,
    };
  });

  assert.deepEqual(observations, [
    { ply: 3, state: "closed", persistence: "transient" },
    { ply: 5, state: "closed", persistence: "stable" },
    { ply: 7, state: "semi-open", persistence: "transient" },
    { ply: 9, state: "semi-open", persistence: "stable" },
  ]);
});

test("incomplete routes disclose every missing checkpoint and evidence coverage", () => {
  const trajectory = onlyTrajectory("1. e4 e5 *", [4, 8]);

  assert.equal(trajectory.state, "incomplete");
  assert.equal(trajectory.evidence_coverage, 0);
  assert.deepEqual(
    trajectory.missing_checkpoints.map((checkpoint) => checkpoint.kind),
    [
      "opening-exit",
      "central-resolution",
      "irreversible-transformation",
      "configured-ply",
      "configured-ply",
    ],
  );
  assert.ok(trajectory.missing_checkpoints.some((checkpoint) => checkpoint.reason.includes("horizon 8")));
  assert.equal(trajectory.snapshots.length, 1);
  assert.equal(trajectory.snapshots[0]!.checkpoint.kind, "final-valid-position");
  assert.equal(trajectory.stable_signal_ids.length, 0);
  assert.equal(trajectory.transient_signal_ids.length, trajectory.snapshots[0]!.signals.length);
});

test("transposed routes align at the same positions and converge on equivalent stable evidence", () => {
  const pgn = `[Event "Move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. e3 O-O 6. Bd3 c6
7. O-O b6 8. b3 a6 9. a3 *

[Event "Move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. e3 O-O 6. Bd3 c6
7. O-O b6 8. b3 a6 9. a3 *`;
  const { report } = build(pgn, [7, 9, 11, 13, 15, 17]);
  assert.equal(report.trajectories.length, 2);
  const latest = report.trajectories.map((trajectory) => configuredSnapshot(trajectory, 17));

  assert.equal(latest[0]!.position_id, latest[1]!.position_id);
  assert.deepEqual(persistenceSignature(latest[0]!), persistenceSignature(latest[1]!));
  assert.equal(signalAt(latest[0]!, "piece.recurring-placements").persistence, "stable");
  assert.equal(signalAt(latest[1]!, "piece.recurring-placements").persistence, "stable");
});

test("trajectory IDs, ordering, confidence, provenance, and injected selections are deterministic", () => {
  const pgn = "1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 *";
  const graph = buildRepertoireGraph(GameTree.fromPgn(pgn), "white");
  const first = buildStrategicTrajectories(graph, { configuredPlies: [9, 3, 5, 7] });
  const second = buildStrategicTrajectories(graph, { configuredPlies: [3, 5, 7, 9] });
  const selection = selectStrategicCheckpoints(graph, { configuredPlies: [3, 5, 7, 9] });
  const injected = buildStrategicTrajectories(graph, { checkpointSelection: selection });

  assert.deepEqual(first, second);
  assert.deepEqual(injected, first);
  const trajectory = first.trajectories[0]!;
  assert.deepEqual(
    trajectory.snapshots.map((snapshot) => snapshot.checkpoint.ply),
    [...trajectory.snapshots.map((snapshot) => snapshot.checkpoint.ply)].sort((left, right) => left - right),
  );
  assert.ok(trajectory.snapshots.every((snapshot) =>
    snapshot.classifier_confidence >= 0 && snapshot.classifier_confidence <= 1
  ));
  assert.equal(first.provenance[0]?.source_id, "strategic-fit:trajectory");
  assert.ok(trajectory.provenance.some((source) => source.source_id === "strategic-fit:pawn-signals"));
  assert.ok(trajectory.provenance.some((source) => source.source_id === "strategic-fit:position-signals"));
});
