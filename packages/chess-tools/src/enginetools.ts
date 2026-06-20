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
import { makeSan } from "chessops/san";
import { GameTree, type Path, buildKeyIndex, landsInCrossBranchPrep } from "./pgn.js";
import { type Color } from "./congruence.js";
import { mainline, classifyCpLoss, type MoveClass } from "./game.js";
import { decisionNodes, gapSeverity, SEVERITY_RANK, moveSan, type Severity } from "./gaps.js";
import { validateLine } from "./validate.js";
import { replacementPivot } from "./repcongruence.js";
import {
  profileStructureShares,
  classifyStructure,
  isolatedPawns,
  doubledPawns,
  passedPawns,
  themes,
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
const evalWhite = (l: { cp: number | null; mate: number | null }) =>
  l.mate !== null ? (l.mate > 0 ? 10000 : -10000) : (l.cp ?? 0);
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
    const l = res?.[0];
    if (!l) return null;
    const whiteCp = l.mate !== null ? (l.mate > 0 ? MATE_CP : -MATE_CP) : (l.cp ?? 0);
    evals.push({ whiteCp, bestUci: l.uci });
  }

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
    const moverCp = (l: EngineLine) => {
      const w = l.mate !== null ? (l.mate > 0 ? MATE_CP : -MATE_CP) : (l.cp ?? 0);
      return moverIsWhite ? w : -w;
    };
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
    const moverCp = (l: EngineLine) => {
      const w = l.mate !== null ? (l.mate > 0 ? MATE_CP : -MATE_CP) : (l.cp ?? 0);
      return moverIsWhite ? w : -w;
    };
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
    const line = res?.[0];
    if (!line) {
      out.push({ san: chk.canonical[0], error: "engine_unavailable" });
      continue;
    }
    const whiteCp = line.mate !== null ? (line.mate > 0 ? MATE_CP : -MATE_CP) : (line.cp ?? 0);
    out.push({ san: chk.canonical[0], uci: chk.firstUci, eval_cp: line.cp, mate: line.mate, mover_cp: moverIsWhite ? whiteCp : -whiteCp });
  }
  out.sort((a, b) => ((b.mover_cp as number) ?? -Infinity) - ((a.mover_cp as number) ?? -Infinity));
  out.forEach((o, i) => (o.rank = i + 1));
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
  const moverCp = (l: EngineLine) => (moverIsWhite ? 1 : -1) * evalWhite(l);

  const res = await analyse(anchorFen, pool, opts.depth ?? 16);
  if (!res) return { error: "engine_unavailable" };
  const best = res.length ? moverCp(res[0]!) : 0;
  const shares = profileStructureShares(tree.leafPositions().map((p) => p.board));

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
      entry.profile_match = Math.round((resultStruct === "unknown" ? 0 : (shares[resultStruct] ?? 0)) * 100) / 100;
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

const BOOL_THEMES = ["fianchetto_white", "fianchetto_black", "minority_attack_white", "minority_attack_black", "flank_vs_center"] as const;
const PV_THEME_WINDOW = 8;

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

  const shares = profileStructureShares(tree.leafPositions().map((p) => p.board));
  const res = await analyse(piv.pivotBeforeFen, 5, opts.depth ?? 16);
  if (!res) return { error: "engine_unavailable" };
  const moverIsWhite = piv.pivotBeforeFen.split(" ")[1] === "w";
  const moverCp = (l: EngineLine) => (moverIsWhite ? 1 : -1) * evalWhite(l);
  const best = res.length ? moverCp(res[0]!) : 0;
  const domSet = new Set(piv.dominantThemes);

  const suggestions: { entry: Record<string, unknown>; mcp: number }[] = [];
  for (const l of res) {
    if (l.uci === piv.outlierUci) continue;
    const mcp = moverCp(l);
    if (best - mcp > 100) continue;
    const after = chessFromFen(piv.pivotBeforeFen);
    after.play(parseUci(l.uci)!);
    const resultStruct = classifyStructure(after.board).structure_class;

    let match = 0;
    if (resultStruct !== "unknown") match = shares[resultStruct] ?? 0;
    else if (domSet.size) {
      const walk = chessFromFen(makeFen(after.toSetup()));
      let bestMatch = 0;
      const seq: (string | null)[] = [...l.pv.slice(1, PV_THEME_WINDOW), null];
      for (const nxt of seq) {
        const t = themes(walk.board, color);
        const tags = BOOL_THEMES.filter((k) => t[k]);
        const plyMatch = [...domSet].filter((d) => tags.includes(d as (typeof BOOL_THEMES)[number])).length / domSet.size;
        if (plyMatch > bestMatch) bestMatch = plyMatch;
        if (bestMatch === 1 || nxt === null) break;
        const mv = parseUci(nxt);
        if (!mv) break;
        walk.play(mv);
      }
      match = bestMatch;
    }

    suggestions.push({
      entry: {
        pivot_move: moveSan(piv.pivotBeforeFen, l.uci),
        line: pvSan(piv.pivotBeforeFen, l.pv),
        eval_cp: evalWhite(l),
        resulting_structure: resultStruct,
        profile_match: Math.round(match * 100) / 100,
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
