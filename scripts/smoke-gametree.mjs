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
  mainline,
  classifyCpLoss,
  moveAccuracy,
  parseOpeningsTsv,
  identifyDeepest,
  boardSvg,
  aggregateGames,
  walkGameVsRepertoire,
  positionProfile,
  themes,
  centerState,
  analyzeCongruence,
  isPromotion,
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

// 16c. transpositionBridges — move-order interlinking
// Two orders to the same English position; the c5-first branch stops a ply short of ...e6.
const brTree = GameTree.fromPgn("1. c4 e6 2. Nc3 c5 *\n\n1. c4 c5 2. Nc3 *");
const bridges = brTree.transpositionBridges("black");
const frontier = bridges.find((b) => b.kind === "frontier_link");
ok(frontier && frontier.move === "e6", `frontier_link bridges via ...e6 (${frontier?.move})`);
ok(frontier && frontier.fromPath.join(" ") === "c4 c5 Nc3", "frontier_link departs from 1.c4 c5 2.Nc3");
ok(frontier && frontier.joinsPath.join(" ") === "c4 e6 Nc3 c5", "frontier_link joins the c4 e6 Nc3 c5 line");
// A linear line has no bridges; the natural continuation is never reported.
ok(GameTree.fromPgn("1. e4 e5 2. Nf3 *").transpositionBridges("white").length === 0, "linear line → no bridges");

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

// 19. boardSvg render
const svg = boardSvg(START_FEN);
ok(svg.startsWith("<svg") && svg.includes("♜") && svg.includes("♙"), "boardSvg renders pieces");
ok((svg.match(/<rect/g) || []).length === 64, "boardSvg has 64 squares");

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
// 1-leaf repertoire → nothing to compare → no flags
ok(analyzeCongruence(GameTree.fromPgn("1. e4 e5 2. Nf3 *"), "white", ecoTable, {}).total_flagged === 0, "single line → no congruence flags");

// 24. isPromotion — pawn to last rank vs normal move
ok(isPromotion("8/P7/8/8/8/8/8/k6K w - - 0 1", "a7", "a8") === true, "isPromotion true for a7→a8");
ok(isPromotion(START_FEN, "e2", "e4") === false, "isPromotion false for e2→e4");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
