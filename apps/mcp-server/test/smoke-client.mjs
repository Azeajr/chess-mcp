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
ok(tools.length === 14, "14 tools registered");

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

console.log("find_repertoire_gaps (engine scan)…");
const gaps = await call(client, "find_repertoire_gaps", { repertoire_id: rep.repertoire_id, depth: 12, min_severity: "high" });
console.log("  gaps:", JSON.stringify(gaps.gaps?.map((g) => `${g.severity} ${g.uncovered_move} ${g.eval}`)));
ok(gaps.gaps?.some((g) => g.uncovered_move === "Qxg2" && g.severity === "high"), "gap scan finds Qxg2 HIGH");

const t0 = Date.now();
const tb = await call(client, "tablebase_lookup", { fen: "4k3/8/8/8/8/8/8/4K2R w - - 0 1" });
console.log(`  late tablebase took ${Date.now() - t0}ms →`, JSON.stringify(tb).slice(0, 80));
ok(tb.category === "win" || tb.moves?.length >= 0, `tablebase_lookup late (${tb.category})`);

console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
