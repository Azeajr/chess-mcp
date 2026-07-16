import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPawnSignalsFromFen,
  type PawnSignalFeatureId,
  type PawnSignalReport,
  type PawnSignalSubject,
  type PawnSignalValueMap,
  type PawnStrategicSignal,
} from "../../src/index.ts";

const FENS = {
  iqp: "r1bqkb1r/pp3ppp/2n2n2/8/3P4/2NB1N2/PP3PPP/R1BQK2R w KQkq - 0 1",
  hanging: "rnb2rk1/p3qpp1/7p/2pp4/8/4PN2/PP2BPPP/R2QK2R w KQ - 0 13",
  carlsbad: "r1bqkb1r/pp3ppp/2p2n2/3p4/3P4/2NB1N2/PP3PPP/R1BQK2R w KQkq - 0 1",
  maroczy: "r1bqkbnr/pp1p1ppp/2n5/8/2P1P3/8/PP3PPP/RNBQKBNR w KQkq - 0 1",
  hedgehog: "rnbqkb1r/5ppp/pp1ppn2/8/2PNP3/2N5/PP2BPPP/R1BQK2R w KQkq - 0 8",
} as const;

function findSignal<F extends PawnSignalFeatureId>(
  report: PawnSignalReport,
  featureId: F,
  subject?: PawnSignalSubject,
): PawnStrategicSignal<F> {
  const signal = report.signals.find((candidate) => {
    if (candidate.feature_id !== featureId) return false;
    if (subject === undefined) return true;
    const value = candidate.value as { subject?: PawnSignalSubject };
    return value.subject === subject;
  });
  assert.ok(signal, `${featureId}${subject === undefined ? "" : ` (${subject})`}`);
  return signal as PawnStrategicSignal<F>;
}

function value<F extends PawnSignalFeatureId>(
  report: PawnSignalReport,
  featureId: F,
  subject?: PawnSignalSubject,
): PawnSignalValueMap[F] {
  return findSignal(report, featureId, subject).value;
}

test("major named formations retain classifier confidence and provenance", () => {
  const expected = [
    [FENS.iqp, "iqp", "IQP"],
    [FENS.hanging, "hanging-pawns", "Hanging pawns"],
    [FENS.carlsbad, "carlsbad", "Carlsbad"],
    [FENS.maroczy, "maroczy", "Maroczy"],
    [FENS.hedgehog, "hedgehog", "Hedgehog"],
  ] as const;

  for (const [fen, formationId, label] of expected) {
    const signal = findSignal(
      extractPawnSignalsFromFen(fen, "white"),
      "pawn-topology.named-formation",
    );
    assert.deepEqual(signal.value, { formation_id: formationId, classifier_label: label });
    assert.ok(signal.confidence > 0 && signal.confidence <= 1, label);
    assert.equal(signal.kind, "observation");
    assert.equal(signal.persistence, "unknown");
    assert.ok(signal.provenance.some((source) => source.kind === "structure-classifier"));
  }
});

test("pawn islands, connected groups, chains, and backward candidates are descriptive observations", () => {
  const fen = "4k3/8/8/2p1p3/2P1P3/3P4/8/4K3 w - - 0 1";
  const report = extractPawnSignalsFromFen(fen, "white");

  const islands = value(report, "pawn-topology.islands", "repertoire");
  assert.deepEqual(islands.observations, [{ files: ["c", "d", "e"], squares: ["c4", "d3", "e4"] }]);

  const connected = value(report, "pawn-topology.connected-groups", "repertoire");
  assert.deepEqual(connected.observations, [{ squares: ["c4", "d3", "e4"], connection: "chain" }]);
  assert.deepEqual(value(report, "pawn-topology.chains", "repertoire").observations, [
    ["c4", "d3", "e4"],
  ]);

  const backward = findSignal(report, "pawn-topology.backward-candidates", "repertoire");
  assert.equal(backward.confidence, 0.7);
  assert.deepEqual(
    backward.value.observations.find((candidate) => candidate.square === "d3"),
    {
      square: "d3",
      advance_square: "d4",
      advance_blocked: false,
      advance_controlled_by_opponent_pawn: true,
    },
  );
  assert.equal(backward.persistence, "unknown");
});

test("temporary doubled pawns disappear without being mislabeled irreversible", () => {
  const doubledFen = "4k3/8/8/8/8/2P5/2P5/4K3 w - - 0 1";
  const resolvedFen = "4k3/8/8/8/8/2P5/8/4K3 w - - 0 1";
  const doubled = findSignal(
    extractPawnSignalsFromFen(doubledFen, "white"),
    "pawn-topology.doubled-groups",
    "repertoire",
  );
  const resolved = findSignal(
    extractPawnSignalsFromFen(resolvedFen, "white"),
    "pawn-topology.doubled-groups",
    "repertoire",
  );

  assert.deepEqual(doubled.value.observations, [{ squares: ["c2", "c3"], mobility: "mobile" }]);
  assert.equal(doubled.persistence, "unknown");
  assert.deepEqual(resolved.value.observations, []);
  assert.equal(resolved.persistence, "unknown");

  const staticFen = "4k3/8/8/2p5/2P5/2P5/8/4K3 w - - 0 1";
  assert.deepEqual(
    value(
      extractPawnSignalsFromFen(staticFen, "white"),
      "pawn-topology.doubled-groups",
      "repertoire",
    ).observations,
    [{ squares: ["c3", "c4"], mobility: "static" }],
  );
});

test("locked and fluid centers remain separate observations", () => {
  const locked = extractPawnSignalsFromFen(
    "4k3/8/4p3/3pP3/3P4/8/8/4K3 w - - 0 1",
    "white",
  );
  assert.equal(value(locked, "center-dynamics.openness").state, "closed");
  assert.deepEqual(value(locked, "center-dynamics.fixity"), {
    state: "fixed",
    fixed_pairs: [
      { white_pawn: "d4", black_pawn: "d5" },
      { white_pawn: "e5", black_pawn: "e6" },
    ],
  });
  assert.equal(value(locked, "center-dynamics.fluidity").state, "fixed");
  assert.deepEqual(value(locked, "center-dynamics.tension").pairs, []);

  const fluid = extractPawnSignalsFromFen(
    "4k3/8/4p3/3p4/2PP4/8/8/4K3 w - - 0 1",
    "white",
  );
  assert.equal(value(fluid, "center-dynamics.fluidity").state, "fluid");
  assert.deepEqual(value(fluid, "center-dynamics.tension").pairs, [{
    repertoire_pawn: "c4",
    opponent_pawn: "d5",
    attacker: "both",
  }]);
});

test("likely breaks disclose geometric evidence without objective-quality claims", () => {
  const report = extractPawnSignalsFromFen(
    "4k3/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/4K3 w - - 0 1",
    "white",
  );
  const signal = findSignal(report, "center-dynamics.likely-breaks");
  const moves = signal.value.breaks.map((candidate) => `${candidate.subject}:${candidate.from}-${candidate.to}`);

  assert.deepEqual(moves, [
    "opponent:c7-c5",
    "opponent:f7-f6",
    "repertoire:c2-c4",
  ]);
  assert.ok(signal.value.breaks.every((candidate) => candidate.readiness === "geometrically-available"));
  assert.ok(signal.value.breaks.every((candidate) => candidate.confidence < 1));
  assert.equal(JSON.stringify(signal).includes("evaluation"), false);
  assert.equal(JSON.stringify(signal).includes("good"), false);
  assert.equal(JSON.stringify(signal).includes("bad"), false);
});

test("mirrored Black analysis preserves repertoire-relative formation and breaks", () => {
  const whiteReport = extractPawnSignalsFromFen(
    "4k3/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/4K3 w - - 0 1",
    "white",
  );
  const blackReport = extractPawnSignalsFromFen(
    "4k3/ppp2ppp/8/3p4/3Pp3/4P3/PPP2PPP/4K3 b - - 0 1",
    "black",
  );

  assert.equal(value(whiteReport, "pawn-topology.named-formation").formation_id, "french");
  assert.equal(value(blackReport, "pawn-topology.named-formation").formation_id, "french");
  assert.equal(
    value(whiteReport, "center-dynamics.likely-breaks").breaks.some(
      (candidate) => candidate.subject === "repertoire" && candidate.from === "c2" && candidate.to === "c4",
    ),
    true,
  );
  assert.equal(
    value(blackReport, "center-dynamics.likely-breaks").breaks.some(
      (candidate) => candidate.subject === "repertoire" && candidate.from === "c7" && candidate.to === "c5",
    ),
    true,
  );
  assert.equal(
    findSignal(blackReport, "pawn-topology.islands", "repertoire").value.color,
    "black",
  );
});

test("signal reports are deterministic, uniquely identified, and confidence-bearing", () => {
  const first = extractPawnSignalsFromFen(FENS.hedgehog, "black");
  const second = extractPawnSignalsFromFen(FENS.hedgehog, "black");
  assert.deepEqual(first, second);
  assert.equal(new Set(first.signals.map((signal) => signal.signal_id)).size, first.signals.length);
  assert.ok(first.signals.every((signal) => signal.confidence >= 0 && signal.confidence <= 1));
  assert.ok(first.signals.every((signal) => signal.kind === "observation"));
  assert.ok(first.signals.every((signal) => signal.provenance.length > 0));
  assert.equal(first.provenance.some((source) => source.kind === "structure-classifier"), true);
});
