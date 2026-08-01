import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildRepertoireGraph,
  suggestStrategicFitIntentFromComments,
} from "../../src/index.ts";

const SOURCE = `
[Event "Intent comments"]

{[%strategic-fit tournament-weapon]} 1. e4 {must keep this line} e5
{avoid queenless middlegame} 2. Nf3 {maybe keep this flexible} Nc6 *
`;

test("supported tags and phrases yield deterministic quoted path-bound suggestions", () => {
  const tree = GameTree.fromPgn(SOURCE);
  const graph = buildRepertoireGraph(tree, "white");
  const suggestions = suggestStrategicFitIntentFromComments(tree, graph);

  assert.deepEqual(
    suggestions.map((entry) => ({
      kind: entry.kind,
      value: entry.intent_value,
      detection: entry.detection,
      comment: entry.source_comment,
      match: entry.source_match,
      path: entry.source_san_path,
    })),
    [
      {
        kind: "tournament-weapon",
        value: "tournament-specific",
        detection: "tag",
        comment: "[%strategic-fit tournament-weapon]",
        match: "[%strategic-fit tournament-weapon]",
        path: [],
      },
      {
        kind: "retain-line",
        value: "keep-intentionally",
        detection: "phrase",
        comment: "must keep this line",
        match: "must keep",
        path: ["e4"],
      },
      {
        kind: "avoid-concept",
        value: "endgame-tendency.queenless",
        detection: "phrase",
        comment: "avoid queenless middlegame",
        match: "avoid queenless middlegame",
        path: ["e4", "e5"],
      },
    ],
  );
  assert.deepEqual(
    suggestions[0]?.references.route_ids,
    graph.routes.map((route) => route.route_id),
  );
  assert.equal(suggestions[1]?.references.decision_ids.length, 1);
  assert.deepEqual(suggestions[1]?.references.source_san_paths, [["e4"]]);
  assert.equal(
    suggestions.every((entry) => entry.suggestion_id.startsWith("comment-intent:")),
    true,
  );
});

test("ambiguous commentary is ignored and scanning never mutates comments or PGN", () => {
  const tree = GameTree.fromPgn("1. e4 {maybe keep this, unless it stops working} e5 *");
  const before = tree.toPgn();
  const suggestions = suggestStrategicFitIntentFromComments(
    tree,
    buildRepertoireGraph(tree, "white"),
  );

  assert.deepEqual(suggestions, []);
  assert.equal(tree.toPgn(), before);
  assert.deepEqual(tree.nodeAt([0]).data.comments, ["maybe keep this, unless it stops working"]);
});

test("editing source text invalidates the exact suggestion identity without mutating either tree", () => {
  const original = GameTree.fromPgn("1. e4 {must keep this line} e5 *");
  const edited = GameTree.fromPgn("1. e4 {must keep this line for team events} e5 *");
  const originalBefore = original.toPgn();
  const editedBefore = edited.toPgn();
  const first = suggestStrategicFitIntentFromComments(
    original,
    buildRepertoireGraph(original, "white"),
  )[0]!;
  const second = suggestStrategicFitIntentFromComments(
    edited,
    buildRepertoireGraph(edited, "white"),
  )[0]!;

  assert.notEqual(first.suggestion_id, second.suggestion_id);
  assert.deepEqual(first.source_san_path, second.source_san_path);
  assert.equal(original.toPgn(), originalBefore);
  assert.equal(edited.toPgn(), editedBefore);
});

test("an unchanged comment keeps its identity when unrelated sibling commentary is inserted", () => {
  const original = GameTree.fromPgn("1. e4 {must keep this line} e5 *");
  const inserted = GameTree.fromPgn("1. e4 {ordinary context} {must keep this line} e5 *");
  const first = suggestStrategicFitIntentFromComments(
    original,
    buildRepertoireGraph(original, "white"),
  )[0]!;
  const second = suggestStrategicFitIntentFromComments(
    inserted,
    buildRepertoireGraph(inserted, "white"),
  )[0]!;

  assert.equal(first.suggestion_id, second.suggestion_id);
  assert.equal(first.source_comment_index, 0);
  assert.equal(second.source_comment_index, 1);
});
