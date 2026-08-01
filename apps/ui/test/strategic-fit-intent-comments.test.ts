import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  createDefaultStrategicFitDocumentMetadata,
  normalizeStrategicFitDocumentMetadata,
  type StrategicFitDocumentMetadata,
} from "@chess-mcp/chess-tools";
import { createStrategicFitIntentCommentState } from "../src/store/strategic-fit-intent-comments.ts";

function fixture(source = "1. e4 {must keep this line} e5 *") {
  let tree = GameTree.fromPgn(source);
  let metadata = createDefaultStrategicFitDocumentMetadata();
  const now = "2026-07-26T12:00:00.000Z";
  let replacements = 0;
  const boundary = {
    currentTree: () => tree,
    repertoireColor: () => "white" as const,
    currentMetadata: () => metadata,
    replaceMetadata: (input: StrategicFitDocumentMetadata) => {
      replacements++;
      const result = normalizeStrategicFitDocumentMetadata(input);
      metadata = structuredClone(result.metadata);
      return result;
    },
    now: () => now,
  };
  return {
    boundary,
    state: createStrategicFitIntentCommentState(boundary),
    metadata: () => metadata,
    tree: () => tree,
    replaceTree: (sourcePgn: string) => {
      tree = GameTree.fromPgn(sourcePgn);
    },
    replacements: () => replacements,
  };
}

test("rejection is durable for unchanged text while an edited comment becomes pending", () => {
  const subject = fixture();
  const beforePgn = subject.tree().toPgn();
  const suggestion = subject.state.suggestions()[0]!;
  const rejected = subject.state.decide(suggestion.suggestion_id, "rejected");

  assert.equal(rejected.disposition, "rejected");
  assert.equal(subject.state.suggestions()[0]?.disposition, "rejected");
  assert.equal(
    createStrategicFitIntentCommentState(subject.boundary).suggestions()[0]?.disposition,
    "rejected",
  );
  assert.equal(subject.tree().toPgn(), beforePgn);
  assert.deepEqual(subject.metadata().profile, createDefaultStrategicFitDocumentMetadata().profile);

  subject.replaceTree("1. e4 {must keep this line for team events} e5 *");
  const edited = subject.state.suggestions()[0]!;
  assert.notEqual(edited.suggestion_id, suggestion.suggestion_id);
  assert.equal(edited.disposition, null);
  assert.equal(
    subject.metadata().comment_intents.length,
    1,
    "the old rejection remains portable history",
  );
});

test("confirmation records structured metadata with exact source/path and preserves the PGN", () => {
  const subject = fixture("1. e4 {[%strategic-fit avoid-queenless-middlegame]} e5 *");
  const beforePgn = subject.tree().toPgn();
  const suggestion = subject.state.suggestions()[0]!;
  const confirmed = subject.state.decide(suggestion.suggestion_id, "confirmed");

  assert.equal(confirmed.disposition, "confirmed");
  assert.equal(confirmed.kind, "avoid-concept");
  assert.equal(confirmed.intent_value, "endgame-tendency.queenless");
  assert.equal(confirmed.source_comment, "[%strategic-fit avoid-queenless-middlegame]");
  assert.deepEqual(confirmed.source_san_path, ["e4"]);
  assert.deepEqual(confirmed.references.source_san_paths, [["e4"]]);
  assert.equal(subject.tree().toPgn(), beforePgn);
  assert.equal(
    normalizeStrategicFitDocumentMetadata(JSON.parse(JSON.stringify(subject.metadata()))).state,
    "valid",
  );
  assert.equal(subject.replacements(), 1);
});

test("a stale UI action cannot confirm text that is no longer present", () => {
  const subject = fixture();
  const suggestion = subject.state.suggestions()[0]!;
  subject.replaceTree("1. e4 {ordinary commentary} e5 *");

  assert.throws(
    () => subject.state.decide(suggestion.suggestion_id, "confirmed"),
    /strategic_fit_intent_suggestion_stale/,
  );
  assert.deepEqual(subject.metadata().comment_intents, []);
  assert.equal(subject.replacements(), 0);
});
