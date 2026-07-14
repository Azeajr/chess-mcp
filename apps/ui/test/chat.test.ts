import test from "node:test";
import assert from "node:assert/strict";
import { selectOutcomes, schemasForConversation } from "../src/llm/chat-routing.ts";
import { streamChat, type ToolSchema } from "../src/llm/openrouter.ts";
import { contractsForHost, toolDefault, validateToolArguments } from "@chess-mcp/chess-tools";
import { actions, currentTree, version } from "../src/store/game.ts";
import { acceptStagedEdit, rejectStagedEdit, stageEdit, stagedEdit } from "../src/store/suggestions.ts";
import { artifactById, createArtifact } from "../src/store/artifacts.ts";

const schema = (name: string): ToolSchema => ({ type: "function", function: { name, description: name, parameters: {} } });
const sse = (...frames: unknown[]) => new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    for (const frame of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  },
});

test("automatic routing can move from position to repertoire without a required preset", () => {
  assert.deepEqual(selectOutcomes("Evaluate this FEN", ""), ["position"]);
  assert.deepEqual(selectOutcomes("Now find gaps in my repertoire", "", ["position"]), ["position", "repertoire"]);
  const selected = schemasForConversation([schema("get_position"), schema("evaluate_position"), schema("find_repertoire_gaps"), schema("batch_review")], ["repertoire"]);
  assert.deepEqual(selected.map((item) => item.function.name), ["get_position", "find_repertoire_gaps"]);
});

test("canonical browser validation rejects malformed and unknown arguments", () => {
  assert.equal(validateToolArguments("evaluate_position", null, "browser").ok, false);
  const unknown = validateToolArguments("evaluate_position", { surprise: true }, "browser");
  assert.deepEqual(unknown, { ok: false, error: "invalid_arguments", reason: "unknown argument: surprise" });
});

test("primary direct repertoire outcomes use the canonical browser commands and defaults", () => {
  const browser = new Set(contractsForHost("browser").map((contract) => contract.name));
  for (const name of ["audit_repertoire_moves", "find_only_moves", "find_structures", "export_annotated_repertoire", "prep_vs_opponent"])
    assert.equal(browser.has(name), true, `${name} is available to chat and direct UI`);
  assert.equal(toolDefault("audit_repertoire_moves", "max_positions", 0), 20);
  assert.equal(toolDefault("find_only_moves", "min_margin", 0), 100);
  assert.equal(validateToolArguments("prep_vs_opponent", {}, "browser").ok, false);
  assert.equal(validateToolArguments("find_only_moves", { export_deck: true }, "browser").ok, true);
  assert.equal(validateToolArguments("find_only_moves", { export_path: "deck.csv" }, "browser").ok, false);
});

test("fake model stream reassembles multiple tool calls", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://test" } }, configurable: true });
  globalThis.fetch = async () => new Response(sse(
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "get_position", arguments: "{}" } }, { index: 1, id: "b", function: { name: "evaluate_position", arguments: "{\"lines\":" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: "3}" } }] }, finish_reason: "tool_calls" }] },
  ), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true }); });
  const result = await streamChat({ apiKey: "x", model: "fake", messages: [], tools: [], onText() {} });
  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.toolCalls[1]!.function.arguments, "{\"lines\":3}");
});

test("fake model stream reports abnormal finish and respects cancellation", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://test" } }, configurable: true });
  globalThis.fetch = async (_input, init) => {
    if (init?.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return new Response(sse({ choices: [{ delta: { content: "partial" }, finish_reason: "length" }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true }); });
  const abnormal = await streamChat({ apiKey: "x", model: "fake", messages: [], tools: [], onText() {} });
  assert.equal(abnormal.abnormalFinish, "length");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(streamChat({ apiKey: "x", model: "fake", messages: [], tools: [], signal: controller.signal, onText() {} }), { name: "AbortError" });
});

test("staged add, prune, and reorder edits require acceptance and share the game command", () => {
  actions.loadPgn("1. e4 (1. d4) e5 2. Nf3");
  const initial = actions.toPgn();
  const reorder = stageEdit("reorder", [], { promoteMove: "d4" });
  assert.equal(reorder.ok, true);
  assert.equal(actions.toPgn(), initial, "staging must not mutate the tree");
  if (!reorder.ok) return;
  assert.equal(acceptStagedEdit(reorder.action_id).ok, true);
  assert.equal(currentTree().nodeAt([]).children[0]!.data.san, "d4");

  const add = stageEdit("add", ["e4", "e5", "Nf3"], { addMoves: ["Nc6"] });
  assert.equal(add.ok, true);
  if (!add.ok) return;
  rejectStagedEdit(add.action_id);
  assert.equal(stagedEdit(add.action_id)?.status, "rejected");
  assert.equal(currentTree().indexPathOfSan(["e4", "e5", "Nf3", "Nc6"]), null);

  const prune = stageEdit("prune", ["d4"]);
  assert.equal(prune.ok, true);
  if (!prune.ok) return;
  assert.equal(acceptStagedEdit(prune.action_id).ok, true);
  assert.equal(currentTree().indexPathOfSan(["d4"]), null);
});

test("staged edits cannot apply after the tree revision changes", () => {
  actions.loadPgn("1. e4 e5");
  const staged = stageEdit("add", ["e4", "e5"], { addMoves: ["Nf3"] });
  assert.equal(staged.ok, true);
  if (!staged.ok) return;
  const stagedRevision = staged.revision;
  actions.newGame();
  assert.notEqual(version(), stagedRevision);
  assert.deepEqual(acceptStagedEdit(staged.action_id), { ok: false, error: "stale_revision" });
  assert.equal(stagedEdit(staged.action_id)?.status, "stale");
});

test("artifact results expose metadata by reference without repeating content", () => {
  const content = "[Event \"Annotated\"]\n\n1. e4 *";
  const result = createArtifact("pgn", content, "game-annotated.pgn");
  assert.equal("content" in result, false);
  assert.equal(result.format, "pgn");
  assert.equal(artifactById(result.artifact_id)?.content, content);
  const deck = createArtifact("csv", "fen,move\nstart,e4", "only-moves.csv");
  assert.equal(deck.media_type, "text/csv");
  assert.equal(artifactById(deck.artifact_id)?.name, "only-moves.csv");
});
