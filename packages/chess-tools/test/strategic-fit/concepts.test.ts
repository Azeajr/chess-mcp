import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_CONCEPT_CATEGORIES,
  STRATEGIC_CONCEPT_RULE_IDS,
  buildRepertoireGraph,
  buildStrategicConceptDictionary,
  buildStrategicTrajectories,
  computeStrategicConceptOverlap,
  type StrategicConceptDictionary,
} from "../../src/index.ts";

function dictionary(
  pgn: string,
  configuredPlies: readonly number[],
  repertoireColor: "white" | "black" = "white",
): StrategicConceptDictionary {
  const graph = buildRepertoireGraph(GameTree.fromPgn(pgn), repertoireColor);
  return buildStrategicConceptDictionary(buildStrategicTrajectories(graph, { configuredPlies }));
}

function conceptIds(result: StrategicConceptDictionary, routeIndex = 0): string[] {
  const route = result.routes[routeIndex];
  assert.ok(route, `route ${routeIndex}`);
  return route.concepts.map((concept) => concept.concept_id);
}

const RICH_CONCEPT_LINE =
  "1. Nf3 d5 2. g3 Nf6 3. Bg2 e6 4. d3 Be7 5. O-O O-O 6. e4 dxe4 7. dxe4 Qxd1 8. Rxd1 *";

test("stable trajectory evidence has a deterministic concept extraction snapshot", () => {
  const result = dictionary(RICH_CONCEPT_LINE, [3, 5, 7, 9, 11, 13, 15]);

  assert.deepEqual(
    result.routes[0]!.concepts.map((concept) => [concept.category, concept.concept_id]),
    [
      ["endgame-tendency", "endgame-tendency.queenless"],
      ["exchange", "exchange.opponent.pawn-for-pawn"],
      ["exchange", "exchange.opponent.queen-for-queen"],
      ["exchange", "exchange.repertoire.pawn-for-pawn"],
      ["exchange", "exchange.repertoire.rook-for-queen"],
      ["pawn-break", "pawn-break.repertoire.c2-c4"],
      ["pawn-break", "pawn-break.repertoire.e2-e4"],
      ["setup-family", "setup-family.bishop-pair.opponent"],
      ["setup-family", "setup-family.bishop-pair.repertoire"],
      ["setup-family", "setup-family.castling.opponent.kingside"],
      ["setup-family", "setup-family.castling.repertoire.kingside"],
      ["setup-family", "setup-family.fianchetto.repertoire.kingside"],
      ["setup-family", "setup-family.piece-placement.opponent.bishop.e7"],
      ["setup-family", "setup-family.piece-placement.opponent.knight.f6"],
      ["setup-family", "setup-family.piece-placement.opponent.rook.f8"],
      ["setup-family", "setup-family.piece-placement.repertoire.bishop.g2"],
      ["setup-family", "setup-family.piece-placement.repertoire.knight.f3"],
      ["setup-family", "setup-family.piece-placement.repertoire.rook.f1"],
      ["tactical-risk-prerequisite", "tactical-prerequisite.queens-retained-fluid-center"],
    ],
  );
  assert.ok(result.routes[0]!.concepts.every((concept) => concept.evidence.length > 0));
  assert.ok(result.routes[0]!.concepts.every((concept) =>
    concept.evidence.every((evidence) =>
      evidence.persistence === "stable" || evidence.persistence === "irreversible"
    )
  ));
});

test("observed plans use conservative deterministic prerequisites", () => {
  const expansion = dictionary(
    "1. a4 d5 2. b4 Nf6 3. c4 e6 4. Nf3 Be7 5. e3 O-O 6. Be2 *",
    [3, 5, 7, 9, 11],
  );
  assert.deepEqual(
    expansion.routes[0]!.concepts
      .filter((concept) => concept.category === "plan")
      .map((concept) => concept.concept_id),
    ["plan.pawn-expansion.repertoire.queenside"],
  );

  const ordinaryDevelopment = dictionary(
    "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 *",
    [5, 7],
  );
  assert.deepEqual(
    ordinaryDevelopment.routes[0]!.concepts.filter((concept) => concept.category === "plan"),
    [],
  );
  assert.ok(!conceptIds(ordinaryDevelopment).includes("plan.minority-attack"));
});

test("transient and unsupported evidence does not invent concepts", () => {
  const result = dictionary("1. e4 e5 *", [4, 8]);

  assert.equal(result.routes[0]!.concepts.length, 0);
  assert.equal(result.labels.length, 0);
  assert.ok(result.routes[0]!.provenance.some((source) =>
    source.source_id === "strategic-fit:concept-classifier"
  ));
});

test("concept IDs are stable, unique, and independent from display labels", () => {
  const first = dictionary(RICH_CONCEPT_LINE, [3, 5, 7, 9, 11, 13, 15]);
  const second = dictionary(RICH_CONCEPT_LINE, [15, 13, 11, 9, 7, 5, 3]);
  const ids = conceptIds(first);

  assert.deepEqual(first, second);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(first.labels.map((label) => label.concept_id), ids);
  assert.ok(first.routes[0]!.concepts.every((concept) => !("label" in concept)));
  assert.deepEqual(STRATEGIC_CONCEPT_CATEGORIES, [
    "pawn-break",
    "plan",
    "setup-family",
    "exchange",
    "tactical-risk-prerequisite",
    "endgame-tendency",
  ]);
  assert.equal(new Set(STRATEGIC_CONCEPT_RULE_IDS).size, STRATEGIC_CONCEPT_RULE_IDS.length);
});

test("transposed routes produce identical concept IDs and complete overlap", () => {
  const pgn = `[Event "Move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. e3 O-O 6. Bd3 c6
7. O-O b6 8. b3 a6 9. a3 *

[Event "Move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. e3 O-O 6. Bd3 c6
7. O-O b6 8. b3 a6 9. a3 *`;
  const result = dictionary(pgn, [7, 9, 11, 13, 15, 17]);
  assert.equal(result.routes.length, 2);
  assert.deepEqual(conceptIds(result, 0), conceptIds(result, 1));
  assert.deepEqual(computeStrategicConceptOverlap(result.routes[0]!, result.routes[1]!), {
    shared_concept_ids: conceptIds(result, 0),
    left_only_concept_ids: [],
    right_only_concept_ids: [],
    overlap: 1,
  });
});

test("labels and classifier provenance serialize separately with explicit versions", () => {
  const result = dictionary(
    "1. d4 d5 2. Nc3 Nf6 3. Bf4 e6 4. Qd2 Be7 5. O-O-O O-O 6. e3 *",
    [5, 7, 9, 11],
  );
  const conceptId = "tactical-prerequisite.opposite-side-castling";
  const label = result.labels.find((candidate) => candidate.concept_id === conceptId);
  const classifier = result.provenance.find((source) =>
    source.source_id === "strategic-fit:concept-classifier"
  );
  assert.ok(result.routes[0]!.concepts.some((concept) => concept.concept_id === conceptId));
  assert.equal(
    JSON.stringify({
      schema_version: result.schema_version,
      analysis_version: result.analysis_version,
      classifier_version: result.classifier_version,
      label,
      classifier,
    }),
    '{"schema_version":"2.0.0","analysis_version":"2.0.0","classifier_version":"1.0.0","label":{"concept_id":"tactical-prerequisite.opposite-side-castling","locale":"en","label":"Opposite-side castling tactical prerequisite"},"classifier":{"source_id":"strategic-fit:concept-classifier","kind":"concept-classifier","state":"available","version":"1.0.0","snapshot":null,"reason":null}}',
  );
  assert.ok(result.routes[0]!.concepts.every((concept) => concept.classifier_version === "1.0.0"));
});
