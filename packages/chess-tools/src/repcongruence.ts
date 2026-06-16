/**
 * analyze_repertoire_congruence (port of repertoire.analyze_congruence). Engine-free. Clusters
 * leaves by opening SYSTEM (move-order-robust) and judges each leaf only against its own
 * system's siblings, flagging structure_outlier / weakness_inconsistency / center_inconsistency.
 */
import { GameTree } from "./pgn.js";
import { positionKey, type Color } from "./congruence.js";
import { type Severity, SEVERITY_RANK } from "./gaps.js";
import { themes, classifyStructure, isolatedPawns, doubledPawns, centerState } from "./structure.js";
import { identifyDeepestFromMoves, type OpeningTable } from "./openings.js";
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

function clusterLabel(table: OpeningTable, sans: string[], sc: string, themeTags: Set<string>): string {
  const op = identifyDeepestFromMoves(table, sans);
  if (op) return op.name.split(":")[0]!.trim();
  if (sc !== "unknown") return `structure:${sc}`;
  for (const theme of BOOL_THEMES) if (themeTags.has(theme)) return `theme:${theme}`;
  return sans.length ? `first-move:${sans[0]}` : "first-move:";
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

  const data: LeafData[] = [];
  for (const { path, pos } of tree.leaves()) {
    if (excl.length && pathPrefix(path, excl)) continue;
    const board = pos.board;
    const t = themes(board, color);
    const sc = classifyStructure(board).structure_class;
    const themeTags = new Set(BOOL_THEMES.filter((k) => t[k]));
    data.push({
      path,
      posKey: positionKey(makeFen(pos.toSetup())),
      structure: sc,
      cluster: clusterLabel(table, path, sc, themeTags),
      isolated: isolatedPawns(board, color),
      doubled: doubledPawns(board, color),
      center: centerState(board),
      themeTags,
    });
  }
  const n = data.length;
  const transpositionKeys = new Set(tree.moveMap().keys());

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
  for (const d of data) (groups.get(d.cluster) ?? groups.set(d.cluster, []).get(d.cluster)!).push(d);
  const incongruencies: Flag[] = [];
  for (const [label, group] of groups) for (const flag of checksFor(group)) incongruencies.push({ ...flag, cluster: label });

  const floor = SEVERITY_RANK[minSeverity];
  const filtered = incongruencies
    .filter((x) => SEVERITY_RANK[x.severity] >= floor)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const acknowledgedCount = filtered.filter((x) => x.acknowledged).length;
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
