/**
 * Chat orchestration: holds the message history, streams the assistant turn, and runs the
 * tool loop (model → tool_calls → local execution → tool results → model …). The current
 * position (FEN + PGN + color) is injected into the system message each send, so the model is
 * always grounded without a round-trip. Every tool runs in the browser (llm/tools.ts) against
 * chess-tools + the local engine — the full repertoire toolset, identical in dev and the deployed
 * PWA (no Node bridge). Errors surface inline; nothing here mutates the repertoire (propose_line
 * and modify_repertoire_line only stage/preview).
 */
import { createSignal } from "solid-js";
import { streamChat, type ChatMessage } from "../llm/openrouter";
import { toolSchemas, runTool } from "../llm/tools";
import { workflowPrompt } from "../llm/workflows";
import { apiKey, model, hasApiKey, chatMode } from "./settings";
import { fen, color, actions } from "./game";

const SYSTEM_PROMPT = `You are a chess assistant embedded in a board UI. Every tool runs locally
against the board, the chess engine, and the chess library — use them; never guess. Be concise.`;

// One tool round ≈ one position checked; repertoire trees have many branches, so 6 was too low
// (retro #5). Still bounded to keep API cost predictable on a runaway loop.
const MAX_ROUNDS = 12;

const [history, setHistory] = createSignal<ChatMessage[]>([]);
const [streamingText, setStreamingText] = createSignal("");
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

export { history, streamingText, busy, error };

export function clearChat() {
  setHistory([]);
  setError(null);
}

function systemMessage(): ChatMessage {
  const ctx = `Current FEN: ${fen()}\nRepertoire color: ${color()}\nWorking PGN:\n${actions.toPgn()}`;
  return { role: "system", content: `${SYSTEM_PROMPT}\n\n${workflowPrompt(chatMode())}\n\n${ctx}` };
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
        tools: toolSchemas,
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
          result = await runTool(tc.function.name, JSON.parse(tc.function.arguments || "{}"));
        } catch (e) {
          result = { error: String(e) };
        }
        setHistory((h) => [...h, { role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) }]);
      }
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
    setStreamingText("");
  }
}
