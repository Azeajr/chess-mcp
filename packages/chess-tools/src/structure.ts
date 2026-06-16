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
import { squareFile, squareRank, makeSquare, parseSquare } from "chessops/util";
import { parseFen } from "chessops/fen";
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

// --- named-structure classifier (port of the 19 _*_confidence scorers + classify_structure) ---
const nameSet = (board: Board, color: Color): Set<string> => new Set(pawns(board, color).map(makeSquare));
const fileSet = (board: Board, color: Color): Set<number> => new Set(pawns(board, color).map(squareFile));
const subset = (a: Iterable<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x));
const b2n = (x: boolean): number => (x ? 1 : 0);

/** Core+bonus confidence: core gates (false → 0); each bonus square lifts base toward cap. */
function graded(coreOk: boolean, bonus: number, base: number, cap: number, step = 0.05): number {
  if (!coreOk) return 0;
  return Math.round(Math.min(cap, base + step * bonus) * 100) / 100;
}
const mirrorName = (n: string): string => makeSquare(parseSquare(n)! ^ 56);
/** White-relative names, rank-mirrored for Black so one spec serves both orientations. */
const rel = (color: Color, ...names: string[]): string[] => (color === "white" ? names : names.map(mirrorName));

const BISHOP = (n: string) => parseSquare(n)!;

function iqp(board: Board, color: Color): number {
  const dPawns = pawns(board, color).filter((sq) => squareFile(sq) === 3);
  if (dPawns.length !== 1) return 0;
  const files = fileSet(board, color);
  if (files.has(2) || files.has(4)) return 0;
  if (pawns(board, other(color)).some((sq) => squareFile(sq) === 3)) return 0;
  const r = squareRank(dPawns[0]!);
  if (color === "white") return r === 3 ? 0.9 : r === 4 || r === 5 ? 0.6 : 0;
  return r === 4 ? 0.9 : r === 2 || r === 3 ? 0.6 : 0;
}
function carlsbad(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  const wf = fileSet(board, "white");
  const bf = fileSet(board, "black");
  if (!wn.has("d4") || !bn.has("d5")) return 0;
  if (!wf.has(2) && bf.has(2) && !bf.has(4)) return 0.85;
  if (wf.has(2) && !bf.has(2) && !wf.has(4)) return 0.7;
  return 0;
}
function maroczy(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  if (wn.has("c4") && wn.has("e4") && !fileSet(board, "white").has(3)) return 0.85;
  if (bn.has("c5") && bn.has("e5") && !fileSet(board, "black").has(3)) return 0.7;
  return 0;
}
function french(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  if (subset(["d4", "e5"], wn) && subset(["d5", "e6"], bn)) return 0.85;
  if (subset(["d4", "e3"], wn) && subset(["d5", "e4"], bn)) return 0.6;
  return 0;
}
function stonewall(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  return subset(["d4", "e3", "f4"], wn) || subset(["d5", "e6", "f5"], bn) ? 0.85 : 0;
}
function kid(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  if (subset(["d5", "e4"], wn) && subset(["e5", "d6"], bn)) return graded(true, b2n(wn.has("c4")) + b2n(bn.has("g6")), 0.7, 0.85, 0.075);
  if (subset(["d4", "e5"], bn) && subset(["e4", "d3"], wn)) return graded(true, b2n(bn.has("c5")) + b2n(wn.has("g3")), 0.45, 0.6, 0.075);
  return 0;
}
function benoni(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  if (subset(["d5", "e4"], wn) && subset(["c5", "d6"], bn) && !fileSet(board, "black").has(4)) return 0.85;
  if (subset(["d4", "e5"], bn) && subset(["c4", "d3"], wn) && !fileSet(board, "white").has(4)) return 0.6;
  return 0;
}
function closedSicilian(board: Board, color: Color): number {
  const own = nameSet(board, color);
  const opp = nameSet(board, other(color));
  if (color === "white") return graded(subset(["e4", "f4"], own) && opp.has("c5"), b2n(own.has("d3")) + b2n(opp.has("d6")), 0.6, 0.7);
  return graded(subset(["e5", "f5"], own) && opp.has("c4"), b2n(own.has("d6")) + b2n(opp.has("d3")), 0.5, 0.65);
}
function hangingPawns(board: Board, color: Color): number {
  const files = fileSet(board, color);
  const coreOk = files.has(2) && files.has(3) && !files.has(1) && !files.has(4);
  const half = new Set(halfOpenFiles(board, color));
  return graded(coreOk, b2n(half.has("b")) + b2n(half.has("e")), 0.7, 0.8);
}
function caroKann(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  if (!(subset(["d4", "e5"], wn) && subset(["c6", "d5"], bn))) return 0;
  const bishops = new Set(board.pieces("black", "bishop"));
  const outside = ["f5", "g4", "g6", "h5"].some((n) => bishops.has(BISHOP(n)));
  return graded(true, b2n(bn.has("e6")) + b2n(outside), 0.78, 0.88);
}
function slav(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  if (!(subset(["c4", "d4"], wn) && subset(["c6", "d5"], bn))) return 0;
  const bishops = new Set(board.pieces("black", "bishop"));
  const outside = ["f5", "g4"].some((n) => bishops.has(BISHOP(n)));
  return graded(true, b2n(bn.has("e6")) + b2n(outside), 0.75, 0.85);
}
function grunfeldCenter(board: Board): number {
  const wn = nameSet(board, "white");
  const coreOk = wn.has("c3") && !wn.has("c4") && wn.has("d4") && new Set(halfOpenFiles(board, "white")).has("b");
  return graded(coreOk, b2n(wn.has("e4")), 0.7, 0.82, 0.08);
}
function nimzoGrunfeld(board: Board): number {
  const wn = nameSet(board, "white");
  const coreOk = subset(["c3", "c4", "d4"], wn) && new Set(halfOpenFiles(board, "white")).has("b");
  return graded(coreOk, b2n(wn.has("e3")), 0.8, 0.88);
}
function hedgehog(board: Board, color: Color): number {
  const own = nameSet(board, color);
  const opp = nameSet(board, other(color));
  if (!(subset(rel(color, "c4", "e4"), own) && subset(rel(color, "d6", "e6"), opp))) return 0;
  const bonus = rel(color, "a6", "b6").reduce((a, s) => a + b2n(opp.has(s)), 0);
  return graded(true, bonus, 0.78, 0.9);
}
function najdorf(board: Board, color: Color): number {
  const own = nameSet(board, color);
  const opp = nameSet(board, other(color));
  if (!(subset(rel(color, "e4"), own) && !fileSet(board, color).has(3) && subset(rel(color, "d6", "e5"), opp))) return 0;
  return graded(true, b2n(!fileSet(board, other(color)).has(2)), 0.72, 0.8);
}
function scheveningen(board: Board, color: Color): number {
  const own = nameSet(board, color);
  const opp = nameSet(board, other(color));
  if (!(subset(rel(color, "e4"), own) && !fileSet(board, color).has(3) && subset(rel(color, "d6", "e6"), opp))) return 0;
  return graded(true, b2n(!fileSet(board, other(color)).has(2)), 0.7, 0.78);
}
function symmetricBenoni(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  if (!(subset(["d5", "e4"], wn) && subset(["c5", "d6", "e5"], bn))) return 0;
  return graded(true, b2n(wn.has("c4")), 0.8, 0.88);
}
function lopez(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  if (!(subset(["e4", "d3"], wn) && subset(["e5", "d6"], bn))) return 0;
  return graded(true, b2n(wn.has("c3")), 0.68, 0.78);
}
function benko(board: Board): number {
  const wn = nameSet(board, "white");
  const bn = nameSet(board, "black");
  const half = new Set(halfOpenFiles(board, "black"));
  if (!(wn.has("d5") && subset(["c5", "d6"], bn) && half.has("a") && half.has("b"))) return 0;
  return graded(true, b2n(wn.has("a2")) + b2n(wn.has("b2")), 0.72, 0.82);
}

export function classifyStructure(board: Board): { structure_class: string; confidence: number } {
  const candidates: [string, number][] = [];
  for (const color of ["white", "black"] as const) {
    for (const [name, conf] of [
      ["IQP", iqp(board, color)],
      ["Closed Sicilian", closedSicilian(board, color)],
      ["Hedgehog", hedgehog(board, color)],
      ["Najdorf", najdorf(board, color)],
      ["Scheveningen", scheveningen(board, color)],
    ] as [string, number][])
      if (conf > 0) candidates.push([name, conf]);
  }
  for (const color of ["white", "black"] as const) {
    const conf = hangingPawns(board, color);
    if (conf > 0) candidates.push(["Hanging pawns", conf]);
  }
  for (const [name, conf] of [
    ["Carlsbad", carlsbad(board)],
    ["Maroczy", maroczy(board)],
    ["French", french(board)],
    ["Stonewall", stonewall(board)],
    ["King's Indian", kid(board)],
    ["Benoni", benoni(board)],
    ["Caro-Kann", caroKann(board)],
    ["Slav", slav(board)],
    ["Grünfeld Centre", grunfeldCenter(board)],
    ["Nimzo-Grünfeld", nimzoGrunfeld(board)],
    ["Symmetric Benoni", symmetricBenoni(board)],
    ["Lopez", lopez(board)],
    ["Benko", benko(board)],
  ] as [string, number][])
    if (conf > 0) candidates.push([name, conf]);

  if (!candidates.length) return { structure_class: "unknown", confidence: 0 };
  const best = candidates.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { structure_class: best[0], confidence: Math.round(best[1] * 100) / 100 };
}

/** Classify the named pawn structure directly from a FEN (chessops stays internal). */
export function classifyStructureFromFen(fen: string): { structure_class: string; confidence: number } {
  return classifyStructure(parseFen(fen).unwrap().board);
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
