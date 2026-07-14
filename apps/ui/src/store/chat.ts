import { createSignal } from "solid-js";
import { streamChat, type ChatMessage, type ToolCall } from "../llm/openrouter";
import { toolSchemas, runTool } from "../llm/tools";
import { workflowPrompt } from "../llm/workflows";
import { schemasForConversation, selectOutcomes, type Outcome } from "../llm/chat-routing";
import { apiKey, model, hasApiKey, chatMode } from "./settings";
import { fen, color, currentTree, currentPath, fileName, version } from "./game";
import type { Path } from "@chess-mcp/chess-tools";

const SYSTEM_PROMPT = `You are a chess assistant embedded in a board UI. Use local tools for chess claims. Be concise. Tool results may be compacted; retrieve current document data with the scoped retrieval tools when needed.`;
const MAX_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 6000;

export type ToolRunState = { id: string; name: string; status: "queued" | "running" | "completed" | "cancelled" | "failed"; done?: number; total?: number; detail?: string; error?: string };
const [history, setHistory] = createSignal<ChatMessage[]>([]);
const [streamingText, setStreamingText] = createSignal("");
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
const [toolRuns, setToolRuns] = createSignal<ToolRunState[]>([]);
let controller: AbortController | null = null;
let lastRequest = "";

export { history, streamingText, busy, error, toolRuns };
export function clearChat() { if (busy()) stop(); lastRequest = ""; setHistory([]); setToolRuns([]); setError(null); }
export function stop() { controller?.abort(); }
export function retry() { if (!busy() && lastRequest) void send(lastRequest); }

export function focusLine(path: Path) {
  const tree = currentTree();
  try {
    const san = tree.sanPathAt(path);
    if (san.length) setHistory((h) => [...h, { role: "focus", content: `Focused: ${san.at(-1)} — ${san.join(" ")} (${tree.fenAt(path)})`, focusPath: path }]);
  } catch { /* stale path */ }
}

function systemMessage(outcomes: readonly Outcome[]): ChatMessage {
  const tree = currentTree();
  const stats = tree.stats();
  const selected = tree.sanPathAt(currentPath());
  const type = stats.leaves > 1 ? "repertoire" : "game";
  const ctx = `Current normalized FEN: ${fen()}\nRepertoire/user color: ${color()}\nSelected SAN path: ${selected.length ? selected.join(" ") : "(root)"}\nDocument: type=${type}, revision=${version()}, file=${fileName() ?? "untitled"}\nTree: nodes=${stats.nodes}, leaves=${stats.leaves}, max_depth=${stats.maxDepth}\nEnabled outcome bundles: ${outcomes.join(", ")}`;
  return { role: "system", content: `${SYSTEM_PROMPT}\n\n${workflowPrompt(chatMode())}\n\n${ctx}` };
}

function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role !== "focus").map((m) => {
    if (m.role !== "tool" || !m.content || m.content.length <= MAX_TOOL_RESULT_CHARS) return m;
    let summary: string;
    try {
      const value = JSON.parse(m.content) as Record<string, unknown>;
      const preserve = ["error", "reason", "fen", "path", "selected_path", "revision", "total", "returned", "next_leaf", "partial"];
      summary = JSON.stringify({ compacted: true, keys: Object.keys(value), ...Object.fromEntries(preserve.filter((k) => k in value).map((k) => [k, value[k]])) });
    } catch { summary = JSON.stringify({ compacted: true, characters: m.content.length }); }
    return { ...m, content: summary };
  });
}

function updateRun(id: string, patch: Partial<ToolRunState>) {
  setToolRuns((runs) => runs.map((run) => run.id === id ? { ...run, ...patch } : run));
}
const cancelled = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

async function executeCalls(calls: ToolCall[], expanded: Set<Outcome>, signal: AbortSignal) {
  setToolRuns((runs) => [...runs, ...calls.map((tc) => ({ id: tc.id, name: tc.function.name, status: "queued" as const }))]);
  for (const tc of calls) {
    if (signal.aborted) { updateRun(tc.id, { status: "cancelled" }); continue; }
    updateRun(tc.id, { status: "running" });
    let result: unknown;
    try {
      let raw: unknown;
      try { raw = JSON.parse(tc.function.arguments || "{}"); }
      catch { raw = null; }
      result = await runTool(tc.function.name, raw as Record<string, unknown>, {
        signal,
        onProgress: (done, total, detail) => updateRun(tc.id, { done, total, detail }),
      });
      if (tc.function.name === "expand_capabilities" && result && typeof result === "object" && "expanded" in result) expanded.add((result as { expanded: Outcome }).expanded);
      updateRun(tc.id, { status: signal.aborted ? "cancelled" : "completed" });
    } catch (e) {
      const isCancelled = cancelled(e) || signal.aborted;
      result = isCancelled ? { error: "cancelled" } : { error: e instanceof Error ? e.message : String(e) };
      updateRun(tc.id, { status: isCancelled ? "cancelled" : "failed", error: isCancelled ? undefined : String((result as { error: string }).error) });
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
  const expanded = new Set<Outcome>();
  let trailingTools = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const outcomes = selectOutcomes(text, chatMode(), [...expanded]);
      setStreamingText("");
      const result = await streamChat({ apiKey: apiKey(), model: model(), messages: [systemMessage(outcomes), ...compactMessages(history())], tools: schemasForConversation(toolSchemas, outcomes), signal, onText: (d) => setStreamingText((t) => t + d) });
      setStreamingText("");
      setHistory((h) => [...h, { role: "assistant", content: result.content || null, tool_calls: result.toolCalls.length ? result.toolCalls : undefined }]);
      if (result.abnormalFinish) { trailingTools = false; setError(`Response ended early (finish_reason: ${result.abnormalFinish}) — you can retry.`); break; }
      if (!result.toolCalls.length) { trailingTools = false; break; }
      trailingTools = true;
      await executeCalls(result.toolCalls, expanded, signal);
      if (signal.aborted) break;
    }
    if (trailingTools && !signal.aborted) {
      const outcomes = selectOutcomes(text, chatMode(), [...expanded]);
      const final = await streamChat({ apiKey: apiKey(), model: model(), messages: [systemMessage(outcomes), ...compactMessages(history()), { role: "system", content: "The tool-round limit was reached. Give a concise incomplete-state summary: what completed, what remains, and how the user can continue. Do not call tools." }], tools: [], signal, onText: (d) => setStreamingText((t) => t + d) });
      setStreamingText("");
      setHistory((h) => [...h, { role: "assistant", content: final.content || "I reached the tool-round limit before completing the request. Please continue or retry to finish the remaining work." }]);
      setError("Tool-round limit reached; the response is explicitly incomplete and can be continued.");
    }
  } catch (e) {
    const partial = streamingText();
    if (partial) setHistory((h) => [...h, { role: "assistant", content: partial }]);
    setError(cancelled(e) || signal.aborted ? "Cancelled. You can edit your request and retry." : e instanceof Error ? e.message : String(e));
  } finally { setBusy(false); setStreamingText(""); controller = null; }
}
