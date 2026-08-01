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
  /** Provider-reported accounting from the final streaming chunk, when available. */
  usage?: Record<string, unknown>;
  /** OpenRouter request correlation identifier from the response headers. */
  generationId?: string;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function describeStreamValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  if (value === null) return "null";
  return JSON.stringify(value);
}

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
  let usage: Record<string, unknown> | undefined;
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
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (!isJsonRecord(json)) continue;
      // Mid-stream provider errors arrive as data frames, not HTTP errors — without this the
      // stream just ends and the user sees a silently clipped answer.
      const streamError = json.error;
      if (streamError) {
        const msg = isJsonRecord(streamError) ? streamError.message : streamError;
        throw new Error(`OpenRouter stream error: ${describeStreamValue(msg).slice(0, 300)}`);
      }
      if (isJsonRecord(json.usage)) usage = json.usage;
      const choice = isJsonArray(json.choices) ? json.choices[0] : undefined;
      if (!isJsonRecord(choice)) continue;
      const finish = choice.finish_reason;
      if (typeof finish === "string" && finish !== "stop" && finish !== "tool_calls") {
        abnormalFinish = finish;
      }
      const delta = choice.delta;
      if (!isJsonRecord(delta)) continue;
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        opts.onText(delta.content);
      }
      const toolCalls = isJsonArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const toolCall of toolCalls) {
        if (!isJsonRecord(toolCall)) continue;
        const idx = typeof toolCall.index === "number" ? toolCall.index : 0;
        const existing = toolByIndex.get(idx) ?? {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (typeof toolCall.id === "string" && toolCall.id) existing.id = toolCall.id;
        const toolFunction = toolCall.function;
        if (isJsonRecord(toolFunction)) {
          if (typeof toolFunction.name === "string" && toolFunction.name)
            existing.function.name = toolFunction.name;
          if (typeof toolFunction.arguments === "string" && toolFunction.arguments)
            existing.function.arguments += toolFunction.arguments;
        }
        toolByIndex.set(idx, existing);
      }
    }
  }

  const toolCalls = [...toolByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const generationId = res.headers.get("X-Generation-Id") ?? undefined;
  return {
    content,
    toolCalls,
    abnormalFinish,
    ...(usage ? { usage } : {}),
    ...(generationId ? { generationId } : {}),
  };
}
