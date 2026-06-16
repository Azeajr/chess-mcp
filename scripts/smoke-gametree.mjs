// Smoke test for the chess-tools GameTree (Phase 1 core). Run: node scripts/smoke-gametree.mjs
import { GameTree } from "../packages/chess-tools/dist/index.js";
import { readFileSync } from "node:fs";

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));

// 1. empty tree → play moves → auto-append + navigate
const t = new GameTree();
ok(t.fenAt([]).startsWith("rnbqkbnr/pppppppp"), "start fen");
let r = t.playMove([], "e2", "e4");
ok(r.appended && t.sanAt(r.path) === "e4", "play e4 appends, san e4");
r = t.playMove(r.path, "e7", "e5");
ok(t.sanAt(r.path) === "e5", "play e5");
r = t.playMove(r.path, "g1", "f3");
ok(t.sanAt(r.path) === "Nf3", "play Nf3");
ok(t.toPgn().includes("1. e4 e5 2. Nf3"), "pgn serializes mainline");

// 2. replay-into-existing = navigate, not duplicate
const before = t.nodeAt([]).children.length;
const r2 = t.playMove([], "e2", "e4");
ok(!r2.appended && t.nodeAt([]).children.length === before, "replay e4 navigates, no dup");

// 3. variation: a different first move branches
const r3 = t.playMove([], "d2", "d4");
ok(r3.appended && t.nodeAt([]).children.length === before + 1, "d4 creates sibling variation");
ok(t.sanAt(r3.path) === "d4", "variation san d4");

// 4. promotion parsed from PGN
const promo = GameTree.fromPgn('[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n\n1. a8=Q *');
ok(promo.sanAt([0]) === "a8=Q", "parsed promotion from pgn");

// 5. load real repertoire, walk, dests
const pgn = readFileSync(new URL("../sample-repertoire.pgn", import.meta.url), "utf8");
const rep = GameTree.fromPgn(pgn);
ok(rep.game.moves.children.length > 0, "repertoire has moves");
// dests is keyed by origin square: 8 pawns + 2 knights = 10 movable origins from start.
ok(rep.destsAt([]).size === 10, "10 movable origin squares from start");
ok(rep.lastMoveAt([0]) !== null, "lastMove computed");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
