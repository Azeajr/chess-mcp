/**
 * Static pawn-structure analysis (port of structure.py — descriptive layer). Pure chessops
 * bitboard work, no engine. Provides the always-on theme tags, pawn primitives, files, and
 * center state that carry structural signal.
 *
 * NOTE: the 19 named pawn-structure scorers (IQP, Carlsbad, Maroczy, …) are not yet ported, so
 * classify_structure returns "unknown" — by design the themes carry the signal even when the
 * structure class is unknown (Python Decision D2: a wrong label misleads more than "unknown").
 * The named scorers are a later phase.
 */
import { squareFile, squareRank, makeSquare } from "chessops/util";
import type { Board } from "chessops/board";
import type { Color } from "./congruence.js";

const FILE_NAMES = "abcdefgh";
const QUEENSIDE = new Set([0, 1, 2, 3]); // files a–d
const QS_FILES = new Set(["a", "b", "c", "d"]);
const KS_FILES = new Set(["e", "f", "g", "h"]);
const other = (c: Color): Color => (c === "white" ? "black" : "white");
const pawns = (board: Board, color: Color): number[] => [...board.pieces(color, "pawn")];

// --- primitives (square names, sorted) ---
export function doubledPawns(board: Board, color: Color): string[] {
  const ps = pawns(board, color);
  const out: number[] = [];
  for (let f = 0; f < 8; f++) {
    const fp = ps.filter((sq) => squareFile(sq) === f);
    if (fp.length >= 2) out.push(...fp);
  }
  return out.map(makeSquare).sort();
}

export function isolatedPawns(board: Board, color: Color): string[] {
  const ps = pawns(board, color);
  const files = new Set(ps.map(squareFile));
  return ps
    .filter((sq) => !files.has(squareFile(sq) - 1) && !files.has(squareFile(sq) + 1))
    .map(makeSquare)
    .sort();
}

export function passedPawns(board: Board, color: Color): string[] {
  const ps = pawns(board, color);
  const enemy = pawns(board, other(color));
  return ps
    .filter((sq) => {
      const f = squareFile(sq);
      const r = squareRank(sq);
      return !enemy.some((e) => {
        if (Math.abs(squareFile(e) - f) > 1) return false;
        return color === "white" ? squareRank(e) > r : squareRank(e) < r;
      });
    })
    .map(makeSquare)
    .sort();
}

export function pawnChains(board: Board, color: Color): string[][] {
  const ps = pawns(board, color);
  const set = new Set(ps);
  const forward = color === "white" ? 1 : -1;
  const parent = new Map(ps.map((s) => [s, s]));
  const find = (x: number): number => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: number, b: number) => parent.set(find(a), find(b));
  for (const sq of ps) {
    const nr = squareRank(sq) + forward;
    if (nr < 0 || nr > 7) continue;
    for (const nf of [squareFile(sq) - 1, squareFile(sq) + 1]) {
      if (nf >= 0 && nf <= 7 && set.has(nf + nr * 8)) union(sq, nf + nr * 8);
    }
  }
  const groups = new Map<number, number[]>();
  for (const sq of ps) {
    const root = find(sq);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(sq);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => g.map(makeSquare).sort())
    .sort((a, b) => a.join().localeCompare(b.join()));
}

// --- files ---
export function openFiles(board: Board): string[] {
  const wf = new Set(pawns(board, "white").map(squareFile));
  const bf = new Set(pawns(board, "black").map(squareFile));
  return [...Array(8).keys()].filter((f) => !wf.has(f) && !bf.has(f)).map((f) => FILE_NAMES[f]!);
}
export function halfOpenFiles(board: Board, color: Color): string[] {
  const own = new Set(pawns(board, color).map(squareFile));
  const enemy = new Set(pawns(board, other(color)).map(squareFile));
  return [...Array(8).keys()].filter((f) => !own.has(f) && enemy.has(f)).map((f) => FILE_NAMES[f]!);
}

// --- theme helpers ---
function wingCounts(board: Board, color: Color): [number, number] {
  let qs = 0;
  let ks = 0;
  for (const sq of pawns(board, color)) (QUEENSIDE.has(squareFile(sq)) ? qs++ : ks++);
  return [qs, ks];
}
function wingMajority(board: Board, color: Color): "queenside" | "kingside" | null {
  const [oqs, oks] = wingCounts(board, color);
  const [pqs, pks] = wingCounts(board, other(color));
  const qsMaj = oqs > pqs;
  const ksMaj = oks > pks;
  if (qsMaj && !ksMaj) return "queenside";
  if (ksMaj && !qsMaj) return "kingside";
  return null;
}
function minorityAttack(board: Board, color: Color): boolean {
  const [oqs, oks] = wingCounts(board, color);
  const [pqs, pks] = wingCounts(board, other(color));
  const half = new Set(halfOpenFiles(board, color));
  if (oqs < pqs && [...QS_FILES].some((f) => half.has(f))) return true;
  if (oks < pks && [...KS_FILES].some((f) => half.has(f))) return true;
  return false;
}
function colorComplex(board: Board, color: Color): "light" | "dark" | null {
  let light = 0;
  let dark = 0;
  for (const sq of pawns(board, color)) ((squareFile(sq) + squareRank(sq)) % 2 === 0 ? dark++ : light++);
  if (dark - light >= 3) return "light";
  if (light - dark >= 3) return "dark";
  return null;
}

export interface Themes {
  fianchetto_white: boolean;
  fianchetto_black: boolean;
  space_white: number;
  space_black: number;
  wing_majority_white: "queenside" | "kingside" | null;
  wing_majority_black: "queenside" | "kingside" | null;
  minority_attack_white: boolean;
  minority_attack_black: boolean;
  flank_vs_center: boolean;
  color_complex: "light" | "dark" | null;
}

// Square indices: g2=14, b2=9, g7=54, b7=49.
export function themes(board: Board, color: Color): Themes {
  const wb = new Set(board.pieces("white", "bishop"));
  const bb = new Set(board.pieces("black", "bishop"));
  const wCenter = pawns(board, "white").filter((sq) => squareFile(sq) === 3 || squareFile(sq) === 4).length;
  const bCenter = pawns(board, "black").filter((sq) => squareFile(sq) === 3 || squareFile(sq) === 4).length;
  return {
    fianchetto_white: wb.has(14) || wb.has(9),
    fianchetto_black: bb.has(54) || bb.has(49),
    space_white: pawns(board, "white").filter((sq) => squareRank(sq) >= 3 && squareRank(sq) <= 5).length,
    space_black: pawns(board, "black").filter((sq) => squareRank(sq) >= 2 && squareRank(sq) <= 4).length,
    wing_majority_white: wingMajority(board, "white"),
    wing_majority_black: wingMajority(board, "black"),
    minority_attack_white: minorityAttack(board, "white"),
    minority_attack_black: minorityAttack(board, "black"),
    flank_vs_center: (wCenter >= 2 && bCenter === 0) || (bCenter >= 2 && wCenter === 0),
    color_complex: colorComplex(board, color),
  };
}

// --- center state ---
export function centerState(board: Board): "tense" | "locked" | "open" | "semi-open" {
  const white = new Set(pawns(board, "white"));
  const black = new Set(pawns(board, "black"));
  const central = [3, 4];
  const wCentral = [...white].filter((sq) => central.includes(squareFile(sq)));
  const bCentral = [...black].filter((sq) => central.includes(squareFile(sq)));

  for (const sq of wCentral) {
    const f = squareFile(sq);
    const r = squareRank(sq);
    if (r + 1 <= 7) for (const nf of [f - 1, f + 1]) if (nf >= 0 && nf <= 7 && black.has(nf + (r + 1) * 8)) return "tense";
  }
  for (const sq of bCentral) {
    const f = squareFile(sq);
    const r = squareRank(sq);
    if (r - 1 >= 0) for (const nf of [f - 1, f + 1]) if (nf >= 0 && nf <= 7 && white.has(nf + (r - 1) * 8)) return "tense";
  }
  for (const f of central) {
    const wRanks = [...white].filter((sq) => squareFile(sq) === f).map(squareRank);
    const bRanks = [...black].filter((sq) => squareFile(sq) === f).map(squareRank);
    if (wRanks.length && bRanks.length && Math.min(...bRanks) - Math.max(...wRanks) === 1) return "locked";
  }
  if (!wCentral.length || !bCentral.length) return "open";
  return "semi-open";
}

// --- classify (named scorers deferred → unknown) ---
export function classifyStructure(_board: Board): { structure_class: string; confidence: number } {
  return { structure_class: "unknown", confidence: 0 };
}

// --- full profile of one position ---
export function positionProfile(board: Board, color: Color, fen: string) {
  const cls = classifyStructure(board);
  return {
    fen,
    structure_class: cls.structure_class,
    confidence: cls.confidence,
    center: centerState(board),
    primitives: {
      doubled: doubledPawns(board, color),
      isolated: isolatedPawns(board, color),
      passed: passedPawns(board, color),
      chains: pawnChains(board, color),
    },
    half_open_files: halfOpenFiles(board, color),
    open_files: openFiles(board),
    themes: themes(board, color),
  };
}

const BOOL_THEMES = ["fianchetto_white", "fianchetto_black", "minority_attack_white", "minority_attack_black", "flank_vs_center"] as const;

/** Aggregate structural fingerprint over a set of leaf boards (port of aggregate_profile). */
export function aggregateProfile(boards: Board[], color: Color) {
  const n = boards.length;
  const denom = n || 1;
  const structCounts = new Map<string, [number, number]>();
  const openTally = new Map<string, number>();
  const halfTally = new Map<string, number>();
  const centerCounts = new Map<string, number>();
  const themeTally = new Map<string, number>();
  let spaceW = 0;
  let spaceB = 0;
  const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

  for (const board of boards) {
    const cls = classifyStructure(board);
    const agg = structCounts.get(cls.structure_class) ?? [0, 0];
    agg[0]++;
    agg[1] += cls.confidence;
    structCounts.set(cls.structure_class, agg);
    for (const f of openFiles(board)) bump(openTally, f);
    for (const f of halfOpenFiles(board, color)) bump(halfTally, f);
    bump(centerCounts, centerState(board));

    const t = themes(board, color);
    for (const k of BOOL_THEMES) if (t[k]) bump(themeTally, k);
    if (t.fianchetto_white && t.fianchetto_black) bump(themeTally, "double_fianchetto");
    if (t.wing_majority_white) bump(themeTally, `wing_majority_white:${t.wing_majority_white}`);
    if (t.wing_majority_black) bump(themeTally, `wing_majority_black:${t.wing_majority_black}`);
    if (t.color_complex) bump(themeTally, `color_complex:${t.color_complex}`);
    spaceW += t.space_white;
    spaceB += t.space_black;
  }

  const structures = [...structCounts.entries()]
    .map(([structure_class, [count, conf]]) => ({ structure_class, count, avg_confidence: Math.round((conf / count) * 100) / 100 }))
    .sort((a, b) => b.count - a.count || a.structure_class.localeCompare(b.structure_class));
  const themesOut: Record<string, number> = {};
  for (const k of [...themeTally.keys()].sort()) themesOut[k] = themeTally.get(k)!;
  themesOut.avg_space_white = Math.round((spaceW / denom) * 10) / 10;
  themesOut.avg_space_black = Math.round((spaceB / denom) * 10) / 10;

  return {
    leaves_analyzed: n,
    structures,
    themes: themesOut,
    center_distribution: Object.fromEntries(centerCounts),
    common_open_files: [...openTally.entries()].filter(([, c]) => c / denom >= 0.5).map(([f]) => f).sort(),
    common_half_open_files: [...halfTally.entries()].filter(([, c]) => c / denom >= 0.5).map(([f]) => f).sort(),
  };
}
