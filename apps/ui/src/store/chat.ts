import { createSignal } from "solid-js";
import { streamChat, type ChatMessage, type ToolCall } from "../llm/openrouter";
import { toolSchemas, runTool } from "../llm/tools";
import { workflowPrompt } from "../llm/workflows";
import { apiKey, model, hasApiKey, chatMode } from "./settings";
import { fen, color, currentTree, currentPath, fileName, version } from "./game";
import type { Path } from "@chess-mcp/chess-tools";
import {
  executionOutcome,
  isAbortError,
  type ExecutionStatus,
} from "../application/execution-status";
import { registerOperation, settleOperation, updateOperation } from "./operations";

/**
 * Human-readable label for a chat tool call. The registry's announcement policy speaks in
 * operations, not raw tool names; this mirrors the display names the UI already uses.
 */
function toolDisplayName(name: string): string {
  return name.replaceAll("_", " ");
}

const SYSTEM_PROMPT = `You are a chess assistant embedded in a board UI. Use local tools for chess claims. Be concise. Tool results may be compacted; retrieve current document data with the scoped retrieval tools when needed.`;
const MAX_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 6000;

export interface ToolRunState {
  id: string;
  name: string;
  status: Exclude<ExecutionStatus, "idle">;
  done?: number;
  total?: number;
  detail?: string;
  error?: string;
}
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
export function clearChat() {
  if (busy()) stop();
  lastRequest = "";
  setHistory([]);
  setToolRuns([]);
  setError(null);
}
export function stop() {
  controller?.abort();
}
export function retry() {
  if (!busy() && lastRequest) void send(lastRequest);
}
/** Test seam for request-level assertions; production always uses the OpenRouter transport. */
export function setChatTransportForTesting(transport?: typeof streamChat) {
  chatTransport = transport ?? streamChat;
}
/** Test seam for deterministic command fixtures; reset by passing no argument. */
export function setChatToolExecutorForTesting(executor?: typeof runTool) {
  toolExecutor = executor ?? runTool;
}

export function focusLine(path: Path) {
  const tree = currentTree();
  try {
    const san = tree.sanPathAt(path);
    if (san.length)
      setHistory((h) => [
        ...h,
        {
          role: "focus",
          content: `Focused: ${san.at(-1)} — ${san.join(" ")} (${tree.fenAt(path)})`,
          focusPath: path,
        },
      ]);
  } catch {
    /* stale path */
  }
}

/**
 * WP-028 AC-2 test seam: append a user message so a suggestion can reference it by index.
 * DEV-only, like the other harness seams.
 */
export function appendUserMessageForTesting(text: string): number {
  if (!import.meta.env.DEV) throw new Error("Test-only function");
  setHistory((all) => [...all, { role: "user", content: text }]);
  return history().length - 1;
}

/** Development harness seam for typed result/action/artifact UI verification. */
export function appendToolResultForTesting(operation: string, result: unknown) {
  const id = `test-tool-${history().length}`;
  setHistory((all) => [
    ...all,
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name: operation, arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: id, content: JSON.stringify(result) },
  ]);
}

/**
 * WP-027 AC-1: the exact context values injected into every turn's system prompt.
 *
 * The context chip renders from this same function rather than recomputing the values, so what the
 * user is told the assistant can see cannot drift from what the assistant is actually sent.
 */
export interface ChatContextSnapshot {
  readonly fen: string;
  readonly color: string;
  readonly sanPath: readonly string[];
  readonly documentType: "repertoire" | "game";
  readonly revision: number;
  readonly fileName: string;
  readonly nodes: number;
  readonly leaves: number;
  readonly maxDepth: number;
}

export function chatContextSnapshot(): ChatContextSnapshot {
  const tree = currentTree();
  const stats = tree.stats();
  return {
    fen: fen(),
    color: color(),
    sanPath: tree.sanPathAt(currentPath()),
    documentType: stats.leaves > 1 ? "repertoire" : "game",
    revision: version(),
    fileName: fileName() ?? "untitled",
    nodes: stats.nodes,
    leaves: stats.leaves,
    maxDepth: stats.maxDepth,
  };
}

/** The context block verbatim, as appended to the system prompt. */
export function chatContextBlock(snapshot: ChatContextSnapshot = chatContextSnapshot()): string {
  return `Current normalized FEN: ${snapshot.fen}\nRepertoire/user color: ${snapshot.color}\nSelected SAN path: ${snapshot.sanPath.length ? snapshot.sanPath.join(" ") : "(root)"}\nDocument: type=${snapshot.documentType}, revision=${snapshot.revision}, file=${snapshot.fileName}\nTree: nodes=${snapshot.nodes}, leaves=${snapshot.leaves}, max_depth=${snapshot.maxDepth}`;
}

function systemMessage(): ChatMessage {
  return {
    role: "system",
    content: `${SYSTEM_PROMPT}\n\n${workflowPrompt(chatMode())}\n\n${chatContextBlock()}`,
  };
}

const REFERENCE_KEYS = new Set([
  "error",
  "reason",
  "fen",
  "path",
  "san_path",
  "variation_path",
  "pivot_path",
  "joins_path",
  "selected_path",
  "revision",
  "action_id",
  "artifact_id",
  "kind",
  "format",
  "name",
  "media_type",
  "bytes",
  "total",
  "returned",
  "next_leaf",
  "partial",
  "page",
  "next_page",
  "truncated",
  "cursor",
  "next_cursor",
  "retrieval",
  "request_id",
  "report_id",
  "finding_id",
  "semantic_finding_id",
  "cohort_id",
  "pivot_id",
  "candidate_id",
  "change_set_id",
  "stage_id",
  "archive_id",
  "operation_id",
  "proposal_id",
  "repertoire_revision",
  "base_repertoire_revision",
  "replacement_schema_version",
  "source_id",
  "version",
  "source_san_paths",
  "constraint_set_id",
  "option_id",
  "portfolio_version",
]);

export function compactToolResult(content: string): string {
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object")
      return JSON.stringify({ compacted: true, characters: content.length });
    const references: Record<string, unknown>[] = [];
    const referencesByLocation = new Map<string, Record<string, unknown>>();
    const addReference = (location: string, kept: Record<string, unknown>) => {
      if (!Object.keys(kept).length) return;
      const existing = referencesByLocation.get(location);
      if (existing) {
        Object.assign(existing, kept);
        return;
      }
      if (references.length >= 100) return;
      const reference = { location, ...kept };
      references.push(reference);
      referencesByLocation.set(location, reference);
    };
    // Strategic Fit reports contain enough provenance to exhaust the general reference bound
    // before findings are reached. Pin semantic report/finding identities first so follow-up
    // discussion never loses the canonical handles during history compaction.
    const pinStrategicFitIdentities = (candidate: unknown, location: string) => {
      if (!candidate || typeof candidate !== "object") return;
      if (Array.isArray(candidate)) {
        candidate.forEach((item, index) => {
          pinStrategicFitIdentities(item, `${location}[${index}]`);
        });
        return;
      }
      const item = candidate as Record<string, unknown>;
      if (typeof item.report_id === "string")
        addReference(location, {
          report_id: item.report_id,
          ...(typeof item.repertoire_revision === "string"
            ? { repertoire_revision: item.repertoire_revision }
            : {}),
        });
      if (typeof item.finding_id === "string") {
        const findingReferences =
          item.references && typeof item.references === "object" && !Array.isArray(item.references)
            ? (item.references as Record<string, unknown>)
            : null;
        addReference(location, {
          finding_id: item.finding_id,
          ...(typeof item.repertoire_revision === "string"
            ? { repertoire_revision: item.repertoire_revision }
            : {}),
          ...(Array.isArray(findingReferences?.source_san_paths)
            ? { source_san_paths: findingReferences.source_san_paths }
            : {}),
        });
      }
      for (const [key, child] of Object.entries(item))
        pinStrategicFitIdentities(child, `${location}.${key}`);
    };
    const visit = (candidate: unknown, location: string) => {
      if (references.length >= 100 || !candidate || typeof candidate !== "object") return;
      if (Array.isArray(candidate)) {
        candidate.forEach((item, index) => {
          visit(item, `${location}[${index}]`);
        });
        return;
      }
      const item = candidate as Record<string, unknown>;
      const kept = Object.fromEntries(
        Object.entries(item).filter(([key]) => REFERENCE_KEYS.has(key)),
      );
      addReference(location, kept);
      for (const [key, child] of Object.entries(item)) visit(child, `${location}.${key}`);
    };
    pinStrategicFitIdentities(value, "$result");
    visit(value, "$result");
    const root = value as Record<string, unknown>;
    return JSON.stringify({
      compacted: true,
      keys: Object.keys(root),
      references,
      references_truncated: references.length >= 100,
    });
  } catch {
    return JSON.stringify({ compacted: true, characters: content.length });
  }
}

function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => m.role !== "focus")
    .map((m) => {
      if (m.role !== "tool" || !m.content || m.content.length <= MAX_TOOL_RESULT_CHARS) return m;
      return { ...m, content: compactToolResult(m.content) };
    });
}

function updateRun(id: string, patch: Partial<ToolRunState>) {
  setToolRuns((runs) => runs.map((run) => (run.id === id ? { ...run, ...patch } : run)));
}

/**
 * WP-027 AC-3: per-call abort controllers, one per tool run.
 *
 * The turn's own signal aborts every child (so `Stop this request` still stops everything), but a
 * child aborting does not touch the turn — which is what lets one run be cancelled while earlier
 * completed runs stay `completed` and the turn continues to the next call.
 */
const runControllers = new Map<string, AbortController>();

export function cancelRun(id: string) {
  const controllerForRun = runControllers.get(id);
  if (controllerForRun) controllerForRun.abort();
}

async function executeCalls(calls: ToolCall[], signal: AbortSignal) {
  setToolRuns((runs) => [
    ...runs,
    ...calls.map((tc) => ({ id: tc.id, name: tc.function.name, status: "queued" as const })),
  ]);
  for (const tc of calls) {
    if (signal.aborted) {
      updateRun(tc.id, { status: "cancelled" });
      continue;
    }
    // A per-run controller linked to the turn: aborting the turn aborts this run, but cancelling
    // this run leaves the turn's controller untouched.
    const runController = new AbortController();
    runControllers.set(tc.id, runController);
    const abortRun = () => {
      runController.abort();
    };
    signal.addEventListener("abort", abortRun, { once: true });
    const runSignal = runController.signal;

    updateRun(tc.id, { status: "running" });
    // WP-010: each chat tool call is a registry operation. The registry owns the announcements.
    const operationId = registerOperation({
      kind: "chat-tool",
      label: toolDisplayName(tc.function.name),
      surface: "chat",
      cancel: abortRun,
    });
    let result: unknown;
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(tc.function.arguments || "{}");
      } catch {
        raw = null;
      }
      result = await toolExecutor(tc.function.name, raw, {
        signal: runSignal,
        onProgress: (done, total, detail) => {
          updateRun(tc.id, { done, total, detail });
          updateOperation(operationId, { done, total, detail });
        },
      });
      const outcome = executionOutcome(runSignal.aborted);
      updateRun(tc.id, { status: outcome });
      settleOperation(
        operationId,
        outcome === "completed" ? "completed" : outcome,
        outcome === "failed" ? { detail: "tool error" } : undefined,
      );
    } catch (e) {
      const isCancelled = isAbortError(e) || runSignal.aborted;
      result = isCancelled
        ? { error: "cancelled" }
        : { error: e instanceof Error ? e.message : String(e) };
      const outcome = executionOutcome(isCancelled, true);
      updateRun(tc.id, {
        status: outcome,
        error: isCancelled ? undefined : (result as { error: string }).error,
      });
      settleOperation(
        operationId,
        outcome,
        outcome === "failed" ? { detail: (result as { error: string }).error } : undefined,
      );
    } finally {
      signal.removeEventListener("abort", abortRun);
    }
    setHistory((h) => [
      ...h,
      { role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) },
    ]);
  }
  for (const tc of calls) runControllers.delete(tc.id);
}

export async function send(userText: string) {
  const text = userText.trim();
  if (!text || busy()) return;
  if (!hasApiKey()) {
    setError("Set your OpenRouter API key in Settings.");
    return;
  }
  lastRequest = text;
  setError(null);
  setHistory((h) => [...h, { role: "user", content: text }]);
  setBusy(true);
  // WP-027 AC-2: runs are conversation history, not per-turn scratch. They stay keyed by
  // tool_call_id so a later turn never destroys the record of an earlier turn's work.
  controller = new AbortController();
  const signal = controller.signal;
  let trailingTools = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      setStreamingText("");
      const result = await chatTransport({
        apiKey: apiKey(),
        model: model(),
        messages: [systemMessage(), ...compactMessages(history())],
        tools: toolSchemas,
        signal,
        onText: (d) => setStreamingText((t) => t + d),
      });
      setStreamingText("");
      setHistory((h) => [
        ...h,
        {
          role: "assistant",
          content: result.content || null,
          tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
        },
      ]);
      if (result.abnormalFinish) {
        trailingTools = false;
        setError(`Response ended early (finish_reason: ${result.abnormalFinish}) — you can retry.`);
        break;
      }
      if (!result.toolCalls.length) {
        trailingTools = false;
        break;
      }
      trailingTools = true;
      await executeCalls(result.toolCalls, signal);
      if (signal.aborted) break;
    }
    if (trailingTools && !signal.aborted) {
      const final = await chatTransport({
        apiKey: apiKey(),
        model: model(),
        messages: [
          systemMessage(),
          ...compactMessages(history()),
          {
            role: "system",
            content:
              "The tool-round limit was reached. Give a concise incomplete-state summary: what completed, what remains, and how the user can continue. Do not call tools.",
          },
        ],
        tools: [],
        signal,
        onText: (d) => setStreamingText((t) => t + d),
      });
      setStreamingText("");
      setHistory((h) => [
        ...h,
        {
          role: "assistant",
          content:
            final.content ||
            "I reached the tool-round limit before completing the request. Please continue or retry to finish the remaining work.",
        },
      ]);
      setError(
        "Tool-round limit reached; the response is explicitly incomplete and can be continued.",
      );
    }
  } catch (e) {
    const partial = streamingText();
    if (partial) setHistory((h) => [...h, { role: "assistant", content: partial }]);
    setError(
      isAbortError(e) || signal.aborted
        ? "Cancelled. You can edit your request and retry."
        : e instanceof Error
          ? e.message
          : String(e),
    );
  } finally {
    setBusy(false);
    setStreamingText("");
    controller = null;
  }
}
