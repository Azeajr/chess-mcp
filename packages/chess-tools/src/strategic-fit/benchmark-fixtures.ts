/**
 * Task 12.4 — deterministic large-repertoire generators for the performance benchmark.
 *
 * A benchmark needs repertoires far larger than the behavioral fixtures, and a committed multi-
 * megabyte PGN would be an unreviewable blob. These generators produce the same tree byte for byte
 * on every machine and every run, so a recorded benchmark result can name the fixture it measured
 * by digest and two results are only ever compared when they measured the same tree.
 *
 * The generator observes analysis; it never participates in it. Nothing here is reachable from a
 * tool, and the trees it produces are ordinary legal repertoires that the analyzer treats exactly
 * as it treats a loaded PGN.
 */
import { Chess } from "chessops/chess";
import { makeSan } from "chessops/san";
import type { Color } from "chessops/types";

import { GameTree, enumerateLegal, type Path } from "../pgn.js";
import { assertDefined } from "../assert.js";

export interface StrategicFitBenchmarkScale {
  readonly id: string;
  readonly description: string;
  /** Upper bound on generated tree nodes; the tree stops growing the moment it is reached. */
  readonly target_nodes: number;
  /** Deepest generated line in plies, so a scale is bounded in depth as well as in width. */
  readonly maximum_ply: number;
  /** Opponent replies kept at each of their turns; the repertoire side always plays one move. */
  readonly replies: number;
  readonly repertoire_color: Color;
}

function scale(value: StrategicFitBenchmarkScale): StrategicFitBenchmarkScale {
  return Object.freeze({ ...value });
}

/**
 * The gated scales are `small` and `standard`. `large` is defined at the plan's ten-thousand-node
 * size but is opt-in: a complete deterministic scan of that tree costs minutes rather than seconds
 * and does not fit in a default Node heap, which is a measurement worth taking deliberately rather
 * than on every focused verification run.
 */
export const STRATEGIC_FIT_BENCHMARK_SCALES: readonly StrategicFitBenchmarkScale[] = Object.freeze([
  scale({
    id: "small",
    description: "Calibration scale: small enough to time repeatedly on any machine.",
    target_nodes: 250,
    maximum_ply: 12,
    replies: 3,
    repertoire_color: "white",
  }),
  scale({
    id: "standard",
    description: "A thousand-node repertoire — the gated working size.",
    target_nodes: 1_000,
    maximum_ply: 16,
    replies: 3,
    repertoire_color: "white",
  }),
  scale({
    id: "large",
    description: "A ten-thousand-node repertoire; opt-in because one scan costs minutes.",
    target_nodes: 10_000,
    maximum_ply: 24,
    replies: 3,
    repertoire_color: "white",
  }),
]);

export function strategicFitBenchmarkScale(id: string): StrategicFitBenchmarkScale {
  const found = STRATEGIC_FIT_BENCHMARK_SCALES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`strategic_fit_unknown_benchmark_scale:${id}`);
  return found;
}

export interface GeneratedStrategicFitRepertoire {
  readonly scale_id: string;
  readonly repertoire_color: Color;
  readonly pgn: string;
  /** Content digest of `pgn`; a benchmark record names it so incomparable fixtures stay apart. */
  readonly digest: string;
  readonly nodes: number;
  readonly leaves: number;
  readonly max_depth: number;
}

/** FNV-1a over the generated PGN. It identifies a fixture; it is not a security primitive. */
export function strategicFitFixtureDigest(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/** A seeded linear congruential sequence, so move selection is varied but fully reproducible. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

interface LegalReply {
  readonly san: string;
  readonly after: Chess;
}

/** Legal replies in one canonical order, so the generated tree never depends on iteration order. */
function sortedLegal(position: Chess): LegalReply[] {
  return enumerateLegal(position)
    .map(({ move, after }) => ({ san: makeSan(position, move), after }))
    .sort((left, right) => (left.san < right.san ? -1 : left.san > right.san ? 1 : 0));
}

interface Frontier {
  readonly path: Path;
  readonly position: Chess;
  readonly ply: number;
}

/**
 * Grow a repertoire-shaped tree breadth first: one move at each repertoire turn and a bounded fan
 * of replies at each opponent turn. Breadth-first growth keeps the tree balanced when the node
 * budget truncates it, so a scale's shape does not depend on where the budget happens to run out.
 */
function grow(target: StrategicFitBenchmarkScale, seed: number): GameTree {
  const tree = new GameTree();
  const frontier: Frontier[] = [{ path: [], position: Chess.default(), ply: 0 }];
  const nextValue = sequence(seed);
  let nodes = 0;
  let cursor = 0;
  while (cursor < frontier.length && nodes < target.target_nodes) {
    const frame = assertDefined(frontier[cursor++]);
    if (frame.ply >= target.maximum_ply) continue;
    const repertoireTurn = (frame.ply % 2 === 0) === (target.repertoire_color === "white");
    const legal = sortedLegal(frame.position);
    if (legal.length === 0) continue;
    const width = repertoireTurn ? 1 : Math.min(target.replies, legal.length);
    for (let index = 0; index < width && nodes < target.target_nodes; index++) {
      const reply = assertDefined(legal[nextValue() % legal.length]);
      const appended = tree.appendSan(frame.path, reply.san);
      if (!appended.appended) continue;
      nodes++;
      frontier.push({ path: appended.path, position: reply.after, ply: frame.ply + 1 });
    }
  }
  return tree;
}

function describe(
  target: StrategicFitBenchmarkScale,
  tree: GameTree,
): GeneratedStrategicFitRepertoire {
  const stats = tree.stats();
  const pgn = tree.toPgn();
  return {
    scale_id: target.id,
    repertoire_color: target.repertoire_color,
    pgn,
    digest: strategicFitFixtureDigest(pgn),
    nodes: stats.nodes,
    leaves: stats.leaves,
    max_depth: stats.maxDepth,
  };
}

const BASE_SEED = 0x9e3779b9;

/** Generate one scale's repertoire. Repeated calls produce byte-identical PGN. */
export function generateStrategicFitBenchmarkRepertoire(
  target: StrategicFitBenchmarkScale,
): GeneratedStrategicFitRepertoire {
  return describe(target, grow(target, BASE_SEED));
}

/**
 * The deterministic local edit the incremental scenario measures: at the deepest opponent node that
 * can carry one, the last reply is dropped and a different legal reply is added in its place. That
 * is an ordinary repertoire edit — one branch leaves the tree and one enters it, every other route
 * keeps its identity, and the edit is deep enough that an incremental run's reuse is real reuse
 * rather than an artifact of the benchmark.
 */
export function editStrategicFitBenchmarkRepertoire(
  target: StrategicFitBenchmarkScale,
  source: GeneratedStrategicFitRepertoire,
): GeneratedStrategicFitRepertoire {
  const tree = GameTree.fromPgn(source.pgn);
  if (!replaceOneReply(target, tree)) throw new Error("strategic_fit_benchmark_edit_found_no_node");
  const result = describe(target, tree);
  if (result.digest === source.digest)
    throw new Error("strategic_fit_benchmark_edit_changed_nothing");
  return { ...result, scale_id: `${target.id}-edited` };
}

interface EditSite {
  readonly path: Path;
  readonly ply: number;
  readonly replacement: string;
}

/** Replace one opponent reply as deep in the tree as the fixture allows, in canonical order. */
function replaceOneReply(target: StrategicFitBenchmarkScale, tree: GameTree): boolean {
  const frontier: Frontier[] = [{ path: [], position: Chess.default(), ply: 0 }];
  let cursor = 0;
  let site: EditSite | null = null;
  while (cursor < frontier.length) {
    const frame = assertDefined(frontier[cursor++]);
    const node = tree.nodeAt(frame.path);
    if (node.children.length === 0) continue;
    const legal = sortedLegal(frame.position);
    const repertoireTurn = (frame.ply % 2 === 0) === (target.repertoire_color === "white");
    if (!repertoireTurn && (site === null || frame.ply > site.ply)) {
      const existing = new Set(node.children.map((child) => child.data.san));
      const replacement = legal.find((reply) => !existing.has(reply.san));
      if (replacement !== undefined) {
        site = { path: [...frame.path], ply: frame.ply, replacement: replacement.san };
      }
    }
    for (const [index, child] of node.children.entries()) {
      const reply = legal.find((candidate) => candidate.san === child.data.san);
      if (reply === undefined) continue;
      frontier.push({ path: [...frame.path, index], position: reply.after, ply: frame.ply + 1 });
    }
  }
  if (site === null) return false;
  const node = tree.nodeAt(site.path);
  node.children.splice(node.children.length - 1, 1);
  tree.appendSan(site.path, site.replacement);
  return true;
}
