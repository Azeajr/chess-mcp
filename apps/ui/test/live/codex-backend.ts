import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The one place that knows the ChatGPT Codex backend's wire format (docs/LIVE_CHAT_TESTS.md).
//
// The backend is the transport the Codex CLI and Hermes' `openai-codex` provider use; it is not a
// documented public API, so every way it can move under us is classified here and reported with
// what to do about it. Callers speak the app's chat-completions shapes in both directions and never
// see Responses items, headers or the credential.
//
// Wire details follow the public openai/codex source: codex-rs/codex-api/src/common.rs
// (ResponsesApiRequest), codex-rs/model-provider/src/bearer_auth_provider.rs (headers),
// codex-rs/login/src/auth/storage.rs (auth.json) and codex-rs/codex-api/src/sse/responses.rs
// (stream events).

const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const WIRE_SOURCE = "codex-rs/codex-api/src/common.rs and src/sse/responses.rs in openai/codex";

// Only the default; nothing else depends on which model runs (`LIVE_MODEL`, below).
const DEFAULT_MODEL = "gpt-5.6-terra";
const REASONING = process.env.LIVE_REASONING?.trim() || undefined;

export type BackendFailure = "login" | "model" | "usage-limit" | "drift" | "unavailable";

export class LiveBackendError extends Error {
  constructor(
    readonly kind: BackendFailure,
    detail: string,
    readonly hint: string,
  ) {
    super(`[${kind}] ${detail}\n  → ${hint}`);
    this.name = "LiveBackendError";
  }
}

export type WireToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type WireMessage = {
  role: string;
  content: string | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
};
export type WireTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
export type Usage = { input: number; cachedInput: number; output: number; reasoning: number };
export type Completion = {
  text: string;
  toolCalls: WireToolCall[];
  finish: "stop" | "tool_calls" | "length";
  usage?: Usage;
};

type Login = { accessToken: string; accountId?: string };

const MODEL_HINT = "`codex debug models` lists the slugs this plan can use; set LIVE_MODEL to one.";

/**
 * `LIVE_MODEL` is a comma-separated list; each entry is an exact slug (`gpt-6-luna`) or a family
 * alias (`terra`, `luna`, `sol`, …) that resolves to the newest listed model of that family in the
 * Codex CLI's model catalog. Each model becomes its own Playwright project.
 */
export function liveModels(): string[] {
  const requested = (process.env.LIVE_MODEL ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set((requested.length ? requested : [DEFAULT_MODEL]).map(resolveModel))];
}

function resolveModel(requested: string): string {
  if (/[-.]/.test(requested)) return requested;
  const file = join(codexHome(), "models_cache.json");
  let slugs: string[] = [];
  try {
    const catalog = JSON.parse(readFileSync(file, "utf8")) as {
      models?: { slug?: unknown; visibility?: unknown }[];
    };
    slugs = (catalog.models ?? [])
      .filter((model) => model.visibility === "list" && typeof model.slug === "string")
      .map((model) => model.slug as string)
      .filter((slug) => slug.endsWith(`-${requested}`));
  } catch {
    throw new LiveBackendError(
      "model",
      `LIVE_MODEL=${requested} is a family alias, but ${file} is unreadable.`,
      `Run any \`codex\` command to refresh the catalog, or ${MODEL_HINT}`,
    );
  }
  const version = (slug: string) =>
    (slug.match(/(\d+(?:\.\d+)*)/)?.[1] ?? "0").split(".").map(Number);
  const newest = slugs.sort((a, b) => {
    const [left, right] = [version(a), version(b)];
    for (let index = 0; index < Math.max(left.length, right.length); index++)
      if ((left[index] ?? 0) !== (right[index] ?? 0))
        return (right[index] ?? 0) - (left[index] ?? 0);
    return 0;
  })[0];
  if (!newest)
    throw new LiveBackendError("model", `No listed "${requested}" model in ${file}.`, MODEL_HINT);
  return newest;
}

function codexHome() {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

// Read-only: refresh tokens rotate, so refreshing here would sign out the Codex CLI and Hermes.
function readLogin(): Login {
  const file = join(codexHome(), "auth.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new LiveBackendError(
      "login",
      `No readable Codex login at ${file}.`,
      "Run `codex login` and sign in with ChatGPT (or set CODEX_HOME).",
    );
  }
  const tokens = (parsed as { tokens?: { access_token?: unknown; account_id?: unknown } }).tokens;
  if (typeof tokens?.access_token !== "string" || !tokens.access_token)
    throw new LiveBackendError(
      "login",
      `${file} holds no ChatGPT access token (an API-key login has none).`,
      "Run `codex login` and choose Sign in with ChatGPT.",
    );
  const expiry = tokenExpiry(tokens.access_token);
  if (expiry !== undefined && expiry < Date.now() + 60_000)
    throw new LiveBackendError(
      "login",
      `The Codex access token expired at ${new Date(expiry).toISOString()}.`,
      "Run any `codex` command (e.g. `codex exec 'say ok'`) so the CLI refreshes it, then retry.",
    );
  return {
    accessToken: tokens.access_token,
    accountId: typeof tokens.account_id === "string" ? tokens.account_id : undefined,
  };
}

function tokenExpiry(token: string): number | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    return typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

const text = (role: string, content: string) => ({
  type: "message",
  role,
  content: [{ type: role === "assistant" ? "output_text" : "input_text", text: content }],
});

function toInput(messages: WireMessage[]) {
  return messages.flatMap((message): unknown[] => {
    const content = message.content ?? "";
    switch (message.role) {
      // Mid-conversation system messages (the app's round-limit summary) stay instructions.
      case "system":
        return [text("developer", content)];
      case "user":
        return [text("user", content)];
      case "assistant":
        return [
          ...(content ? [text("assistant", content)] : []),
          ...(message.tool_calls ?? []).map((call) => ({
            type: "function_call",
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          })),
        ];
      case "tool":
        return [{ type: "function_call_output", call_id: message.tool_call_id, output: content }];
      default:
        return [];
    }
  });
}

const toTools = (tools: WireTool[]) =>
  tools.map(({ function: tool }) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }));

const drift = (detail: string) =>
  new LiveBackendError(
    "drift",
    detail,
    `The backend's wire format may have changed. Compare test/live/codex-backend.ts with ${WIRE_SOURCE}.`,
  );

function classifyStatus(
  model: string,
  status: number,
  body: string,
  headers: Headers,
): LiveBackendError {
  const detail = `Codex backend answered ${status}: ${body.slice(0, 400) || "(empty body)"}`;
  if (status === 401 || status === 403)
    return new LiveBackendError(
      "login",
      detail,
      "The ChatGPT login was refused. Run any `codex` command to refresh it, or `codex login` again.",
    );
  if (status === 429) {
    // codex-rs/codex-api/src/rate_limits.rs: `<prefix>-primary-reset-at` is epoch seconds.
    const resetAt = Number(headers.get("x-codex-primary-reset-at"));
    const reset = Number.isFinite(resetAt) && resetAt > 0 ? new Date(resetAt * 1000) : undefined;
    return new LiveBackendError(
      "usage-limit",
      detail,
      `The ChatGPT plan's usage window is exhausted${reset ? `; it resets at ${reset.toLocaleString()}` : ""}. Retry later or lower LIVE_RUNS.`,
    );
  }
  if (status >= 500)
    return new LiveBackendError("unavailable", detail, "Transient backend failure; retry later.");
  if ((status === 400 || status === 404) && /model/i.test(body))
    return new LiveBackendError("model", detail, `${model} was refused. ${MODEL_HINT}`);
  // 400 (rejected body or model), 404 (endpoint moved), 415, … — something about the contract.
  return drift(detail);
}

type StreamEvent = { type?: unknown; [key: string]: unknown };

async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = done ? "" : (blocks.pop() ?? "");
    for (const block of blocks) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        throw drift(`Unparseable stream event: ${data.slice(0, 200)}`);
      }
    }
    if (done) return;
  }
}

function readUsage(response: unknown): Usage | undefined {
  const usage = (response as { usage?: Record<string, unknown> } | undefined)?.usage;
  if (!usage) return undefined;
  const number = (value: unknown) => (typeof value === "number" ? value : 0);
  const detail = (key: string, field: string) =>
    number((usage[key] as Record<string, unknown> | undefined)?.[field]);
  return {
    input: number(usage.input_tokens),
    cachedInput: detail("input_tokens_details", "cached_tokens"),
    output: number(usage.output_tokens),
    reasoning: detail("output_tokens_details", "reasoning_tokens"),
  };
}

export class CodexBackend {
  private readonly session = randomUUID();

  private constructor(
    readonly model: string,
    private readonly login: Login,
  ) {}

  /** Throws a `login` LiveBackendError when the Codex CLI is not signed in with ChatGPT. */
  static fromCodexLogin(model: string) {
    return new CodexBackend(model, readLogin());
  }

  async complete(request: {
    messages: WireMessage[];
    tools: WireTool[];
    signal?: AbortSignal;
  }): Promise<Completion> {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        signal: request.signal,
        headers: {
          Authorization: `Bearer ${this.login.accessToken}`,
          ...(this.login.accountId ? { "ChatGPT-Account-ID": this.login.accountId } : {}),
          originator: "codex_cli_rs",
          session_id: this.session,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          input: toInput(request.messages),
          ...(request.tools.length ? { tools: toTools(request.tools) } : {}),
          tool_choice: "auto",
          parallel_tool_calls: false,
          reasoning: REASONING ? { effort: REASONING } : null,
          store: false,
          include: [],
          prompt_cache_key: this.session,
        }),
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      throw new LiveBackendError(
        "unavailable",
        `Could not reach ${ENDPOINT}: ${(error as Error).message}`,
        "Check the network connection; retry later.",
      );
    }
    if (!response.ok)
      throw classifyStatus(
        this.model,
        response.status,
        await response.text().catch(() => ""),
        response.headers,
      );
    // The backend may omit Content-Type on its stream; only a document in its place is drift (an
    // HTML challenge page, or a JSON error with a 200 status).
    const type = response.headers.get("content-type") ?? "";
    if (/text\/html|application\/json/.test(type) || !response.body)
      throw drift(
        `Expected an event stream, got ${type || "no body"}: ${(await response.text().catch(() => "")).slice(0, 300)}`,
      );

    let text = "";
    let messageText = "";
    const toolCalls: WireToolCall[] = [];
    for await (const event of events(response.body)) {
      switch (event.type) {
        case "response.output_text.delta":
          if (typeof event.delta === "string") text += event.delta;
          break;
        case "response.output_item.done": {
          const item = event.item as Record<string, unknown> | undefined;
          if (item?.type === "function_call") {
            const { call_id: id, name, arguments: args } = item;
            if (typeof id !== "string" || typeof name !== "string" || typeof args !== "string")
              throw drift(`A function_call item is missing call_id, name or arguments.`);
            toolCalls.push({ id, type: "function", function: { name, arguments: args } });
          } else if (item?.type === "message" && Array.isArray(item.content)) {
            for (const part of item.content as { type?: string; text?: unknown }[])
              if (part.type === "output_text" && typeof part.text === "string")
                messageText += part.text;
          }
          break;
        }
        case "response.completed":
        case "response.incomplete":
          return {
            text: text || messageText,
            toolCalls,
            finish:
              event.type === "response.incomplete"
                ? "length"
                : toolCalls.length
                  ? "tool_calls"
                  : "stop",
            usage: readUsage(event.response),
          };
        case "response.failed":
        case "error": {
          const failure = (event.response as { error?: unknown } | undefined)?.error ?? event;
          const detail = JSON.stringify(failure).slice(0, 400);
          if (/usage_limit|rate_limit|quota/i.test(detail))
            throw new LiveBackendError(
              "usage-limit",
              `Codex backend stream failed: ${detail}`,
              "The ChatGPT plan's usage window is exhausted. Retry later or lower LIVE_RUNS.",
            );
          throw new LiveBackendError(
            "unavailable",
            `Codex backend stream failed: ${detail}`,
            "Usually transient; retry. If it repeats with the same message, the request shape may have drifted.",
          );
        }
      }
    }
    throw drift("The stream ended without response.completed.");
  }
}

/** One tiny round trip that exercises a tool definition, so drift fails the run once, up front. */
export async function probeBackend(model: string) {
  const result = await CodexBackend.fromCodexLogin(model).complete({
    messages: [
      { role: "system", content: "Call the ping tool exactly once with value 'ok'." },
      { role: "user", content: "Ping." },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "ping",
          description: "Connectivity probe.",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      },
    ],
  });
  if (!result.toolCalls.length && !result.text)
    throw drift("The probe returned neither text nor a tool call.");
  return result;
}
