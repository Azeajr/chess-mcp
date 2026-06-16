/**
 * Chat orchestration: holds the message history, streams the assistant turn, and runs the
 * tool loop (model → tool_calls → local execution → tool results → model …). The current
 * position (FEN + PGN + color) is injected into the system message each send, so the model is
 * always grounded without a round-trip. Errors surface inline; nothing here mutates the
 * repertoire (propose_line only stages suggestions).
 */
import { createSignal } from "solid-js";
import { streamChat, type ChatMessage, type ToolSchema } from "../llm/openrouter";
import { toolSchemas, runTool, BRIDGED_TOOLS } from "../llm/tools";
import {
  initBridge,
  listTools,
  callTool,
  bridgedSchema,
  takesRepertoireId,
} from "../llm/mcp-client";
import { apiKey, model, hasApiKey } from "./settings";
import { fen, color, actions } from "./game";

const SYSTEM_PROMPT = `You are a chess opening-repertoire assistant embedded in a board UI.
Always ground claims by calling tools (evaluate_position, get_legal_moves) — never
invent evaluations or assume a position. When you recommend a concrete continuation, call
propose_line so the user sees it on the board and can accept it; do not claim a line was added.
Be concise.`;

// One tool round ≈ one position checked; repertoire trees have many branches, so 6 was too low
// (retro #5). Still bounded to keep API cost predictable on a runaway loop.
const MAX_ROUNDS = 12;

const [history, setHistory] = createSignal<ChatMessage[]>([]);
const [streamingText, setStreamingText] = createSignal("");
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

// Dev-only MCP bridge (UI_MCP_BRIDGE_DESIGN.md). When reachable, the curated repertoire tools
// are merged into the model's tool surface; otherwise the chat runs with browser-native tools.
const [bridgeReady, setBridgeReady] = createSignal(false);
const [bridgedSchemas, setBridgedSchemas] = createSignal<ToolSchema[]>([]);
const [repertoireId, setRepertoireId] = createSignal<string | null>(null);

export { history, streamingText, busy, error, bridgeReady };

// Probe once at startup. Failure (deployed PWA / bridge off) leaves bridgeReady false → degrade.
void (async () => {
  if (!(await initBridge())) return;
  try {
    const defs = await listTools();
    const schemas: ToolSchema[] = [];
    for (const [name, def] of defs) if (BRIDGED_TOOLS.has(name)) schemas.push(bridgedSchema(def));
    setBridgedSchemas(schemas);
    setBridgeReady(true);
  } catch {
    /* leave degraded */
  }
})();

export function clearChat() {
  setHistory([]);
  setError(null);
}

/** Capture the repertoire_id from a load_repertoire result; returns it (or null). */
function captureId(text: string): string | null {
  try {
    const o = JSON.parse(text) as { repertoire_id?: string };
    if (o.repertoire_id) {
      setRepertoireId(o.repertoire_id);
      return o.repertoire_id;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/** Load (or re-load) the current working PGN into the MCP server; caches the handle (D2). */
export async function loadRepertoireForCurrent(): Promise<string | null> {
  if (!bridgeReady()) return null;
  try {
    return captureId(await callTool("load_repertoire", { pgn: actions.toPgn(), color: color() }));
  } catch {
    return null;
  }
}

/** Run a tool: browser-native via runTool, or a curated MCP tool over the bridge. */
async function execTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!(bridgeReady() && BRIDGED_TOOLS.has(name))) return runTool(name, args);

  const call = (a: Record<string, unknown>) => callTool(name, a);
  const a = { ...args };
  if (takesRepertoireId(name) && !a.repertoire_id && repertoireId()) a.repertoire_id = repertoireId();

  try {
    const text = await call(a);
    if (name === "load_repertoire") captureId(text);
    return text;
  } catch (e) {
    // Stale handle → re-load from the current PGN once and retry (D2).
    if (takesRepertoireId(name) && /not[_ ]found/i.test(String(e))) {
      const id = await loadRepertoireForCurrent();
      if (id) return call({ ...a, repertoire_id: id });
    }
    throw e;
  }
}

function systemMessage(): ChatMessage {
  const ctx = `Current FEN: ${fen()}\nRepertoire color: ${color()}\nWorking PGN:\n${actions.toPgn()}`;
  return { role: "system", content: `${SYSTEM_PROMPT}\n\n${ctx}` };
}

export async function send(userText: string) {
  const text = userText.trim();
  if (!text || busy()) return;
  if (!hasApiKey()) {
    setError("Set your OpenRouter API key in Settings.");
    return;
  }
  setError(null);
  setHistory((h) => [...h, { role: "user", content: text }]);
  setBusy(true);

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      setStreamingText("");
      const messages = [systemMessage(), ...history()];
      const { content, toolCalls } = await streamChat({
        apiKey: apiKey(),
        model: model(),
        messages,
        tools: [...toolSchemas, ...bridgedSchemas()],
        onText: (d) => setStreamingText((t) => t + d),
      });
      setStreamingText("");
      setHistory((h) => [
        ...h,
        { role: "assistant", content: content || null, tool_calls: toolCalls.length ? toolCalls : undefined },
      ]);

      if (!toolCalls.length) break;
      for (const tc of toolCalls) {
        let result: unknown;
        try {
          result = await execTool(tc.function.name, JSON.parse(tc.function.arguments || "{}"));
        } catch (e) {
          result = { error: String(e) };
        }
        // Bridged tools already return a string payload; native tools return an object.
        const content = typeof result === "string" ? result : JSON.stringify(result);
        setHistory((h) => [...h, { role: "tool", tool_call_id: tc.id, content }]);
      }
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
    setStreamingText("");
  }
}
