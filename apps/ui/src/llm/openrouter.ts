/**
 * OpenRouter chat client — OpenAI-compatible, streamed, with tool calling. Provider-agnostic:
 * the model is a user setting (e.g. "anthropic/claude-sonnet-4.5"). One round per call; the
 * caller (store/chat.ts) runs the tool loop. Browser fetch direct to OpenRouter (CORS-enabled),
 * key from localStorage.
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  // "focus" is a UI-only marker (a tree-click context note); it is never sent to the model —
  // store/chat.ts filters it out before each request.
  role: "system" | "user" | "assistant" | "tool" | "focus";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** UI-only: the index path a "focus" marker points at, for click-to-revisit. Not wired. */
  focusPath?: number[];
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface RoundResult {
  content: string;
  toolCalls: ToolCall[];
  /** finish_reason when it is not a normal end ("length", "content_filter", …). */
  abnormalFinish?: string;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function wireMessage(m: ChatMessage) {
  return {
    role: m.role,
    content: m.content,
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
  };
}

/**
 * One streamed assistant turn. `onText` fires for each content delta; the returned object has
 * the full accumulated content plus any tool calls the model requested (with arguments
 * reassembled from their streamed fragments).
 */
export async function streamChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
}): Promise<RoundResult> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Chess Repertoire",
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages.map(wireMessage),
      tools: opts.tools.length ? opts.tools : undefined,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let abnormalFinish: string | undefined;
  // Tool calls stream as fragments keyed by index; reassemble here.
  const toolByIndex = new Map<number, ToolCall>();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      // Mid-stream provider errors arrive as data frames, not HTTP errors — without this the
      // stream just ends and the user sees a silently clipped answer.
      if (json.error) {
        const msg =
          typeof json.error === "object" && json.error !== null
            ? (json.error.message ?? JSON.stringify(json.error))
            : String(json.error);
        throw new Error(`OpenRouter stream error: ${String(msg).slice(0, 300)}`);
      }
      const choice = json.choices?.[0];
      const finish = choice?.finish_reason;
      if (typeof finish === "string" && finish !== "stop" && finish !== "tool_calls") {
        abnormalFinish = finish;
      }
      const delta = choice?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        opts.onText(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const existing =
          toolByIndex.get(idx) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name = tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        toolByIndex.set(idx, existing);
      }
    }
  }

  const toolCalls = [...toolByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  return { content, toolCalls, abnormalFinish };
}
