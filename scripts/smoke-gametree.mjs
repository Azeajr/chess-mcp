// Smoke test for the chess-tools GameTree (Phase 1 core). Run: node scripts/smoke-gametree.mjs
import {
  GameTree,
  classifyUciMove,
  weightFor,
  decisionNodes,
  gapSeverity,
  moveSan,
  validateLine,
  legalMoves,
  validateFen,
  validatePgn,
} from "../packages/chess-tools/dist/index.js";
import { readFileSync } from "node:fs";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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

// 6. congruence: in-book / out / adjacent (transposition)
const rep2 = GameTree.fromPgn("1. e4 e5 2. Nf3 *");
const keys2 = rep2.allPositionKeys();
const bookAtRoot = rep2.childSansAt([]); // ['e4']
ok(classifyUciMove(START_FEN, "e2e4", bookAtRoot, keys2).fit === "in-book", "e4 is in-book");
ok(classifyUciMove(START_FEN, "d2d4", bookAtRoot, keys2).fit === "out", "d4 is out of book");
// Nf3 from start is not the book move (e4) but transposes into a tree position → adjacent.
const keys3 = GameTree.fromPgn("1. Nf3 *").allPositionKeys();
ok(classifyUciMove(START_FEN, "g1f3", ["e4"], keys3).fit === "adjacent", "Nf3 adjacent via transposition");

// 7. weight is from YOUR side (white-POV eval flips for black)
ok(weightFor(60, null, "white") === "thick", "+60 white → thick");
ok(weightFor(60, null, "black") === "thin", "+60 white-POV is thin for black");
ok(weightFor(0, null, "white") === "medium", "0 → medium");
ok(weightFor(null, 2, "white") === "thick", "mate for you → thick");

// 8. decision nodes — white repertoire: opponent (black) to move, ≥1 prepared reply
const wRep = GameTree.fromPgn("1. d4 d5 2. c4 e6 *");
const wNodes = decisionNodes(wRep, "white");
ok(wNodes.length === 2, "white rep: 2 decision nodes");
ok(JSON.stringify(wNodes[0].covered) === '["d5"]', "after d4 covered=[d5]");
ok(JSON.stringify(wNodes[1].covered) === '["e6"]', "after d4 d5 c4 covered=[e6]");

// black repertoire: root counts (White moves first → opponent-to-move with a prepared reply)
const bNodes = decisionNodes(GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *"), "black");
ok(bNodes[0].path.length === 0, "black rep: root is a decision node");
ok(JSON.stringify(bNodes[0].covered) === '["e4"]', "root covered=[e4] for black");

// 9. gap severity (opponent-POV cp): loss vs best, capped by absolute edge
ok(gapSeverity(90, 80) === "high", "loss 10, edge +80 → high");
ok(gapSeverity(15, 10) === "low", "near-best but near-equal (+10) → low");
ok(gapSeverity(90, 40) === "medium", "loss 50 → medium");
ok(moveSan(START_FEN, "g1f3") === "Nf3", "moveSan g1f3 → Nf3");

// 10. validateLine — legal line canonicalizes + first UCI; illegal rejected at index
const vGood = validateLine(START_FEN, ["e4", "e5", "Nf3"]);
ok(vGood.ok && JSON.stringify(vGood.canonical) === '["e4","e5","Nf3"]', "validateLine legal → canonical");
ok(vGood.firstUci === "e2e4", "validateLine firstUci e2e4");
const vBad = validateLine(START_FEN, ["e4", "e5", "Qd9"]);
ok(!vBad.ok && vBad.badIndex === 2, "validateLine illegal flagged at index 2");

// 11. legalMoves from start = 20
ok(legalMoves(START_FEN).length === 20, "20 legal moves from start");
ok(legalMoves(START_FEN).includes("Nf3"), "legalMoves includes Nf3");

// 12. validateFen / validatePgn / stats
ok(validateFen(START_FEN).valid, "validateFen start valid");
ok(!validateFen("not a fen").valid, "validateFen garbage invalid");
ok(validatePgn("1. e4 e5 *").valid, "validatePgn legal");
ok(!validatePgn("").valid, "validatePgn empty invalid");
const st = GameTree.fromPgn("1. d4 d5 2. c4 e6 ( 2... c6 ) *").stats();
ok(st.nodes === 5 && st.leaves === 2 && st.maxDepth === 4, "stats nodes/leaves/maxDepth");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
