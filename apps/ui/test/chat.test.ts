import test from "node:test";
import assert from "node:assert/strict";
import { streamChat, type ToolSchema } from "../src/llm/openrouter.ts";
import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  analyzeStrategicFit,
  completeStrategicFitReport,
  contractsForHost,
  jsonSchemaForTool,
  projectStrategicFitLegacyResult,
  strategicFitCompleteAnalysisOptions,
  strategicFitOptionsFromToolArguments,
  toolDefault,
  validateToolArguments,
  type StrategicFitToolArguments,
} from "@chess-mcp/chess-tools";
import { actions, currentTree, version } from "../src/store/game.ts";
import { acceptStagedEdit, rejectStagedEdit, stageEdit, stagedEdit } from "../src/store/suggestions.ts";
import { artifactById, createArtifact } from "../src/store/artifacts.ts";
import { defaultBrowserCommandDependencies } from "../src/application/browser-commands/default-context.ts";
import { executeDirectBrowserCommand } from "../src/store/commands.ts";
import { runTool } from "../src/llm/tools.ts";
import { workflowPrompt } from "../src/llm/workflows.ts";
import { findArtifactMetadata, strategicFitChatState } from "../src/components/ToolResult.tsx";
import { requestedDepth } from "../src/application/browser-commands/types.ts";

const sse = (...frames: unknown[]) => new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    for (const frame of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  },
});

test("canonical browser validation rejects malformed and unknown arguments", () => {
  assert.equal(validateToolArguments("evaluate_position", null, "browser").ok, false);
  const unknown = validateToolArguments("evaluate_position", { surprise: true }, "browser");
  assert.deepEqual(unknown, { ok: false, error: "invalid_arguments", reason: "unknown argument: surprise" });
  assert.deepEqual(validateToolArguments("load_repertoire", { pgn: "*", color: "white" }, "browser"), {
    ok: false, error: "invalid_arguments", reason: "load_repertoire is not available on the browser host",
  });
  assert.deepEqual(validateToolArguments("propose_line", { moves: ["e4"] }, "mcp"), {
    ok: false, error: "invalid_arguments", reason: "propose_line is not available on the mcp host",
  });
});

test("canonical Strategic Fit schema validates bounded nested V2 arguments", () => {
  const valid: StrategicFitToolArguments = {
    profile: {
      mode: "custom",
      preferences: {
        opponent_popularity_importance: 0.6,
        personal_game_frequency_importance: 0.2,
        preferred_concept_ids: ["concept:iqp"],
      },
    },
    weighting: { mode: "equal" },
    page: { offset: 0, limit: 12 },
    sort: "expected-frequency",
    cohort_overrides: [{
      override_id: "override:exclude",
      kind: "exclude",
      decision_ids: ["decision:one"],
    }],
    route_assessments: [{
      route_id: "route:one",
      resolution_state: "keep-intentionally",
    }],
  };
  assert.equal(validateToolArguments("analyze_repertoire_congruence", valid, "browser").ok, true);
  assert.equal(
    validateToolArguments("analyze_repertoire_congruence", {
      profile: { mode: "custom", preferences: { opponent_popularity_importance: 1.1 } },
    }, "browser").ok,
    false,
  );
  assert.equal(
    validateToolArguments("analyze_repertoire_congruence", {
      profile: { mode: "balanced", preferences: { invented: true } },
    }, "browser").ok,
    false,
  );
  assert.equal(
    validateToolArguments("analyze_repertoire_congruence", {
      cohort_overrides: [{ override_id: "override:empty", kind: "merge" }],
    }, "browser").ok,
    false,
  );
  assert.equal(
    validateToolArguments("analyze_repertoire_congruence", {
      page: { offset: 0, limit: 51 },
    }, "browser").ok,
    false,
  );

  const schema = jsonSchemaForTool("analyze_repertoire_congruence", "browser") as {
    properties: Record<string, { type: string; additionalProperties?: boolean; maxItems?: number }>;
  };
  assert.equal(schema.properties.profile.type, "object");
  assert.equal(schema.properties.profile.additionalProperties, false);
  assert.equal(schema.properties.cohort_overrides.maxItems, 100);
});

test("deep analysis forces every browser engine request to depth 30", () => {
  assert.equal(requestedDepth({}, { analysisDepth: () => 20 } as never), 20);
  assert.equal(requestedDepth({ depth: 12 }, { analysisDepth: () => 20 } as never), 12);
  assert.equal(requestedDepth({}, { analysisDepth: () => 30 } as never), 30);
  assert.equal(requestedDepth({ depth: 12 }, { analysisDepth: () => 30 } as never), 30);
});

test("primary direct repertoire outcomes use the canonical browser commands and defaults", () => {
  const browser = new Set(contractsForHost("browser").map((contract) => contract.name));
  for (const name of ["audit_repertoire_moves", "find_only_moves", "find_structures", "export_annotated_repertoire", "export_strategic_fit_metadata", "export_strategic_fit_intent_pgn", "prep_vs_opponent"])
    assert.equal(browser.has(name), true, `${name} is a browser command`);
  assert.equal(toolDefault("audit_repertoire_moves", "max_positions", 0), 20);
  assert.equal(toolDefault("find_only_moves", "min_margin", 0), 100);
  assert.equal(validateToolArguments("prep_vs_opponent", {}, "browser").ok, false);
  assert.equal(validateToolArguments("find_only_moves", { export_deck: true }, "browser").ok, true);
  assert.equal(validateToolArguments("find_only_moves", { export_path: "deck.csv" }, "browser").ok, false);
  assert.equal(browser.has("inspect_shortcut"), true);
  assert.equal(toolDefault("inspect_shortcut", "max_positions", 0), 12);
  assert.equal(validateToolArguments("inspect_shortcut", { line_path: [], at_ply: 0 }, "browser").ok, false);
});

test("direct and chat adapters share one semantic command result with injected providers", async () => {
  actions.loadPgn("1. e4 e5 *");
  const networkGames = [{
    white: "someone", black: "alice", result: "1-0", white_elo: 1800, black_elo: 1800,
    eco: null, opening: null, date: null, time_control: null, user_color: "black" as const,
    user_result: "loss" as const, pgn: '[White "someone"]\n[Black "alice"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
  }];
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    analyse: async () => [{ uci: "e2e4", cp: 24, mate: null, depth: 12, pv: ["e2e4", "e7e5"] }],
    lichessGames: async () => networkGames,
    openings: async () => new Map(),
  };
  const args = { depth: 12, lines: 1 };
  const direct = await executeDirectBrowserCommand("evaluate_position", args, {}, dependencies);
  const chat = await runTool("evaluate_position", args, {}, dependencies);
  assert.deepEqual(chat, direct);
  assert.deepEqual(direct, {
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    eval_pov: "white",
    eval_sign: "positive favors White; negative favors Black",
    lines: [{ uci: "e2e4", san: "e4", cp: 24, mate: null, depth: 12 }],
  });

  const prepArgs = { username: "alice", max_games: 1 };
  const directPrep = await executeDirectBrowserCommand("prep_vs_opponent", prepArgs, {}, dependencies);
  const chatPrep = await runTool("prep_vs_opponent", prepArgs, {}, dependencies);
  assert.deepEqual(chatPrep, directPrep);
  assert.deepEqual(directPrep, {
    username: "alice", opponent_color: "black", games_total: 1, games_matched_color: 1,
    games_skipped_fen_setup: 0, games_reached_prep: 1, coverage_pct: 100,
    avg_in_book_plies: 2, uncovered_opponent_moves: [],
    lines: [{ name: "Unclassified", eco: null, games: 1, hit_rate: 100, win_rate: 0, draw_rate: 0, loss_rate: 100 }],
  });
});

test("browser Strategic Fit adapter matches the bounded MCP-equivalent core fixture", async () => {
  actions.loadPgn(
    "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 Bxc3+ " +
    "(4... O-O 5. Bd3 d5 6. Nf3 c5) (4... b6 5. Bd3 Bb7 6. Nf3 O-O) 5. bxc3 O-O *",
  );
  const openings = new Map();
  const progress: Array<[number, number | undefined, string | undefined]> = [];
  const args: StrategicFitToolArguments = {
    profile: { mode: "familiar-plans" },
    weighting: { mode: "equal" },
    page: { offset: 0, limit: 2 },
    sort: "finding-id",
    limit: 2,
  };
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    openings: async () => openings,
    strategicFitReport: async (
      pgn: string,
      options: Parameters<typeof analyzeStrategicFit>[1],
      execution?: { signal?: AbortSignal; onProgress?: Parameters<typeof analyzeStrategicFit>[1]["onProgress"] },
    ) => completeStrategicFitReport(analyzeStrategicFit(GameTree.fromPgn(pgn), {
      ...strategicFitCompleteAnalysisOptions(options),
      shouldCancel: () => execution?.signal?.aborted ?? false,
      onProgress: execution?.onProgress,
    })),
  };

  const browser = await executeDirectBrowserCommand(
    "analyze_repertoire_congruence",
    args as Record<string, unknown>,
    { onProgress: (done, total, detail) => progress.push([done, total, detail]) },
    dependencies,
  );
  const mcpEquivalent = projectStrategicFitLegacyResult(
    analyzeStrategicFit(
      currentTree(),
      strategicFitOptionsFromToolArguments(args, {
        repertoireColor: dependencies.currentColor(),
        repertoireRevision: `browser:${version()}`,
        openingTable: openings,
      }),
    ),
    { limit: args.limit },
  );

  assert.deepEqual(browser, mcpEquivalent);
  assert.equal(mcpEquivalent.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(mcpEquivalent.legacy_projection.deprecated, true);
  assert.deepEqual(mcpEquivalent.profile, {
    schema_version: mcpEquivalent.schema_version,
    mode: "familiar-plans",
    source: "explicit",
    provisional: false,
    preferences: {
      maximum_engine_loss_cp: null,
      opponent_popularity_importance: 0,
      personal_game_frequency_importance: 0,
      manual_weight_importance: 0,
      additional_memorization_tolerance: 0.5,
      preferred_concept_ids: [],
      avoided_concept_ids: [],
      preferred_tactical_character: [],
      minimum_opponent_coverage: null,
    },
  });
  assert.equal(progress.at(-1)?.[0], 6);
  assert.equal(progress.at(-1)?.[1], 6);
});

test("browser Strategic Fit adapter fails closed when the document changes during analysis", async () => {
  actions.loadPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
  let currentRevision = 11;
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    currentRevision: () => currentRevision,
    openings: async () => new Map(),
    strategicFitReport: async (
      pgn: string,
      options: Parameters<typeof analyzeStrategicFit>[1],
    ) => {
      const report = completeStrategicFitReport(analyzeStrategicFit(
        GameTree.fromPgn(pgn),
        strategicFitCompleteAnalysisOptions(options),
      ));
      currentRevision++;
      return report;
    },
  };

  assert.deepEqual(
    await executeDirectBrowserCommand("analyze_repertoire_congruence", {}, {}, dependencies),
    {
      error: "strategic_fit_stale_report",
      reason: "The repertoire or analysis color changed while Strategic Fit was running; request a fresh report.",
    },
  );
});

test("Strategic Fit chat state preserves incomplete and blocked evidence semantics", () => {
  assert.equal(strategicFitChatState({ state: "ready" }, []), "complete");
  assert.equal(strategicFitChatState({ state: "ready" }, [{ provisional: true }]), "provisional");
  assert.equal(strategicFitChatState({ state: "degraded" }, []), "incomplete");
  assert.equal(strategicFitChatState({ state: "blocked" }, []), "blocked");
});

test("browser annotation guidance validates pasted PGN only and keeps artifact types distinct", () => {
  assert.match(workflowPrompt(""), /Shared grounding contract/);
  assert.match(workflowPrompt(""), /When the user explicitly names an analysis or export, call its matching command/);
  assert.match(workflowPrompt(""), /validate the line once and evaluate its returned final FEN/);
  assert.match(workflowPrompt("general"), /White-POV centipawns/);
  const prompt = workflowPrompt("annotate");
  assert.match(prompt, /Validate only PGN pasted by the user/);
  assert.match(prompt, /export_annotated_pgn/);
  assert.match(prompt, /export_annotated_repertoire/);
  assert.doesNotMatch(prompt, /omit pgn to annotate/);
  assert.match(workflowPrompt("repertoire"), /preserve report_id and finding_id exactly/);
  assert.match(workflowPrompt("repertoire"), /insufficient-evidence result is not evidence of consistency/);
});

test("actual chat requests transmit all 41 schemas on natural, follow-up, and preset turns", async (t) => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const settings = await import("../src/store/settings.ts");
  const chat = await import("../src/store/chat.ts");
  settings.setApiKey("test-key");
  const requests: { tools: ToolSchema[]; messages: { role: string; content: string | null }[] }[] = [];
  const executed: string[] = [];
  const expectedByText = new Map([
    ["audit my repertoire moves", "audit_repertoire_moves"],
    ["find only moves in my repertoire", "find_only_moves"],
    ["find structures in my repertoire", "find_structures"],
    ["prep vs opponent alice", "prep_vs_opponent"],
    ["export an annotated repertoire", "export_annotated_repertoire"],
    ["export my strategic fit settings", "export_strategic_fit_metadata"],
    ["export a strategic fit intent pgn", "export_strategic_fit_intent_pgn"],
    ["evaluate this position", "evaluate_position"],
    ["what about g4", "evaluate_position"],
    ["now audit this repertoire", "audit_repertoire_moves"],
    ["review this game", "get_game_summary"],
    ["long audit", "audit_repertoire_moves"],
  ]);
  chat.setChatTransportForTesting(async (opts) => {
    requests.push({ tools: opts.tools, messages: opts.messages });
    const last = opts.messages.at(-1);
    const command = last?.role === "user" ? expectedByText.get(last.content ?? "") : undefined;
    return command
      ? { content: "", toolCalls: [{ id: `call-${requests.length}`, type: "function", function: { name: command, arguments: command === "prep_vs_opponent" ? '{"username":"alice"}' : "{}" } }] }
      : { content: "done", toolCalls: [] };
  });
  chat.setChatToolExecutorForTesting(async (name) => {
    executed.push(name);
    return { command: name, fixture: true };
  });
  t.after(() => {
    chat.setChatTransportForTesting();
    chat.setChatToolExecutorForTesting();
    settings.setApiKey("");
    chat.clearChat();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  for (const [request, command] of [...expectedByText].slice(0, 7)) {
    chat.clearChat();
    await chat.send(request);
    assert.equal(executed.at(-1), command, `${request} executes ${command}`);
    const names = requests.at(-2)!.tools.map((tool) => tool.function.name);
    assert.equal(names.length, 41);
    assert.equal(new Set(names).size, 41);
    assert.equal(names.includes(command), true);
    if (command === "export_annotated_repertoire") assert.equal(executed.at(-1), "export_annotated_repertoire");
  }

  chat.clearChat();
  await chat.send("evaluate this position");
  await chat.send("what about g4");
  assert.deepEqual(executed.slice(-2), ["evaluate_position", "evaluate_position"]);
  assert.equal(requests.at(-2)!.tools.some((tool) => tool.function.name === "evaluate_position"), true);

  chat.clearChat();
  await chat.send("evaluate this position");
  await chat.send("now audit this repertoire");
  await chat.send("review this game");
  assert.deepEqual(executed.slice(-3), ["evaluate_position", "audit_repertoire_moves", "get_game_summary"]);
  assert.equal(requests.slice(-6).filter((_request, index) => index % 2 === 0).every((request) => request.tools.length === 41), true);

  settings.setChatMode("repertoire");
  chat.clearChat();
  await chat.send("find structures in my repertoire");
  assert.equal(requests.at(-2)!.tools.length, 41, "preset changes guidance, not availability");

  chat.setChatToolExecutorForTesting(async (_name, _args, options) => new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("Cancelled", "AbortError"));
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  }));
  chat.clearChat();
  const pending = chat.send("long audit");
  while (!chat.toolRuns().some((run) => run.status === "running")) await new Promise((resolve) => setTimeout(resolve, 0));
  chat.stop();
  await pending;
  assert.equal(chat.busy(), false, "chat settles promptly after Stop during a command");
  assert.equal(chat.toolRuns().at(-1)?.status, "cancelled");
});

test("current-document annotation and pasted-PGN validation use distinct valid paths", async () => {
  actions.loadPgn("1. e4 e5 *", "game.pgn");
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    analyse: async (fen: string) => [{ uci: fen.split(" ")[1] === "w" ? "e2e4" : "e7e5", cp: 20, mate: null, depth: 12, pv: [] }],
  };
  const pasted = await runTool("validate_pgn", { pgn: "1. d4 d5 *" }, {}, dependencies) as { valid?: boolean };
  assert.equal(pasted.valid, true);
  const missing = await runTool("validate_pgn", {}, {}, dependencies);
  assert.deepEqual(missing, { error: "invalid_arguments", reason: "missing required argument: pgn" });
  const current = await runTool("export_annotated_pgn", { depth: 12 }, {}, dependencies) as { kind?: string; artifact_id?: string };
  assert.equal(current.kind, "artifact");
  assert.equal(typeof current.artifact_id, "string");
});

test("browser repertoire annotation exports native V2 evidence through the artifact boundary", async () => {
  actions.loadPgn(`1. e4 e5 *

1. d4 d5 2. c4 *

1. c4 *`, "strategic-fit.pgn");
  const source = currentTree().toPgn();
  let artifact: { format: string; content: string; name: string } | undefined;
  let injectedRevision: string | undefined;
  const dependencies = {
    ...defaultBrowserCommandDependencies,
    openings: async () => new Map(),
    analyse: async () => { throw new Error("congruence-only export must not invoke the engine"); },
    strategicFitReport: async (
      pgn: string,
      options: Parameters<typeof analyzeStrategicFit>[1],
    ) => {
      injectedRevision = options.repertoireRevision;
      return completeStrategicFitReport(analyzeStrategicFit(
        GameTree.fromPgn(pgn),
        strategicFitCompleteAnalysisOptions(options),
      ));
    },
    createArtifact: (format: "pgn" | "csv" | "json", content: string, name: string) => {
      artifact = { format, content, name };
      return { kind: "artifact", artifact_id: "artifact:strategic-fit", format, name };
    },
  };

  const result = await executeDirectBrowserCommand(
    "export_annotated_repertoire",
    { include: ["congruence"] },
    {},
    dependencies,
  ) as { kind?: string; artifact_id?: string; annotated?: { congruence: number } };

  assert.equal(result.kind, "artifact");
  assert.equal(result.artifact_id, "artifact:strategic-fit");
  assert.ok((result.annotated?.congruence ?? 0) > 0);
  assert.equal(injectedRevision, `browser:${version()}`);
  assert.equal(artifact?.format, "pgn");
  assert.equal(artifact?.name, "strategic-fit-annotated.pgn");
  assert.match(artifact?.content ?? "", /Strategic Fit evidence \[analysis=2\.0\.0;/);
  assert.match(artifact?.content ?? "", /status=uncertain-evidence-only/);
  assert.equal(currentTree().toPgn(), source, "browser artifact export leaves the source document unchanged");
});

test("chat reports round exhaustion, malformed tool JSON, and clean Retry", async (t) => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  });
  const settings = await import("../src/store/settings.ts");
  const chat = await import("../src/store/chat.ts");
  settings.setApiKey("test-key");
  t.after(() => {
    chat.setChatTransportForTesting();
    chat.setChatToolExecutorForTesting();
    settings.setApiKey("");
    chat.clearChat();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  let roundRequests = 0;
  chat.setChatTransportForTesting(async (options) => {
    roundRequests++;
    return options.tools.length
      ? { content: "", toolCalls: [{ id: `round-${roundRequests}`, type: "function", function: { name: "get_position", arguments: "{}" } }] }
      : { content: "Incomplete: the bounded loop ended cleanly.", toolCalls: [] };
  });
  chat.setChatToolExecutorForTesting(async () => ({ grounded: true }));
  await chat.send("keep using tools");
  assert.equal(roundRequests, 13, "twelve tool rounds are followed by one no-tool summary request");
  assert.match(chat.error() ?? "", /Tool-round limit reached/);
  assert.equal(chat.history().at(-1)?.content, "Incomplete: the bounded loop ended cleanly.");

  chat.clearChat();
  let malformedRound = 0;
  chat.setChatToolExecutorForTesting();
  chat.setChatTransportForTesting(async () => ++malformedRound === 1
    ? { content: "", toolCalls: [{ id: "bad-json", type: "function", function: { name: "get_position", arguments: "{" } }] }
    : { content: "Recovered from invalid arguments.", toolCalls: [] });
  await chat.send("malformed call");
  const malformed = chat.history().find((message) => message.role === "tool" && message.tool_call_id === "bad-json");
  assert.match(malformed?.content ?? "", /invalid_arguments/);
  assert.equal(chat.history().at(-1)?.content, "Recovered from invalid arguments.");

  chat.clearChat();
  let retryAttempts = 0;
  chat.setChatTransportForTesting(async () => {
    if (retryAttempts++ === 0) throw new Error("temporary provider failure");
    return { content: "Retry completed.", toolCalls: [] };
  });
  await chat.send("retry this request");
  assert.match(chat.error() ?? "", /temporary provider failure/);
  chat.retry();
  while (chat.busy()) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(chat.error(), null);
  assert.equal(chat.history().at(-1)?.content, "Retry completed.");
});

test("fake model stream reassembles multiple tool calls", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://test" } }, configurable: true });
  globalThis.fetch = async () => new Response(sse(
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "get_position", arguments: "{}" } }, { index: 1, id: "b", function: { name: "evaluate_position", arguments: "{\"lines\":" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: "3}" } }] }, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 4000, completion_tokens: 20, total_tokens: 4020, cost: 0.01 } },
  ), { status: 200, headers: { "X-Generation-Id": "gen-test" } });
  t.after(() => { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true }); });
  const result = await streamChat({ apiKey: "x", model: "fake", messages: [], tools: [], onText() {} });
  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.toolCalls[1]!.function.arguments, "{\"lines\":3}");
  assert.equal(result.usage?.total_tokens, 4020);
  assert.equal(result.generationId, "gen-test");
});

test("fake model stream reports abnormal finish and respects cancellation", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { value: { location: { origin: "http://test" } }, configurable: true });
  globalThis.fetch = async (_input, init) => {
    if (init?.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return new Response(sse({ choices: [{ delta: { content: "partial" }, finish_reason: "length" }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true }); });
  const abnormal = await streamChat({ apiKey: "x", model: "fake", messages: [], tools: [], onText() {} });
  assert.equal(abnormal.abnormalFinish, "length");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(streamChat({ apiKey: "x", model: "fake", messages: [], tools: [], signal: controller.signal, onText() {} }), { name: "AbortError" });
});

test("staged add, prune, and reorder edits require acceptance and share the game command", () => {
  actions.loadPgn("1. e4 (1. d4) e5 2. Nf3");
  const initial = actions.toPgn();
  const reorder = stageEdit("reorder", [], { promoteMove: "d4" });
  assert.equal(reorder.ok, true);
  assert.equal(actions.toPgn(), initial, "staging must not mutate the tree");
  if (!reorder.ok) return;
  assert.equal(acceptStagedEdit(reorder.action_id).ok, true);
  assert.equal(currentTree().nodeAt([]).children[0]!.data.san, "d4");

  const add = stageEdit("add", ["e4", "e5", "Nf3"], { addMoves: ["Nc6"] });
  assert.equal(add.ok, true);
  if (!add.ok) return;
  rejectStagedEdit(add.action_id);
  assert.equal(stagedEdit(add.action_id)?.status, "rejected");
  assert.equal(currentTree().indexPathOfSan(["e4", "e5", "Nf3", "Nc6"]), null);

  const prune = stageEdit("prune", ["d4"]);
  assert.equal(prune.ok, true);
  if (!prune.ok) return;
  assert.equal(acceptStagedEdit(prune.action_id).ok, true);
  assert.equal(currentTree().indexPathOfSan(["d4"]), null);
});

test("staged edits cannot apply after the tree revision changes", () => {
  actions.loadPgn("1. e4 e5");
  const staged = stageEdit("add", ["e4", "e5"], { addMoves: ["Nf3"] });
  assert.equal(staged.ok, true);
  if (!staged.ok) return;
  const stagedRevision = staged.revision;
  actions.newGame();
  assert.notEqual(version(), stagedRevision);
  assert.deepEqual(acceptStagedEdit(staged.action_id), { ok: false, error: "stale_revision" });
  assert.equal(stagedEdit(staged.action_id)?.status, "stale");
});

test("artifact results expose metadata by reference without repeating content", () => {
  const content = "[Event \"Annotated\"]\n\n1. e4 *";
  const result = createArtifact("pgn", content, "game-annotated.pgn");
  assert.equal("content" in result, false);
  assert.equal(result.format, "pgn");
  assert.equal(artifactById(result.artifact_id)?.content, content);
  const deck = createArtifact("csv", "fen,move\nstart,e4", "only-moves.csv");
  assert.equal(deck.media_type, "text/csv");
  assert.equal(artifactById(deck.artifact_id)?.name, "only-moves.csv");
  const sidecar = createArtifact("json", "{\"sidecar_version\":\"1.0.0\"}\n", "strategic-fit.json");
  assert.equal(sidecar.media_type, "application/json");
  assert.equal("content" in sidecar, false);
  assert.deepEqual(findArtifactMetadata({ findings: [], deck }), [deck]);
});

test("history compaction preserves Strategic Fit identities, artifacts, actions, navigation, and pagination references", async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  });
  const { compactToolResult } = await import("../src/store/chat.ts");
  const compacted = JSON.parse(compactToolResult(JSON.stringify({
    report_id: "strategic-fit-report:abc",
    repertoire_revision: "browser:7",
    findings: [{
      finding_id: "finding:def",
      references: { source_san_paths: [["e4", "e5"]] },
      path: ["e4", "e5"],
      fen: "fen-value",
      detail: "x".repeat(7000),
    }],
    deck: { kind: "artifact", artifact_id: "artifact-9", format: "csv", name: "drill.csv", bytes: 12 },
    action: { kind: "staged_edit", action_id: "edit-3", revision: 7, path: ["e4"] },
    next_page: "cursor-2",
    partial: true,
  }))) as { references: Record<string, unknown>[] };
  const serialized = JSON.stringify(compacted.references);
  assert.match(serialized, /artifact-9/);
  assert.match(serialized, /edit-3/);
  assert.match(serialized, /fen-value/);
  assert.match(serialized, /cursor-2/);
  assert.match(serialized, /strategic-fit-report:abc/);
  assert.match(serialized, /finding:def/);
  assert.match(serialized, /browser:7/);
  assert.match(serialized, /source_san_paths/);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
