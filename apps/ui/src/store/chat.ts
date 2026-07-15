import { createSignal } from "solid-js";
import { streamChat, type ChatMessage, type ToolCall } from "../llm/openrouter";
import { toolSchemas, runTool } from "../llm/tools";
import { workflowPrompt } from "../llm/workflows";
import { apiKey, model, hasApiKey, chatMode } from "./settings";
import { fen, color, currentTree, currentPath, fileName, version } from "./game";
import type { Path } from "@chess-mcp/chess-tools";
import { executionOutcome, isAbortError, type ExecutionStatus } from "../application/execution-status";

const SYSTEM_PROMPT = `You are a chess assistant embedded in a board UI. Use local tools for chess claims. Be concise. Tool results may be compacted; retrieve current document data with the scoped retrieval tools when needed.`;
const MAX_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 6000;

export type ToolRunState = { id: string; name: string; status: Exclude<ExecutionStatus, "idle">; done?: number; total?: number; detail?: string; error?: string };
const [history, setHistory] = createSignal<ChatMessage[]>([]);
const [streamingText, setStreamingText] = createSignal("");
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
const [toolRuns, setToolRuns] = createSignal<ToolRunState[]>([]);
let controller: AbortController | null = null;
let lastRequest = "";
let chatTransport: typeof streamChat = streamChat;
let toolExecutor: typeof runTool = runTool;

export { history, streamingText, busy, error, toolRuns };
export function clearChat() { if (busy()) stop(); lastRequest = ""; setHistory([]); setToolRuns([]); setError(null); }
export function stop() { controller?.abort(); }
export function retry() { if (!busy() && lastRequest) void send(lastRequest); }
/** Test seam for request-level assertions; production always uses the OpenRouter transport. */
export function setChatTransportForTesting(transport?: typeof streamChat) { chatTransport = transport ?? streamChat; }
/** Test seam for deterministic command fixtures; reset by passing no argument. */
export function setChatToolExecutorForTesting(executor?: typeof runTool) { toolExecutor = executor ?? runTool; }

export function focusLine(path: Path) {
  const tree = currentTree();
  try {
    const san = tree.sanPathAt(path);
    if (san.length) setHistory((h) => [...h, { role: "focus", content: `Focused: ${san.at(-1)} — ${san.join(" ")} (${tree.fenAt(path)})`, focusPath: path }]);
  } catch { /* stale path */ }
}

/** Development harness seam for typed result/action/artifact UI verification. */
export function appendToolResultForTesting(operation: string, result: unknown) {
  const id = `test-tool-${history().length}`;
  setHistory((all) => [
    ...all,
    { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: operation, arguments: "{}" } }] },
    { role: "tool", tool_call_id: id, content: JSON.stringify(result) },
  ]);
}

function systemMessage(): ChatMessage {
  const tree = currentTree();
  const stats = tree.stats();
  const selected = tree.sanPathAt(currentPath());
  const type = stats.leaves > 1 ? "repertoire" : "game";
  const ctx = `Current normalized FEN: ${fen()}\nRepertoire/user color: ${color()}\nSelected SAN path: ${selected.length ? selected.join(" ") : "(root)"}\nDocument: type=${type}, revision=${version()}, file=${fileName() ?? "untitled"}\nTree: nodes=${stats.nodes}, leaves=${stats.leaves}, max_depth=${stats.maxDepth}`;
  return { role: "system", content: `${SYSTEM_PROMPT}\n\n${workflowPrompt(chatMode())}\n\n${ctx}` };
}

const REFERENCE_KEYS = new Set([
  "error", "reason", "fen", "path", "san_path", "variation_path", "pivot_path", "joins_path",
  "selected_path", "revision", "action_id", "artifact_id", "kind", "format", "name", "media_type",
  "bytes", "total", "returned", "next_leaf", "partial", "page", "next_page", "truncated",
]);

export function compactToolResult(content: string): string {
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object") return JSON.stringify({ compacted: true, characters: content.length });
    const references: Record<string, unknown>[] = [];
    const visit = (candidate: unknown, location: string) => {
      if (references.length >= 100 || !candidate || typeof candidate !== "object") return;
      if (Array.isArray(candidate)) { candidate.forEach((item, index) => visit(item, `${location}[${index}]`)); return; }
      const item = candidate as Record<string, unknown>;
      const kept = Object.fromEntries(Object.entries(item).filter(([key]) => REFERENCE_KEYS.has(key)));
      if (Object.keys(kept).length) references.push({ location, ...kept });
      for (const [key, child] of Object.entries(item)) visit(child, `${location}.${key}`);
    };
    visit(value, "$result");
    const root = value as Record<string, unknown>;
    return JSON.stringify({ compacted: true, keys: Object.keys(root), references, references_truncated: references.length >= 100 });
  } catch { return JSON.stringify({ compacted: true, characters: content.length }); }
}

function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role !== "focus").map((m) => {
    if (m.role !== "tool" || !m.content || m.content.length <= MAX_TOOL_RESULT_CHARS) return m;
    return { ...m, content: compactToolResult(m.content) };
  });
}

function updateRun(id: string, patch: Partial<ToolRunState>) {
  setToolRuns((runs) => runs.map((run) => run.id === id ? { ...run, ...patch } : run));
}

async function executeCalls(calls: ToolCall[], signal: AbortSignal) {
  setToolRuns((runs) => [...runs, ...calls.map((tc) => ({ id: tc.id, name: tc.function.name, status: "queued" as const }))]);
  for (const tc of calls) {
    if (signal.aborted) { updateRun(tc.id, { status: "cancelled" }); continue; }
    updateRun(tc.id, { status: "running" });
    let result: unknown;
    try {
      let raw: unknown;
      try { raw = JSON.parse(tc.function.arguments || "{}"); }
      catch { raw = null; }
      result = await toolExecutor(tc.function.name, raw as Record<string, unknown>, {
        signal,
        onProgress: (done, total, detail) => updateRun(tc.id, { done, total, detail }),
      });
      updateRun(tc.id, { status: executionOutcome(signal.aborted) });
    } catch (e) {
      const isCancelled = isAbortError(e) || signal.aborted;
      result = isCancelled ? { error: "cancelled" } : { error: e instanceof Error ? e.message : String(e) };
      updateRun(tc.id, { status: executionOutcome(isCancelled, true), error: isCancelled ? undefined : String((result as { error: string }).error) });
    }
    setHistory((h) => [...h, { role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) }]);
  }
}

export async function send(userText: string) {
  const text = userText.trim();
  if (!text || busy()) return;
  if (!hasApiKey()) { setError("Set your OpenRouter API key in Settings."); return; }
  lastRequest = text;
  setError(null); setHistory((h) => [...h, { role: "user", content: text }]); setBusy(true); setToolRuns([]);
  controller = new AbortController();
  const signal = controller.signal;
  let trailingTools = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      setStreamingText("");
      const result = await chatTransport({ apiKey: apiKey(), model: model(), messages: [systemMessage(), ...compactMessages(history())], tools: toolSchemas, signal, onText: (d) => setStreamingText((t) => t + d) });
      setStreamingText("");
      setHistory((h) => [...h, { role: "assistant", content: result.content || null, tool_calls: result.toolCalls.length ? result.toolCalls : undefined }]);
      if (result.abnormalFinish) { trailingTools = false; setError(`Response ended early (finish_reason: ${result.abnormalFinish}) — you can retry.`); break; }
      if (!result.toolCalls.length) { trailingTools = false; break; }
      trailingTools = true;
      await executeCalls(result.toolCalls, signal);
      if (signal.aborted) break;
    }
    if (trailingTools && !signal.aborted) {
      const final = await chatTransport({ apiKey: apiKey(), model: model(), messages: [systemMessage(), ...compactMessages(history()), { role: "system", content: "The tool-round limit was reached. Give a concise incomplete-state summary: what completed, what remains, and how the user can continue. Do not call tools." }], tools: [], signal, onText: (d) => setStreamingText((t) => t + d) });
      setStreamingText("");
      setHistory((h) => [...h, { role: "assistant", content: final.content || "I reached the tool-round limit before completing the request. Please continue or retry to finish the remaining work." }]);
      setError("Tool-round limit reached; the response is explicitly incomplete and can be continued.");
    }
  } catch (e) {
    const partial = streamingText();
    if (partial) setHistory((h) => [...h, { role: "assistant", content: partial }]);
    setError(isAbortError(e) || signal.aborted ? "Cancelled. You can edit your request and retry." : e instanceof Error ? e.message : String(e));
  } finally { setBusy(false); setStreamingText(""); controller = null; }
}
