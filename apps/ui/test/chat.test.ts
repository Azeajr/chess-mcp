import test from "node:test";
import assert from "node:assert/strict";
import { selectOutcomes, schemasForConversation } from "../src/llm/chat-routing.ts";
import { streamChat, type ToolSchema } from "../src/llm/openrouter.ts";
import { validateToolArguments } from "@chess-mcp/chess-tools";

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
