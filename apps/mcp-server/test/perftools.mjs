// Engine-free unit tests for the P5-P8 perf items and T5-T7 tools (mock engine where needed).
// Run: node --import tsx apps/mcp-server/test/perftools.mjs   (needs chess-tools dist built)
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import {
  GameTree,
  enumerateLegal,
  someLegal,
  walkGameVsRepertoire,
  searchStructures,
  annotateRepertoire,
  parseOpeningsTsv,
} from "../../../packages/chess-tools/dist/index.js";

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));

const posFromFen = (fen) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const legalUcis = (fen) => enumerateLegal(posFromFen(fen)).map(({ move }) => makeUci(move));

// --- P6: someLegal early-exit parity with enumerateLegal ---
for (const fen of [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "8/1P6/8/8/8/k7/8/K7 w - - 0 1", // promotion: queen-only enumeration
]) {
  const pos = posFromFen(fen);
  const all = enumerateLegal(pos);
  ok(someLegal(pos, () => true) === all.length > 0, `someLegal(any) parity @ ${fen}`);
  ok(someLegal(pos, () => false) === false, `someLegal(none) parity @ ${fen}`);
  const target = all.length ? makeUci(all[all.length - 1].move) : null;
  if (target) ok(someLegal(pos, (m) => makeUci(m.move) === target), "someLegal finds the last enumerated move");
}

// --- P8: structural clone preserves data; edits stay clone-on-write ---
{
  const pgn = '[White "A"]\n[Black "B"]\n\n1. e4 {main move} e5 $1 (1... c5 {sicilian}) 2. Nf3 *';
  const tree = GameTree.fromPgn(pgn);
  const before = tree.toPgn();
  const clone = tree.clone();
  ok(clone.toPgn() === before, "clone round-trips PGN (headers, comments, NAGs, variations)");
  clone.appendSan(clone.indexPathOfSan(["e4", "e5", "Nf3"]), "Nc6");
  ok(tree.toPgn() === before, "mutating the clone leaves the source untouched");
  const edited = tree.edit("prune", ["e4", "e5", "Nf3"]);
  ok(edited.tree !== null && tree.toPgn() === before, "edit still clone-on-write via structural copy");
  ok(!edited.tree.toPgn().includes("Nf3"), "prune applied on the edited copy");
  const reorder = tree.edit("reorder", ["e4"], { promoteMove: "c5" });
  ok(reorder.tree.toPgn().indexOf("c5") < reorder.tree.toPgn().indexOf("e5"), "reorder works on the copy");
}

// --- P5: prune-scan pre-pass cache — chunked calls match a full call; appendSan invalidates ---
{
  // Two lines transposing at ply 4: A's Nc3 lands in B's prep and B's Nf3 lands in A's.
  const tree = GameTree.fromPgn("1. d4 Nf6 (1... e6 2. c4 Nf6 3. Nc3) 2. c4 e6 3. Nf3 *");
  // Mock engine: every legal move, flat cp 50 — everything is near-best, so any transposer is found.
  const analyse = async (fen) => legalUcis(fen).map((uci) => ({ uci, cp: 50, mate: null }));

  const full = await tree.pruneTranspositions("white", {}, analyse);
  ok(full.totalLeaves === 2 && full.partial === false, "full scan covers both leaves");
  const reroutes = full.suggestions.map((s) => s.rerouteMove).sort();
  ok(reroutes.includes("Nc3") && reroutes.includes("Nf3"), `both cross-line re-routes found (got ${reroutes})`);

  const chunk1 = await tree.pruneTranspositions("white", { leafStart: 0, leafCount: 1 }, analyse);
  const chunk2 = await tree.pruneTranspositions("white", { leafStart: chunk1.nextLeaf, leafCount: 1 }, analyse);
  ok(chunk1.partial === true && chunk1.nextLeaf === 1 && chunk2.nextLeaf === null, "cursor bookkeeping across chunks");
  ok(
    chunk1.suggestions.length + chunk2.suggestions.length === full.suggestions.length,
    "chunked union equals the full scan (cached pre-pass, same results)",
  );
  ok(
    chunk1.totalPositionsEstimate === full.totalPositionsEstimate,
    "whole-tree estimate identical on a cursor chunk (P5 cache serves it)",
  );

  tree.appendSan([], "e4"); // new root branch → third leaf; the cached pre-pass must be dropped
  const after = await tree.pruneTranspositions("white", {}, analyse);
  ok(after.totalLeaves === 3, "appendSan invalidates the P5 pre-pass cache");
}

// --- T7: walk reports EVERY departure (continues past the first by transposition key) ---
{
  // White rep: 1. c4 e6 2. d4 d5 3. Nc3. Game: 1. d4 d5 2. c4 e6 3. Nf3 — deviation at move 1
  // (played d4, prescribed c4), then the game TRANSPOSES back into prep after 2... e6, where
  // 3. Nf3 deviates again (prescribed Nc3). The old first-departure walk saw only the first.
  const rep = GameTree.fromPgn("1. c4 e6 2. d4 d5 3. Nc3 *");
  const map = rep.moveMap();
  const w = walkGameVsRepertoire(map, "white", "1. d4 d5 2. c4 e6 3. Nf3 Nf6 *");
  ok(w.in_book_plies === 0, "in_book_plies still counts consecutive-from-start");
  ok(w.player_deviations.length === 2, `both deviations reported (got ${w.player_deviations.length})`);
  ok(
    w.player_deviations[0]?.played === "d4" && w.player_deviations[1]?.played === "Nf3",
    "departures carry the played move in game order",
  );
  ok(w.player_deviations[1]?.ply === 5, "post-transposition departure carries its ply");

  // Opponent novelty still reported on a clean game.
  const w2 = walkGameVsRepertoire(map, "white", "1. c4 c5 *");
  ok(w2.uncovered_opponents.length === 1 && w2.uncovered_opponents[0].played === "c5", "uncovered opponent move reported");
  ok(w2.in_book_plies === 1, "in-book plies before the novelty counted");
}

// --- T5: structural position search over leaves ---
{
  const tree = GameTree.fromPgn("1. e4 e6 2. d4 d5 3. e5 (3. exd5 exd5) *"); // French advance + exchange
  const leaves = tree.leaves().map((l) => ({ path: l.path, board: l.pos.board, fen: makeFen(l.pos.toSetup()) }));
  ok(leaves.length === 2, "fixture has two leaves");
  const french = searchStructures(leaves, "white", { structure: "french" });
  ok(french.length === 1 && french[0].path.includes("e5"), "case-insensitive named-structure query hits the advance line");
  const locked = searchStructures(leaves, "white", { center: "locked" });
  // Both leaves lock the d-file pawn pair; the advance line additionally carries the French label.
  ok(locked.length === 2 && locked.some((l) => l.structure_class === "French"), "center query returns classifier context");
  ok(searchStructures(leaves, "white", { structure: "IQP" }).length === 0, "non-matching structure returns empty");
  ok(
    searchStructures(leaves, "white", { structure: "French", minConfidence: 0.99 }).length === 0,
    "minConfidence gates a structure match",
  );
}

// --- T6: annotated repertoire export (mock engine) ---
{
  const tree = GameTree.fromPgn("1. e4 e5 2. Nf3 *");
  const sourcePgn = tree.toPgn();
  // Mock: white-to-move multipv → a3 (+200) / h3 (0); black-to-move multipv → a6 (-200 white-POV,
  // i.e. +200 mover) / h6 (0). Single-PV after-position probes → flat 0. So every prescribed move
  // audits as a 200cp mistake, every your-turn node is a 200cp-margin only-move, and the covered
  // e5 leaves a6 as a high-severity gap.
  const analyse = async (fen, mpv, depth) => {
    if (mpv === 1) return [{ uci: "", cp: 0, mate: null, depth, pv: [] }];
    const turn = fen.split(" ")[1];
    const moves = turn === "w" ? ["a2a3", "h2h3", "b2b3", "g2g3"] : ["a7a6", "h7h6", "b7b6", "g7g6"];
    return moves.slice(0, mpv).map((uci, i) => ({
      uci,
      cp: (turn === "w" ? 1 : -1) * (i === 0 ? 200 : 0),
      mate: null,
      depth,
      pv: [uci],
    }));
  };
  const table = parseOpeningsTsv("eco\tname\tpgn\n");
  const res = await annotateRepertoire(tree, "white", { repertoireRevision: "perftools:annotation" }, analyse, table);
  ok(!("error" in res), "annotate runs clean");
  ok(res.annotated.audit === 2, `audit annotations on both prescribed moves (got ${res.annotated.audit})`);
  ok(res.annotated.only_moves === 2, `only-move annotations on both your-turn nodes (got ${res.annotated.only_moves})`);
  ok(res.annotated.gaps >= 1, `gap annotation for the uncovered near-best reply (got ${res.annotated.gaps})`);
  ok(res.pgn.includes("audit: mistake") && res.pgn.includes("$2"), "audit comment + NAG embedded");
  ok(res.pgn.includes("only move: next best -200cp"), "only-move comment embedded");
  ok(res.pgn.includes("gap: a6 not covered"), "gap comment embedded at the owed node");
  ok(tree.toPgn() === sourcePgn, "source tree untouched (annotations on a clone)");
  const auditOnly = await annotateRepertoire(
    tree,
    "white",
    { include: ["audit"], repertoireRevision: "perftools:audit-only" },
    analyse,
    table,
  );
  ok(auditOnly.annotated.only_moves === 0 && auditOnly.annotated.gaps === 0, "include filters the sources");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
