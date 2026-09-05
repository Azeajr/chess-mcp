import {
  GameTree,
  pruneTailPath,
  compareShortcutLines,
  checkShortcutCoverage,
  classifyUciMove,
  weightFor,
  decisionNodes,
  turnNodes,
  findRepertoireGaps,
  suggestGapFills,
  auditRepertoireMoves,
  findOnlyMoves,
  onlyMoveDeckCsv,
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
  isPromotion,
  medianLineLength,
  buildFitProfile,
  fitScore,
  explorerPosition,
  theoryDepth,
  setExplorerToken,
  hasExplorerToken,
} from "../packages/chess-tools/dist/index.js";
import { readFileSync } from "node:fs";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));

const t = new GameTree();
ok(t.fenAt([]).startsWith("rnbqkbnr/pppppppp"), "start fen");
let r = t.playMove([], "e2", "e4");
ok(r.appended && t.sanAt(r.path) === "e4", "play e4 appends, san e4");
r = t.playMove(r.path, "e7", "e5");
ok(t.sanAt(r.path) === "e5", "play e5");
r = t.playMove(r.path, "g1", "f3");
ok(t.sanAt(r.path) === "Nf3", "play Nf3");
ok(t.toPgn().includes("1. e4 e5 2. Nf3"), "pgn serializes mainline");
ok(
  t.childMovesAt([0, 0]).some((m) => m.san === "Nf3" && m.orig === "g1" && m.dest === "f3"),
  "childMovesAt returns repertoire arrows",
);

const before = t.nodeAt([]).children.length;
const r2 = t.playMove([], "e2", "e4");
ok(!r2.appended && t.nodeAt([]).children.length === before, "replay e4 navigates, no dup");

const r3 = t.playMove([], "d2", "d4");
ok(r3.appended && t.nodeAt([]).children.length === before + 1, "d4 creates sibling variation");
ok(t.sanAt(r3.path) === "d4", "variation san d4");

const promo = GameTree.fromPgn("1. a4 b5 2. axb5 a6 3. bxa6 Nf6 4. a7 e6 5. axb8=Q *");
ok(promo.sanAt([0, 0, 0, 0, 0, 0, 0, 0, 0]) === "axb8=Q", "parsed promotion from pgn");

const pgn = readFileSync(new URL("../sample-repertoire.pgn", import.meta.url), "utf8");
const rep = GameTree.fromPgn(pgn);
ok(rep.game.moves.children.length > 0, "repertoire has moves");
ok(rep.destsAt([]).size === 10, "10 movable origin squares from start");
ok(rep.lastMoveAt([0]) !== null, "lastMove computed");

const rep2 = GameTree.fromPgn("1. e4 e5 2. Nf3 *");
const keys2 = rep2.allPositionKeys();
const bookAtRoot = rep2.childSansAt([]);
ok(classifyUciMove(START_FEN, "e2e4", bookAtRoot, keys2).fit === "in-book", "e4 is in-book");
ok(classifyUciMove(START_FEN, "d2d4", bookAtRoot, keys2).fit === "out", "d4 is out of book");
const keys3 = GameTree.fromPgn("1. Nf3 *").allPositionKeys();
ok(
  classifyUciMove(START_FEN, "g1f3", ["e4"], keys3).fit === "adjacent",
  "Nf3 adjacent via transposition",
);

ok(weightFor(60, null, "white") === "thick", "+60 white → thick");
ok(weightFor(60, null, "black") === "thin", "+60 white-POV is thin for black");
ok(weightFor(0, null, "white") === "medium", "0 → medium");
ok(weightFor(null, 2, "white") === "thick", "mate for you → thick");

const wRep = GameTree.fromPgn("1. d4 d5 2. c4 e6 *");
const wNodes = decisionNodes(wRep, "white");
ok(wNodes.length === 2, "white rep: 2 decision nodes");
ok(JSON.stringify(wNodes[0].covered) === '["d5"]', "after d4 covered=[d5]");
ok(JSON.stringify(wNodes[1].covered) === '["e6"]', "after d4 d5 c4 covered=[e6]");

const bNodes = decisionNodes(GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *"), "black");
ok(bNodes[0].path.length === 0, "black rep: root is a decision node");
ok(JSON.stringify(bNodes[0].covered) === '["e4"]', "root covered=[e4] for black");

const tNodes = decisionNodes(
  GameTree.fromPgn("1. d4 d5 2. Nf3 Nf6 3. c4 e6 *\n\n1. Nf3 Nf6 2. d4 d5 3. c4 e6 *"),
  "white",
);
const merged = tNodes.find((n) => n.transpositionPaths.length > 1);
ok(
  merged && merged.transpositionPaths.length === 2 && JSON.stringify(merged.covered) === '["e6"]',
  "decision node merges 2 move orders (transpositionPaths=2, covered=[e6])",
);

ok(gapSeverity(90, 80) === "high", "loss 10, edge +80 → high");
ok(gapSeverity(15, 10) === "low", "near-best but near-equal (+10) → low");
ok(gapSeverity(90, 40) === "medium", "loss 50 → medium");
ok(moveSan(START_FEN, "g1f3") === "Nf3", "moveSan g1f3 → Nf3");

const vGood = validateLine(START_FEN, ["e4", "e5", "Nf3"]);
ok(
  vGood.ok && JSON.stringify(vGood.canonical) === '["e4","e5","Nf3"]',
  "validateLine legal → canonical",
);
ok(vGood.firstUci === "e2e4", "validateLine firstUci e2e4");
ok(
  validateLine("8/P7/8/8/8/8/8/k6K w - - 0 1", ["a8=Q"]).firstUci === "a7a8q",
  "validateLine firstUci keeps the promotion suffix (a7a8q)",
);
const vBad = validateLine(START_FEN, ["e4", "e5", "Qd9"]);
ok(!vBad.ok && vBad.badIndex === 2, "validateLine illegal flagged at index 2");

ok(legalMoves(START_FEN).length === 20, "20 legal moves from start");
ok(legalMoves(START_FEN).includes("Nf3"), "legalMoves includes Nf3");

ok(validateFen(START_FEN).valid, "validateFen start valid");
ok(!validateFen("not a fen").valid, "validateFen garbage invalid");
ok(validatePgn("1. e4 e5 *").valid, "validatePgn legal");
ok(!validatePgn("").valid, "validatePgn empty invalid");
const st = GameTree.fromPgn("1. d4 d5 2. c4 e6 ( 2... c6 ) *").stats();
ok(st.nodes === 5 && st.leaves === 2 && st.maxDepth === 4, "stats nodes/leaves/maxDepth");

const rejects = (pgn) => {
  try {
    GameTree.fromPgn(pgn);
    return false;
  } catch {
    return true;
  }
};
ok(rejects("1. e4 e5 2. Nf6 *"), "fromPgn rejects an illegal move (no knight reaches f6)");
ok(rejects("1. e4 e5 2. e4 *"), "fromPgn rejects a double move (e4 already played)");
ok(!rejects("1. e4 e5 2. Nf3 *"), "fromPgn accepts a legal line");
ok(
  !rejects('[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 *'),
  "fromPgn accepts a standard-start FEN header",
);
ok(
  rejects('[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n\n1. a8=Q *'),
  "fromPgn rejects a custom FEN setup",
);

const tr = GameTree.fromPgn("1. e4 ( 1. Nf3 e5 2. e4 ) 1... e5 2. Nf3 *").transpositions();
ok(tr.length === 1 && tr[0].paths.length === 2, "transposition found with 2 converging paths");

const covDangling = GameTree.fromPgn("1. d4 d5 2. c4 e6 *").coverage("white");
ok(
  covDangling.danglingCount === 1 && covDangling.frontierCount === 0,
  "QGD white: 1 dangling line",
);
const covFrontier = GameTree.fromPgn("1. d4 d5 2. c4 *").coverage("white");
ok(
  covFrontier.danglingCount === 0 && covFrontier.frontierCount === 1,
  "opponent-to-move leaf is a frontier",
);

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
ok(
  moveAccuracy(0) === 1 && Math.abs(moveAccuracy(300) - Math.exp(-1)) < 1e-9,
  "moveAccuracy curve",
);

const matePgn = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# *";
const termAnalyse = async (fen) => {
  const sans = legalMoves(fen);
  if (!sans.length) return [];
  const uci = validateLine(fen, [sans[0]]).firstUci;
  return [{ uci, cp: 0, mate: null, depth: 12, pv: [uci] }];
};
const recMate = await analyzeMainline(matePgn, 12, termAnalyse);
ok(
  recMate !== null && recMate.length === 7,
  `analyzeMainline reviews a mate-ending game (${recMate ? recMate.length : "null"} plies)`,
);
ok(
  recMate && recMate.at(-1).san === "Qxf7#" && recMate.at(-1).classification === "good",
  "terminal eval: mating move classified, review not aborted",
);
ok(
  (await analyzeMainline(matePgn, 12, async () => null)) === null,
  "analyzeMainline still returns null when the engine is truly unavailable",
);

const base = GameTree.fromPgn("1. e4 *");
const added = base.edit("add", ["e4"], { addMoves: ["e5", "Nf3"] });
ok(added.tree && added.tree.toPgn().includes("1. e4 e5 2. Nf3"), "edit add grafts the line");
ok(base.stats().nodes === 1, "source tree unchanged after edit (clone-on-write)");
ok(added.tree.stats().nodes === 3, "edited tree has 3 nodes");
const pr = GameTree.fromPgn("1. e4 e5 ( 1... c5 ) *").edit("prune", ["e4", "c5"]);
ok(pr.tree && pr.tree.nodeAt([0]).children.length === 1, "prune removes the c5 variation");
ok(
  GameTree.fromPgn("1. e4 *").edit("prune", []).error === "invalid_edit",
  "prune root → invalid_edit",
);
ok(
  GameTree.fromPgn("1. e4 *").edit("add", ["e4"], { addMoves: ["Qh8"] }).error === "invalid_line",
  "illegal add → invalid_line",
);
ok(
  GameTree.fromPgn("1. e4 *").edit("prune", ["d4"]).error === "variation_not_found",
  "bad path → variation_not_found",
);
const tolerantAdd = GameTree.fromPgn("1. e4 c6 2. c3 d5 3. e5 *").edit(
  "add",
  ["e4", "c6", "c3", "d5", "exd5"],
  { addMoves: ["cxd5", "d4"] },
);
ok(
  !tolerantAdd.error && tolerantAdd.tree?.toPgn().includes("3. exd5 cxd5 4. d4"),
  "add tolerates path ending in new moves",
);
ok(
  tolerantAdd.added &&
    tolerantAdd.added.from.join(" ") === "e4 c6 c3 d5" &&
    tolerantAdd.added.moves.join(" ") === "exd5 cxd5 d4",
  `add reports anchor + grafted moves (${tolerantAdd.added?.from.join(" ")} + ${tolerantAdd.added?.moves.join(" ")})`,
);

const spTree = GameTree.fromPgn("1. e4 e5 ( 1... c5 2. Nf3 ) 2. Nf3 *");
ok(spTree.sanPathAt([]).length === 0, "sanPathAt([]) → []");
ok(spTree.sanPathAt([0, 0]).join(" ") === "e4 e5", "sanPathAt mainline → e4 e5");
ok(spTree.sanPathAt([0, 1]).join(" ") === "e4 c5", "sanPathAt variation → e4 c5");
let spThrew = false;
try {
  spTree.sanPathAt([9]);
} catch {
  spThrew = true;
}
ok(spThrew, "sanPathAt throws on invalid index");
ok(spTree.indexPathOfSan(["e4", "c5"]).join(",") === "0,1", "indexPathOfSan variation → 0,1");
ok(spTree.indexPathOfSan(["e4", "e5"]).join(",") === "0,0", "indexPathOfSan mainline → 0,0");
ok(spTree.indexPathOfSan(["e4", "d4"]) === null, "indexPathOfSan unknown line → null");

const extTree = GameTree.fromPgn("1. c4 e6 2. Nc3 c5 *\n\n1. c4 c5 *");
const pickNc3 = async (fen) => (fen.split(" ")[1] === "w" ? ["b1c3"] : []);
const ext = await extTree.extendedBridges("white", { maxDepth: 3, nodeBudget: 60 }, pickNc3);
const twoPly = ext.find((b) => b.moves.join(" ") === "Nc3 e6");
ok(
  twoPly && twoPly.fromPath.join(" ") === "c4 c5",
  "extendedBridges: 2-ply extension departs from 1.c4 c5",
);
ok(
  twoPly && twoPly.joinsPath.join(" ") === "c4 e6 Nc3 c5",
  "extendedBridges: joins the c4 e6 Nc3 c5 line",
);
ok(twoPly && twoPly.moves.length === 2, "extendedBridges: rejoin takes 2 plies");
const shallow = await extTree.extendedBridges("white", { maxDepth: 1, nodeBudget: 60 }, pickNc3);
ok(
  !shallow.some((b) => b.moves.join(" ") === "Nc3 e6"),
  "extendedBridges: maxDepth 1 misses the 2-ply rejoin",
);
const noExt = await GameTree.fromPgn("1. e4 e5 2. Nf3 *").extendedBridges(
  "white",
  { maxDepth: 4, nodeBudget: 40 },
  pickNc3,
);
ok(noExt.length === 0, "extendedBridges: linear line → none");

const stubAnalyse = async (fen) =>
  fen.split(" ")[1] === "w"
    ? [{ uci: "b1c3", cp: 0, mate: null, depth: 12, pv: ["b1c3"] }]
    : [{ uci: "e7e6", cp: 0, mate: null, depth: 12, pv: ["e7e6"] }];
const stubs = await resolveDanglingStubs(extTree, "white", {}, stubAnalyse);
ok(
  !stubs.error && stubs.resolved >= 1,
  "resolveDanglingStubs: at least one dangling stub resolves",
);
const connected = stubs.error ? null : stubs.dangling.find((d) => d.path.join(" ") === "c4 c5");
ok(
  connected && connected.connects_via?.join(" ") === "Nc3 e6",
  "resolveDanglingStubs: c4 c5 connects via Nc3 e6",
);
ok(
  connected && connected.joins_path?.join(" ") === "c4 e6 Nc3 c5",
  "resolveDanglingStubs: rejoins the c4 e6 Nc3 c5 line",
);

const dupTree = GameTree.fromPgn("1. d4 Nf6 2. c4 e6 3. Nc3 *\n\n1. d4 e6 2. c4 Nf6 3. Nc3 d5 *");
const pickD5 = async (fen) => (fen.split(" ")[1] === "b" ? ["d7d5"] : []);
const dupExt = await dupTree.extendedBridges("black", { maxDepth: 3, nodeBudget: 60 }, pickD5);
ok(dupExt.length === 0, "extendedBridges: a leaf that already transposes yields no extension");

const prTree = GameTree.fromPgn(
  "1. d4 Nf6 2. Nf3 e6 3. Bf4 *\n\n1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 *",
);
const afterD4Nf6 = (fen) => fen.includes("5n2/8/3P4");
const linesGood = [
  { uci: "c2c4", cp: 30, mate: null },
  { uci: "g1f3", cp: 20, mate: null },
];
const analyseGood = async (fen) => (afterD4Nf6(fen) ? linesGood : []);
const prune = await prTree.pruneTranspositions("white", {}, analyseGood);
const aCut = prune.suggestions.find((p) => p.rerouteMove === "c4");
ok(
  aCut && aCut.linePath.join(" ") === "d4 Nf6 Nf3 e6 Bf4",
  "pruneTranspositions: flags the shortenable London line",
);
ok(
  aCut && aCut.atPly === 2 && aCut.savedPlies === 3,
  "pruneTranspositions: re-route @ply2 prunes the 3-ply tail",
);
ok(
  aCut && aCut.joinsPath.join(" ") === "d4 Nf6 c4",
  "pruneTranspositions: joins the c4 (QID) line",
);
ok(
  aCut && aCut.evalStay === 20 && aCut.evalTranspose === 30 && aCut.evalDelta === -10,
  "pruneTranspositions: reports the eval trade",
);
const linesBlunder = [
  { uci: "c1f4", cp: 100, mate: null },
  { uci: "c2c4", cp: 20, mate: null },
];
const gated = await prTree.pruneTranspositions("white", {}, async (fen) =>
  afterD4Nf6(fen) ? linesBlunder : [],
);
ok(
  !gated.suggestions.some((p) => p.rerouteMove === "c4"),
  "pruneTranspositions: near-best gate drops a top-k blunder re-route",
);
const capped = await prTree.pruneTranspositions("white", { maxLossCp: 5 }, analyseGood);
ok(
  capped.suggestions.some((p) => p.rerouteMove === "c4"),
  "pruneTranspositions: keeps a re-route that gains eval",
);
ok(
  !capped.suggestions.some((p) => p.rerouteMove === "Nf3"),
  "pruneTranspositions: maxLossCp filters a re-route that loses >5cp",
);
const budgeted = await prTree.pruneTranspositions("white", { budget: 1 }, analyseGood);
ok(budgeted.positionsAnalysed <= 1, "pruneTranspositions: budget caps analyses spent");
const chunk = await prTree.pruneTranspositions(
  "white",
  { leafStart: 1, leafCount: 1 },
  analyseGood,
);
ok(
  chunk.totalLeaves === 2 && chunk.leafStart === 1 && chunk.nextLeaf === null,
  "pruneTranspositions: leaf cursor reports totals and exhausts",
);
ok(
  prune.partial === false && chunk.partial === true,
  "C6: full call is authoritative, cursor chunk is partial",
);
const noTrans = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
const nt = await noTrans.pruneTranspositions("white", {}, async () => [
  { uci: "g1f3", cp: 10, mate: null },
]);
ok(
  nt.totalPositionsEstimate === 0 && nt.positionsAnalysed === 0 && nt.suggestions.length === 0,
  "pruneTranspositions: P1 skips nodes with no cross-branch transposer",
);
ok(prune.positionsAnalysed === 2, "pruneTranspositions: P2 memo analyses a shared position once");
let progressCalls = 0;
await prTree.pruneTranspositions("white", {}, analyseGood, () => progressCalls++);
ok(progressCalls > 0, "pruneTranspositions: onProgress fires during the scan");
ok(
  JSON.stringify(pruneTailPath(aCut)) === JSON.stringify(["d4", "Nf6", "Nf3"]),
  "pruneTailPath: prunes the original line's tail at the re-route ply",
);
const c2only = async (fen) =>
  fen.includes("PPP1PPPP/RNBQKBNR")
    ? [{ uci: "c2c4", cp: 30, mate: null }]
    : fen.includes("RNBQKB1R b")
      ? [{ uci: "e7e6", cp: 15, mate: null }]
      : [];
const c2res = await prTree.pruneTranspositions("white", {}, c2only);
const c2cut = c2res.suggestions.find((p) => p.rerouteMove === "c4");
ok(
  c2cut && c2cut.evalStay === 15 && c2cut.evalDelta === -15,
  "pruneTranspositions: C2 resolves evalStay for an out-of-top-k stay move",
);
const twoStub = async (fen) =>
  fen.includes("5n2/8/3P4")
    ? [
        { uci: "c2c4", cp: 10, mate: null },
        { uci: "g1f3", cp: 20, mate: null },
      ]
    : fen.includes("4pn2/8/3P4")
      ? [
          { uci: "c2c4", cp: 40, mate: null },
          { uci: "c1f4", cp: 20, mate: null },
        ]
      : [];
const two = await prTree.pruneTranspositions("white", {}, twoStub);
const l1 = two.suggestions.filter((s) => s.linePath.join(" ") === "d4 Nf6 Nf3 e6 Bf4");
const sav = l1.find((s) => s.bestSavings);
const ev = l1.find((s) => s.bestEval);
ok(l1.length === 2, "C1: all re-routes for a line are returned, not just the earliest");
ok(
  sav && sav.atPly === 2 && sav.savedPlies === 3 && sav.bestEval === false,
  "C1: bestSavings = earliest / biggest tail cut",
);
ok(
  ev && ev.atPly === 4 && ev.evalTranspose === 40 && ev.bestSavings === false,
  "C1: bestEval = best resulting eval, a distinct pick",
);
const e1Stub = async (fen, _mpv, depth) =>
  depth != null
    ? [{ uci: "a7a6", cp: 99, mate: null }]
    : fen.includes("5n2/8/3P4")
      ? [
          { uci: "c2c4", cp: 10, mate: null },
          { uci: "g1f3", cp: 20, mate: null },
        ]
      : fen.includes("4pn2/8/3P4")
        ? [
            { uci: "c2c4", cp: 40, mate: null },
            { uci: "c1f4", cp: 20, mate: null },
          ]
        : [];
const e1 = await prTree.pruneTranspositions("white", { confirmDepth: 20 }, e1Stub);
const e1ev = e1.suggestions.find((s) => s.linePath.join(" ") === "d4 Nf6 Nf3 e6 Bf4" && s.bestEval);
ok(
  e1ev && e1ev.evalConfirmed === true && e1ev.evalTranspose === 99,
  "E1: best-eval re-route is deep-confirmed",
);
ok(
  e1.suggestions.some((s) => s.bestSavings && !s.evalConfirmed),
  "E1: only the best-eval pick is deep-confirmed",
);
ok(
  prTree.subtreeLeafBoards(["d4", "Nf6"]).length === 2,
  "C3: subtreeLeafBoards collects the branch's leaves",
);
ok(
  prTree.subtreeLeafBoards(["d4", "Nf6", "Nf3", "e6", "Bf4"]).length === 1,
  "C3: a leaf node yields one board",
);
ok(
  prTree.subtreeLeafBoards(["d4", "Qh5"]) === null,
  "C3: subtreeLeafBoards returns null for an absent path",
);
ok(
  prTree.mainlineLeafBoard(["d4", "Nf6"]) !== null,
  "C3: mainlineLeafBoard follows first-children to a leaf",
);
ok(
  typeof prTree.fenAtSanPath(["d4", "Nf6"]) === "string" &&
    prTree.fenAtSanPath(["d4", "Qh5"]) === null,
  "C3: fenAtSanPath resolves a path / null when absent",
);
const flat = async () => [{ uci: "a2a3", cp: 0, mate: null }];
const cmp = await compareShortcutLines(
  prTree,
  "white",
  { linePath: ["d4", "Nf6", "Nf3", "e6", "Bf4"], atPly: 2, joinsPath: ["d4", "Nf6", "c4"] },
  flat,
);
ok(
  !("error" in cmp) && cmp.basis === "fit" && cmp.evalDelta === 0,
  "C3: compareShortcutLines falls back to fit when eval is a wash",
);
ok(
  typeof cmp.fitStay === "number" && (cmp.recommend === "stay" || cmp.recommend === "transpose"),
  "C3: returns fit scores + a recommendation",
);
ok(
  !("error" in cmp) && cmp.fitStay > 0 && cmp.fitTranspose > 0,
  "C3: blended fit scores short/unclassified branches > 0 (no unknown→0 collapse)",
);
const cmpBad = await compareShortcutLines(
  prTree,
  "white",
  { linePath: ["d4", "Nf6"], atPly: 1, joinsPath: ["d4", "Qh5"] },
  flat,
);
ok("error" in cmpBad && cmpBad.error === "path_not_found", "C3: bad joins_path → path_not_found");
const empty = async () => [];
const cov = await checkShortcutCoverage(
  prTree,
  "white",
  { linePath: ["d4", "Nf6", "Nf3", "e6", "Bf4"], atPly: 2 },
  empty,
);
ok(
  !("error" in cov) && cov.introduces_gap === false && cov.prunes.join(" ") === "d4 Nf6 Nf3",
  "C4: checkShortcutCoverage prunes the tail and reports coverage-safe",
);
const covErr = await checkShortcutCoverage(
  prTree,
  "white",
  { linePath: ["d4", "Nf6", "Nf3", "e6", "Bf4"], atPly: 2 },
  async () => null,
);
ok("error" in covErr && covErr.error === "engine_unavailable", "C4: propagates engine_unavailable");

const gapTree = GameTree.fromPgn(
  "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 *\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 *",
);
const atGapNode = (fen) => fen.includes("4pn2/8/2PP4/2N5/") && fen.split(" ")[1] === "b";
const gapStub = async (fen) =>
  atGapNode(fen) ? [{ uci: "d7d5", cp: -40, mate: null, depth: 10, pv: ["d7d5"] }] : [];
const gr = await findRepertoireGaps(gapTree, "white", { minSeverity: "low" }, gapStub);
ok(
  !gr.error && gr.covered_by_transposition.length === 1,
  "findRepertoireGaps: a transposing uncovered reply is covered, not a gap",
);
ok(
  gr.covered_by_transposition?.[0]?.uncovered_move === "d5",
  "covered_by_transposition records the transposing reply ...d5",
);
ok(
  gr.covered_by_transposition?.[0]?.joins_path.join(" ") === "d4 d5 c4 e6 Nc3 Nf6",
  "covered_by_transposition names the prep line joined",
);
ok(
  !gr.error && !gr.gaps.some((g) => g.uncovered_move === "d5"),
  "findRepertoireGaps: the transposing reply is excluded from gaps",
);

const fillTree = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
const fillStub = async (fen) =>
  fen.includes("2p5/4P3") && fen.split(" ")[1] === "w"
    ? [
        { uci: "g1f3", cp: 40, mate: null, depth: 10, pv: [] },
        { uci: "d2d4", cp: 20, mate: null, depth: 10, pv: [] },
      ]
    : [];
const fills = await suggestGapFills(
  fillTree,
  "white",
  [0],
  "c5",
  { depth: 10, target_plies: 4 },
  fillStub,
);
ok(
  !("error" in fills) && fills.options.length === 2,
  "suggestGapFills returns best-eval and best-fit choices",
);
ok(
  !("error" in fills) &&
    fills.options[0].kind === "best_eval" &&
    fills.options[0].line.join(" ") === "c5 Nf3",
  "suggestGapFills keeps the uncovered move and strongest reply in the staged line",
);

const cmStub = async (fen) =>
  fen.includes("4P3")
    ? [{ uci: "e7e5", cp: 20, mate: null, depth: 10, pv: [] }]
    : [{ uci: "a7a6", cp: -5, mate: null, depth: 10, pv: [] }]; // after 1.a3
const cmRanked = await compareMoves(START_FEN, ["a3", "e4"], 10, cmStub);
ok(
  cmRanked.candidates[0].san === "e4" && cmRanked.candidates[0].rank === 1,
  "compareMoves ranks the stronger move first",
);
ok(
  cmRanked.candidates[0].mover_cp === 20 && cmRanked.candidates[1].mover_cp === -5,
  "compareMoves reports mover-POV cp",
);
ok(
  (await compareMoves(START_FEN, ["Qz9"], 10, cmStub)).candidates[0].error === "illegal_move",
  "compareMoves flags an illegal candidate",
);
const cmMixed = await compareMoves(START_FEN, ["e4", "Qz9"], 10, cmStub);
ok(
  cmMixed.candidates.find((c) => c.error)?.rank === undefined,
  "compareMoves: error rows are unranked",
);
ok(
  cmMixed.candidates.find((c) => !c.error)?.rank === 1,
  "compareMoves: scored rows still ranked from 1",
);
ok(
  (await compareMoves(START_FEN, ["e4"], 10, async () => null)).candidates[0].error ===
    "engine_unavailable",
  "compareMoves: null engine → engine_unavailable",
);
const cmMateFen = "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1";
const cmMateStub = async (fen) =>
  legalMoves(fen).length ? [{ uci: "a1a2", cp: 0, mate: null, depth: 10, pv: [] }] : [];
const cmMate = await compareMoves(cmMateFen, ["Ra8"], 10, cmMateStub);
ok(
  !cmMate.candidates[0].error && cmMate.candidates[0].mover_cp === 100000,
  "compareMoves: a mating move is decisive, not engine_unavailable",
);

const yNodes = turnNodes(wRep, "white");
ok(yNodes.length === 2, "turnNodes(white): root + after d4 d5");
ok(
  yNodes[0].path.length === 0 && JSON.stringify(yNodes[0].covered) === '["d4"]',
  "turnNodes: root prescribes d4",
);
ok(
  yNodes[1].sanPath.join(" ") === "d4 d5" && JSON.stringify(yNodes[1].covered) === '["c4"]',
  "turnNodes: sanPath threads the SAN route",
);

const auditRep = GameTree.fromPgn("1. d4 d5 2. c4 *");
let auditCalls = 0;
const auditStub = async (fen) => {
  auditCalls++;
  return fen === START_FEN
    ? [
        { uci: "e2e4", cp: 40, mate: null, depth: 10, pv: [] },
        { uci: "d2d4", cp: 10, mate: null, depth: 10, pv: [] },
      ]
    : [
        { uci: "c2c4", cp: 30, mate: null, depth: 10, pv: [] },
        { uci: "e2e4", cp: 5, mate: null, depth: 10, pv: [] },
      ];
};
const audit = await auditRepertoireMoves(auditRep, "white", { minCpLoss: 0 }, auditStub);
ok(
  !audit.error && audit.positions_scanned === 2 && audit.moves_audited === 2,
  "audit: 2 your-turn nodes, 2 moves audited",
);
ok(auditCalls === 2, "audit: prescribed-in-lines needs no child search");
ok(
  audit.findings[0].prescribed === "d4" &&
    audit.findings[0].cp_loss === 30 &&
    audit.findings[0].path.length === 0,
  "audit: worst-first, root d4 loses 30 to e4",
);
ok(
  audit.findings[0].best_move === "e4" && audit.findings[0].best_margin === 30,
  "audit: best_move + best_margin from the multipv-2 pair",
);
ok(
  audit.findings[1].prescribed === "c4" &&
    audit.findings[1].cp_loss === 0 &&
    audit.findings[1].path.join(" ") === "d4 d5",
  "audit: best-move prescription scores cp_loss 0, SAN path to the node",
);
const auditMin = await auditRepertoireMoves(auditRep, "white", {}, auditStub);
ok(
  !auditMin.error && auditMin.findings.length === 0 && auditMin.moves_audited === 2,
  "audit: default minCpLoss 50 filters small losses",
);

const fallbackStub = async (fen) =>
  fen === START_FEN
    ? [
        { uci: "e2e4", cp: 200, mate: null, depth: 10, pv: [] },
        { uci: "g1f3", cp: 150, mate: null, depth: 10, pv: [] },
      ]
    : [{ uci: "d7d5", cp: 40, mate: null, depth: 10, pv: [] }];
const fb = await auditRepertoireMoves(
  GameTree.fromPgn("1. d4 *"),
  "white",
  { minCpLoss: 0 },
  fallbackStub,
);
ok(
  !fb.error &&
    fb.findings[0].prescribed_eval === 40 &&
    fb.findings[0].cp_loss === 160 &&
    fb.findings[0].classification === "mistake",
  "audit fallback: child eval negated to mover POV, classified",
);

const mateRep = GameTree.fromPgn("1. f3 e5 2. g4 Qh4# *");
const auditMateStub = async (fen) =>
  legalMoves(fen).length
    ? fen.split(" ")[1] === "b"
      ? [
          { uci: "a7a6", cp: 0, mate: null, depth: 10, pv: [] },
          { uci: "h7h6", cp: -10, mate: null, depth: 10, pv: [] },
        ]
      : [{ uci: "g2g4", cp: -20, mate: null, depth: 10, pv: [] }]
    : [];
const auditMate = await auditRepertoireMoves(mateRep, "black", { minCpLoss: 0 }, auditMateStub);
ok(!auditMate.error && auditMate.moves_audited === 2, "audit mate: both black moves audited");
ok(
  auditMate.findings.every((f) => f.prescribed !== "Qh4#" || f.cp_loss === 0),
  "audit mate: the mating move is decisive, cp_loss 0",
);
ok(
  (await auditRepertoireMoves(auditRep, "white", {}, async () => null)).error ===
    "engine_unavailable",
  "audit: null engine → engine_unavailable",
);

const omRep = GameTree.fromPgn("1. d4 d5 2. c4 e6 (2... c6) *");
const omStub = async (fen) =>
  fen === START_FEN
    ? [
        { uci: "d2d4", cp: 20, mate: null, depth: 10, pv: [] },
        { uci: "e2e4", cp: 15, mate: null, depth: 10, pv: [] },
      ]
    : [
        { uci: "c2c4", cp: 150, mate: null, depth: 10, pv: [] },
        { uci: "g1f3", cp: 10, mate: null, depth: 10, pv: [] },
      ];
const om = await findOnlyMoves(omRep, "white", {}, omStub);
ok(
  !om.error && om.positions_scanned === 2 && om.only_moves_found === 1,
  "onlyMoves: 1 of 2 nodes clears the default 100cp margin",
);
ok(
  om.findings[0].path.join(" ") === "d4 d5" && om.findings[0].margin === 140,
  "onlyMoves: tagged node carries path + margin",
);
ok(
  om.findings[0].prescribed.join() === "c4" && om.findings[0].prescribed_is_best,
  "onlyMoves: prescribed c4 is the engine best",
);
ok(
  om.lines.length === 2 &&
    om.lines.every((l) => l.critical === 1 && l.your_moves === 2 && l.density === 0.5),
  "onlyMoves: both leaf lines score density 0.5",
);
const omWrongStub = async (fen) =>
  fen === START_FEN
    ? [{ uci: "d2d4", cp: 20, mate: null, depth: 10, pv: [] }]
    : [
        { uci: "g1f3", cp: 150, mate: null, depth: 10, pv: [] },
        { uci: "c2c4", cp: 10, mate: null, depth: 10, pv: [] },
      ];
const omWrong = await findOnlyMoves(omRep, "white", {}, omWrongStub);
ok(
  !omWrong.error && omWrong.only_moves_found === 1 && omWrong.positions_scanned === 2,
  "onlyMoves: single-line root skipped, no error",
);
ok(
  omWrong.findings[0].best_move === "Nf3" && !omWrong.findings[0].prescribed_is_best,
  "onlyMoves: prescribed_is_best=false when the tree move trails",
);
ok(
  (await findOnlyMoves(omRep, "white", {}, async () => null)).error === "engine_unavailable",
  "onlyMoves: null engine → engine_unavailable",
);
ok(
  (await findOnlyMoves(omRep, "white", { minMargin: 150 }, omStub)).only_moves_found === 0,
  "onlyMoves: minMargin filters",
);

const deck = onlyMoveDeckCsv("white", om.findings);
const deckLines = deck.trimEnd().split("\n");
ok(deckLines[0] === "front,back,fen,margin" && deckLines.length === 2, "deck: header + 1 row");
ok(
  deckLines[1].startsWith("1.d4 d5 (White to move),c4 (only move: next best -140cp),"),
  "deck: numbered front + margin-note back",
);
const deckEdge = onlyMoveDeckCsv("black", [
  {
    path: [],
    fen: "8/8/8/8/8/8/8/8 b - - 0 1",
    prescribed: ['a"b'],
    best_move: "x",
    prescribed_is_best: false,
    margin: 100000,
    best_eval: 100000,
  },
]);
ok(
  deckEdge.includes("(start position) (Black to move)") && deckEdge.includes("decisively worse"),
  "deck: start-position front + sentinel-margin wording",
);
ok(
  deckEdge.includes('"a""b (only move: alternatives are decisively worse)"'),
  "deck: quote-bearing field escaped per RFC-4180",
);

const il = GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $4 *").illustrativeLines();
ok(il.lines.length === 1 && il.illustrativeLeaves === 1, "illustrative NAG line flagged");
ok(il.lines[0].path.at(-1) === "Qh4", "flagged path ends at the bad move");
const ilNested = GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $4 3. Nf3 Qxe4+ $2 *").illustrativeLines();
ok(
  ilNested.lines.length === 1 && ilNested.illustrativeLeaves === 1,
  "nested NAG counted once (outer subsumes)",
);

const ecoTable = parseOpeningsTsv(readFileSync("./apps/mcp-server/data/openings.tsv", "utf8"));
ok(ecoTable.size > 3000, `ECO table loaded (${ecoTable.size} entries)`);
const sicilian = identifyDeepest(ecoTable, "1. e4 c5 *");
ok(
  sicilian && sicilian.name.includes("Sicilian"),
  `1.e4 c5 → ${sicilian?.name} (${sicilian?.eco})`,
);
const qg = identifyDeepest(ecoTable, "1. d4 d5 2. c4 *");
ok(qg && qg.name.includes("Queen's Gambit"), `1.d4 d5 2.c4 → ${qg?.name} (${qg?.eco})`);

const aggRecs = [
  {
    result: "loss",
    group_key: "eco_e4",
    group_name: "Open Game",
    avg_cpl: 50,
    blunders: [
      { move: "e5", classification: "blunder" },
      { move: "d4", classification: "mistake" },
      { move: "e5", classification: "blunder" },
    ],
  },
  {
    result: "loss",
    group_key: "eco_e4",
    group_name: "Open Game",
    avg_cpl: 70,
    blunders: [
      { move: "e5", classification: "blunder" },
      { move: "g5", classification: "inaccuracy" },
    ],
  },
];
const agg = aggregateGames(aggRecs, true);
ok(
  agg.total_games === 2 &&
    agg.groups[0].top_blunders[0].move === "e5" &&
    agg.groups[0].top_blunders[0].frequency === 3,
  "aggregateGames top blunder e5 x3",
);
ok(agg.groups[0].loss_rate === 1, "aggregateGames loss_rate 1.0");

const mapH = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *").moveMap();
const followed = walkGameVsRepertoire(mapH, "white", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
ok(
  followed.in_book_plies === 4 &&
    followed.player_deviations.length === 0 &&
    followed.uncovered_opponents.length === 0,
  "followed prep: 4 in-book plies",
);
const oppDev = walkGameVsRepertoire(mapH, "white", "1. e4 e5 2. Nf3 d6 *");
ok(
  oppDev.in_book_plies === 3 && oppDev.uncovered_opponents[0]?.played === "d6",
  "opponent left book at d6",
);
const playerDev = walkGameVsRepertoire(mapH, "white", "1. e4 e5 2. d4 *");
ok(
  playerDev.in_book_plies === 2 && playerDev.player_deviations[0]?.played === "d4",
  "player left prep at d4",
);

const fianchetto = GameTree.fromPgn("1. g3 g6 2. Bg2 Bg7 *").positionAtSanPath([
  "g3",
  "g6",
  "Bg2",
  "Bg7",
]);
const th = themes(fianchetto.board, "white");
ok(th.fianchetto_white && th.fianchetto_black, "fianchetto themes detected (both sides)");
ok(
  centerState(GameTree.fromPgn("1. e4 e5 *").positionAtSanPath(["e4", "e5"]).board) === "locked",
  "1.e4 e5 → locked center",
);
ok(
  centerState(GameTree.fromPgn("1. e4 c5 *").positionAtSanPath(["e4", "c5"]).board) === "semi-open",
  "1.e4 c5 → semi-open (home d-pawns still central)",
);
const dbl = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 *").positionAtSanPath([
  "e4",
  "e5",
  "Nf3",
  "Nc6",
  "Bb5",
  "a6",
  "Bxc6",
  "dxc6",
]);
const prof = positionProfile(dbl.board, "black", "");
ok(
  prof.primitives.doubled.includes("c6") && prof.primitives.doubled.includes("c7"),
  "doubled c-pawns for black after Bxc6 dxc6",
);

ok(isPromotion("8/P7/8/8/8/8/8/k6K w - - 0 1", "a7", "a8") === true, "isPromotion true for a7→a8");
ok(isPromotion(START_FEN, "e2", "e4") === false, "isPromotion false for e2→e4");

const ro = GameTree.fromPgn("1. e4 e5 ( 1... c5 ) *").edit("reorder", ["e4"], {
  promoteMove: "c5",
});
ok(
  ro.tree &&
    ro.tree.nodeAt([0]).children[0].data.san === "c5" &&
    ro.tree.toPgn().includes("1. e4 c5"),
  "reorder promotes c5 to mainline",
);
ok(
  GameTree.fromPgn("1. e4 e5 ( 1... c5 ) *").edit("reorder", ["e4"], { promoteMove: "d4" })
    .error === "variation_not_found",
  "reorder unknown move → variation_not_found",
);
ok(
  GameTree.fromPgn("1. e4 e5 ( 1... c5 ) *").edit("reorder", ["e4"], {}).error === "invalid_edit",
  "reorder without promote_move → invalid_edit",
);
ok(
  GameTree.fromPgn("1. e4 *").edit("add", ["e4"], { addMoves: [] }).error === "invalid_edit",
  "add with empty moves → invalid_edit",
);

ok(
  GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $2 *").illustrativeLines().lines.length === 1,
  "$2 (dubious) flags an illustrative line",
);
ok(
  GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $6 *").illustrativeLines().lines.length === 1,
  "$6 flags an illustrative line",
);
ok(
  GameTree.fromPgn("1. e4 e5 2. Bc4 Qh4 $1 *").illustrativeLines().lines.length === 0,
  "$1 (good move) is NOT illustrative",
);

ok(spTree.positionAtSanPath(["e4", "d4"]) === null, "positionAtSanPath null on an off-tree path");
ok(spTree.positionAtSanPath(["e4", "e5"]) !== null, "positionAtSanPath resolves a real line");

let mlt = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
mlt = mlt.edit("add", ["e4", "e5"], { addMoves: ["Bc4", "Bc5"] }).tree;
mlt = mlt.edit("add", ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"], { addMoves: ["Ba4", "Nf6"] }).tree;
ok(medianLineLength(mlt) === 6, "medianLineLength → median of genuine leaves {4,8} = 6");
const mltT = mlt.edit("add", ["e4"], { addMoves: ["Nc6", "Nf3", "e5", "Bb5"] }).tree;
ok(
  medianLineLength(mltT) === 6,
  "medianLineLength excludes the depth-5 transposition leaf (plain median would be 5)",
);
ok(medianLineLength(new GameTree()) === 0, "medianLineLength → 0 for an empty tree");

const fitRep = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *");
const fitBoards = fitRep.leafPositions().map((p) => p.board);
const fitProfile = buildFitProfile(fitBoards, "white");
ok(fitProfile.freq.size > 0, "buildFitProfile → non-empty signal profile");
const selfFit = fitScore(fitProfile, fitBoards[0], "white");
ok(
  selfFit > 0 && selfFit <= 1,
  "fitScore: a repertoire leaf scores in (0,1] against its own profile",
);

const fianBoards = GameTree.fromPgn("1. g3 g6 2. Bg2 Bg7 3. Nf3 Nf6 *")
  .leafPositions()
  .map((p) => p.board);
ok(
  positionProfile(fianBoards[0], "white", "").structure_class === "unknown",
  "fianchetto leaf classifies unknown",
);
ok(
  fitScore(buildFitProfile(fianBoards, "white"), fianBoards[0], "white") > 0,
  "fitScore: unknown-but-thematic position scores > 0 (themes/center carry it)",
);

const rawExplorer = {
  white: 550,
  draws: 250,
  black: 200,
  opening: { eco: "B20", name: "Sicilian Defense" },
  moves: [
    { uci: "g1f3", san: "Nf3", averageRating: 1980, white: 500, draws: 200, black: 200 },
    { uci: "c2c4", san: "c4", white: 50, draws: 30, black: 20 },
  ],
};
const realFetch = globalThis.fetch;
let fetchCalls = [];
let fetchAuth = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push(String(url));
  fetchAuth.push(init?.headers?.Authorization ?? null);
  return { ok: true, status: 200, json: async () => rawExplorer };
};
setExplorerToken("lip_smoketoken");
ok(hasExplorerToken() === true, "explorer: token registered");
const exFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const ex1 = await explorerPosition(exFen);
ok(
  ex1 && ex1.total_games === 1000 && ex1.white_pct === 55 && ex1.opening.eco === "B20",
  "explorer: totals + white-POV shares parsed",
);
ok(
  ex1.moves[0].san === "Nf3" && ex1.moves[0].played_pct === 90 && ex1.moves[0].games === 900,
  "explorer: per-move frequency (900/1000 = 90%)",
);
ok(
  ex1.moves[1].played_pct === 10 && ex1.moves[1].average_rating === null,
  "explorer: missing averageRating → null",
);
ok(
  fetchCalls[0].includes("speeds=blitz,rapid,classical") &&
    fetchCalls[0].includes("ratings=1800,2000,2200,2500"),
  "explorer: lichess db defaults (1800+ blitz/rapid/classical)",
);
ok(
  fetchCalls[0].startsWith("https://explorer.lichess.org/") &&
    fetchAuth[0] === "Bearer lip_smoketoken",
  "explorer: new host + Bearer token header",
);
const ex2 = await explorerPosition(exFen);
ok(ex2 === ex1 && fetchCalls.length === 1, "explorer: same key served from cache, no second fetch");
await explorerPosition(exFen, { db: "masters" });
ok(
  fetchCalls.length === 2 && fetchCalls[1].includes("/masters?"),
  "explorer: masters db is a separate key + endpoint",
);
globalThis.fetch = realFetch;
setExplorerToken(null);
ok(hasExplorerToken() === false, "explorer: token cleared");

const popTree = GameTree.fromPgn("1. e4 e5 2. Nf3 *");
const popEngine = async (fen) =>
  fen.split(" ")[1] === "b"
    ? [
        { uci: "e7e5", cp: -80, mate: null, depth: 10, pv: [] }, // covered, mover(black) 80
        { uci: "c7c5", cp: -75, mate: null, depth: 10, pv: [] }, // gap, loss 5 → high
        { uci: "e7e6", cp: -70, mate: null, depth: 10, pv: [] }, // gap, loss 10 → high
      ]
    : [];
const popLookup = async () => ({
  total_games: 1000,
  white_pct: 50,
  draw_pct: 30,
  black_pct: 20,
  opening: null,
  moves: [
    {
      san: "e6",
      uci: "e7e6",
      games: 550,
      played_pct: 55,
      white_pct: 50,
      draw_pct: 30,
      black_pct: 20,
      average_rating: null,
    },
    {
      san: "c5",
      uci: "c7c5",
      games: 100,
      played_pct: 10,
      white_pct: 50,
      draw_pct: 30,
      black_pct: 20,
      average_rating: null,
    },
  ],
});
const popGaps = await findRepertoireGaps(
  popTree,
  "white",
  { minSeverity: "low", popularity: popLookup },
  popEngine,
);
ok(
  !popGaps.error && popGaps.gaps.length === 2 && popGaps.gaps.every((g) => g.severity === "high"),
  "popularity: both gaps high severity",
);
ok(
  popGaps.gaps[0].uncovered_move === "e6" &&
    popGaps.gaps[0].played_pct === 55 &&
    popGaps.gaps[0].played_games === 550,
  "popularity: more-played gap ranked first within the tier",
);
ok(
  popGaps.gaps[1].uncovered_move === "c5" && popGaps.gaps[1].played_pct === 10,
  "popularity: rarer gap second, annotated",
);
const popOffline = await findRepertoireGaps(
  popTree,
  "white",
  { minSeverity: "low", popularity: async () => null },
  popEngine,
);
ok(
  !popOffline.error && popOffline.gaps.length === 2 && popOffline.gaps[0].played_pct === null,
  "popularity: explorer miss → null annotation, scan intact",
);
const popNoFlag = await findRepertoireGaps(popTree, "white", { minSeverity: "low" }, popEngine);
ok(!popNoFlag.error && !("played_pct" in popNoFlag.gaps[0]), "popularity: absent unless requested");

const tdTree = GameTree.fromPgn("1. e4 e5 ( 1... c5 2. Nf3 d6 ) 2. Nf3 Nc6 *");
let tdCalls = 0;
const tdLookup = async (fen) => {
  tdCalls++;
  const games = fen.includes("2p5") && fen.includes("5N2") ? 50 : 1000;
  return {
    total_games: games,
    white_pct: 50,
    draw_pct: 30,
    black_pct: 20,
    opening: null,
    moves: [],
  };
};
const td = await theoryDepth(tdTree, {}, tdLookup);
ok(
  !td.error && td.lines.length === 2 && td.truncated === false,
  "theoryDepth: one verdict per leaf line",
);
const tdSic = td.lines.find((l) => l.san_path.includes("c5"));
ok(
  tdSic.theory_exit_ply === 3 && tdSic.games_at_exit === 50 && tdSic.games_at_last_theory === 1000,
  "theoryDepth: c5 branch exits theory at ply 3 (2.Nf3, 50 games)",
);
ok(
  tdSic.san_path.join(" ") === "e4 c5 Nf3 d6",
  "theoryDepth: full line reported even below the exit",
);
const tdMain = td.lines.find((l) => !l.san_path.includes("c5"));
ok(
  tdMain.theory_exit_ply === null &&
    tdMain.games_at_exit === null &&
    tdMain.games_at_last_theory === 1000,
  "theoryDepth: in-theory-throughout line has no exit",
);
ok(
  tdCalls === 7 && td.positions_queried === 7,
  "theoryDepth: 8 nodes, 7 queried — no lookup below the exit",
);
let tdxCalls = 0;
const tdxLookup = async () => (
  tdxCalls++,
  { total_games: 1000, white_pct: 50, draw_pct: 30, black_pct: 20, opening: null, moves: [] }
);
const tdx = await theoryDepth(
  GameTree.fromPgn("1. d4 d5 2. Nf3 *\n\n1. Nf3 d5 2. d4 *"),
  {},
  tdxLookup,
);
ok(
  !tdx.error && tdxCalls === 6 && tdx.lines.length === 2,
  "theoryDepth: transposed position queried once",
);
const tdCap = await theoryDepth(tdTree, { maxPositions: 2 }, tdLookup);
ok(
  !tdCap.error && tdCap.truncated === true && tdCap.lines_skipped > 0,
  "theoryDepth: query budget → truncated + lines_skipped",
);
ok(
  (await theoryDepth(tdTree, {}, async () => null)).error === "explorer_unavailable",
  "theoryDepth: offline → explorer_unavailable",
);
let tdrFirst = true;
const tdrLookup = async (fen) => (tdrFirst ? ((tdrFirst = false), null) : tdLookup(fen));
ok(
  !(await theoryDepth(tdTree, {}, tdrLookup)).error,
  "theoryDepth: one transient failure retried, walk completes",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
