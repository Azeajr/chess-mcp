// Smoke test for the chess-tools GameTree (Phase 1 core). Run: node scripts/smoke-gametree.mjs
import {
  GameTree,
  pruneTailPath,
  compareShortcutLines,
  checkShortcutCoverage,
  classifyUciMove,
  weightFor,
  decisionNodes,
  findRepertoireGaps,
  resolveDanglingStubs,
  compareMoves,
  gapSeverity,
  moveSan,
  validateLine,
  legalMoves,
  validateFen,
  validatePgn,
  mainline,
  analyzeMainline,
  classifyCpLoss,
  moveAccuracy,
  parseOpeningsTsv,
  identifyDeepest,
  aggregateGames,
  walkGameVsRepertoire,
  positionProfile,
  themes,
  centerState,
  analyzeCongruence,
  isPromotion,
  medianLineLength,
  buildFitProfile,
  fitScore,
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
ok(t.childMovesAt([0, 0]).some((m) => m.san === "Nf3" && m.orig === "g1" && m.dest === "f3"), "childMovesAt returns repertoire arrows");

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

// 8b. transposition merge: one black-to-move position reached by two move orders → a single
// decision node carrying both paths (locks the O(n) position-threaded rewrite's merge logic).
const tNodes = decisionNodes(
  GameTree.fromPgn("1. d4 d5 2. Nf3 Nf6 3. c4 e6 *\n\n1. Nf3 Nf6 2. d4 d5 3. c4 e6 *"),
  "white",
);
const merged = tNodes.find((n) => n.transpositionPaths.length > 1);
ok(merged && merged.transpositionPaths.length === 2 && JSON.stringify(merged.covered) === '["e6"]', "decision node merges 2 move orders (transpositionPaths=2, covered=[e6])");

// 9. gap severity (opponent-POV cp): loss vs best, capped by absolute edge
ok(gapSeverity(90, 80) === "high", "loss 10, edge +80 → high");
ok(gapSeverity(15, 10) === "low", "near-best but near-equal (+10) → low");
ok(gapSeverity(90, 40) === "medium", "loss 50 → medium");
ok(moveSan(START_FEN, "g1f3") === "Nf3", "moveSan g1f3 → Nf3");

// 10. validateLine — legal line canonicalizes + first UCI; illegal rejected at index
const vGood = validateLine(START_FEN, ["e4", "e5", "Nf3"]);
ok(vGood.ok && JSON.stringify(vGood.canonical) === '["e4","e5","Nf3"]', "validateLine legal → canonical");
ok(vGood.firstUci === "e2e4", "validateLine firstUci e2e4");
// firstUci is the move's UCI via makeUci, so a promotion keeps its suffix (a4-char from+to concat
// dropped it). compare_moves returns this as a candidate's `uci`; the UI arrow slices [0:2]/[2:4], so
// the extra char is harmless there but the suffix is now correct for any UCI consumer.
ok(validateLine("8/P7/8/8/8/8/8/k6K w - - 0 1", ["a8=Q"]).firstUci === "a7a8q", "validateLine firstUci keeps the promotion suffix (a7a8q)");
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

// 12b. fromPgn validates move legality. chessops parsePgn stores a syntactically-valid-but-illegal SAN
// verbatim, so an illegal move must be rejected at the construction boundary — not loaded silently and
// then counted by stats() while leaves()/positionAtSan* skip-or-throw on it. load_repertoire surfaces
// the throw as invalid_pgn. A FEN setup header is honored (validates from the true start).
const rejects = (pgn) => { try { GameTree.fromPgn(pgn); return false; } catch { return true; } };
ok(rejects("1. e4 e5 2. Nf6 *"), "fromPgn rejects an illegal move (no knight reaches f6)");
ok(rejects("1. e4 e5 2. e4 *"), "fromPgn rejects a double move (e4 already played)");
ok(!rejects("1. e4 e5 2. Nf3 *"), "fromPgn accepts a legal line");
ok(!rejects('[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n\n1. a8=Q *'), "fromPgn honors a FEN setup (a8=Q legal there)");

// 13. transpositions — two move orders reaching the same position
const tr = GameTree.fromPgn("1. e4 ( 1. Nf3 e5 2. e4 ) 1... e5 2. Nf3 *").transpositions();
ok(tr.length === 1 && tr[0].paths.length === 2, "transposition found with 2 converging paths");

// 14. coverage — your-turn leaf = dangling; opponent-to-move leaf = frontier
const covDangling = GameTree.fromPgn("1. d4 d5 2. c4 e6 *").coverage("white");
ok(covDangling.danglingCount === 1 && covDangling.frontierCount === 0, "QGD white: 1 dangling line");
const covFrontier = GameTree.fromPgn("1. d4 d5 2. c4 *").coverage("white");
ok(covFrontier.danglingCount === 0 && covFrontier.frontierCount === 1, "opponent-to-move leaf is a frontier");

// 15. mainline walk + cp-loss classification + accuracy
const ml = mainline("1. e4 e5 2. Nf3 *");
ok(ml.length === 3, "mainline 3 moves");
ok(ml[0].color === "white" && ml[0].san === "e4" && ml[1].color === "black", "mainline colors/SAN");
ok(ml[0].fenBefore === START_FEN, "mainline first fenBefore = start");
ok(
  classifyCpLoss(201) === "blunder" &&
    classifyCpLoss(101) === "mistake" &&
    classifyCpLoss(51) === "inaccuracy" &&
    classifyCpLoss(50) === "good",
  "classifyCpLoss thresholds",
);
ok(moveAccuracy(0) === 1 && Math.abs(moveAccuracy(300) - Math.exp(-1)) < 1e-9, "moveAccuracy curve");

// 15b. analyzeMainline distinguishes a TERMINAL position (mate/stalemate → the engine returns [], not
// null) from engine-unavailable (null). A game ending in checkmate must still review move-by-move, not
// abort as engine_unavailable. The stub mirrors the real engine: [] once no legal moves remain.
const matePgn = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# *";
const termAnalyse = async (fen) => {
  const sans = legalMoves(fen);
  if (!sans.length) return []; // terminal: Stockfish emits no info/pv lines (verified vs the bundled engine)
  const uci = validateLine(fen, [sans[0]]).firstUci;
  return [{ uci, cp: 0, mate: null, depth: 12, pv: [uci] }];
};
const recMate = await analyzeMainline(matePgn, 12, termAnalyse);
ok(recMate !== null && recMate.length === 7, `analyzeMainline reviews a mate-ending game (${recMate ? recMate.length : "null"} plies)`);
ok(recMate && recMate.at(-1).san === "Qxf7#" && recMate.at(-1).classification === "good", "terminal eval: mating move classified, review not aborted");
ok((await analyzeMainline(matePgn, 12, async () => null)) === null, "analyzeMainline still returns null when the engine is truly unavailable");

// 16. modify_repertoire_line edits — clone-on-write
const base = GameTree.fromPgn("1. e4 *");
const added = base.edit("add", ["e4"], { addMoves: ["e5", "Nf3"] });
ok(added.tree && added.tree.toPgn().includes("1. e4 e5 2. Nf3"), "edit add grafts the line");
ok(base.stats().nodes === 1, "source tree unchanged after edit (clone-on-write)");
ok(added.tree.stats().nodes === 3, "edited tree has 3 nodes");
const pr = GameTree.fromPgn("1. e4 e5 ( 1... c5 ) *").edit("prune", ["e4", "c5"]);
ok(pr.tree && pr.tree.nodeAt([0]).children.length === 1, "prune removes the c5 variation");
ok(GameTree.fromPgn("1. e4 *").edit("prune", []).error === "invalid_edit", "prune root → invalid_edit");
ok(GameTree.fromPgn("1. e4 *").edit("add", ["e4"], { addMoves: ["Qh8"] }).error === "invalid_line", "illegal add → invalid_line");
ok(GameTree.fromPgn("1. e4 *").edit("prune", ["d4"]).error === "variation_not_found", "bad path → variation_not_found");
const tolerantAdd = GameTree.fromPgn("1. e4 c6 2. c3 d5 3. e5 *").edit("add", ["e4", "c6", "c3", "d5", "exd5"], { addMoves: ["cxd5", "d4"] });
ok(!tolerantAdd.error && tolerantAdd.tree?.toPgn().includes("3. exd5 cxd5 4. d4"), "add tolerates path ending in new moves");
// add echoes where the graft actually anchored after the path was re-split (retro #3 legibility)
ok(
  tolerantAdd.added &&
    tolerantAdd.added.from.join(" ") === "e4 c6 c3 d5" &&
    tolerantAdd.added.moves.join(" ") === "exd5 cxd5 d4",
  `add reports anchor + grafted moves (${tolerantAdd.added?.from.join(" ")} + ${tolerantAdd.added?.moves.join(" ")})`,
);

// 16b. sanPathAt — index path → SAN list (inverse of resolveSan)
const spTree = GameTree.fromPgn("1. e4 e5 ( 1... c5 2. Nf3 ) 2. Nf3 *");
ok(spTree.sanPathAt([]).length === 0, "sanPathAt([]) → []");
ok(spTree.sanPathAt([0, 0]).join(" ") === "e4 e5", "sanPathAt mainline → e4 e5");
ok(spTree.sanPathAt([0, 1]).join(" ") === "e4 c5", "sanPathAt variation → e4 c5");
let spThrew = false;
try { spTree.sanPathAt([9]); } catch { spThrew = true; }
ok(spThrew, "sanPathAt throws on invalid index");
// indexPathOfSan — inverse of sanPathAt
ok(spTree.indexPathOfSan(["e4", "c5"]).join(",") === "0,1", "indexPathOfSan variation → 0,1");
ok(spTree.indexPathOfSan(["e4", "e5"]).join(",") === "0,0", "indexPathOfSan mainline → 0,0");
ok(spTree.indexPathOfSan(["e4", "d4"]) === null, "indexPathOfSan unknown line → null");

// 16d. extendedBridges — engine-guided multi-ply extension (retro 2a/2b). Injected pickMoves
// stands in for the engine (deterministic). White stub "1.c4 c5 *" rejoins the prepared
// 1.c4 e6 2.Nc3 c5 line TWO plies on: white Nc3, then black ...e6 transposes into prep.
const extTree = GameTree.fromPgn("1. c4 e6 2. Nc3 c5 *\n\n1. c4 c5 *");
const pickNc3 = async (fen) => (fen.split(" ")[1] === "w" ? ["b1c3"] : []);
const ext = await extTree.extendedBridges("white", { maxDepth: 3, nodeBudget: 60 }, pickNc3);
const twoPly = ext.find((b) => b.moves.join(" ") === "Nc3 e6");
ok(twoPly && twoPly.fromPath.join(" ") === "c4 c5", "extendedBridges: 2-ply extension departs from 1.c4 c5");
ok(twoPly && twoPly.joinsPath.join(" ") === "c4 e6 Nc3 c5", "extendedBridges: joins the c4 e6 Nc3 c5 line");
ok(twoPly && twoPly.moves.length === 2, "extendedBridges: rejoin takes 2 plies");
// Depth cap: maxDepth 1 cannot reach a 2-ply rejoin.
const shallow = await extTree.extendedBridges("white", { maxDepth: 1, nodeBudget: 60 }, pickNc3);
ok(!shallow.some((b) => b.moves.join(" ") === "Nc3 e6"), "extendedBridges: maxDepth 1 misses the 2-ply rejoin");
// Linear line → no extensions (no frontier leaf where the color is to move).
const noExt = await GameTree.fromPgn("1. e4 e5 2. Nf3 *").extendedBridges("white", { maxDepth: 4, nodeBudget: 40 }, pickNc3);
ok(noExt.length === 0, "extendedBridges: linear line → none");

// 16d-bis. resolveDanglingStubs — wires extendedBridges into coverage: does each dangling stub
// bridge back into prep? extTree's "1.c4 c5" leaf (white to move) rejoins c4 e6 Nc3 c5 via Nc3+...e6.
const stubAnalyse = async (fen) =>
  fen.split(" ")[1] === "w"
    ? [{ uci: "b1c3", cp: 0, mate: null, depth: 12, pv: ["b1c3"] }]
    : [{ uci: "e7e6", cp: 0, mate: null, depth: 12, pv: ["e7e6"] }];
const stubs = await resolveDanglingStubs(extTree, "white", {}, stubAnalyse);
ok(!stubs.error && stubs.resolved >= 1, "resolveDanglingStubs: at least one dangling stub resolves");
const connected = stubs.error ? null : stubs.dangling.find((d) => d.path.join(" ") === "c4 c5");
ok(connected && connected.connects_via?.join(" ") === "Nc3 e6", "resolveDanglingStubs: c4 c5 connects via Nc3 e6");
ok(connected && connected.joins_path?.join(" ") === "c4 e6 Nc3 c5", "resolveDanglingStubs: rejoins the c4 e6 Nc3 c5 line");

// 16e. Bridges omit lines that ALREADY transpose. Game 1's "...3.Nc3" leaf is the same position
// as game 2's 3.Nc3 node (reached by the Nf6/e6 move-order swap) → an existing transposition.
// That leaf must not be reported as a bridge departure (transpositions() already links it).
const dupTree = GameTree.fromPgn("1. d4 Nf6 2. c4 e6 3. Nc3 *\n\n1. d4 e6 2. c4 Nf6 3. Nc3 d5 *");
const pickD5 = async (fen) => (fen.split(" ")[1] === "b" ? ["d7d5"] : []);
const dupExt = await dupTree.extendedBridges("black", { maxDepth: 3, nodeBudget: 60 }, pickD5);
ok(dupExt.length === 0, "extendedBridges: a leaf that already transposes yields no extension");

// 16f. pruneTranspositions — shorten a line via an engine-vetted transposition. A London-ish line
// (Nf3/Bf4) can re-route at move 2 by playing c4, transposing into a QID line that continues.
// analyse is a deterministic stub (no real engine); the "after 1.d4 Nf6" FEN carries the candidates.
const prTree = GameTree.fromPgn("1. d4 Nf6 2. Nf3 e6 3. Bf4 *\n\n1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 *");
const afterD4Nf6 = (fen) => fen.includes("5n2/8/3P4");
const linesGood = [{ uci: "c2c4", cp: 30, mate: null }, { uci: "g1f3", cp: 20, mate: null }];
const analyseGood = async (fen) => (afterD4Nf6(fen) ? linesGood : []);
const prune = await prTree.pruneTranspositions("white", {}, analyseGood);
const aCut = prune.suggestions.find((p) => p.rerouteMove === "c4");
ok(aCut && aCut.linePath.join(" ") === "d4 Nf6 Nf3 e6 Bf4", "pruneTranspositions: flags the shortenable London line");
ok(aCut && aCut.atPly === 2 && aCut.savedPlies === 3, "pruneTranspositions: re-route @ply2 prunes the 3-ply tail");
ok(aCut && aCut.joinsPath.join(" ") === "d4 Nf6 c4", "pruneTranspositions: joins the c4 (QID) line");
ok(aCut && aCut.evalStay === 20 && aCut.evalTranspose === 30 && aCut.evalDelta === -10, "pruneTranspositions: reports the eval trade");
// Near-best gate: a transposing move in the top-k but far below #1 (a blunder) is excluded.
const linesBlunder = [{ uci: "c1f4", cp: 100, mate: null }, { uci: "c2c4", cp: 20, mate: null }];
const gated = await prTree.pruneTranspositions("white", {}, async (fen) => (afterD4Nf6(fen) ? linesBlunder : []));
ok(!gated.suggestions.some((p) => p.rerouteMove === "c4"), "pruneTranspositions: near-best gate drops a top-k blunder re-route");
// maxLossCp: re-route that loses more than the cap vs staying is filtered (the gaining one stays).
const capped = await prTree.pruneTranspositions("white", { maxLossCp: 5 }, analyseGood);
ok(capped.suggestions.some((p) => p.rerouteMove === "c4"), "pruneTranspositions: keeps a re-route that gains eval");
ok(!capped.suggestions.some((p) => p.rerouteMove === "Nf3"), "pruneTranspositions: maxLossCp filters a re-route that loses >5cp");
// budget caps engine analyses (now spent only on pre-filtered candidate nodes, P1, not every node).
const budgeted = await prTree.pruneTranspositions("white", { budget: 1 }, analyseGood);
ok(budgeted.positionsAnalysed <= 1, "pruneTranspositions: budget caps analyses spent");
// cursor pagination: scanning only the 2nd leaf (the QID line, no shortening) yields nothing, and the
// metadata reports the cursor advancing to the end (next_leaf null = done).
const chunk = await prTree.pruneTranspositions("white", { leafStart: 1, leafCount: 1 }, analyseGood);
ok(chunk.totalLeaves === 2 && chunk.leafStart === 1 && chunk.nextLeaf === null, "pruneTranspositions: leaf cursor reports totals and exhausts");
// C6: a full (no-cursor) call is the authoritative global ranking (partial:false); a cursor chunk is
// progress-only (partial:true) and must not be merged by the caller.
ok(prune.partial === false && chunk.partial === true, "C6: full call is authoritative, cursor chunk is partial");
// P1 pre-filter: a single line with no branches has no cross-branch transposer, so the scan spends
// ZERO engine calls and the estimate is 0 (the engine is never consulted on dead nodes).
const noTrans = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
const nt = await noTrans.pruneTranspositions("white", {}, async () => [{ uci: "g1f3", cp: 10, mate: null }]);
ok(nt.totalPositionsEstimate === 0 && nt.positionsAnalysed === 0 && nt.suggestions.length === 0, "pruneTranspositions: P1 skips nodes with no cross-branch transposer");
// P2: both leaves' d4Nf6 candidate is the same position — analysed once (memo), so the walk spends 2
// engine calls (d4Nf6 + the deeper d4Nf6Nf3e6 candidate on line 1), not 3.
ok(prune.positionsAnalysed === 2, "pruneTranspositions: P2 memo analyses a shared position once");
// onProgress fires; pruneTailPath gives the apply path (the original line's node at the re-route ply).
let progressCalls = 0;
await prTree.pruneTranspositions("white", {}, analyseGood, () => progressCalls++);
ok(progressCalls > 0, "pruneTranspositions: onProgress fires during the scan");
ok(JSON.stringify(pruneTailPath(aCut)) === JSON.stringify(["d4", "Nf6", "Nf3"]), "pruneTailPath: prunes the original line's tail at the re-route ply");
// C2: when the line's own move (Nf3) is outside the engine's top-k, evalStay is resolved from a
// single-PV eval of the position after that move (here 15cp) — the trade is never reported null.
const c2only = async (fen) =>
  fen.includes("PPP1PPPP/RNBQKBNR") ? [{ uci: "c2c4", cp: 30, mate: null }] // d4 Nf6: g1 knight still home
  : fen.includes("RNBQKB1R b") ? [{ uci: "e7e6", cp: 15, mate: null }] // after Nf3 (black to move)
  : [];
const c2res = await prTree.pruneTranspositions("white", {}, c2only);
const c2cut = c2res.suggestions.find((p) => p.rerouteMove === "c4");
ok(c2cut && c2cut.evalStay === 15 && c2cut.evalDelta === -15, "pruneTranspositions: C2 resolves evalStay for an out-of-top-k stay move");
// C1: a line can have several re-routes; the early (move 2) one cuts the most tail but evals low, a
// deeper (move 4) one cuts less but evals high — bestSavings and bestEval tag the two distinct picks.
const twoStub = async (fen) =>
  fen.includes("5n2/8/3P4") ? [{ uci: "c2c4", cp: 10, mate: null }, { uci: "g1f3", cp: 20, mate: null }] // move 2: c4 eval 10
  : fen.includes("4pn2/8/3P4") ? [{ uci: "c2c4", cp: 40, mate: null }, { uci: "c1f4", cp: 20, mate: null }] // move 4: c4 eval 40
  : [];
const two = await prTree.pruneTranspositions("white", {}, twoStub);
const l1 = two.suggestions.filter((s) => s.linePath.join(" ") === "d4 Nf6 Nf3 e6 Bf4");
const sav = l1.find((s) => s.bestSavings);
const ev = l1.find((s) => s.bestEval);
ok(l1.length === 2, "C1: all re-routes for a line are returned, not just the earliest");
ok(sav && sav.atPly === 2 && sav.savedPlies === 3 && sav.bestEval === false, "C1: bestSavings = earliest / biggest tail cut");
ok(ev && ev.atPly === 4 && ev.evalTranspose === 40 && ev.bestSavings === false, "C1: bestEval = best resulting eval, a distinct pick");
// E1: with confirmDepth set, the best-eval pick is re-searched (here the deep stub returns 99cp) and
// flagged evalConfirmed; the cheaper picks are not.
const e1Stub = async (fen, _mpv, depth) =>
  depth != null ? [{ uci: "a7a6", cp: 99, mate: null }] // deep-confirm call (any position) → force a value
  : fen.includes("5n2/8/3P4") ? [{ uci: "c2c4", cp: 10, mate: null }, { uci: "g1f3", cp: 20, mate: null }]
  : fen.includes("4pn2/8/3P4") ? [{ uci: "c2c4", cp: 40, mate: null }, { uci: "c1f4", cp: 20, mate: null }]
  : [];
const e1 = await prTree.pruneTranspositions("white", { confirmDepth: 20 }, e1Stub);
const e1ev = e1.suggestions.find((s) => s.linePath.join(" ") === "d4 Nf6 Nf3 e6 Bf4" && s.bestEval);
ok(e1ev && e1ev.evalConfirmed === true && e1ev.evalTranspose === 99, "E1: best-eval re-route is deep-confirmed");
ok(e1.suggestions.some((s) => s.bestSavings && !s.evalConfirmed), "E1: only the best-eval pick is deep-confirmed");
// C3 building blocks: subtree leaves (what a branch commits to), mainline leaf (its representative
// line), and fen-at-path. d4Nf6 has 2 leaves under it (the Bf4 line + the g3 line); a leaf has 1.
ok(prTree.subtreeLeafBoards(["d4", "Nf6"]).length === 2, "C3: subtreeLeafBoards collects the branch's leaves");
ok(prTree.subtreeLeafBoards(["d4", "Nf6", "Nf3", "e6", "Bf4"]).length === 1, "C3: a leaf node yields one board");
ok(prTree.subtreeLeafBoards(["d4", "Qh5"]) === null, "C3: subtreeLeafBoards returns null for an absent path");
ok(prTree.mainlineLeafBoard(["d4", "Nf6"]) !== null, "C3: mainlineLeafBoard follows first-children to a leaf");
ok(typeof prTree.fenAtSanPath(["d4", "Nf6"]) === "string" && prTree.fenAtSanPath(["d4", "Qh5"]) === null, "C3: fenAtSanPath resolves a path / null when absent");
// C3 core (compareShortcutLines): constant-eval stub → evalDelta 0 → fit breaks the tie; both branches
// of prTree are short/unclassifiable so structures are "unknown".
const flat = async () => [{ uci: "a2a3", cp: 0, mate: null }];
const cmp = await compareShortcutLines(prTree, "white", { linePath: ["d4", "Nf6", "Nf3", "e6", "Bf4"], atPly: 2, joinsPath: ["d4", "Nf6", "c4"] }, flat);
ok(!("error" in cmp) && cmp.basis === "fit" && cmp.evalDelta === 0, "C3: compareShortcutLines falls back to fit when eval is a wash");
ok(typeof cmp.fitStay === "number" && (cmp.recommend === "stay" || cmp.recommend === "transpose"), "C3: returns fit scores + a recommendation");
ok(!("error" in cmp) && cmp.fitStay > 0 && cmp.fitTranspose > 0, "C3: blended fit scores short/unclassified branches > 0 (no unknown→0 collapse)");
const cmpBad = await compareShortcutLines(prTree, "white", { linePath: ["d4", "Nf6"], atPly: 1, joinsPath: ["d4", "Qh5"] }, flat);
ok("error" in cmpBad && cmpBad.error === "path_not_found", "C3: bad joins_path → path_not_found");
// C4 core (checkShortcutCoverage): [] stub means the gap scan finds nothing, so pruning the tail opens
// no new gap; the prune path is line_path truncated to at_ply+1.
const empty = async () => [];
const cov = await checkShortcutCoverage(prTree, "white", { linePath: ["d4", "Nf6", "Nf3", "e6", "Bf4"], atPly: 2 }, empty);
ok(!("error" in cov) && cov.introduces_gap === false && cov.prunes.join(" ") === "d4 Nf6 Nf3", "C4: checkShortcutCoverage prunes the tail and reports coverage-safe");
const covErr = await checkShortcutCoverage(prTree, "white", { linePath: ["d4", "Nf6", "Nf3", "e6", "Bf4"], atPly: 2 }, async () => null);
ok("error" in covErr && covErr.error === "engine_unavailable", "C4: propagates engine_unavailable");

// 16g. findRepertoireGaps — transposition-first resolution. At the decision node after
// 1.d4 Nf6 2.c4 e6 3.Nc3 (black to move, prep = ...Bb4), the uncovered reply ...d5 transposes into
// the 1.d4 d5 2.c4 e6 3.Nc3 Nf6 leaf — a false gap, recorded as covered rather than counted.
const gapTree = GameTree.fromPgn("1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 *\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 *");
const atGapNode = (fen) => fen.includes("4pn2/8/2PP4/2N5/") && fen.split(" ")[1] === "b";
const gapStub = async (fen) => (atGapNode(fen) ? [{ uci: "d7d5", cp: -40, mate: null, depth: 10, pv: ["d7d5"] }] : []);
const gr = await findRepertoireGaps(gapTree, "white", { minSeverity: "low" }, gapStub);
ok(!gr.error && gr.covered_by_transposition.length === 1, "findRepertoireGaps: a transposing uncovered reply is covered, not a gap");
ok(gr.covered_by_transposition?.[0]?.uncovered_move === "d5", "covered_by_transposition records the transposing reply ...d5");
ok(gr.covered_by_transposition?.[0]?.joins_path.join(" ") === "d4 d5 c4 e6 Nc3 Nf6", "covered_by_transposition names the prep line joined");
ok(!gr.error && !gr.gaps.some((g) => g.uncovered_move === "d5"), "findRepertoireGaps: the transposing reply is excluded from gaps");

// 16h. compareMoves — rank caller SANs by engine, mover POV. Stubs stand in for the engine (the
// real one is exercised by smoke-client). From the start (White to move) e4 (white-POV +20) outranks
// a3 (−5); mover_cp is reported from your POV.
const cmStub = async (fen) =>
  fen.includes("4P3") ? [{ uci: "e7e5", cp: 20, mate: null, depth: 10, pv: [] }] // after 1.e4 (Black to move)
  : [{ uci: "a7a6", cp: -5, mate: null, depth: 10, pv: [] }]; // after 1.a3
const cmRanked = await compareMoves(START_FEN, ["a3", "e4"], 10, cmStub);
ok(cmRanked.candidates[0].san === "e4" && cmRanked.candidates[0].rank === 1, "compareMoves ranks the stronger move first");
ok(cmRanked.candidates[0].mover_cp === 20 && cmRanked.candidates[1].mover_cp === -5, "compareMoves reports mover-POV cp");
ok((await compareMoves(START_FEN, ["Qz9"], 10, cmStub)).candidates[0].error === "illegal_move", "compareMoves flags an illegal candidate");
ok((await compareMoves(START_FEN, ["e4"], 10, async () => null)).candidates[0].error === "engine_unavailable", "compareMoves: null engine → engine_unavailable");
// Terminal-after-move (Ra8#): the engine returns [] (no legal replies), NOT null. The mating move must be
// decisive (mover_cp = +MATE_CP 100000), never mislabeled engine_unavailable (the conflation bug fixed here).
const cmMateFen = "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1";
const cmMateStub = async (fen) => (legalMoves(fen).length ? [{ uci: "a1a2", cp: 0, mate: null, depth: 10, pv: [] }] : []);
const cmMate = await compareMoves(cmMateFen, ["Ra8"], 10, cmMateStub);
ok(!cmMate.candidates[0].error && cmMate.candidates[0].mover_cp === 100000, "compareMoves: a mating move is decisive, not engine_unavailable");

// 17. illustrative lines — NAG tier
const il = GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $4 *").illustrativeLines();
ok(il.lines.length === 1 && il.illustrativeLeaves === 1, "illustrative NAG line flagged");
ok(il.lines[0].path.at(-1) === "Qh4", "flagged path ends at the bad move");

// 18. ECO opening lookup (real table, chessops-keyed)
const ecoTable = parseOpeningsTsv(readFileSync("./apps/mcp-server/data/openings.tsv", "utf8"));
ok(ecoTable.size > 3000, `ECO table loaded (${ecoTable.size} entries)`);
const sicilian = identifyDeepest(ecoTable, "1. e4 c5 *");
ok(sicilian && sicilian.name.includes("Sicilian"), `1.e4 c5 → ${sicilian?.name} (${sicilian?.eco})`);
const qg = identifyDeepest(ecoTable, "1. d4 d5 2. c4 *");
ok(qg && qg.name.includes("Queen's Gambit"), `1.d4 d5 2.c4 → ${qg?.name} (${qg?.eco})`);

// 20. aggregateGames (Python test parity: e5 blunder x3 in one group)
const aggRecs = [
  { result: "loss", group_key: "eco_e4", group_name: "Open Game", avg_cpl: 50, blunders: [{ move: "e5", classification: "blunder" }, { move: "d4", classification: "mistake" }, { move: "e5", classification: "blunder" }] },
  { result: "loss", group_key: "eco_e4", group_name: "Open Game", avg_cpl: 70, blunders: [{ move: "e5", classification: "blunder" }, { move: "g5", classification: "inaccuracy" }] },
];
const agg = aggregateGames(aggRecs, true);
ok(agg.total_games === 2 && agg.groups[0].top_blunders[0].move === "e5" && agg.groups[0].top_blunders[0].frequency === 3, "aggregateGames top blunder e5 x3");
ok(agg.groups[0].loss_rate === 1, "aggregateGames loss_rate 1.0");

// 21. walkGameVsRepertoire — followed / opponent-departed / player-departed
const mapH = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *").moveMap();
const followed = walkGameVsRepertoire(mapH, "white", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
ok(followed.in_book_plies === 4 && !followed.player_deviation && !followed.uncovered_opponent, "followed prep: 4 in-book plies");
const oppDev = walkGameVsRepertoire(mapH, "white", "1. e4 e5 2. Nf3 d6 *");
ok(oppDev.in_book_plies === 3 && oppDev.uncovered_opponent?.played === "d6", "opponent left book at d6");
const playerDev = walkGameVsRepertoire(mapH, "white", "1. e4 e5 2. d4 *");
ok(playerDev.in_book_plies === 2 && playerDev.player_deviation?.played === "d4", "player left prep at d4");

// 22. structure — themes, center state, primitives
const fianchetto = GameTree.fromPgn("1. g3 g6 2. Bg2 Bg7 *").positionAtSanPath(["g3", "g6", "Bg2", "Bg7"]);
const th = themes(fianchetto.board, "white");
ok(th.fianchetto_white && th.fianchetto_black, "fianchetto themes detected (both sides)");
ok(centerState(GameTree.fromPgn("1. e4 e5 *").positionAtSanPath(["e4", "e5"]).board) === "locked", "1.e4 e5 → locked center");
ok(centerState(GameTree.fromPgn("1. e4 c5 *").positionAtSanPath(["e4", "c5"]).board) === "semi-open", "1.e4 c5 → semi-open (home d-pawns still central)");
const dbl = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 *").positionAtSanPath(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6"]);
const prof = positionProfile(dbl.board, "black", "");
ok(prof.primitives.doubled.includes("c6") && prof.primitives.doubled.includes("c7"), "doubled c-pawns for black after Bxc6 dxc6");

// 23. congruence — Nimzo cluster where one line accepts doubled c-pawns (weakness minority)
const nimzo = "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 Bxc3+ ( 4... O-O 5. Bd3 d5 6. Nf3 c5 ) ( 4... b6 5. Bd3 Bb7 6. Nf3 O-O ) 5. bxc3 O-O *";
const cong = analyzeCongruence(GameTree.fromPgn(nimzo), "white", ecoTable, {});
ok(cong.leaves_analyzed === 3, `congruence: 3 leaves (${cong.leaves_analyzed})`);
ok(cong.incongruencies.some((i) => i.type === "weakness_inconsistency"), "weakness_inconsistency flagged for the doubled-pawn line");
// ECO clustering still resolves the real opening name (locks the incremental-ECO rewrite)
ok(Object.keys(cong.clusters).some((k) => /Nimzo/i.test(k)), `clusters carry the ECO name (${Object.keys(cong.clusters).join(", ")})`);
// 1-leaf repertoire → nothing to compare → no flags
ok(analyzeCongruence(GameTree.fromPgn("1. e4 e5 2. Nf3 *"), "white", ecoTable, {}).total_flagged === 0, "single line → no congruence flags");

// 24. isPromotion — pawn to last rank vs normal move
ok(isPromotion("8/P7/8/8/8/8/8/k6K w - - 0 1", "a7", "a8") === true, "isPromotion true for a7→a8");
ok(isPromotion(START_FEN, "e2", "e4") === false, "isPromotion false for e2→e4");

// 26. edit("reorder") — promote a variation to the mainline (the one edit action with no coverage).
const ro = GameTree.fromPgn("1. e4 e5 ( 1... c5 ) *").edit("reorder", ["e4"], { promoteMove: "c5" });
ok(ro.tree && ro.tree.nodeAt([0]).children[0].data.san === "c5" && ro.tree.toPgn().includes("1. e4 c5"), "reorder promotes c5 to mainline");
ok(GameTree.fromPgn("1. e4 e5 ( 1... c5 ) *").edit("reorder", ["e4"], { promoteMove: "d4" }).error === "variation_not_found", "reorder unknown move → variation_not_found");
ok(GameTree.fromPgn("1. e4 e5 ( 1... c5 ) *").edit("reorder", ["e4"], {}).error === "invalid_edit", "reorder without promote_move → invalid_edit");
// add with no moves → invalid_edit (distinct from an illegal move → invalid_line)
ok(GameTree.fromPgn("1. e4 *").edit("add", ["e4"], { addMoves: [] }).error === "invalid_edit", "add with empty moves → invalid_edit");

// 27. illustrativeLines — only the BAD NAG tiers ($2 dubious / $4 blunder / $6) flag; a good NAG does not.
ok(GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $2 *").illustrativeLines().lines.length === 1, "$2 (dubious) flags an illustrative line");
ok(GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $6 *").illustrativeLines().lines.length === 1, "$6 flags an illustrative line");
ok(GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $1 *").illustrativeLines().lines.length === 0, "$1 (good move) is NOT illustrative");

// 28. positionAtSanPath — null on a path that doesn't match a line (the get_structural_profile
// variation_not_found guard); a real line resolves.
ok(spTree.positionAtSanPath(["e4", "d4"]) === null, "positionAtSanPath null on an off-tree path");
ok(spTree.positionAtSanPath(["e4", "e5"]) !== null, "positionAtSanPath resolves a real line");

// 29. medianLineLength — filtered median leaf depth (gap-fill "typical depth"). Transposition-endpoint
// leaves (position recurs elsewhere, keyCount > 1) are excluded so deliberately-short lines don't
// drag it down.
let mlt = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
mlt = mlt.edit("add", ["e4", "e5"], { addMoves: ["Bc4", "Bc5"] }).tree; // depth-4 leaf
mlt = mlt.edit("add", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"], { addMoves: ["Ba4", "Nf6"] }).tree; // depth-8 leaf
ok(medianLineLength(mlt) === 6, "medianLineLength → median of genuine leaves {4,8} = 6");
// add 1...Nc6 2.Nf3 e5 3.Bb5 → a depth-5 leaf that transposes into the mainline after 3.Bb5
const mltT = mlt.edit("add", ["e4"], { addMoves: ["Nc6", "Nf3", "e5", "Bb5"] }).tree;
ok(medianLineLength(mltT) === 6, "medianLineLength excludes the depth-5 transposition leaf (plain median would be 5)");
ok(medianLineLength(new GameTree()) === 0, "medianLineLength → 0 for an empty tree");

// 30. buildFitProfile / fitScore — blended structural fit (named structure + center + themes). A leaf
// scores > 0 against its own repertoire's profile (the lone-named-structure metric often gave 0).
const fitRep = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *");
const fitBoards = fitRep.leafPositions().map((p) => p.board);
const fitProfile = buildFitProfile(fitBoards, "white");
ok(fitProfile.freq.size > 0, "buildFitProfile → non-empty signal profile");
const selfFit = fitScore(fitProfile, fitBoards[0], "white");
ok(selfFit > 0 && selfFit <= 1, "fitScore: a repertoire leaf scores in (0,1] against its own profile");

// 30b. fitScore gives an unclassified-but-thematic position real signal — the fix for shorten/suggest
// fit collapsing to 0 on "unknown". A double-fianchetto line classifies "unknown" (no named scorer)
// yet scores > 0 via its center + theme signals (the blended fit now shared by shorten + suggest).
const fianBoards = GameTree.fromPgn("1. g3 g6 2. Bg2 Bg7 3. Nf3 Nf6 *").leafPositions().map((p) => p.board);
ok(positionProfile(fianBoards[0], "white", "").structure_class === "unknown", "fianchetto leaf classifies unknown");
ok(fitScore(buildFitProfile(fianBoards, "white"), fianBoards[0], "white") > 0, "fitScore: unknown-but-thematic position scores > 0 (themes/center carry it)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
