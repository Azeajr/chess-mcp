/**
 * On-demand repertoire gap scan — a thin wrapper over the shared chess-tools
 * `findRepertoireGaps` (R7: the scan loop used to be a hand-maintained fork for progress +
 * cancel; the shared implementation now takes onProgress/shouldCancel, so severity math and
 * covered-by-transposition semantics have a single owner). This store only adapts the result
 * to UI shapes and runs the per-gap fill suggestions.
 *
 * Engine-heavy, so it runs only when the user clicks Scan, is cancellable, and reports progress.
 */
import { createSignal } from "solid-js";
import {
  findRepertoireGaps,
  suggestComplementaryLines,
  medianLineLength,
  buildFitProfile,
  fitScore,
  type FitProfile,
  type Severity,
  type Path,
} from "@chess-mcp/chess-tools";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseSan, makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { currentTree, color } from "./game";
import { analyseMulti } from "../engine/stockfish";

export interface Gap {
  path: Path;
  uncoveredMove: string;
  /** white-POV cp after the move (null if mate). */
  evalCp: number | null;
  mate: number | null;
  severity: Severity;
}
export interface CoveredGap {
  path: Path;
  uncoveredMove: string;
  /** the prepared line this reply transposes into (shallowest SAN path). */
  joinsPath: string[];
}

const MAX_POSITIONS = 12; // decision points scanned (shallowest first)
const SCAN_DEPTH = 12; // shallower than the live bar — a full scan trades depth for time
const MIN_SEVERITY: Severity = "medium";
const LIMIT = 12;

const [gaps, setGaps] = createSignal<Gap[]>([]);
const [covered, setCovered] = createSignal<CoveredGap[]>([]);
const [scanning, setScanning] = createSignal(false);
const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
const [scanError, setScanError] = createSignal<string | null>(null);

export { gaps, covered, scanning, progress, scanError };

// --- per-gap fill suggestions (on-demand: best-eval + best-fit reply to the uncovered move) ---

const FILL_DEPTH = 16; // suggestComplementaryLines' own default; deeper than the scan — picked once per gap
const FILL_LIMIT = 4; // candidate replies; each gets a deep line built + scored, so keep it small
const TAIL_DEPTH = 14; // base depth per search in the engine-best continuation past the reply
const MAX_TAIL_DEPTH = 18; // cap per-search depth; the tail ITERATES to reach length (cheaper than going very deep)
const PROBE_PLIES = 10; // short line used only to rank candidates by fit before deep-building the two shown
const FALLBACK_PLIES = 10; // if the repertoire has no genuine lines yet, still build a real line

/** One suggested reply + the full line it stages (SAN, from the gap node). */
export interface FillOption {
  reply: string;
  /** the complete staged SAN line from the gap node: [uncoveredMove, reply, …engine tail]. */
  line: string[];
  /** mover-POV cp after the reply (null if mate). */
  evalCp: number | null;
  /** structural fit with the repertoire (blended structure+center+themes profile, 0..1). */
  fit: number;
}
export interface GapFill {
  bestEval: FillOption;
  /** null when the best-fit reply is the same move as best-eval (deduped → single badge). */
  bestFit: FillOption | null;
}
type FillState = "loading" | { error: string } | GapFill;

/** Stable identity for a gap row (path + the specific uncovered move). */
export function gapKey(g: Gap): string {
  return `${g.path.join(",")}|${g.uncoveredMove}`;
}

const [fills, setFills] = createSignal<Record<string, FillState>>({});
export { fills };

// Generation token bumped ONLY on rescan, so a fill in flight from a previous scan is discarded.
// It is NOT bumped per click — multiple gaps fill concurrently, each updating its own row.
let fillGen = 0;

interface RawSuggestion {
  move: string;
  eval: number;
  profile_match?: number;
  pv: string;
}

/** Engine-best continuation (SAN) from `fen`, up to `maxPlies` — one search, reads its full PV. */
async function engineTail(fen: string, maxPlies: number): Promise<string[]> {
  const out: string[] = [];
  if (maxPlies <= 0) return out;
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  let cur = fen;
  // Stockfish truncates its PV below the nominal depth, so one search can't guarantee the length.
  // Iterate: walk the PV, and when it runs out before the target, re-search from where it ended and
  // continue. Depth tracks the remaining need (capped) — iterating shallow beats one very deep search.
  for (let guard = 0; out.length < maxPlies && guard < 6; guard++) {
    const need = maxPlies - out.length;
    const depth = Math.min(MAX_TAIL_DEPTH, Math.max(TAIL_DEPTH, need + 2));
    const res = await analyseMulti(cur, 1, depth);
    if (!res || !res.length) break;
    let advanced = 0;
    for (const uci of res[0]!.pv ?? []) {
      if (out.length >= maxPlies) break;
      const mv = parseUci(uci);
      if (!mv) break;
      out.push(makeSan(pos, mv));
      pos.play(mv);
      advanced++;
    }
    if (advanced === 0) break; // no legal continuation (mate/stalemate) — can't extend further
    cur = makeFen(pos.toSetup());
  }
  return out;
}

/** Full staged line from the gap node: [uncoveredMove, reply, …engine tail], capped to `toAdd` plies. */
async function buildFillLine(anchorFen: string, uncoveredMove: string, replySan: string, toAdd: number): Promise<string[]> {
  const pos = Chess.fromSetup(parseFen(anchorFen).unwrap()).unwrap();
  const mv = parseSan(pos, replySan);
  if (!mv) return [uncoveredMove, replySan];
  pos.play(mv);
  const tail = await engineTail(makeFen(pos.toSetup()), toAdd - 2); // −2: uncoveredMove + reply
  const line = [uncoveredMove, replySan, ...tail].slice(0, Math.max(2, toAdd));
  // End on the user's move: index 0 is the opponent's uncovered move, so the user's moves sit at odd
  // indices → an even length ends on a user move. Drop a trailing opponent move (color-agnostic).
  if (line.length % 2 === 1) line.pop();
  return line;
}

/**
 * Structural fit of a line with the repertoire: the MEAN blended fit (named structure + center +
 * themes) across every position the line passes through, not just its endpoint. Whole-line scoring
 * rewards a continuation that stays in familiar structures the whole way, and is robust to a single
 * outlier endpoint. The blend keeps fit from collapsing to 0 the way a lone named-structure match did.
 */
function lineFit(startFen: string, sans: string[], profile: FitProfile, col: "white" | "black"): number {
  const pos = Chess.fromSetup(parseFen(startFen).unwrap()).unwrap();
  let sum = 0;
  let n = 0;
  for (const san of sans) {
    const mv = parseSan(pos, san);
    if (!mv) break;
    pos.play(mv);
    sum += fitScore(profile, pos.board, col);
    n++;
  }
  return n ? Math.round((sum / n) * 100) / 100 : 0;
}

/**
 * Suggest a line that fills `g`. Anchor is the position AFTER the gap's specific uncovered move (not
 * the decision-node FEN — that would suggest a reply to the engine's best opponent move instead).
 * Returns the user's best-eval and best-fit replies, deduped.
 */
export async function fillGap(g: Gap) {
  const key = gapKey(g);
  if (fills()[key] === "loading") return;
  const gen = fillGen; // capture (do NOT bump) — only a rescan invalidates this fill
  setFills((p) => ({ ...p, [key]: "loading" }));

  const tree = currentTree();
  const col = color();
  // anchor = play the uncovered (opponent) move, then it's the user's turn
  const startFen = tree.fenAt(g.path);
  const pos = Chess.fromSetup(parseFen(startFen).unwrap()).unwrap();
  const mv = parseSan(pos, g.uncoveredMove);
  if (!mv) {
    setFills((p) => ({ ...p, [key]: { error: "could not replay the uncovered move" } }));
    return;
  }
  pos.play(mv);
  const anchorFen = makeFen(pos.toSetup());

  try {
    const res = (await suggestComplementaryLines(
      tree,
      col,
      anchorFen,
      { mode: "low_memorization", limit: FILL_LIMIT, depth: FILL_DEPTH },
      (f, mpv, d) => analyseMulti(f, mpv, d ?? FILL_DEPTH),
    )) as { suggestions?: RawSuggestion[]; error?: string };
    if (gen !== fillGen) return; // superseded by a rescan
    if (res.error) {
      setFills((p) => ({ ...p, [key]: { error: res.error === "engine_unavailable" ? "engine offline" : res.error! } }));
      return;
    }
    const sugg = res.suggestions ?? [];
    if (!sugg.length) {
      setFills((p) => ({ ...p, [key]: { error: "no fill found" } }));
      return;
    }
    const moverEval = (s: RawSuggestion) => (col === "white" ? 1 : -1) * s.eval;
    // Length: total line ≈ the repertoire's typical (filtered-median) depth, so the filled line is as
    // deep as the rest. toAdd is the plies appended FROM the gap; ≥2 so the gap is always closed.
    const target = medianLineLength(tree) || FALLBACK_PLIES;
    const toAdd = Math.max(2, target - g.path.length);
    const profile = buildFitProfile(
      tree.leafPositions().map((p) => p.board),
      col,
    );

    // Rank cheaply: score each candidate's fit on a SHORT probe line (one shallow search), so we only
    // pay for the full median-deep line on the two we actually show.
    const probed: { s: RawSuggestion; fit: number }[] = [];
    for (const s of sugg) {
      const probe = await buildFillLine(anchorFen, g.uncoveredMove, s.move, Math.min(toAdd, PROBE_PLIES));
      if (gen !== fillGen) return; // superseded during the probe searches
      probed.push({ s, fit: lineFit(startFen, probe, profile, col) });
    }
    const ev = (p: { s: RawSuggestion }) => moverEval(p.s);
    const evalPick = [...probed].sort((a, b) => ev(b) - ev(a) || b.fit - a.fit)[0]!;
    const restP = probed.filter((p) => p.s.move !== evalPick.s.move);
    const fitPick = restP.length ? [...restP].sort((a, b) => b.fit - a.fit || ev(b) - ev(a))[0]! : null;

    // Deep-build (iterative, to the median length) only the two shown; rescore fit at the real endpoint.
    const mkOption = async (s: RawSuggestion): Promise<FillOption> => {
      const line = await buildFillLine(anchorFen, g.uncoveredMove, s.move, toAdd);
      return { reply: s.move, line, evalCp: moverEval(s), fit: lineFit(startFen, line, profile, col) };
    };
    const bestEval = await mkOption(evalPick.s);
    if (gen !== fillGen) return;
    const bestFit = fitPick ? await mkOption(fitPick.s) : null;
    if (gen !== fillGen) return;
    setFills((p) => ({ ...p, [key]: { bestEval, bestFit } }));
  } catch (e) {
    if (gen !== fillGen) return;
    setFills((p) => ({ ...p, [key]: { error: e instanceof Error ? e.message : String(e) } }));
  }
}

let cancelToken = 0;

export function cancelScan() {
  cancelToken++;
  setScanning(false);
  setProgress(null);
}

export async function scanGaps() {
  const token = ++cancelToken;
  const tree = currentTree();
  const col = color();

  setScanError(null);
  setGaps([]);
  setCovered([]);
  setFills({});
  fillGen++; // discard any in-flight fill from the previous scan
  setScanning(true);
  setProgress({ done: 0, total: 0 });

  const res = await findRepertoireGaps(
    tree,
    col,
    {
      depth: SCAN_DEPTH,
      minSeverity: MIN_SEVERITY,
      maxPositions: MAX_POSITIONS,
      limit: LIMIT,
      onProgress: (done, total) => {
        if (token === cancelToken) setProgress({ done, total });
      },
      shouldCancel: () => token !== cancelToken,
    },
    analyseMulti,
  );
  if (token !== cancelToken || "cancelled" in res) return; // cancelled / superseded
  if ("error" in res) {
    setScanError("engine offline");
    setScanning(false);
    setProgress(null);
    return;
  }

  setGaps(
    res.gaps.map((g) => ({ path: g.path, uncoveredMove: g.uncovered_move, evalCp: g.eval, mate: g.mate, severity: g.severity })),
  );
  setCovered(
    res.covered_by_transposition.map((c) => ({ path: c.path, uncoveredMove: c.uncovered_move, joinsPath: c.joins_path })),
  );
  setScanning(false);
  setProgress(null);
}
