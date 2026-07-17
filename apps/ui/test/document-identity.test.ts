import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserDocumentId,
  normalizeBrowserDocumentId,
} from "../src/store/document-identity.ts";
import {
  actions,
  documentId,
  restoreDocument,
} from "../src/store/game.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("document ID validation canonicalizes only RFC-compatible UUIDs", () => {
  assert.equal(
    normalizeBrowserDocumentId("550E8400-E29B-41D4-A716-446655440000"),
    "550e8400-e29b-41d4-a716-446655440000",
  );
  for (const value of [undefined, null, 42, "", "not-a-uuid", "00000000-0000-0000-0000-000000000000"]) {
    assert.equal(normalizeBrowserDocumentId(value), undefined);
  }
});

test("document ID generation prefers native UUIDs and has a secure version-4 fallback", () => {
  const native = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(createBrowserDocumentId({ randomUUID: () => native }), native);

  const fallback = createBrowserDocumentId({
    randomUUID: () => "malformed",
    getRandomValues: (array) => {
      if (array instanceof Uint8Array) array.fill(0xab);
      return array;
    },
  });
  assert.match(fallback, UUID);
  assert.equal(fallback[14], "4");
  assert.equal(fallback[19], "a");
  assert.throws(() => createBrowserDocumentId({}), /Secure browser UUID generation is unavailable/);
});

test("new and successful explicit loads rotate identity while mutations and save state preserve it", () => {
  const initial = documentId();
  assert.match(initial, UUID);

  actions.loadPgn("1. e4 e5 *", "one.pgn");
  const loaded = documentId();
  assert.match(loaded, UUID);
  assert.notEqual(loaded, initial);

  actions.goto([0]);
  actions.setColor("black");
  const edit = actions.applyEdit("add", ["e4", "e5"], { addMoves: ["Nf3"] });
  assert.equal(edit.ok, true);
  actions.markSaved();
  assert.equal(documentId(), loaded);

  actions.loadPgn("1. e4 e5 *", "two.pgn");
  const secondImport = documentId();
  assert.notEqual(secondImport, loaded, "even identical imported contents are a fresh document");

  actions.newGame();
  assert.match(documentId(), UUID);
  assert.notEqual(documentId(), secondImport);
});

test("restore resumes a valid identity and safely replaces missing or corrupt identity", () => {
  const persisted = "550e8400-e29b-41d4-a716-446655440000";
  restoreDocument("1. d4 d5 *", "restored.pgn", persisted.toUpperCase());
  assert.equal(documentId(), persisted);

  restoreDocument("1. c4 e5 *", "legacy.pgn", undefined);
  const legacyId = documentId();
  assert.match(legacyId, UUID);
  assert.notEqual(legacyId, persisted);

  restoreDocument("1. Nf3 d5 *", "corrupt.pgn", "shared-file-name");
  assert.match(documentId(), UUID);
  assert.notEqual(documentId(), legacyId);
});

test("failed explicit loads and failed restores leave the active identity unchanged", () => {
  actions.loadPgn("1. e4 e5 *", "safe.pgn");
  const active = documentId();
  const pgn = actions.toPgn();

  assert.throws(() => actions.loadPgn("1. e4 e5 2. e4 *", "illegal.pgn"), /illegal move/);
  assert.equal(documentId(), active);
  assert.equal(actions.toPgn(), pgn);

  assert.throws(() => restoreDocument("", "corrupt-autosave.pgn", crypto.randomUUID()), /no game/);
  assert.equal(documentId(), active);
  assert.equal(actions.toPgn(), pgn);
});
