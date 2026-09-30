import assert from "node:assert/strict";
import test from "node:test";
import {
  actions,
  currentTree,
  dirty,
  documentId,
  version,
  fen,
  setExploreMode,
  exploration,
  keepExploration,
  discardExploration,
} from "../src/store/game.ts";
import { undo, redo, getStacksForTesting } from "../src/store/history.ts";
import {
  addSuggestion,
  acceptAllSuggestions,
  clearSuggestions,
  stagePreviewLine,
  acceptPreview,
} from "../src/store/suggestions.ts";
import {
  executeCommand,
  commandStates,
  commandIsStale,
  rerunCommand,
} from "../src/store/commands.ts";
import { preference } from "../src/store/preferences.ts";

const load = () => {
  actions.loadPgn("1. d4 d5 *");
  clearSuggestions();
};

test("F2 exploration is provisional; Keep is one undoable edit and Discard is read-only", () => {
  load();
  const pgn = actions.toPgn();
  const revision = version();
  setExploreMode(true);
  actions.play("e2", "e4");
  actions.play("e7", "e5");
  assert.ok(exploration());
  assert.equal(actions.toPgn(), pgn);
  assert.equal(version(), revision);
  assert.equal(dirty(), false);
  assert.notEqual(fen(), currentTree().fenAt([]));
  discardExploration();
  assert.equal(fen(), currentTree().fenAt([]));
  actions.play("e2", "e4");
  assert.equal(keepExploration()?.ok, true);
  assert.equal(getStacksForTesting().undo.length, 1);
  assert.match(actions.toPgn(), /e4/);
  undo();
  assert.equal(actions.toPgn(), pgn);
  assert.equal(dirty(), false);
  redo();
  assert.match(actions.toPgn(), /e4/);
  actions.newGame();
  assert.equal(exploration(), null);
});

test("F3 delete and mainline changes remain undoable", () => {
  load();
  actions.applyEdit("add", [], { addMoves: ["e4", "e5"] });
  const before = actions.toPgn();
  assert.equal(actions.applyEdit("reorder", [], { promoteMove: "e4" }).ok, true);
  assert.equal(currentTree().childSansAt([])[0], "e4");
  undo();
  assert.equal(actions.toPgn(), before);
  assert.equal(actions.applyEdit("prune", ["e4"]).ok, true);
  assert.equal(currentTree().indexPathOfSan(["e4"]), null);
  undo();
  assert.equal(actions.toPgn(), before);
});

test("F18 accepting a batch is atomic and uses one history entry", () => {
  load();
  const before = actions.toPgn();
  addSuggestion(["e4", "e5"]);
  addSuggestion(["c4", "e5"]);
  acceptAllSuggestions();
  assert.equal(getStacksForTesting().undo.length, 1);
  assert.ok(currentTree().indexPathOfSan(["e4", "e5"]));
  assert.ok(currentTree().indexPathOfSan(["c4", "e5"]));
  undo();
  assert.equal(actions.toPgn(), before);
});

test("F18 stale batches and previews never edit a replacement document", () => {
  load();
  addSuggestion(["e4"]);
  stagePreviewLine([], ["c4"]);
  actions.newGame();
  const before = actions.toPgn();
  acceptAllSuggestions();
  acceptPreview();
  assert.equal(actions.toPgn(), before);
  assert.equal(getStacksForTesting().undo.length, 0);
});

test("F21 results retain per-command arguments, stale on edits/side changes, clear across documents", async () => {
  load();
  await executeCommand("find_structures", { structure: "Kings Indian" });
  assert.equal(commandStates().find_structures.status, "completed");
  assert.equal(commandIsStale("find_structures"), false);
  actions.applyEdit("add", [], { addMoves: ["e4"] });
  assert.equal(commandIsStale("find_structures"), true);
  await rerunCommand("find_structures");
  assert.equal(commandIsStale("find_structures"), false);
  assert.deepEqual(commandStates().find_structures.args, { structure: "Kings Indian" });
  actions.setColor("black");
  assert.equal(commandIsStale("find_structures"), true);
  const id = documentId();
  actions.loadPgn("1. e4 e5 *");
  assert.notEqual(documentId(), id);
  assert.deepEqual(commandStates().find_structures, { status: "idle" });
});

test("F7/F17/F19 preferences survive a fresh reader and tolerate unavailable storage", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
  try {
    const [, set] = preference("workflow-test", "off");
    set("on");
    assert.equal(preference("workflow-test", "off")[0](), "on");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    const [value, update] = preference("workflow-test", "off");
    update("on");
    assert.equal(value(), "on");
  } finally {
    if (prior) Object.defineProperty(globalThis, "localStorage", prior);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
