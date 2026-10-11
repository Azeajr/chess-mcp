import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const diagnostics = await import("../src/store/diagnostics.ts");
const settings = await import("../src/store/settings.ts");
const chat = await import("../src/store/chat.ts");
const bundle = await import("../src/application/diagnostic-bundle.ts");

let persisted: unknown;
diagnostics.setDiagnosticsStorageForTesting({
  load: () => Promise.resolve(persisted),
  save: (value) => {
    persisted = structuredClone(value);
    return Promise.resolve();
  },
});

const API_KEY = "sk-or-v1-0123456789abcdef";
const LICHESS_TOKEN = "lip_abcdefgh12345678";

async function runTurn() {
  settings.setApiKey(API_KEY);
  settings.setLichessToken(LICHESS_TOKEN);
  chat.setChatTransportForTesting(async (opts) => {
    const last = opts.messages.at(-1);
    if (last?.role !== "user") return { content: "Here is what the report found.", toolCalls: [] };
    return {
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "get_strategic_fit_report", arguments: '{"report_id":"report:one"}' },
        },
      ],
      usage: { prompt_tokens: 1200 },
    };
  });
  // The result is past the compaction cap and leaks a credential, as provider text could.
  chat.setChatToolExecutorForTesting(async () => ({
    summary: { classification: "uncertain", echoed: `token ${LICHESS_TOKEN}` },
    padding: "x".repeat(7000),
  }));
  chat.clearChat();
  await chat.send("Run Strategic Fit and tell me what it found.");
}

function cleanup() {
  chat.setChatTransportForTesting();
  chat.setChatToolExecutorForTesting();
  settings.setApiKey("");
  settings.setLichessToken("");
  chat.clearChat();
  diagnostics.resetDiagnosticsForTesting();
}

test("each model round is recorded exactly as sent, with its response", async (t) => {
  t.after(cleanup);
  await runTurn();
  const [session] = diagnostics.sessions();
  assert.equal(session!.rounds.length, 2);
  const [first, second] = session!.rounds;
  assert.deepEqual(
    first!.toolCalls?.map((call) => call.name),
    ["get_strategic_fit_report"],
  );
  assert.deepEqual(first!.usage, { prompt_tokens: 1200 });
  assert.equal(second!.text, "Here is what the report found.");
  assert.equal(second!.turn, first!.turn);
  assert.deepEqual([first!.round, second!.round], [1, 2]);

  // The second request carried the tool result in compacted form: that is what the model read.
  const sent = second!.messages.find((message) => message.role === "tool");
  const sentText = diagnostics.resolveText(sent!.content!);
  assert.match(sentText, /"compacted":true/);
  assert.doesNotMatch(sentText, /classification/);

  // The tool call itself keeps the full result.
  const [tool] = session!.tools;
  assert.equal(tool!.name, "get_strategic_fit_report");
  assert.equal(tool!.status, "completed");
  assert.match(diagnostics.resolveText(tool!.result), /"classification":"uncertain"/);

  const kinds = session!.events.map((event) => event.kind);
  assert.equal(kinds.includes("user-message"), true);
  assert.equal(kinds.includes("turn-end"), true);
});

test("a repeated system prompt is stored once", async (t) => {
  t.after(cleanup);
  await runTurn();
  const [session] = diagnostics.sessions();
  const [first, second] = session!.rounds;
  const systemFirst = first!.messages[0]!.content!;
  const systemSecond = second!.messages[0]!.content!;
  const shared = systemFirst.filter((id) => systemSecond.includes(id));
  assert.ok(shared.length > 0, "consecutive system prompts share paragraphs");
  const texts = diagnostics.diagnosticTexts();
  const stored = [...new Set([...systemFirst, ...systemSecond])].reduce(
    (sum, id) => sum + texts.get(id)!.length,
    0,
  );
  const sentTwice =
    diagnostics.resolveText(systemFirst).length + diagnostics.resolveText(systemSecond).length;
  assert.ok(stored < sentTwice, "shared paragraphs are not stored twice");
});

test("the record survives a reload as the previous session", async (t) => {
  t.after(cleanup);
  await runTurn();
  diagnostics.recordFault("console.error", ["[engine] worker crashed"]);
  await diagnostics.flushDiagnostics();
  const before = diagnostics.sessions().at(-1)!;

  diagnostics.resetDiagnosticsForTesting();
  await diagnostics.restoreDiagnostics();
  const [previous, current] = diagnostics.sessions();
  assert.equal(previous!.id, before.id);
  assert.equal(previous!.rounds.length, 2);
  assert.equal(previous!.faults[0]!.message, "[engine] worker crashed");
  assert.equal(current!.rounds.length, 0);
  assert.match(diagnostics.resolveText(previous!.tools[0]!.result), /"classification":"uncertain"/);
});

test("the budget evicts the oldest entries but keeps faults", async (t) => {
  t.after(cleanup);
  for (let index = 0; index < 40; index++)
    diagnostics.recordToolCall({
      turn: 1,
      id: `call-${index}`,
      name: "find_repertoire_gaps",
      arguments: {},
      status: "completed",
      startedAt: Date.now() + index,
      result: `${index}`.padEnd(5_000, "y"),
    });
  diagnostics.recordFault("console.warn", ["[engine] slow"]);
  diagnostics.enforceDiagnosticsBudgetForTesting(60_000);
  const [session] = diagnostics.sessions();
  assert.ok(session!.tools.length < 40);
  assert.ok(session!.evicted > 0);
  assert.equal(session!.tools.at(-1)!.id, "call-39", "the newest entries stay");
  assert.equal(session!.faults.length, 1);
  assert.ok(diagnostics.diagnosticStats().bytes <= 60_000);
});

test("faults raised in the page are recorded and still reach the console", () => {
  const seen: unknown[][] = [];
  const target = Object.assign(new EventTarget(), {
    console: {
      error: (...values: unknown[]) => seen.push(values),
      warn: (...values: unknown[]) => seen.push(values),
    },
    document: { visibilityState: "visible" },
  });
  diagnostics.installFaultCapture(target as unknown as Window & typeof globalThis);
  target.console.error("[engine] worker crashed", new Error("boom"));
  target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "lost" }));
  const faults = diagnostics.sessions().at(-1)!.faults;
  assert.equal(seen.length, 1);
  assert.equal(faults[0]!.kind, "console.error");
  assert.match(faults[0]!.message, /\[engine\] worker crashed Error: boom/);
  assert.deepEqual(
    faults.map((fault) => fault.kind),
    ["console.error", "unhandledrejection"],
  );
});

test("a bundle carries the record and state but never a credential", async (t) => {
  t.after(cleanup);
  await runTurn();
  const saved = bundle.buildDiagnosticBundle({ includeRepertoire: false });
  assert.match(saved.name, /^chess-debug-\d{8}-\d{6}\.json$/);
  assert.equal(saved.content.includes(API_KEY), false);
  assert.equal(saved.content.includes(LICHESS_TOKEN), false);
  assert.match(saved.content, /\[redacted\]/);

  const parsed = JSON.parse(saved.content) as {
    schemaVersion: number;
    settings: { apiKeySet: boolean; lichessTokenSet: boolean };
    document: { pgn: unknown; pgnOmitted?: boolean };
    sessions: { rounds: unknown[] }[];
    texts: Record<string, string>;
    timeline: string[];
    state: { conversation: { role: string; content: string[] | null }[] };
  };
  assert.equal(parsed.schemaVersion, 1);
  assert.deepEqual(parsed.settings.apiKeySet, true);
  assert.deepEqual(parsed.settings.lichessTokenSet, true);
  assert.equal(parsed.document.pgn, null);
  assert.equal(parsed.document.pgnOmitted, true);
  assert.equal(parsed.sessions.at(-1)!.rounds.length, 2);
  assert.ok(parsed.timeline.some((line) => line.includes("user (turn")));
  assert.ok(parsed.timeline.some((line) => line.includes("tool get_strategic_fit_report")));
  const reply = parsed.state.conversation.at(-1)!;
  assert.equal(bundle.bundleText(reply.content!, parsed.texts), "Here is what the report found.");

  const withPgn = JSON.parse(bundle.buildDiagnosticBundle({ includeRepertoire: true }).content) as {
    document: { pgn: unknown };
  };
  assert.equal(typeof withPgn.document.pgn, "string");
});

test("a value the recorder cannot store becomes a fault, never an exception", (t) => {
  t.after(cleanup);
  assert.doesNotThrow(() => {
    diagnostics.recordToolCall({
      turn: 1,
      id: "call-undefined",
      name: "ui_get_state",
      arguments: {},
      status: "completed",
      startedAt: Date.now(),
      // JSON.stringify(undefined) is undefined: a tool that returns nothing.
      result: undefined as unknown as string,
    });
  });
  const [session] = diagnostics.sessions();
  assert.equal(session!.tools.length, 0);
  assert.equal(session!.faults.at(-1)!.kind, "diagnostics");
  assert.match(session!.faults.at(-1)!.message, /could not record recordToolCallUnguarded/);
});
