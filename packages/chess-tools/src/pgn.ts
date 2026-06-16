/**
 * GameTree — variation-aware PGN tree over chessops, shared by the UI and (later) the
 * Node MCP server. This is the TS counterpart of the Python server's variation walking
 * (repertoire.py iter_nodes/walk_leaves). Mainline + variations, auto-append on play.
 *
 * A position is addressed by a Path: the list of child indices from the root. The board
 * is recomputed by replaying SANs along the path — cheap for opening-depth trees.
 */
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan, makeSanAndPlay } from "chessops/san";
import { makeSquare, parseSquare } from "chessops/util";
import {
  defaultGame,
  parsePgn,
  makePgn,
  ChildNode,
  type Game,
  type Node,
  type PgnNodeData,
} from "chessops/pgn";
import { chessgroundDests } from "chessops/compat";
import type { Move, NormalMove } from "chessops/types";
import { positionKey, type Color } from "./congruence.js";

/** Child-index path from the root. `[]` is the starting position. */
export type Path = number[];

export interface PlayResult {
  path: Path;
  /** true when the move created a new node (vs navigating into an existing one). */
  appended: boolean;
}

export class GameTree {
  game: Game<PgnNodeData>;

  constructor(game?: Game<PgnNodeData>) {
    this.game = game ?? defaultGame();
  }

  /** Parse the first game of a PGN. Throws if no game is present. */
  static fromPgn(pgn: string): GameTree {
    const games = parsePgn(pgn);
    const first = games[0];
    if (!first) throw new Error("no game found in PGN");
    return new GameTree(first);
  }

  toPgn(): string {
    return makePgn(this.game);
  }

  /** The node at `path`, or the root node for `[]`. Throws on an invalid path. */
  nodeAt(path: Path): Node<PgnNodeData> {
    let node: Node<PgnNodeData> = this.game.moves;
    for (const idx of path) {
      const child = node.children[idx];
      if (!child) throw new Error(`invalid path at index ${idx}`);
      node = child;
    }
    return node;
  }

  /** Replay the SANs along `path` and return the resulting position. */
  positionAt(path: Path): Chess {
    const pos = Chess.default();
    let node: Node<PgnNodeData> = this.game.moves;
    for (const idx of path) {
      const child = node.children[idx];
      if (!child) throw new Error(`invalid path at index ${idx}`);
      const move = parseSan(pos, child.data.san);
      if (!move) throw new Error(`illegal SAN in tree: ${child.data.san}`);
      pos.play(move);
      node = child;
    }
    return pos;
  }

  fenAt(path: Path): string {
    return makeFen(this.positionAt(path).toSetup());
  }

  /** chessground dests map (legal moves) for the position at `path`. */
  destsAt(path: Path): Map<string, string[]> {
    return chessgroundDests(this.positionAt(path));
  }

  /**
   * Play a board move (chessground orig/dest squares) from `path`. If a child with the
   * same SAN already exists, navigate into it; otherwise append a new node. Returns the
   * resulting path and whether a node was created.
   */
  playMove(path: Path, orig: string, dest: string, promotion?: string): PlayResult {
    const pos = this.positionAt(path);
    const from = parseSquare(orig);
    const to = parseSquare(dest);
    if (from === undefined || to === undefined) throw new Error("bad square");
    const move: NormalMove = { from, to };
    // Auto-queen a pawn reaching the last rank when no promotion is given (Phase 1: no
    // promotion modal). rank 0 = '1', rank 7 = '8'; `to >> 3` is the rank index.
    const piece = pos.board.get(from);
    const toRank = to >> 3;
    if (promotion) move.promotion = promotion as NormalMove["promotion"];
    else if (piece?.role === "pawn" && (toRank === 0 || toRank === 7)) move.promotion = "queen";
    const san = makeSanAndPlay(pos, move as Move);
    if (san === "--") throw new Error(`illegal move ${orig}${dest}`);
    return this.appendSan(path, san);
  }

  /** Append a SAN at `path` (or navigate if it already exists as a child). */
  appendSan(path: Path, san: string): PlayResult {
    const parent = this.nodeAt(path);
    const existing = parent.children.findIndex((c) => c.data.san === san);
    if (existing >= 0) return { path: [...path, existing], appended: false };
    const child = new ChildNode<PgnNodeData>({ san });
    parent.children.push(child);
    return { path: [...path, parent.children.length - 1], appended: true };
  }

  /** (nodes, leaves, maxDepthPlies) over the whole tree — for the load_repertoire summary. */
  stats(): { nodes: number; leaves: number; maxDepth: number } {
    let nodes = 0;
    let leaves = 0;
    let maxDepth = 0;
    const dfs = (node: Node<PgnNodeData>, depth: number) => {
      for (const child of node.children) {
        nodes++;
        if (child.children.length === 0) leaves++;
        if (depth + 1 > maxDepth) maxDepth = depth + 1;
        dfs(child, depth + 1);
      }
    };
    dfs(this.game.moves, 0);
    return { nodes, leaves, maxDepth };
  }

  /** Known continuations (child SANs) at `path` — the in-book moves from here. */
  childSansAt(path: Path): string[] {
    return this.nodeAt(path).children.map((c) => c.data.san);
  }

  /**
   * Transposition keys of every position in the tree (for adjacency detection). DFS replays
   * each line once, carrying the position — O(nodes), no per-node re-walk.
   */
  allPositionKeys(): Set<string> {
    const keys = new Set<string>();
    const dfs = (node: Node<PgnNodeData>, pos: Chess) => {
      for (const child of node.children) {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) continue;
        next.play(move);
        keys.add(positionKey(makeFen(next.toSetup())));
        dfs(child, next);
      }
    };
    dfs(this.game.moves, Chess.default());
    return keys;
  }

  /**
   * Positions the tree reaches by more than one move order (port of find_transpositions).
   * Groups nodes by transposition key; returns converging positions (>1 path), largest first.
   */
  transpositions(): { fen: string; paths: string[][] }[] {
    const groups = new Map<string, { fen: string; paths: string[][] }>();
    const dfs = (node: Node<PgnNodeData>, pos: Chess, sanPath: string[]) => {
      for (const child of node.children) {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) continue;
        next.play(move);
        const fen = makeFen(next.toSetup());
        const key = positionKey(fen);
        const sp = [...sanPath, child.data.san];
        const g = groups.get(key) ?? { fen, paths: [] };
        g.paths.push(sp);
        groups.set(key, g);
        dfs(child, next, sp);
      }
    };
    dfs(this.game.moves, Chess.default(), []);
    return [...groups.values()].filter((g) => g.paths.length > 1).sort((a, b) => b.paths.length - a.paths.length);
  }

  /**
   * Tree-shape hygiene (port of coverage_report). Dangling = leaves where it is YOUR turn and
   * the position is not continued elsewhere by transposition (a real hole). Frontier = the rest
   * (opponent-to-move leaves, or your-turn leaves covered by another move order).
   */
  coverage(color: Color): {
    leaves: number;
    danglingCount: number;
    danglingLines: { path: string[]; ply: number }[];
    frontierCount: number;
    maxDepth: number;
    shallowestLeafPly: number;
  } {
    const interior = new Set<string>();
    const leaves: { path: string[]; ply: number; turn: Color; key: string }[] = [];
    const dfs = (node: Node<PgnNodeData>, pos: Chess, sanPath: string[]) => {
      for (const child of node.children) {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) continue;
        next.play(move);
        const key = positionKey(makeFen(next.toSetup()));
        const sp = [...sanPath, child.data.san];
        if (child.children.length) {
          interior.add(key);
          dfs(child, next, sp);
        } else {
          leaves.push({ path: sp, ply: sp.length, turn: next.turn, key });
        }
      }
    };
    dfs(this.game.moves, Chess.default(), []);
    const dangling = leaves.filter((l) => l.turn === color && !interior.has(l.key));
    const plies = leaves.map((l) => l.ply);
    return {
      leaves: leaves.length,
      danglingCount: dangling.length,
      danglingLines: dangling.map((l) => ({ path: l.path, ply: l.ply })),
      frontierCount: leaves.length - dangling.length,
      maxDepth: plies.length ? Math.max(...plies) : 0,
      shallowestLeafPly: plies.length ? Math.min(...plies) : 0,
    };
  }

  /** SAN of the move that leads to `path` (the last node), or null at the root. */
  sanAt(path: Path): string | null {
    if (path.length === 0) return null;
    return (this.nodeAt(path) as ChildNode<PgnNodeData>).data.san;
  }

  /** UCI of the last move on `path`, for chessground lastMove highlight. */
  lastMoveAt(path: Path): [string, string] | null {
    if (path.length === 0) return null;
    const before = this.positionAt(path.slice(0, -1));
    const san = this.sanAt(path)!;
    const move = parseSan(before, san);
    if (!move || !("from" in move)) return null;
    return [makeSquare(move.from), makeSquare(move.to)];
  }
}
