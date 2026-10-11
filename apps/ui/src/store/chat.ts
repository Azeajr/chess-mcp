import { createSignal } from "solid-js";
import { history, setHistory } from "./chat-history";
import { streamChat, type ChatMessage, type ToolCall } from "../llm/openrouter";
import {
  assistantToolSchemas,
  runAssistantTool as runTool,
  ownsCommandLifecycle,
} from "../llm/tools";
import { uiSnapshot, uiStateToken } from "../application/ui-actions";
import {
  pendingProposals,
  recordPresented,
  type AssistantTurnContext,
} from "../application/ui-adapters/proposals";
import {
  guidedStatus,
  setGuidedStatus,
  setGuidedPurpose,
  setGuidedReply,
  registerGuidedInterrupt,
} from "./guided-ui";
import { workflowPrompt } from "../llm/workflows";
import { GOAL_STARTERS, MISSING_KEY } from "../content/chat";
import { apiKey, model, hasApiKey, chatMode, setSettingsFocusTarget } from "./settings";
import { setSettingsOpen } from "./ui";
import { withoutCredentials } from "../application/chat-credentials";
import { fen, color, currentTree, currentPath, fileName, version } from "./game";
import type { Path } from "@chess-mcp/chess-tools";
import {
  executionOutcome,
  isAbortError,
  type ExecutionStatus,
} from "../application/execution-status";
import { registerOperation, settleOperation, updateOperation } from "./operations";
import { assertTestOnly } from "./test-seam";

function toolDisplayName(name: string): string {
  return name.replaceAll("_", " ");
}
const requestAborted = (signal: AbortSignal) => signal.aborted;

const SYSTEM_PROMPT = `You are a chess assistant embedded in a board UI. Use local tools for chess claims. Be concise. Tool results may be compacted; retrieve current document data with the scoped retrieval tools when needed.`;
const MAX_ROUNDS = 12;
const MAX_TOOL_RESULT_CHARS = 6000;
const MAX_TOOL_RUNS = 200;
export const MAX_TOOL_RUNS_FOR_TESTING = MAX_TOOL_RUNS;

interface ToolRunState {
  id: string;
  name: string;
  status: Exclude<ExecutionStatus, "idle">;
  done?: number;
  total?: number;
  detail?: string;
  error?: string;
}
const [streamingText, setStreamingText] = createSignal("");
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
const [toolRuns, setToolRuns] = createSignal<ToolRunState[]>([]);
let controller: AbortController | null = null;
let lastRequest = "";
// Each user message starts a turn. The application, not the model, assigns the message identity, so
// an approval or settings request can be traced to the words the user actually sent.
let turnSequence = 0;
let currentTurn: AssistantTurnContext | null = null;
export const currentAssistantTurn = () => currentTurn;
let chatTransportOverride: typeof streamChat | null = null;
let toolExecutorOverride: typeof runTool | null = null;
const chatTransport: typeof streamChat = (...args) =>
  (chatTransportOverride ?? streamChat)(...args);
const toolExecutor: typeof runTool = (...args) => (toolExecutorOverride ?? runTool)(...args);

export { history, streamingText, busy, error, toolRuns };
export function clearChat() {
  if (busy()) stop();
  lastRequest = "";
  setHistory([]);
  setToolRuns([]);
  setError(null);
}
export function stop() {
  if (guidedStatus() !== "paused") {
    setGuidedStatus("cancelled");
    setGuidedPurpose("Stopped. Completed results remain available.");
  }
  controller?.abort();
}
registerGuidedInterrupt(stop);
export function handoff() {
  stop();
  setGuidedPurpose("You're in control. Send a message whenever you want help.");
}
export async function replaceRequest(text: string) {
  if (busy()) {
    stop();
    await activeSend;
  }
  return send(text);
}
let activeSend: Promise<void> | undefined;
export function retry() {
  if (!busy() && lastRequest) void send(lastRequest);
}
export function setChatTransportForTesting(transport?: typeof streamChat) {
  assertTestOnly();
  chatTransportOverride = transport ?? null;
}
export function setChatToolExecutorForTesting(executor?: typeof runTool) {
  assertTestOnly();
  toolExecutorOverride = executor ?? null;
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

export function appendUserMessageForTesting(text: string): number {
  assertTestOnly();
  setHistory((all) => [...all, { role: "user", content: text }]);
  return history().length - 1;
}

export function appendToolResultForTesting(operation: string, result: unknown) {
  assertTestOnly();
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

export function chatContextBlock(snapshot: ChatContextSnapshot = chatContextSnapshot()): string {
  return `Current normalized FEN: ${snapshot.fen}\nRepertoire/user color: ${snapshot.color}\nSelected SAN path: ${snapshot.sanPath.length ? snapshot.sanPath.join(" ") : "(root)"}\nDocument: type=${snapshot.documentType}, revision=${snapshot.revision}, file=${snapshot.fileName}\nTree: nodes=${snapshot.nodes}, leaves=${snapshot.leaves}, max_depth=${snapshot.maxDepth}`;
}

function systemMessage(): ChatMessage {
  return {
    role: "system",
    content: `${SYSTEM_PROMPT}\n\n${workflowPrompt(chatMode())}\n\n${chatContextBlock()}\n\nCurrent UI state: ${JSON.stringify(uiSnapshot(currentTurn ?? undefined))}`,
  };
}

const REFERENCE_KEYS = new Set([
  "resultId",
  "stateToken",
  "actionId",
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

const runControllers = new Map<string, AbortController>();

export function cancelRun(id: string) {
  const controllerForRun = runControllers.get(id);
  if (controllerForRun) controllerForRun.abort();
}

async function executeCalls(calls: ToolCall[], signal: AbortSignal) {
  setToolRuns((runs) => {
    const next = [
      ...runs,
      ...calls.map((tc) => ({ id: tc.id, name: tc.function.name, status: "queued" as const })),
    ];
    return next.length > MAX_TOOL_RUNS ? next.slice(next.length - MAX_TOOL_RUNS) : next;
  });
  for (const tc of calls) {
    if (signal.aborted) {
      updateRun(tc.id, { status: "cancelled" });
      setHistory((h) => [
        ...h,
        { role: "tool", tool_call_id: tc.id, content: '{"error":"cancelled"}' },
      ]);
      continue;
    }
    const runController = new AbortController();
    runControllers.set(tc.id, runController);
    const abortRun = () => {
      runController.abort();
    };
    signal.addEventListener("abort", abortRun, { once: true });
    const runSignal = runController.signal;

    updateRun(tc.id, { status: "running" });
    let raw: unknown;
    try {
      raw = JSON.parse(tc.function.arguments || "{}");
    } catch {
      raw = null;
    }
    const operationId =
      !toolExecutorOverride && ownsCommandLifecycle(tc.function.name, raw)
        ? null
        : registerOperation({
            kind: "chat-tool",
            label: toolDisplayName(tc.function.name),
            surface: "chat",
            cancel: abortRun,
          });
    let result: unknown;
    const proposalsBefore = new Set(pendingProposals().map((proposal) => proposal.proposalId));
    try {
      result = await toolExecutor(tc.function.name, raw, {
        signal: runSignal,
        onProgress: (done, total, detail) => {
          updateRun(tc.id, { done, total, detail });
          if (operationId) updateOperation(operationId, { done, total, detail });
        },
        ...(currentTurn ? { turn: currentTurn } : {}),
      });
      const failed =
        !!result &&
        typeof result === "object" &&
        "error" in result &&
        typeof result.error === "string";
      const outcome = executionOutcome(runSignal.aborted, failed);
      updateRun(tc.id, { status: outcome });
      if (operationId)
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
      if (operationId)
        settleOperation(
          operationId,
          outcome,
          outcome === "failed" ? { detail: (result as { error: string }).error } : undefined,
        );
    } finally {
      signal.removeEventListener("abort", abortRun);
      // Any proposal a tool staged appears as a card in this turn; record it as presented.
      if (currentTurn)
        recordPresented(
          currentTurn.turnId,
          pendingProposals().filter((proposal) => !proposalsBefore.has(proposal.proposalId)),
        );
    }
    setHistory((h) => [
      ...h,
      { role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) },
    ]);
  }
  for (const tc of calls) runControllers.delete(tc.id);
}

export function send(userText: string): Promise<void> {
  if (busy()) return Promise.resolve();
  activeSend = sendTurn(userText);
  return activeSend;
}

async function sendTurn(userText: string) {
  if (busy()) return;
  const removed = withoutCredentials(userText.trim());
  const text = removed.text;
  if (!text) return;
  // Credentials are entered only in Settings: open it at the field the message held a value for.
  const [credential] = removed.fields;
  if (credential) {
    setSettingsFocusTarget(credential);
    setSettingsOpen(true);
  }
  if (!hasApiKey()) {
    // Keep the request through the detour to Settings, so Send again sends it.
    lastRequest = text;
    const goal = GOAL_STARTERS.find((starter) => starter.label === text);
    setError(goal ? MISSING_KEY.withManualRoute(goal.manual) : MISSING_KEY.message);
    return;
  }
  lastRequest = text;
  setError(null);
  const turnId = ++turnSequence;
  currentTurn = { turnId, messageId: `user-message-${turnId}`, text };
  setHistory((h) => [...h, { role: "user", content: text }]);
  setBusy(true);
  setGuidedStatus("executing");
  setGuidedPurpose(text.slice(0, 180));
  setGuidedReply("");
  controller = new AbortController();
  const signal = controller.signal;
  let trailingTools = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      setStreamingText("");
      const sourceToken = uiStateToken();
      const result = await chatTransport({
        apiKey: apiKey(),
        model: model(),
        messages: [systemMessage(), ...compactMessages(history())],
        tools: assistantToolSchemas,
        signal,
        onText: (d) => setStreamingText((t) => t + d),
      });
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (sourceToken !== uiStateToken()) {
        setGuidedStatus("paused");
        setGuidedPurpose("The position or inputs changed. Send a message to continue from here.");
        throw new DOMException("Context changed", "AbortError");
      }
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
      if (requestAborted(signal)) break;
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
    if (guidedStatus() === "executing") {
      setGuidedStatus(error() ? "failed" : "completed");
      const reply = history().at(-1);
      if (!error() && reply?.role === "assistant" && reply.content)
        setGuidedReply(reply.content.slice(0, 400));
    }
    setBusy(false);
    setStreamingText("");
    controller = null;
  }
}
