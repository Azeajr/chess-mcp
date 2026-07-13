/**
 * analyze_repertoire_congruence (port of repertoire.analyze_congruence). Engine-free. Clusters
 * leaves by opening SYSTEM (move-order-robust) and judges each leaf only against its own
 * system's siblings, flagging structure_outlier / weakness_inconsistency / center_inconsistency.
 */
import { GameTree } from "./pgn.js";
import { positionKey, type Color } from "./congruence.js";
import { type Severity, SEVERITY_RANK } from "./gaps.js";
import { themes, classifyStructure, isolatedPawns, doubledPawns, centerState } from "./structure.js";
import { type OpeningTable } from "./openings.js";
import { Chess } from "chessops/chess";
import type { Node, PgnNodeData } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { makeFen } from "chessops/fen";

const BOOL_THEMES = ["fianchetto_white", "fianchetto_black", "minority_attack_white", "minority_attack_black", "flank_vs_center"] as const;
const THEME_DOMINANCE = 0.66; // a theme is the grain only when a strong majority share it

interface LeafData {
  path: string[];
  posKey: string;
  structure: string;
  cluster: string;
  isolated: string[];
  doubled: string[];
  center: string;
  themeTags: Set<string>;
}

interface Flag {
  type: "structure_outlier" | "weakness_inconsistency" | "center_inconsistency";
  severity: Severity;
  description: string;
  paths: string[][];
  cluster?: string;
  acknowledged?: boolean;
  source?: string;
}

const pathPrefix = (path: string[], excl: string[][]) =>
  excl.some((e) => e.length <= path.length && e.every((s, i) => path[i] === s));

const pathEq = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);

// ecoName = the deepest ECO opening name along the line (computed incrementally during the tree
// walk, not re-replayed per leaf). null → fall back to structure / theme / first move.
function clusterLabel(ecoName: string | null, sc: string, themeTags: Set<string>, firstSan: string | undefined): string {
  if (ecoName) return ecoName.split(":")[0]!.trim();
  if (sc !== "unknown") return `structure:${sc}`;
  for (const theme of BOOL_THEMES) if (themeTags.has(theme)) return `theme:${theme}`;
  return firstSan ? `first-move:${firstSan}` : "first-move:";
}

// --- replacement-pivot resolution (suggest_replacement_line, port of replacement_pivot) ---

export interface PivotResult {
  pivotPath: string[];
  /** FEN of the position the pivot move is played from (the engine search anchor). */
  pivotBeforeFen: string;
  /** UCI of the user move being replaced. */
  outlierUci: string;
  /** SAN of the opponent move that led to the pivot position, or null. */
  anchoredTo: string | null;
  dominantThemes: string[];
}
export type PivotError = { error: "variation_not_found" | "no_user_move" };

interface UserMove {
  beforeKey: string;
  beforeFen: string;
  uci: string;
  afterBoard: Chess["board"];
  index: number;
}

/** The user moves along a SAN path, with the position before each (null if the path is illegal). */
function userMovesAlong(color: Color, sanPath: readonly string[]): UserMove[] | null {
  const pos = Chess.default();
  const out: UserMove[] = [];
  for (let i = 0; i < sanPath.length; i++) {
    const turn = pos.turn;
    const beforeFen = makeFen(pos.toSetup());
    const move = parseSan(pos, sanPath[i]!);
    if (!move) return null;
    const uci = makeUci(move);
    pos.play(move);
    if (turn === color) out.push({ beforeKey: positionKey(beforeFen), beforeFen, uci, afterBoard: pos.clone().board, index: i });
  }
  return out;
}

/**
 * The user move suggest_replacement_line should replace, plus the repertoire's dominant themes.
 * Pivot order: (1) earliest user move not played in any dominant-theme line; (2) else the first
 * user move that incurs a doubled/isolated pawn; (3) else the last user move.
 */
export function replacementPivot(tree: GameTree, color: Color, outlierPath: readonly string[]): PivotResult | PivotError {
  if (tree.positionAtSanPath(outlierPath) === null) return { error: "variation_not_found" };
  const leaves = tree.leaves();
  const tagsByLeaf = leaves.map(({ pos }) => new Set<string>(BOOL_THEMES.filter((t) => themes(pos.board, color)[t])));
  const themeCounts = new Map<string, number>();
  for (const tags of tagsByLeaf) for (const t of tags) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
  const dominantThemes = new Set([...themeCounts.entries()].filter(([, c]) => c / leaves.length >= THEME_DOMINANCE).map(([t]) => t));

  const dominantPairs = new Set<string>();
  leaves.forEach(({ path }, idx) => {
    if (![...dominantThemes].some((t) => tagsByLeaf[idx]!.has(t))) return;
    const um = userMovesAlong(color, path);
    if (um) for (const u of um) dominantPairs.add(`${u.beforeKey}|${u.uci}`);
  });

  const userMoves = userMovesAlong(color, outlierPath);
  if (!userMoves) return { error: "variation_not_found" };
  if (!userMoves.length) return { error: "no_user_move" };

  let pivot: UserMove | undefined;
  if (dominantPairs.size) pivot = userMoves.find((u) => !dominantPairs.has(`${u.beforeKey}|${u.uci}`));
  if (!pivot) pivot = userMoves.find((u) => doubledPawns(u.afterBoard, color).length || isolatedPawns(u.afterBoard, color).length);
  if (!pivot) pivot = userMoves[userMoves.length - 1]!;

  return {
    pivotPath: outlierPath.slice(0, pivot.index + 1),
    pivotBeforeFen: pivot.beforeFen,
    outlierUci: pivot.uci,
    anchoredTo: pivot.index >= 1 ? outlierPath[pivot.index - 1]! : null,
    dominantThemes: [...dominantThemes],
  };
}

export interface CongruenceOptions {
  minSeverity?: Severity;
  limit?: number;
  acknowledgedWeaknesses?: string[][];
  excludePaths?: string[][];
}

export function analyzeCongruence(tree: GameTree, color: Color, table: OpeningTable, opts: CongruenceOptions = {}) {
  const minSeverity = opts.minSeverity ?? "medium";
  const limit = opts.limit ?? 10;
  const ackSet = opts.acknowledgedWeaknesses ?? [];
  const excl = opts.excludePaths ?? [];

  // One DFS carrying the position, the running deepest-ECO name, and each node's already-computed
  // key. Replaces a per-leaf identifyDeepestFromMoves (which re-replayed the whole line → O(leaves·d))
  // and a separate tree.moveMap() walk for the interior keys → both fold into this single O(nodes) pass.
  const data: LeafData[] = [];
  const transpositionKeys = new Set<string>(); // interior position keys (positions with a continuation)
  const dfs = (node: Node<PgnNodeData>, pos: Chess, sanPath: string[], ecoName: string | null, selfKey: string) => {
    if (node.children.length) {
      transpositionKeys.add(selfKey);
      for (const child of node.children) {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) continue;
        next.play(move);
        const childKey = positionKey(makeFen(next.toSetup()));
        const hit = table.get(childKey);
        dfs(child, next, [...sanPath, child.data.san], hit ? hit.name : ecoName, childKey);
      }
      return;
    }
    if (excl.length && pathPrefix(sanPath, excl)) return; // excluded leaf
    const board = pos.board;
    const t = themes(board, color);
    const sc = classifyStructure(board).structure_class;
    const themeTags = new Set(BOOL_THEMES.filter((k) => t[k]));
    data.push({
      path: sanPath,
      posKey: selfKey,
      structure: sc,
      cluster: clusterLabel(ecoName, sc, themeTags, sanPath[0]),
      isolated: isolatedPawns(board, color),
      doubled: doubledPawns(board, color),
      center: centerState(board),
      themeTags,
    });
  };
  const start = Chess.default();
  dfs(tree.game.moves, start, [], null, positionKey(makeFen(start.toSetup())));
  const n = data.length;

  const checksFor = (group: LeafData[]): Flag[] => {
    const gn = group.length;
    const found: Flag[] = [];

    // 1. structure_outlier
    const known = group.filter((d) => d.structure !== "unknown");
    if (known.length / gn >= 0.5) {
      const counts = new Map<string, number>();
      for (const d of known) counts.set(d.structure, (counts.get(d.structure) ?? 0) + 1);
      const [dominant, domCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
      if (domCount / known.length >= 0.5) {
        for (const d of known) {
          if (d.structure === dominant) continue;
          found.push({
            type: "structure_outlier",
            severity: domCount / known.length > 0.8 ? "high" : "medium",
            description: `Most lines reach a ${dominant} structure; this line reaches ${d.structure} — a separate middlegame plan to learn.`,
            paths: [d.path],
          });
        }
      }
    } else {
      const themeCounts = new Map<string, number>();
      for (const d of group) for (const theme of d.themeTags) themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
      const dominantCandidates = [...themeCounts.entries()].filter(([, c]) => c / gn >= THEME_DOMINANCE);
      if (dominantCandidates.length) {
        const [dominantTheme] = dominantCandidates.sort((a, b) => b[1] - a[1])[0]!;
        const domShare = themeCounts.get(dominantTheme)! / gn;
        for (const d of group) {
          if (d.themeTags.has(dominantTheme)) continue;
          if (transpositionKeys.has(d.posKey)) continue; // covered via a longer move order
          found.push({
            type: "structure_outlier",
            severity: domShare > 0.8 ? "high" : "medium",
            description: `Most lines share the '${dominantTheme}' theme; this line lacks it — a structural inconsistency in the repertoire's DNA.`,
            paths: [d.path],
            source: "theme",
          });
        }
      }
    }

    // 2. weakness_inconsistency
    const weak = group.filter((d) => d.isolated.length || d.doubled.length);
    if (weak.length && weak.length < gn * 0.5) {
      for (const d of weak) {
        const kinds = [d.doubled.length ? "doubled" : null, d.isolated.length ? "isolated" : null].filter(Boolean);
        const acknowledged = ackSet.some((p) => pathEq(p, d.path));
        const flag: Flag = {
          type: "weakness_inconsistency",
          severity: acknowledged ? "low" : "medium",
          description: `Most lines keep a sound pawn structure, but here you accept ${kinds.join("/")} pawns — inconsistent structural comfort.`,
          paths: [d.path],
        };
        if (acknowledged) flag.acknowledged = true;
        found.push(flag);
      }
    }

    // 3. center_inconsistency
    const locked = group.filter((d) => d.center === "locked").length;
    const opened = group.filter((d) => d.center === "open").length;
    if (locked / gn >= 0.25 && opened / gn >= 0.25) {
      const examples = [
        ...group.filter((d) => d.center === "locked").slice(0, 2).map((d) => d.path),
        ...group.filter((d) => d.center === "open").slice(0, 2).map((d) => d.path),
      ];
      found.push({
        type: "center_inconsistency",
        severity: "low",
        description: `Center handling is split: ${locked} line(s) lock the center, ${opened} open it — differing strategic commitments.`,
        paths: examples,
      });
    }
    return found;
  };

  const groups = new Map<string, LeafData[]>();
  for (const d of data) {
    let g = groups.get(d.cluster);
    if (!g) groups.set(d.cluster, (g = []));
    g.push(d);
  }
  const incongruencies: Flag[] = [];
  for (const [label, group] of groups) for (const flag of checksFor(group)) incongruencies.push({ ...flag, cluster: label });

  const floor = SEVERITY_RANK[minSeverity];
  // Count acknowledged flags BEFORE the severity filter: acknowledging downgrades a flag to "low",
  // which the default min_severity ("medium") then drops — counting after the filter reported 0
  // exactly when the acknowledgement worked, hiding the "N flags suppressed" signal.
  const acknowledgedCount = incongruencies.filter((x) => x.acknowledged).length;
  const filtered = incongruencies
    .filter((x) => SEVERITY_RANK[x.severity] >= floor)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const unacknowledged = filtered.filter((x) => !x.acknowledged);
  const byType: Record<string, number> = {};
  for (const x of unacknowledged) byType[x.type] = (byType[x.type] ?? 0) + 1;
  const clusters = Object.fromEntries(
    [...groups.entries()].map(([label, g]) => [label, g.length] as const).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );

  return {
    total_flagged: unacknowledged.length,
    acknowledged_count: acknowledgedCount,
    leaves_analyzed: n,
    clusters,
    by_type: byType,
    incongruencies: filtered.slice(0, limit),
  };
}
