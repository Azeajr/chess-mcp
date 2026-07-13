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
import { GameTree, type Path, buildKeyIndex, landsInCrossBranchPrep } from "./pgn.js";
import { type Color } from "./congruence.js";
import { mainline, classifyCpLoss, type MoveClass } from "./game.js";
import { decisionNodes, turnNodes, gapSeverity, SEVERITY_RANK, moveSan, type Severity } from "./gaps.js";
import { validateLine } from "./validate.js";
import { replacementPivot } from "./repcongruence.js";
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

  const evals: { whiteCp: number; bestUci: string }[] = [];
  for (const fen of fens) {
    const res = await analyse(fen, 1, depth);
    if (res === null) return null; // engine genuinely unavailable
    const l = res[0];
    if (!l) {
      // No lines ⇒ a terminal position (no legal moves); the engine returns []. This is only ever the
      // final fenAfter, consumed as an `after` eval (its bestUci is never read). Checkmate ⇒ the side
      // to move is mated (white-POV ∓MATE_CP); stalemate / insufficient material ⇒ a draw (0). Treating
      // [] as engine_unavailable (the old bug) aborted the review of every game ending in mate.
      const pos = chessFromFen(fen);
      evals.push({ whiteCp: pos.isCheckmate() ? (pos.turn === "white" ? -MATE_CP : MATE_CP) : 0, bestUci: "" });
      continue;
    }
    evals.push({ whiteCp: whitePov(l, MATE_CP), bestUci: l.uci });
  }

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
}
export interface Gap {
  path: Path;
  fen: string;
  uncovered_move: string;
  eval: number | null;
  mate: number | null;
  severity: Severity;
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
  const found: Gap[] = [];
  const covered: CoveredGap[] = [];
  for (const node of nodes) {
    const res = await analyse(node.fen, 4, opts.depth ?? 14);
    if (!res) return { error: "engine_unavailable" };
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
      found.push({ path: node.path, fen: node.fen, uncovered_move: san, eval: l.cp, mate: l.mate, severity: gapSeverity(best, moverCp(l)) });
    }
  }
  const gaps = found
    .filter((g) => SEVERITY_RANK[g.severity] >= SEVERITY_RANK[minSev])
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, opts.limit ?? 10);
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
  const findings: AuditFinding[] = [];
  let audited = 0;
  for (const node of nodes) {
    const res = await analyse(node.fen, 2, depth);
    if (res === null) return { error: "engine_unavailable" };
    if (!res.length) continue; // unreachable: the node has a stored child, so a legal move exists
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
        if (r === null) return { error: "engine_unavailable" };
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
  }
  findings.sort((a, b) => b.cp_loss - a.cp_loss);
  return {
    color,
    positions_scanned: nodes.length,
    moves_audited: audited,
    findings: findings.slice(0, opts.limit ?? 10),
  };
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
  const before = await findRepertoireGaps(tree, color, gapsOpts, analyse);
  if ("error" in before) return { error: before.error };
  const after = await findRepertoireGaps(edited.tree, color, gapsOpts, analyse);
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
  const out: Record<string, unknown>[] = [];
  for (const san of moves) {
    const chk = validateLine(fen, [san]);
    if (!chk.ok || !chk.finalFen) {
      out.push({ san, error: "illegal_move" });
      continue;
    }
    const res = await analyse(chk.finalFen, 1, depth);
    if (res === null) {
      out.push({ san: chk.canonical[0], error: "engine_unavailable" });
      continue;
    }
    const line = res[0];
    if (!line) {
      // The move ENDS the game: finalFen is terminal (no legal replies), so the engine returns [] (not
      // null). Distinguishing that from engine-unavailable (null) is the fix — otherwise a mating candidate
      // was reported engine_unavailable (the same class as the analyzeMainline terminal bug). Checkmate ⇒
      // this move wins for the mover (decisive +MATE_CP); stalemate / insufficient material ⇒ a draw (0).
      const moverWins = chessFromFen(chk.finalFen).isCheckmate();
      out.push({ san: chk.canonical[0], uci: chk.firstUci, eval_cp: null, mate: null, mover_cp: moverWins ? MATE_CP : 0 });
      continue;
    }
    out.push({ san: chk.canonical[0], uci: chk.firstUci, eval_cp: line.cp, mate: line.mate, mover_cp: moverPov(line, moverIsWhite, MATE_CP) });
  }
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
