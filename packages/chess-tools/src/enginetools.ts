/**
 * Engine-dependent orchestration shared by the Node MCP server and the browser PWA chat.
 *
 * Each function takes an injected `Analyse` callback so it is agnostic to where Stockfish runs
 * (Node `stockfish` wasm via engine.ts, or the browser Worker in apps/ui/src/engine/stockfish.ts).
 * The pure analysis (GameTree walking, structure classification, congruence) lives in the other
 * chess-tools modules; this layer adds the per-position engine searches and the result shaping
 * that the MCP tools return — so server and PWA produce identical output.
 */
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { makeSan, parseSan } from "chessops/san";
import type { ChildNode, PgnNodeData } from "chessops/pgn";
import { GameTree, type Path, buildKeyIndex, landsInCrossBranchPrep } from "./pgn.js";
import { positionKey, type Color } from "./congruence.js";
import { mainline, classifyCpLoss, type MoveClass } from "./game.js";
import { decisionNodes, turnNodes, gapSeverity, SEVERITY_RANK, moveSan, type Severity } from "./gaps.js";
import { validateLine } from "./validate.js";
import type { ExplorerLookup } from "./explorer.js";
import type { OpeningTable } from "./openings.js";
import { replacementPivot, analyzeCongruence } from "./repcongruence.js";
import {
  profileStructureShares,
  buildFitProfile,
  fitScore,
  classifyStructure,
  isolatedPawns,
  doubledPawns,
  passedPawns,
} from "./structure.js";

const MATE_CP = 100000;

/** One engine line. Matches the Node engine's MultiLine and the (extended) browser one. */
export interface EngineLine {
  uci: string;
  cp: number | null;
  mate: number | null;
  depth: number;
  /** full principal variation, UCI moves. */
  pv: string[];
}

/** Injected engine: top-`multipv` lines for a FEN to `depth`, or null when unavailable. */
export type Analyse = (fen: string, multipv: number, depth: number) => Promise<EngineLine[] | null>;

const chessFromFen = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

// Mate-sentinel NOTE: this file deliberately carries TWO magnitudes, and unifying them WOULD change tool
// output (out of scope). The magnitude is therefore an explicit argument to whitePov, so each call site
// states which it wants instead of hiding the choice in a hand-inlined copy (and a future sign fix can't
// miss a stray copy): 100000 for internal decisive/severity math (analyze_game eval_cp, find_repertoire_gaps
// severity, compare_moves mover_cp) vs 10000 for the published `eval`/`eval_cp` of suggest_* (via evalWhite).
type ScoreLine = { cp: number | null; mate: number | null };
/** White-POV centipawns; a mate maps to ±mateCp (the caller picks the sentinel magnitude). */
const whitePov = (l: ScoreLine, mateCp: number): number =>
  l.mate !== null ? (l.mate > 0 ? mateCp : -mateCp) : (l.cp ?? 0);
/** whitePov flipped to the side to move (the mover). */
const moverPov = (l: ScoreLine, moverIsWhite: boolean, mateCp: number): number =>
  (moverIsWhite ? 1 : -1) * whitePov(l, mateCp);
const evalWhite = (l: ScoreLine) => whitePov(l, 10000);
const pvSan = (fen: string, pv: string[]): string => {
  const pos = chessFromFen(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, 5)) {
    const mv = parseUci(uci);
    if (!mv) break;
    out.push(makeSan(pos, mv));
    pos.play(mv);
  }
  return out.join(" ");
};

// --- game review (analyze_game / get_game_summary / export_annotated_pgn / batch_review) ---

export interface MoveRecord {
  ply: number;
  color: Color;
  san: string;
  cp_loss: number;
  classification: MoveClass;
  /** white-POV eval after the played move. */
  eval_cp: number;
  /** best move at the position (SAN). */
  best_move: string;
  /** white-POV eval of best play before the move. */
  best_eval: number;
}

/** One engine eval per mainline position (N+1 for N moves); cp_loss from consecutive white evals. */
export async function analyzeMainline(pgn: string, depth: number, analyse: Analyse): Promise<MoveRecord[] | null> {
  const moves = mainline(pgn);
  if (!moves.length) return [];
  const fens = moves.map((m) => m.fenBefore);
  fens.push(moves[moves.length - 1]!.fenAfter);

  // Fired concurrently — the engine pool parallelises, its queue is the limiter (P1).
  const results = await Promise.all(fens.map((fen) => analyse(fen, 1, depth)));
  if (results.some((r) => r === null)) return null; // engine genuinely unavailable
  const evals = results.map((res, i) => {
    const l = res![0];
    if (!l) {
      // No lines ⇒ a terminal position (no legal moves); the engine returns []. This is only ever the
      // final fenAfter, consumed as an `after` eval (its bestUci is never read). Checkmate ⇒ the side
      // to move is mated (white-POV ∓MATE_CP); stalemate / insufficient material ⇒ a draw (0). Treating
      // [] as engine_unavailable (the old bug) aborted the review of every game ending in mate.
      const pos = chessFromFen(fens[i]!);
      return { whiteCp: pos.isCheckmate() ? (pos.turn === "white" ? -MATE_CP : MATE_CP) : 0, bestUci: "" };
    }
    return { whiteCp: whitePov(l, MATE_CP), bestUci: l.uci };
  });

  // A before-position always has a legal move (the game played one from it), so its bestUci is only
  // empty if the engine misbehaved — report that as engine trouble, not the invalid_pgn the caller's
  // catch would have labeled the moveSan("") throw as.
  if (moves.some((_, k) => evals[k]!.bestUci === "")) return null;

  return moves.map((m, k) => {
    const before = evals[k]!;
    const after = evals[k + 1]!;
    const loss = m.color === "white" ? before.whiteCp - after.whiteCp : after.whiteCp - before.whiteCp;
    const cp_loss = Math.max(0, loss);
    return {
      ply: m.ply,
      color: m.color,
      san: m.san,
      cp_loss,
      classification: classifyCpLoss(cp_loss),
      eval_cp: after.whiteCp,
      best_move: moveSan(m.fenBefore, before.bestUci),
      best_eval: before.whiteCp,
    };
  });
}

// --- find_repertoire_gaps (engine scan over decision nodes) ---

export interface GapsOptions {
  depth?: number;
  minSeverity?: Severity;
  maxPositions?: number;
  limit?: number;
  /**
   * Optional explorer lookup (T2). When set, the surviving gaps are annotated with how often the
   * uncovered move is actually played and re-ranked by frequency WITHIN each severity tier —
   * severity stays the primary signal (an uncovered near-refutation matters even when rare);
   * frequency breaks ties toward the holes actually faced. Explorer failure degrades the
   * annotation to null, never the scan.
   */
  popularity?: ExplorerLookup;
}
export interface Gap {
  path: Path;
  fen: string;
  uncovered_move: string;
  eval: number | null;
  mate: number | null;
  severity: Severity;
  /** % of explorer games at this position playing the uncovered move (only when popularity requested; null on explorer miss). */
  played_pct?: number | null;
  /** explorer game count for the uncovered move (same conditions). */
  played_games?: number | null;
}
export interface CoveredGap {
  path: Path;
  fen: string;
  uncovered_move: string;
  /** the prepared line this reply transposes into (shallowest SAN path). */
  joins_path: string[];
}
export type GapsResult =
  | { error: "engine_unavailable" }
  | {
      color: Color;
      positions_scanned: number;
      total_gaps: number;
      gaps: Gap[];
      /** strong replies that look uncovered but transpose into prep — false gaps, not counted. */
      covered_by_transposition: CoveredGap[];
    };

export async function findRepertoireGaps(
  tree: GameTree,
  color: Color,
  opts: GapsOptions,
  analyse: Analyse,
): Promise<GapsResult> {
  const minSev: Severity = opts.minSeverity ?? "medium";
  const nodes = decisionNodes(tree, color).slice(0, opts.maxPositions ?? 20);
  const { keyMap } = buildKeyIndex(tree.game.moves);
  // Per-node searches fired concurrently (P1 — the pool parallelises, its queue is the limiter);
  // results assembled in node order so output matches the old sequential scan.
  const perNode = await Promise.all(
    nodes.map(async (node) => {
      const res = await analyse(node.fen, 4, opts.depth ?? 14);
      if (!res) return null;
      const gaps: Gap[] = [];
      const covered: CoveredGap[] = [];
      const moverIsWhite = node.fen.split(" ")[1] === "w";
      const moverCp = (l: EngineLine) => moverPov(l, moverIsWhite, MATE_CP);
      const best = res.length ? moverCp(res[0]!) : 0;
      for (const l of res) {
        const san = moveSan(node.fen, l.uci);
        if (node.covered.includes(san)) continue;
        // Transposition-first: a strong uncovered reply that walks into prep on a DIFFERENT line is
        // not a real gap. Record it as covered-by-transposition instead of inflating the gap list —
        // engine-free, on results the scan already computed.
        const after = Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
        after.play(parseUci(l.uci)!);
        const tgt = landsInCrossBranchPrep(keyMap, after, node.path);
        if (tgt) {
          covered.push({ path: node.path, fen: node.fen, uncovered_move: san, joins_path: tgt.sanPath });
          continue;
        }
        gaps.push({ path: node.path, fen: node.fen, uncovered_move: san, eval: l.cp, mate: l.mate, severity: gapSeverity(best, moverCp(l)) });
      }
      return { gaps, covered };
    }),
  );
  if (perNode.some((r) => r === null)) return { error: "engine_unavailable" };
  const found = perNode.flatMap((r) => r!.gaps);
  const covered = perNode.flatMap((r) => r!.covered);
  const gaps = found
    .filter((g) => SEVERITY_RANK[g.severity] >= SEVERITY_RANK[minSev])
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, opts.limit ?? 10);
  if (opts.popularity && gaps.length) {
    // One request per unique decision node (several gaps can share one), post-limit only —
    // request budget ≤ limit at 1 req/s. The lookup caches, so transposition re-hits are free.
    const fens = [...new Set(gaps.map((g) => g.fen))];
    const byFen = new Map(await Promise.all(fens.map(async (f) => [f, await opts.popularity!(f)] as const)));
    for (const g of gaps) {
      const pos = byFen.get(g.fen);
      // A move absent from the explorer's top-moves list is (approximately) never played there.
      const m = pos?.moves.find((x) => x.san === g.uncovered_move);
      g.played_pct = pos ? (m?.played_pct ?? 0) : null;
      g.played_games = pos ? (m?.games ?? 0) : null;
    }
    gaps.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (b.played_pct ?? -1) - (a.played_pct ?? -1));
  }
  return { color, positions_scanned: nodes.length, total_gaps: gaps.length, gaps, covered_by_transposition: covered };
}

// --- audit_repertoire_moves (engine-check the user's own prescribed moves, tree-wide) ---

export interface AuditOptions {
  depth?: number;
  /** Report findings with cp_loss >= this (default 50). */
  minCpLoss?: number;
  maxPositions?: number;
  limit?: number;
}
export interface AuditFinding {
  /** SAN path from the root to the position (before the prescribed move). */
  path: string[];
  fen: string;
  /** Your repertoire move here (canonical SAN). */
  prescribed: string;
  /** Mover-POV cp (MATE_CP sentinel — same magnitude as the severity math). */
  prescribed_eval: number;
  best_move: string;
  best_eval: number;
  /** best_eval - prescribed_eval, floored at 0. */
  cp_loss: number;
  classification: MoveClass;
  /** best - second from the multipv-2 search (only-move signal); null when only one legal move. */
  best_margin: number | null;
}
export type AuditResult =
  | { error: "engine_unavailable" }
  | { color: Color; positions_scanned: number; moves_audited: number; findings: AuditFinding[] };

/**
 * Walk every your-turn node (transposition-deduped, shallowest first), multipv-2 search, and rank
 * the prescribed moves by cp_loss vs the engine's best — "which of my repertoire moves are bad".
 * A prescribed move inside the multipv lines is scored directly; otherwise one extra single-PV
 * search of the position after it (the same 1-ply-offset comparison analyzeMainline makes).
 */
export async function auditRepertoireMoves(
  tree: GameTree,
  color: Color,
  opts: AuditOptions,
  analyse: Analyse,
): Promise<AuditResult> {
  const depth = opts.depth ?? 14;
  const minCpLoss = opts.minCpLoss ?? 50;
  const nodes = turnNodes(tree, color).slice(0, opts.maxPositions ?? 20);
  // Nodes fired concurrently (P1); within a node the two-phase logic (multipv-2, then a
  // conditional single-PV for an off-line prescribed move) stays sequential and readable.
  const perNode = await Promise.all(
    nodes.map(async (node) => {
      const res = await analyse(node.fen, 2, depth);
      if (res === null) return null;
      const findings: AuditFinding[] = [];
      let audited = 0;
      if (!res.length) return { findings, audited }; // unreachable: the node has a stored child, so a legal move exists
      const moverIsWhite = node.fen.split(" ")[1] === "w";
      const mcp = (l: EngineLine) => moverPov(l, moverIsWhite, MATE_CP);
      const best = mcp(res[0]!);
      const best_move = moveSan(node.fen, res[0]!.uci);
      const best_margin = res.length > 1 ? best - mcp(res[1]!) : null;
      const bySan = new Map(res.map((l) => [moveSan(node.fen, l.uci), l]));
      for (const raw of node.covered) {
        const pos = chessFromFen(node.fen);
        const mv = parseSan(pos, raw);
        if (!mv) continue; // tree moves are replay-verified at load; unreachable
        const prescribed = makeSan(pos, mv);
        audited++;
        const hit = bySan.get(prescribed);
        let prescribedCp: number;
        if (hit) {
          prescribedCp = mcp(hit);
        } else {
          pos.play(mv);
          const r = await analyse(makeFen(pos.toSetup()), 1, depth);
          if (r === null) return null;
          const l = r[0];
          // [] ⇒ the prescribed move ENDS the game (same terminal contract as compareMoves):
          // mate delivered is decisive for the mover; stalemate / insufficient material is a draw.
          prescribedCp = l ? -moverPov(l, pos.turn === "white", MATE_CP) : pos.isCheckmate() ? MATE_CP : 0;
        }
        const cp_loss = Math.max(0, best - prescribedCp);
        if (cp_loss < minCpLoss) continue;
        findings.push({
          path: node.sanPath,
          fen: node.fen,
          prescribed,
          prescribed_eval: prescribedCp,
          best_move,
          best_eval: best,
          cp_loss,
          classification: classifyCpLoss(cp_loss),
          best_margin,
        });
      }
      return { findings, audited };
    }),
  );
  if (perNode.some((r) => r === null)) return { error: "engine_unavailable" };
  const findings = perNode.flatMap((r) => r!.findings);
  findings.sort((a, b) => b.cp_loss - a.cp_loss);
  return {
    color,
    positions_scanned: nodes.length,
    moves_audited: perNode.reduce((a, r) => a + r!.audited, 0),
    findings: findings.slice(0, opts.limit ?? 10),
  };
}

// --- find_only_moves (criticality tagging + spaced-repetition drill deck) ---

export interface OnlyMoveOptions {
  depth?: number;
  /** Tag positions where best − second ≥ this (default 100 — misremembering costs a "mistake"). */
  minMargin?: number;
  maxPositions?: number;
  linesLimit?: number;
}
export interface OnlyMoveFinding {
  /** SAN path from the root to the position (before your move). */
  path: string[];
  fen: string;
  /** Your repertoire move(s) here (canonical SAN) — the drill answer. */
  prescribed: string[];
  best_move: string;
  /** false ⇒ compounded problem: an only-move position where the tree prescribes a non-best
   *  move — fix via audit_repertoire_moves before drilling. */
  prescribed_is_best: boolean;
  /** best − second, mover POV (MATE_CP sentinel when a mate line is involved). */
  margin: number;
  best_eval: number;
}
export interface OnlyMoveLine {
  line: string[];
  critical: number;
  your_moves: number;
  /** critical / your_moves, 2 dp — "sharpest lines to drill". */
  density: number;
}
export type OnlyMoveResult =
  | { error: "engine_unavailable" }
  | {
      color: Color;
      positions_scanned: number;
      only_moves_found: number;
      findings: OnlyMoveFinding[];
      lines: OnlyMoveLine[];
    };

/**
 * Tag your-turn positions where the engine's best move stands alone (best − second ≥ minMargin):
 * the "only move" positions where misremembering the repertoire is punished. Same walker and
 * multipv-2 search as auditRepertoireMoves but the opposite filter — the audit surfaces bad
 * prescriptions (cp_loss), this surfaces sharp positions regardless of prescription quality
 * (the healthy cp_loss-0 case never clears the audit's filter). `lines` ranks leaf lines by
 * tagged-position density, transposition-aware: a tagged node reached by two move orders counts
 * in both lines (it must be recalled in both).
 */
export async function findOnlyMoves(
  tree: GameTree,
  color: Color,
  opts: OnlyMoveOptions,
  analyse: Analyse,
): Promise<OnlyMoveResult> {
  const depth = opts.depth ?? 14;
  const minMargin = opts.minMargin ?? 100;
  const nodes = turnNodes(tree, color).slice(0, opts.maxPositions ?? 300);
  const perNode = await Promise.all(
    nodes.map(async (node) => {
      const res = await analyse(node.fen, 2, depth);
      if (res === null) return null;
      const key = positionKey(node.fen);
      // < 2 lines ⇒ a single legal move — literally forced, nothing to drill.
      if (res.length < 2) return { key, finding: null };
      const moverIsWhite = node.fen.split(" ")[1] === "w";
      const mcp = (l: EngineLine) => moverPov(l, moverIsWhite, MATE_CP);
      const margin = mcp(res[0]!) - mcp(res[1]!);
      if (margin < minMargin) return { key, finding: null };
      const pos = chessFromFen(node.fen);
      const prescribed = node.covered.map((raw) => {
        const mv = parseSan(pos, raw);
        return mv ? makeSan(pos, mv) : raw; // tree moves are replay-verified at load; fallback unreachable
      });
      const best_move = moveSan(node.fen, res[0]!.uci);
      const finding: OnlyMoveFinding = {
        path: node.sanPath,
        fen: node.fen,
        prescribed,
        best_move,
        prescribed_is_best: prescribed.includes(best_move),
        margin,
        best_eval: mcp(res[0]!),
      };
      return { key, finding };
    }),
  );
  if (perNode.some((r) => r === null)) return { error: "engine_unavailable" };
  const scanned = new Set(perNode.map((r) => r!.key));
  const tagged = new Set(perNode.filter((r) => r!.finding).map((r) => r!.key));
  const findings = perNode
    .map((r) => r!.finding)
    .filter((f): f is OnlyMoveFinding => f !== null)
    .sort((a, b) => b.margin - a.margin);

  // Line density: replay each leaf line counting your-turn decision positions (scanned only —
  // a maxPositions cut must not deflate the denominator) and how many are tagged.
  const lines: OnlyMoveLine[] = [];
  for (const leaf of tree.leaves()) {
    const pos = Chess.default();
    let your_moves = 0;
    let critical = 0;
    for (const san of leaf.path) {
      if (pos.turn === color) {
        const key = positionKey(makeFen(pos.toSetup()));
        if (scanned.has(key)) {
          your_moves++;
          if (tagged.has(key)) critical++;
        }
      }
      const mv = parseSan(pos, san);
      if (!mv) break; // replay-verified at load; unreachable
      pos.play(mv);
    }
    if (critical) lines.push({ line: leaf.path, critical, your_moves, density: Math.round((critical / your_moves) * 100) / 100 });
  }
  lines.sort((a, b) => b.density - a.density || b.critical - a.critical);

  return {
    color,
    positions_scanned: nodes.length,
    only_moves_found: findings.length,
    findings,
    lines: lines.slice(0, opts.linesLimit ?? 10),
  };
}

const csvField = (s: string): string => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
/** "1.d4 d5 2.c4" — sanPath always starts at the root, so numbering is positional. */
const numberedSan = (path: string[]): string =>
  path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(" ");

/**
 * Serialize tagged only-move positions as a flashcard CSV (header row, RFC-4180 quoting):
 * front = numbered SAN path + side to move, back = prescribed move(s) + margin note, plus a fen
 * column for board-rendering card templates. Anki's importer maps the columns directly.
 */
export function onlyMoveDeckCsv(color: Color, findings: OnlyMoveFinding[]): string {
  const side = color === "white" ? "White" : "Black";
  const rows = findings.map((f) => {
    const front = `${f.path.length ? numberedSan(f.path) : "(start position)"} (${side} to move)`;
    const note = f.margin >= MATE_CP / 2 ? "only move: alternatives are decisively worse" : `only move: next best -${f.margin}cp`;
    const back = `${f.prescribed.join(" / ")} (${note})`;
    return [front, back, f.fen, String(f.margin)].map(csvField).join(",");
  });
  return ["front,back,fen,margin", ...rows].join("\n") + "\n";
}

// --- export_annotated_repertoire (T6: analysis findings as portable PGN comments/NAGs) ---

export type AnnotateSource = "audit" | "only_moves" | "gaps" | "congruence";
export interface AnnotateOptions {
  /** Which analyses to embed (default: all four; congruence silently skipped without an OpeningTable). */
  include?: AnnotateSource[];
  depth?: number;
  /** Per-scan position cap; unset = each tool's own default (audit/gaps 20, only-moves 300). */
  maxPositions?: number;
  /** audit filter (default 50). */
  minCpLoss?: number;
  /** only-move filter (default 100). */
  minMargin?: number;
  /** gaps + congruence filter (default medium). */
  minSeverity?: Severity;
}
export type AnnotateResult =
  | { error: "engine_unavailable" }
  | { color: Color; pgn: string; annotated: Record<AnnotateSource, number> };

// Same glyph mapping as export_annotated_pgn: $4 = blunder (??), $2 = mistake (?), $6 = dubious (?!).
const ANNOTATE_NAG: Record<string, number> = { blunder: 4, mistake: 2, inaccuracy: 6 };

/**
 * Run the selected repertoire analyses and embed every finding as a PGN comment (plus a NAG for
 * audit findings) at the flagged node of a CLONED tree — the findings become portable to any
 * board GUI instead of living only in tool JSON. The scans run on the source tree; the audit and
 * only-move scans share the same turnNodes walk + multipv-2 searches, so the eval cache collapses
 * the overlap. In-context truncation limits are the interactive tools' concern — the export
 * annotates the FULL finding sets (bounded by maxPositions, which caps the engine work).
 */
export async function annotateRepertoire(
  tree: GameTree,
  color: Color,
  opts: AnnotateOptions,
  analyse: Analyse,
  openings?: OpeningTable,
): Promise<AnnotateResult> {
  const include = opts.include ?? ["audit", "only_moves", "gaps", "congruence"];
  const clone = tree.clone();
  const NO_LIMIT = 10000;

  const evalStr = (cp: number) =>
    cp >= MATE_CP / 2 ? "winning" : cp <= -MATE_CP / 2 ? "losing" : `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
  const childData = (sanPath: string[]): PgnNodeData | null => {
    const idx = clone.indexPathOfSan(sanPath);
    if (!idx || !idx.length) return null;
    return (clone.nodeAt(idx) as ChildNode<PgnNodeData>).data;
  };
  const comment = (data: PgnNodeData, text: string) => {
    (data.comments ??= []).push(text);
  };
  const addNag = (data: PgnNodeData, n: number) => {
    if (!(data.nags ??= []).includes(n)) data.nags.push(n);
  };

  const annotated: Record<AnnotateSource, number> = { audit: 0, only_moves: 0, gaps: 0, congruence: 0 };

  if (include.includes("audit")) {
    const res = await auditRepertoireMoves(
      tree,
      color,
      { depth: opts.depth, minCpLoss: opts.minCpLoss, maxPositions: opts.maxPositions, limit: NO_LIMIT },
      analyse,
    );
    if ("error" in res) return res;
    for (const f of res.findings) {
      const d = childData([...f.path, f.prescribed]);
      if (!d) continue; // findings come from this tree; unreachable
      addNag(d, ANNOTATE_NAG[f.classification] ?? 6);
      const loss = f.cp_loss >= MATE_CP / 2 ? "decisively" : `${f.cp_loss}cp`;
      comment(d, `audit: ${f.classification} — loses ${loss} vs ${f.best_move} (${evalStr(f.best_eval)})`);
      annotated.audit++;
    }
  }

  if (include.includes("only_moves")) {
    const res = await findOnlyMoves(
      tree,
      color,
      { depth: opts.depth, minMargin: opts.minMargin, maxPositions: opts.maxPositions, linesLimit: 1 },
      analyse,
    );
    if ("error" in res) return res;
    for (const f of res.findings) {
      const note =
        f.margin >= MATE_CP / 2 ? "only move: alternatives are decisively worse" : `only move: next best -${f.margin}cp`;
      const tail = f.prescribed_is_best ? "" : `; engine best is ${f.best_move}`;
      for (const san of f.prescribed) {
        const d = childData([...f.path, san]);
        if (d) comment(d, `${note}${tail}`);
      }
      annotated.only_moves++;
    }
  }

  if (include.includes("gaps")) {
    const res = await findRepertoireGaps(
      tree,
      color,
      { depth: opts.depth, minSeverity: opts.minSeverity, maxPositions: opts.maxPositions, limit: NO_LIMIT },
      analyse,
    );
    if ("error" in res) return res;
    for (const g of res.gaps) {
      // Gap.path is the index path to the position OWED the reply; an empty path = the root
      // (a Black repertoire's uncovered first move) → the game-level comment.
      const text = `gap: ${g.uncovered_move} not covered (severity ${g.severity})`;
      if (g.path.length === 0) (clone.game.comments ??= []).push(text);
      else comment((clone.nodeAt(g.path) as ChildNode<PgnNodeData>).data, text);
      annotated.gaps++;
    }
  }

  if (include.includes("congruence") && openings) {
    const res = analyzeCongruence(tree, color, openings, { minSeverity: opts.minSeverity, limit: NO_LIMIT });
    for (const flag of res.incongruencies) {
      for (const p of flag.paths) {
        const d = childData(p);
        if (!d) continue;
        comment(d, `congruence: ${flag.description}`);
        annotated.congruence++;
      }
    }
  }

  return { color, pgn: clone.toPgn(), annotated };
}

// --- shorten suggestion vetting (shared by the MCP tools and the PWA Shorten UI) ---

/** C3 — quality of a shortcut: the line you'd ADOPT (transpose into joinsPath) vs the one you'd
 *  ABANDON (stay on linePath past atPly), on eval (at the fork) + structural fit (subtree distribution
 *  vs the repertoire aggregate). Recommends eval unless |evalDelta| ≤ tiebreak, then fit. */
export interface ShortcutComparison {
  recommend: "stay" | "transpose";
  basis: "eval" | "fit" | "fit_eval_unavailable";
  eval_disagrees_with_fit: boolean;
  evalStay: number | null;
  evalTranspose: number | null;
  evalDelta: number | null;
  fitStay: number;
  fitTranspose: number;
  structureStay: string;
  structureTranspose: string;
  unknownShareStay: number;
  unknownShareTranspose: number;
}

export async function compareShortcutLines(
  tree: GameTree,
  color: Color,
  opts: { linePath: string[]; atPly: number; joinsPath: string[]; depth?: number; evalTiebreakCp?: number },
  analyse: Analyse,
): Promise<ShortcutComparison | { error: string }> {
  const stayPath = opts.linePath.slice(0, opts.atPly + 1);
  const stayFen = tree.fenAtSanPath(stayPath);
  const joinFen = tree.fenAtSanPath(opts.joinsPath);
  const subA = tree.subtreeLeafBoards(stayPath);
  const subB = tree.subtreeLeafBoards(opts.joinsPath);
  if (!stayFen || !joinFen || !subA || !subB) return { error: "path_not_found" };

  const yourEval = async (fen: string): Promise<number | null> => {
    const r = await analyse(fen, 1, opts.depth ?? 16);
    if (!r || !r.length) return null;
    // After your move the side to move is the OPPONENT; moverPov gives their POV, so negate to yours.
    return -moverPov(r[0]!, fen.split(" ")[1] === "w", MATE_CP);
  };
  const evalStay = await yourEval(stayFen);
  const evalTranspose = await yourEval(joinFen);
  const evalDelta = evalStay != null && evalTranspose != null ? evalStay - evalTranspose : null;

  const r2 = (x: number) => Math.round(x * 100) / 100;
  // Blended structural fit (named structure + center + themes) — robust to unclassified positions, the
  // same signal gap-fill uses. A branch's fit = mean fitScore over its leaf boards; unknownShare (the
  // named-structure-unclassified share) stays informational but no longer forces the fit to 0.
  const profile = buildFitProfile(tree.leafPositions().map((p) => p.board), color);
  const fitOf = (boards: Parameters<typeof buildFitProfile>[0]) => {
    const fit = boards.length ? boards.reduce((s, b) => s + fitScore(profile, b, color), 0) / boards.length : 0;
    return { fit: r2(fit), unknown: r2(profileStructureShares(boards).unknown ?? 0) };
  };
  const fa = fitOf(subA);
  const fb = fitOf(subB);
  const labelOf = (sans: string[]) => {
    const b = tree.mainlineLeafBoard(sans);
    return b ? classifyStructure(b).structure_class : "unknown";
  };

  const tb = opts.evalTiebreakCp ?? 30;
  const fitPref = fb.fit >= fa.fit ? "transpose" : "stay";
  let recommend: "stay" | "transpose";
  let basis: "eval" | "fit" | "fit_eval_unavailable";
  if (evalDelta != null && Math.abs(evalDelta) > tb) {
    recommend = evalDelta < 0 ? "transpose" : "stay";
    basis = "eval";
  } else {
    recommend = fitPref;
    basis = evalDelta == null ? "fit_eval_unavailable" : "fit";
  }
  const evalPref = evalDelta == null ? null : evalDelta < 0 ? "transpose" : "stay";
  return {
    recommend,
    basis,
    eval_disagrees_with_fit: evalPref != null && evalPref !== fitPref,
    evalStay,
    evalTranspose,
    evalDelta,
    fitStay: fa.fit,
    fitTranspose: fb.fit,
    structureStay: labelOf(stayPath),
    structureTranspose: labelOf(opts.joinsPath),
    unknownShareStay: fa.unknown,
    unknownShareTranspose: fb.unknown,
  };
}

/** C4 — coverage safety: prune the line's tail (linePath truncated to atPly+1) on a COPY, re-run the
 *  gap scan, and return gaps present after but not before (replies the pruned tail had been covering). */
export interface ShortcutCoverage {
  prunes: string[];
  introduces_gap: boolean;
  new_gaps: Gap[];
  before_total: number;
  after_total: number;
}

export async function checkShortcutCoverage(
  tree: GameTree,
  color: Color,
  opts: { linePath: string[]; atPly: number; depth?: number; minSeverity?: Severity; maxPositions?: number; limit?: number },
  analyse: Analyse,
): Promise<ShortcutCoverage | { error: string }> {
  const prunes = opts.linePath.slice(0, opts.atPly + 1);
  if (!prunes.length) return { error: "invalid_prune" };
  const edited = tree.edit("prune", prunes);
  if (!edited.tree) return { error: edited.error ?? "invalid_edit" };
  const gapsOpts = { depth: opts.depth, minSeverity: opts.minSeverity, maxPositions: opts.maxPositions, limit: opts.limit };
  // Both scans in parallel (P1) — they share most positions, so the cache/in-flight dedupe
  // collapses the overlap either way.
  const [before, after] = await Promise.all([
    findRepertoireGaps(tree, color, gapsOpts, analyse),
    findRepertoireGaps(edited.tree, color, gapsOpts, analyse),
  ]);
  if ("error" in before) return { error: before.error };
  if ("error" in after) return { error: after.error };
  const key = (g: Gap) => `${g.fen}|${g.uncovered_move}`;
  const beforeSet = new Set(before.gaps.map(key));
  const new_gaps = after.gaps.filter((g) => !beforeSet.has(key(g)));
  return { prunes, introduces_gap: new_gaps.length > 0, new_gaps, before_total: before.total_gaps, after_total: after.total_gaps };
}

// --- resolve_dangling_stubs (engine-vetted: does a dangling stub rejoin prep?) ---

export interface StubResolution {
  /** SAN path to the dangling leaf (your-turn, owed a continuation). */
  path: string[];
  ply: number;
  /** Engine-best SAN sequence that bridges the stub back into prep (present only when it does). */
  connects_via?: string[];
  /** Prep line the bridge rejoins. */
  joins_path?: string[];
  joins_ply?: number;
}
export type CoverageResolution =
  | { error: "engine_unavailable" }
  | { resolved: number; dangling: StubResolution[] };

const STUB_MAX_DEPTH = 4;
const STUB_NODE_BUDGET = 40;
const STUB_CP_THRESHOLD = 50;

/**
 * For each dangling stub (your-turn leaf owed a move), check whether the color's engine-best moves
 * bridge it back into existing prep within a few plies (GameTree.extendedBridges). The dangling set
 * IS extendedBridges' frontier set, so they match by departure path. This is frontier_link / stub
 * resolution for the MCP + chat surfaces. Engine injected (chess-tools stays engine-free).
 */
export async function resolveDanglingStubs(
  tree: GameTree,
  color: Color,
  opts: { maxDepth?: number; nodeBudget?: number; cpThreshold?: number; limit?: number },
  analyse: Analyse,
): Promise<CoverageResolution> {
  const dangling = tree.coverage(color).danglingLines.slice(0, opts.limit ?? 20);
  if (!dangling.length) return { resolved: 0, dangling: [] };

  const cpThreshold = opts.cpThreshold ?? STUB_CP_THRESHOLD;
  let engineOk = true;
  const pickMoves = async (fen: string): Promise<string[]> => {
    const res = await analyse(fen, 3, 12);
    if (!res) {
      engineOk = false;
      return [];
    }
    if (!res.length) return [];
    const moverIsWhite = fen.split(" ")[1] === "w";
    const moverCp = (l: EngineLine) => moverPov(l, moverIsWhite, MATE_CP);
    const best = moverCp(res[0]!);
    return res.filter((l) => best - moverCp(l) <= cpThreshold).map((l) => l.uci);
  };

  const ext = await tree.extendedBridges(
    color,
    { maxDepth: opts.maxDepth ?? STUB_MAX_DEPTH, nodeBudget: opts.nodeBudget ?? STUB_NODE_BUDGET },
    pickMoves,
  );
  if (!engineOk) return { error: "engine_unavailable" };

  // extendedBridges ranks best-first; keep the first (best) extension per departure path.
  const byPath = new Map<string, (typeof ext)[number]>();
  for (const e of ext) {
    const k = e.fromPath.join(" ");
    if (!byPath.has(k)) byPath.set(k, e);
  }

  let resolved = 0;
  const out: StubResolution[] = dangling.map((d) => {
    const e = byPath.get(d.path.join(" "));
    if (!e) return { path: d.path, ply: d.ply };
    resolved++;
    return { path: d.path, ply: d.ply, connects_via: e.moves, joins_path: e.joinsPath, joins_ply: e.joinsPly };
  });
  return { resolved, dangling: out };
}

// --- compare_moves (rank caller-supplied SANs by engine, mover POV) ---

export async function compareMoves(
  fen: string,
  moves: string[],
  depth: number,
  analyse: Analyse,
): Promise<{ fen: string; candidates: Record<string, unknown>[] }> {
  const moverIsWhite = fen.split(" ")[1] === "w";
  // Candidates fired concurrently (P1); `out` keeps the caller's move order until the sort below.
  const out: Record<string, unknown>[] = await Promise.all(
    moves.map(async (san) => {
      const chk = validateLine(fen, [san]);
      if (!chk.ok || !chk.finalFen) return { san, error: "illegal_move" };
      const res = await analyse(chk.finalFen, 1, depth);
      if (res === null) return { san: chk.canonical[0], error: "engine_unavailable" };
      const line = res[0];
      if (!line) {
        // The move ENDS the game: finalFen is terminal (no legal replies), so the engine returns [] (not
        // null). Distinguishing that from engine-unavailable (null) is the fix — otherwise a mating candidate
        // was reported engine_unavailable (the same class as the analyzeMainline terminal bug). Checkmate ⇒
        // this move wins for the mover (decisive +MATE_CP); stalemate / insufficient material ⇒ a draw (0).
        const moverWins = chessFromFen(chk.finalFen).isCheckmate();
        return { san: chk.canonical[0], uci: chk.firstUci, eval_cp: null, mate: null, mover_cp: moverWins ? MATE_CP : 0 };
      }
      return { san: chk.canonical[0], uci: chk.firstUci, eval_cp: line.cp, mate: line.mate, mover_cp: moverPov(line, moverIsWhite, MATE_CP) };
    }),
  );
  out.sort((a, b) => ((b.mover_cp as number) ?? -Infinity) - ((a.mover_cp as number) ?? -Infinity));
  // Rank only the scored candidates — a rank on an illegal/engine-error row reads as a real placement.
  let rank = 0;
  for (const o of out) if (o.mover_cp !== undefined) o.rank = ++rank;
  return { fen, candidates: out };
}

// --- suggest_complementary_lines (engine + structure ranking from an anchor FEN) ---

export interface SuggestComplementaryOptions {
  mode?: "low_memorization" | "sharp";
  depth?: number;
  limit?: number;
}

export async function suggestComplementaryLines(
  tree: GameTree,
  color: Color,
  fen: string,
  opts: SuggestComplementaryOptions,
  analyse: Analyse,
): Promise<Record<string, unknown>> {
  const m = opts.mode ?? "low_memorization";
  const setup = parseFen(fen);
  if (setup.isErr) return { error: "invalid_fen", reason: String(setup.error) };
  const posCheck = Chess.fromSetup(setup.value);
  if (posCheck.isErr) return { error: "invalid_fen", reason: String(posCheck.error) };
  const pos = posCheck.value;
  const lim = Math.max(1, Math.min(10, opts.limit ?? 5));
  const pool = Math.min(10, lim + 2);

  let opponentMoveSan: string | null = null;
  if (pos.turn !== color) {
    const oppRes = await analyse(makeFen(pos.toSetup()), 1, opts.depth ?? 16);
    if (!oppRes) return { error: "engine_unavailable" };
    const oppUci = oppRes[0]?.uci;
    if (!oppUci) return { mode: m, anchor_fen: makeFen(pos.toSetup()), suggestions: [] };
    opponentMoveSan = moveSan(makeFen(pos.toSetup()), oppUci);
    pos.play(parseUci(oppUci)!);
  }
  const anchorFen = makeFen(pos.toSetup());
  const moverIsWhite = pos.turn === "white";
  const moverCp = (l: EngineLine) => moverPov(l, moverIsWhite, 10000);

  const res = await analyse(anchorFen, pool, opts.depth ?? 16);
  if (!res) return { error: "engine_unavailable" };
  const best = res.length ? moverCp(res[0]!) : 0;
  const leafBoards = tree.leafPositions().map((p) => p.board);
  const profile = buildFitProfile(leafBoards, color); // low_memorization: blended structural fit
  const shares = profileStructureShares(leafBoards); // sharp: structure novelty (not a fit axis)

  const ranked: { entry: Record<string, unknown>; mcp: number }[] = [];
  for (const l of res) {
    const mcp = moverCp(l);
    if (best - mcp > 100) continue;
    const after = chessFromFen(anchorFen);
    after.play(parseUci(l.uci)!);
    const resultStruct = classifyStructure(after.board).structure_class;
    const entry: Record<string, unknown> = {
      move: moveSan(anchorFen, l.uci),
      resulting_structure: resultStruct,
      eval: evalWhite(l),
      pv: pvSan(anchorFen, l.pv),
    };
    if (m === "low_memorization") {
      entry.profile_match = fitScore(profile, after.board, color);
    } else {
      const imbalance = (["white", "black"] as const).reduce(
        (a, c) => a + isolatedPawns(after.board, c).length + doubledPawns(after.board, c).length + passedPawns(after.board, c).length,
        0,
      );
      const novelty = resultStruct in shares ? 0 : 1;
      entry.sharpness = Math.round((Math.abs(mcp) / 100 + 0.5 * imbalance + novelty) * 100) / 100;
    }
    ranked.push({ entry, mcp });
  }

  if (m === "low_memorization")
    ranked.sort((a, b) => (b.entry.profile_match as number) - (a.entry.profile_match as number) || b.mcp - a.mcp);
  else ranked.sort((a, b) => (b.entry.sharpness as number) - (a.entry.sharpness as number));

  const result: Record<string, unknown> = { mode: m, anchor_fen: anchorFen, suggestions: ranked.slice(0, lim).map((r) => r.entry) };
  if (opponentMoveSan) result.opponent_move = opponentMoveSan;
  return result;
}

// --- suggest_replacement_line (pivot resolution + engine + structure) ---

export interface SuggestReplacementOptions {
  mode?: "structural_fit" | "low_memorization" | "solid";
  depth?: number;
}

export async function suggestReplacementLine(
  tree: GameTree,
  color: Color,
  outlierVariationPath: string[],
  opts: SuggestReplacementOptions,
  analyse: Analyse,
): Promise<Record<string, unknown>> {
  const m = opts.mode ?? "structural_fit";
  const piv = replacementPivot(tree, color, outlierVariationPath);
  if ("error" in piv) {
    const reason =
      piv.error === "no_user_move"
        ? "outlier_variation_path contains no user move to replace"
        : "outlier_variation_path does not match a line in the repertoire";
    return { error: piv.error, reason };
  }

  const profile = buildFitProfile(tree.leafPositions().map((p) => p.board), color);
  const res = await analyse(piv.pivotBeforeFen, 5, opts.depth ?? 16);
  if (!res) return { error: "engine_unavailable" };
  const moverIsWhite = piv.pivotBeforeFen.split(" ")[1] === "w";
  const moverCp = (l: EngineLine) => moverPov(l, moverIsWhite, 10000);
  const best = res.length ? moverCp(res[0]!) : 0;

  const suggestions: { entry: Record<string, unknown>; mcp: number }[] = [];
  for (const l of res) {
    if (l.uci === piv.outlierUci) continue;
    const mcp = moverCp(l);
    if (best - mcp > 100) continue;
    const after = chessFromFen(piv.pivotBeforeFen);
    after.play(parseUci(l.uci)!);
    const resultStruct = classifyStructure(after.board).structure_class;
    // Blended structural fit (named structure + center + themes) — robust when resultStruct is
    // "unknown", so the hand-rolled PV-theme fallback this replaced is no longer needed.
    const match = fitScore(profile, after.board, color);

    suggestions.push({
      entry: {
        pivot_move: moveSan(piv.pivotBeforeFen, l.uci),
        line: pvSan(piv.pivotBeforeFen, l.pv),
        eval_cp: evalWhite(l),
        resulting_structure: resultStruct,
        profile_match: match,
      },
      mcp,
    });
  }

  if (m === "solid") suggestions.sort((a, b) => b.mcp - a.mcp);
  else suggestions.sort((a, b) => (b.entry.profile_match as number) - (a.entry.profile_match as number) || b.mcp - a.mcp);

  return {
    outlier_move: moveSan(piv.pivotBeforeFen, piv.outlierUci),
    anchored_to: piv.anchoredTo,
    // SAN path up to and including the move being replaced — the UI strips the last entry to get
    // the anchor position (pivotBeforeFen) for staging a replacement preview.
    pivot_path: piv.pivotPath,
    suggestions: suggestions.map((s) => s.entry),
  };
}
