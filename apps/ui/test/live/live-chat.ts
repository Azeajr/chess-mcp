import { writeFileSync } from "node:fs";
import type { Page, Route } from "playwright/test";
import { expect, test as base } from "../e2e/helpers/fixtures";
import {
  CodexBackend,
  LiveBackendError,
  type Completion,
  type Usage,
  type WireMessage,
  type WireTool,
} from "./codex-backend";

export { expect };

// Playwright side of the live journeys (docs/LIVE_CHAT_TESTS.md). The app's chat request is answered
// in the test process by CodexBackend; this file only routes, records and waits. Nothing here knows
// the backend's wire format.

const APP_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TURN_TIMEOUT = 5 * 60_000;

type Round = {
  turn: number;
  ms: number;
  text: string;
  toolCalls: { name: string; arguments: unknown }[];
  receipts: unknown[];
  finish?: string;
  usage?: Usage;
  error?: string;
};

const parse = (value: string | null) => {
  try {
    return JSON.parse(value ?? "") as unknown;
  } catch {
    return value;
  }
};

// The app reads OpenRouter's chat-completions stream; answer in exactly that shape.
function chatStream({ text, toolCalls, finish, usage }: Completion) {
  const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    choices: [{ index: 0, delta, ...extra }],
  });
  const chunks = [
    ...(text ? [chunk({ role: "assistant", content: text })] : []),
    ...toolCalls.map((call, index) => chunk({ tool_calls: [{ index, ...call }] })),
    {
      ...chunk({}, { finish_reason: finish }),
      ...(usage
        ? {
            usage: {
              prompt_tokens: usage.input,
              completion_tokens: usage.output,
              total_tokens: usage.input + usage.output,
            },
          }
        : {}),
    },
  ];
  return `${chunks.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("")}data: [DONE]\n\n`;
}

export class LiveChat {
  readonly rounds: Round[] = [];
  readonly turns: { user: string; reply: string; rounds: number }[] = [];
  private pending = 0;
  private failure: Error | undefined;

  constructor(
    private readonly page: Page,
    private readonly backend: CodexBackend,
  ) {}

  get model() {
    return this.backend.model;
  }

  async answer(route: Route) {
    this.pending++;
    const started = Date.now();
    const body = route.request().postDataJSON() as { messages: WireMessage[]; tools?: WireTool[] };
    // Tool results arrive with the next request: they are the previous round's receipts.
    const previous = this.rounds.at(-1);
    if (previous?.toolCalls.length) {
      const last = body.messages.map((message) => message.role).lastIndexOf("assistant");
      previous.receipts = body.messages
        .slice(last + 1)
        .filter((message) => message.role === "tool")
        .map((message) => parse(message.content));
    }
    const round: Round = {
      turn: this.turns.length,
      ms: 0,
      text: "",
      toolCalls: [],
      receipts: [],
    };
    this.rounds.push(round);
    try {
      const result = await this.backend.complete({
        messages: body.messages,
        tools: body.tools ?? [],
      });
      Object.assign(round, {
        text: result.text,
        toolCalls: result.toolCalls.map((call) => ({
          name: call.function.name,
          arguments: parse(call.function.arguments),
        })),
        finish: result.finish,
        usage: result.usage,
      });
      round.ms = Date.now() - started;
      await route
        .fulfill({ status: 200, contentType: "text/event-stream", body: chatStream(result) })
        .catch(() => undefined);
    } catch (error) {
      round.ms = Date.now() - started;
      round.error = (error as Error).message;
      this.failure ??= error as Error;
      await route
        .fulfill({ status: 502, contentType: "text/plain", body: "live bridge: backend failed" })
        .catch(() => undefined);
    } finally {
      this.pending--;
    }
  }

  /** Sends one user message through the visible composer and waits for the assistant to finish. */
  async say(text: string): Promise<string> {
    const page = this.page;
    await page.evaluate(() => {
      const api = (
        window as unknown as { __chess: { apiKey(): string; setApiKey(k: string): void } }
      ).__chess;
      if (!api.apiKey()) api.setApiKey("live-codex-bridge");
    });
    this.turns.push({ user: text, reply: "", rounds: 0 });
    const start = this.rounds.length;
    // A user in a dialog goes back to the conversation first, as the stubbed journeys do.
    const back = page.getByRole("button", { name: "Return to chat", exact: true }).first();
    if (await back.isVisible()) await back.click();
    const chatTab = page.getByRole("tab", { name: /Chat/ });
    if (await chatTab.isVisible()) await chatTab.click();
    await page.getByRole("textbox", { name: "Chat message" }).fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect
      .poll(
        async () => {
          if (this.failure) return "failed";
          if (this.pending || this.rounds.length === start) return "running";
          const busy = await page.evaluate(() =>
            (window as unknown as { __chess: { chatBusy(): boolean } }).__chess.chatBusy(),
          );
          return busy ? "running" : "done";
        },
        { timeout: TURN_TIMEOUT, intervals: [500], message: `assistant turn "${text}"` },
      )
      .not.toBe("running");
    const rounds = this.rounds.slice(start);
    const turn = this.turns.at(-1)!;
    turn.rounds = rounds.length;
    turn.reply = rounds.filter((round) => !round.toolCalls.length).at(-1)?.text ?? "";
    if (this.failure) {
      const infrastructure = this.failure instanceof LiveBackendError;
      test.info().annotations.push({
        type: infrastructure ? "infrastructure" : "bridge-error",
        description: this.failure.message,
      });
      throw this.failure;
    }
    return turn.reply;
  }

  /** The `ui_act` receipts of this turn and earlier ones, in order. */
  receipts() {
    return this.rounds.flatMap((round) => round.receipts) as {
      status?: string;
      error?: string;
      result?: Record<string, unknown>;
    }[];
  }

  transcript() {
    return { model: this.model, turns: this.turns, rounds: this.rounds };
  }
}

/** An invariant the app must hold whatever the model does; a failure is a safety breach. */
export async function safety(name: string, check: () => Promise<unknown> | unknown) {
  await test.step(`safety: ${name}`, async () => {
    try {
      await check();
    } catch (error) {
      test.info().annotations.push({ type: "safety-breach", description: name });
      throw error;
    }
  });
}

/** Whether the model finished the user's task; failures count against its pass rate. */
export const outcome = (name: string, check: () => Promise<unknown> | unknown) =>
  test.step(`outcome: ${name}`, async () => {
    const errors = test.info().errors.length;
    await check();
    if (test.info().errors.length > errors)
      test.info().annotations.push({ type: "outcome-miss", description: name });
  });

export const test = base.extend<{ live: LiveChat }, { liveModel: string }>({
  liveModel: ["", { option: true, scope: "worker" }],
  live: async ({ page, liveModel }, use, testInfo) => {
    const chat = new LiveChat(page, CodexBackend.fromCodexLogin(liveModel));
    await page.route(APP_ENDPOINT, (route) => chat.answer(route));
    await use(chat);
    // Written to the run's output directory so it outlives the run, passing or not.
    const path = testInfo.outputPath("transcript.json");
    writeFileSync(path, JSON.stringify(chat.transcript(), null, 2));
    await testInfo.attach("transcript.json", { path, contentType: "application/json" });
  },
});
