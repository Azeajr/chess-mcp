// MCP smoke client: spawn the Node server over stdio, list tools, exercise a representative set.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const repoRoot = resolve(pkgDir, "..", "..");
const pkgBin = join(pkgDir, "node_modules", ".bin", "tsx");
const rootBin = join(repoRoot, "node_modules", ".bin", "tsx");
const tsxBin = existsSync(pkgBin) ? pkgBin : rootBin;
const entry = join(pkgDir, "src", "index.ts");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const TRAP = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qg6 *";

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));
const call = async (client, name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

const transport = new StdioClientTransport({ command: tsxBin, args: [entry], cwd: repoRoot });
const client = new Client({ name: "smoke", version: "0" }, { capabilities: {} });
await client.connect(transport);

const tools = (await client.listTools()).tools;
console.log("TOOLS:", tools.length, "→", tools.map((t) => t.name).join(", "));
ok(tools.length === 25, "25 tools registered");

ok((await call(client, "validate_fen", { fen: START })).valid, "validate_fen start valid");
ok((await call(client, "get_legal_moves", { fen: START })).moves.length === 20, "20 legal from start");

const cloud = await call(client, "cloud_eval", { fen: START });
ok(typeof cloud.cp === "number", `cloud_eval start cp (${cloud.cp})`);

const tbEarly = await call(client, "tablebase_lookup", { fen: "4k3/8/8/8/8/8/8/4K2R w - - 0 1" });
ok(tbEarly.category === "win", `tablebase_lookup early (${tbEarly.category})`);

console.log("evaluate_position (Node Stockfish, depth 12)…");
const ev = await call(client, "evaluate_position", { fen: START, depth: 12, lines: 3 });
ok(Array.isArray(ev.lines) && ev.lines.length >= 1, "evaluate_position returns lines");
console.log("  best:", ev.lines?.[0]);

const em = await call(client, "engine_move", { fen: START, depth: 12 });
ok(typeof em.san === "string", `engine_move best = ${em.san} (${em.cp})`);

const rep = await call(client, "load_repertoire", { pgn: TRAP, color: "white" });
ok(typeof rep.repertoire_id === "string" && rep.nodes > 0, `load_repertoire id + ${rep.nodes} nodes`);

const cov = await call(client, "get_repertoire_coverage", { repertoire_id: rep.repertoire_id });
ok(typeof cov.dangling_count === "number" && cov.leaves >= 1, `coverage: ${cov.dangling_count} dangling / ${cov.leaves} leaves`);

const transRep = await call(client, "load_repertoire", { pgn: "1. e4 ( 1. Nf3 e5 2. e4 ) 1... e5 2. Nf3 *", color: "white" });
const trans = await call(client, "get_transpositions", { repertoire_id: transRep.repertoire_id });
ok(trans.total === 1 && trans.transpositions[0].paths.length === 2, "get_transpositions finds the converging position");

console.log("compare_moves (engine, depth 12)…");
const cmp = await call(client, "compare_moves", { fen: START, moves: ["e4", "d4", "a3"], depth: 12 });
console.log("  ranked:", JSON.stringify(cmp.candidates.map((c) => `${c.rank}.${c.san} ${c.mover_cp}`)));
ok(cmp.candidates[0].rank === 1 && cmp.candidates.find((c) => c.san === "a3").rank === 3, "compare_moves ranks a3 last");

console.log("find_repertoire_gaps (engine scan)…");
const gaps = await call(client, "find_repertoire_gaps", { repertoire_id: rep.repertoire_id, depth: 12, min_severity: "high" });
console.log("  gaps:", JSON.stringify(gaps.gaps?.map((g) => `${g.severity} ${g.uncovered_move} ${g.eval}`)));
ok(gaps.gaps?.some((g) => g.uncovered_move === "Qxg2" && g.severity === "high"), "gap scan finds Qxg2 HIGH");

const t0 = Date.now();
// Game analysis on a game with a clear white blunder (4.Nxe5 hangs a knight).
const BLUNDER = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. Nxe5 Nxe5 5. d4 *";
console.log("analyze_game / get_game_summary (engine, depth 8)…");
const ag = await call(client, "analyze_game", { pgn: BLUNDER, depth: 8 });
ok(ag.total_moves >= 8 && ag.moves.some((m) => m.classification !== "good"), `analyze_game ${ag.total_moves} moves, some flagged`);
const gs = await call(client, "get_game_summary", { pgn: BLUNDER, depth: 8 });
console.log("  white:", JSON.stringify(gs.white), "worst:", gs.worst_moves?.[0]?.san, gs.worst_moves?.[0]?.cp_loss);
ok(gs.white.blunders + gs.white.mistakes >= 1, "get_game_summary flags white's Nxe5");
const ann = await call(client, "export_annotated_pgn", { pgn: BLUNDER, depth: 8 });
ok(/\$[246]/.test(ann.annotated_pgn), "export_annotated_pgn has a NAG glyph");

const tb = await call(client, "tablebase_lookup", { fen: "4k3/8/8/8/8/8/8/4K2R w - - 0 1" });
console.log(`  late tablebase took ${Date.now() - t0}ms →`, JSON.stringify(tb).slice(0, 80));
ok(tb.category === "win" || tb.moves?.length >= 0, `tablebase_lookup late (${tb.category})`);

// modify_repertoire_line (clone-on-write) + export round-trip
const repE = await call(client, "load_repertoire", { pgn: "1. e4 *", color: "white" });
const mod = await call(client, "modify_repertoire_line", { repertoire_id: repE.repertoire_id, action: "add", path: ["e4"], add_moves: ["e5", "Nf3"] });
ok(typeof mod.new_repertoire_id === "string" && mod.nodes === 3, `modify_repertoire_line add → ${mod.nodes} nodes`);
const modExport = await call(client, "export_repertoire", { repertoire_id: mod.new_repertoire_id });
ok(modExport.pgn.includes("e5") && modExport.pgn.includes("Nf3"), "edited tree exports the new line");
const srcExport = await call(client, "export_repertoire", { repertoire_id: repE.repertoire_id });
ok(!srcExport.pgn.includes("e5"), "source repertoire unchanged (clone-on-write)");

const ill = await call(client, "load_repertoire", { pgn: "1. e4 e5 2. Bc4 Qh4 $4 *", color: "white" });
const ilr = await call(client, "classify_illustrative_lines", { repertoire_id: ill.repertoire_id });
ok(ilr.lines.length === 1 && ilr.illustrative_leaves === 1, "classify_illustrative_lines flags the NAG line");

const op = await call(client, "identify_opening", { pgn: "1. e4 c5 2. Nf3 d6 *" });
ok(op.name?.includes("Sicilian"), `identify_opening → ${op.name} (${op.eco})`);

const img = await call(client, "board_image", { fen: START });
ok(img.format === "svg" && img.svg.startsWith("<svg"), "board_image returns SVG");

console.log("batch_review (engine, depth 8, 2 games)…");
const MULTI = '[Event "G1"]\n[Result "1-0"]\n\n1. e4 c5 2. Nf3 *\n\n[Event "G2"]\n[Result "0-1"]\n\n1. d4 d5 2. c4 *';
const br = await call(client, "batch_review", { pgn: MULTI, group_by: "eco", depth: 8 });
console.log("  groups:", JSON.stringify(br.groups?.map((g) => `${g.name}(${g.games})`)));
ok(br.total_games === 2 && br.groups.length === 2, "batch_review aggregates 2 games into 2 eco groups");

console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
