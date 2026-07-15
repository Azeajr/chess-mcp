import { performance } from "node:perf_hooks";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
const models = (process.env.OPENROUTER_MODELS ?? "").split(",").map((model) => model.trim()).filter(Boolean);
const maxLiveRounds = Math.max(1, Math.min(4, Number(process.env.OPENROUTER_EVAL_MAX_ROUNDS ?? 2) || 2));

if (!apiKey || !models.length) {
  console.error("Set OPENROUTER_API_KEY and comma-separated OPENROUTER_MODELS before running this credentialed verification.");
  process.exit(2);
}

const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://127.0.0.1:4173" } },
});

const [{ streamChat }, { toolSchemas }, settings, chat, game] = await Promise.all([
  import("../apps/ui/src/llm/openrouter.ts"),
  import("../apps/ui/src/llm/tools.ts"),
  import("../apps/ui/src/store/settings.ts"),
  import("../apps/ui/src/store/chat.ts"),
  import("../apps/ui/src/store/game.ts"),
]);

const repertoirePgn = "1. e4 (1. d4 d5 2. c4 e6) e5 2. Nf3 (2. Nc3 Nf6) Nc6 3. Bb5 a6 *";
const gamePgn = '[Event "Verification game"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const afterG4 = "rnbqkbnr/pppppppp/8/8/6P1/8/PPPPPP1P/RNBQKBNR b KQkq g3 0 1";

const cases = [
  { id: "ambiguous_repertoire", prompt: "What are the biggest problems here?", any: ["audit_repertoire_moves", "find_repertoire_gaps", "get_repertoire_coverage"] },
  { id: "audit", prompt: "Audit my prescribed repertoire moves.", all: ["audit_repertoire_moves"] },
  { id: "only_moves", prompt: "Find only moves in my repertoire and prepare a drill deck.", all: ["find_only_moves"] },
  { id: "structures", prompt: "Find Carlsbad structures in my repertoire.", all: ["find_structures"] },
  { id: "opponent", prompt: "Prepare my repertoire against Lichess opponent alice.", all: ["prep_vs_opponent"] },
  { id: "annotated_repertoire", prompt: "Export an annotated version of this repertoire.", all: ["export_annotated_repertoire"] },
  { id: "position", prompt: "Evaluate this position.", all: ["evaluate_position"] },
  { id: "position_followup", prompt: "What about g4?", any: ["evaluate_position", "compare_moves"], preserve: true },
  { id: "switch_repertoire", prompt: "Now audit this repertoire instead.", all: ["audit_repertoire_moves"], preserve: true },
  { id: "switch_game", prompt: "I loaded a game. Review the current game and summarize the mistakes.", any: ["get_game_summary", "analyze_game"], preserve: true, document: "game" },
];

const fixtureFor = (name, args = {}) => {
  switch (name) {
    case "get_position": return { fen: startFen, turn: "white", legal_moves: ["g4", "e4", "d4"], color: "white" };
    case "get_legal_moves": return { fen: args.fen ?? startFen, moves: args.fen === afterG4 ? ["e5", "d5"] : ["g4", "e4", "d4"] };
    case "validate_line": return { ok: true, canonical: ["g4"], finalFen: afterG4 };
    case "evaluate_position": return { fen: afterG4, eval_pov: "white", lines: [{ san: "e5", cp: 12, mate: null, depth: 14 }] };
    case "audit_repertoire_moves": return { color: "white", positions_scanned: 4, moves_audited: 4, findings: [] };
    case "find_only_moves": return { color: "white", positions_scanned: 4, only_moves_found: 0, findings: [], lines: [] };
    case "find_structures": return { color: "white", leaves_total: 3, total_matches: 1, matches: [{ path: ["d4", "d5", "c4", "e6"], structure: "Carlsbad" }] };
    case "prep_vs_opponent": return { username: "alice", games_matched_color: 0, coverage_pct: null, uncovered_opponent_moves: [], lines: [] };
    case "export_annotated_repertoire": return { kind: "artifact", artifact_id: "eval-artifact", format: "pgn", name: "repertoire-annotated.pgn", bytes: 128 };
    case "get_game_summary": return { total_moves: 6, white: { accuracy_pct: 90 }, black: { accuracy_pct: 88 }, worst_moves: [] };
    case "analyze_game": return { total_moves: 6, moves: [] };
    case "get_document_pgn": return { revision: 1, pgn: game.actions.toPgn() };
    case "get_selected_subtree": return { selected_path: [], lines: [["e4", "e5", "Nf3", "Nc6"]], truncated: false };
    case "find_repertoire_gaps": return { color: "white", positions_scanned: 4, total_gaps: 0, gaps: [], covered_by_transposition: [] };
    case "get_repertoire_coverage": return { color: "white", leaves: 3, dangling_count: 0, frontier_count: 0, dangling_lines: [] };
    default: return { command: name, fixture: true };
  }
};

const satisfies = (testCase, calls) =>
  (testCase.all ?? []).every((name) => calls.includes(name))
  && (!testCase.any || testCase.any.some((name) => calls.includes(name)));

settings.setApiKey(apiKey);
settings.setChatMode("");

const report = {
  generated_at: new Date().toISOString(),
  schema_count: toolSchemas.length,
  schema_utf8_bytes: Buffer.byteLength(JSON.stringify(toolSchemas)),
  max_live_rounds: maxLiveRounds,
  models: [],
};
let active;

chat.setChatToolExecutorForTesting(async (name, args) => fixtureFor(name, args));
chat.setChatTransportForTesting(async (options) => {
  if (!active) throw new Error("verification transport called without an active case");
  if (active.satisfied || active.rounds.length >= maxLiveRounds) return { content: "Selection captured for verification.", toolCalls: [] };
  const started = performance.now();
  const result = await streamChat(options);
  const names = result.toolCalls.map((call) => call.function.name);
  active.calls.push(...names);
  active.rounds.push({
    latency_ms: Math.round(performance.now() - started),
    transmitted_schemas: options.tools.length,
    calls: names,
    arguments: result.toolCalls.map((call) => {
      try { return JSON.parse(call.function.arguments || "{}"); }
      catch { return call.function.arguments; }
    }),
    content: result.content.slice(0, 500),
    usage: result.usage ?? null,
    generation_id: result.generationId ?? null,
    abnormal_finish: result.abnormalFinish ?? null,
  });
  active.satisfied = satisfies(active.testCase, active.calls);
  return result;
});

for (const model of models) {
  settings.setModel(model);
  chat.clearChat();
  game.actions.loadPgn(repertoirePgn, "verification-repertoire.pgn");
  const modelResult = { model, cases: [] };
  report.models.push(modelResult);
  for (const testCase of cases) {
    if (!testCase.preserve) {
      chat.clearChat();
      game.actions.loadPgn(repertoirePgn, "verification-repertoire.pgn");
    }
    if (testCase.document === "game") game.actions.loadPgn(gamePgn, "verification-game.pgn");
    active = { testCase, calls: [], rounds: [], satisfied: false };
    await chat.send(testCase.prompt);
    const transportError = chat.error();
    const passed = active.satisfied
      && active.rounds.length > 0
      && active.rounds.every((round) => round.transmitted_schemas === toolSchemas.length)
      && !transportError;
    modelResult.cases.push({
      id: testCase.id,
      prompt: testCase.prompt,
      expected_all: testCase.all ?? [],
      expected_any: testCase.any ?? [],
      selected_calls: active.calls,
      rounds: active.rounds,
      error: transportError,
      passed,
    });
  }
}

chat.setChatTransportForTesting();
chat.setChatToolExecutorForTesting();
chat.clearChat();
settings.setApiKey("");
active = undefined;

report.passed = report.models.every((modelResult) => modelResult.cases.every((testCase) => testCase.passed));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
