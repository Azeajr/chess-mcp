/**
 * Chat orchestration: holds the message history, streams the assistant turn, and runs the
 * tool loop (model → tool_calls → local execution → tool results → model …). The current
 * position (FEN + PGN + color) is injected into the system message each send, so the model is
 * always grounded without a round-trip. Errors surface inline; nothing here mutates the
 * repertoire (propose_line only stages suggestions).
 */
import { createSignal } from "solid-js";
import { streamChat, type ChatMessage } from "../llm/openrouter";
import { toolSchemas, runTool } from "../llm/tools";
import { apiKey, model, hasApiKey } from "./settings";
import { fen, color, actions } from "./game";

const SYSTEM_PROMPT = `You are a chess opening-repertoire assistant embedded in a board UI.
Always ground claims by calling tools (evaluate_position, cloud_eval, get_legal_moves) — never
invent evaluations or assume a position. When you recommend a concrete continuation, call
propose_line so the user sees it on the board and can accept it; do not claim a line was added.
Be concise.`;

const MAX_ROUNDS = 6;

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
