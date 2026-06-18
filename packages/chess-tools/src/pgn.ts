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
import { parseSan, makeSan, makeSanAndPlay } from "chessops/san";
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

  /** Parse a PGN into a single tree. Multiple games are merged (used when repertoire tools
   *  export each line as a separate game). Throws if no game is present. */
  static fromPgn(pgn: string): GameTree {
    const games = parsePgn(pgn);
    const first = games[0];
    if (!first) throw new Error("no game found in PGN");
    const tree = new GameTree(first);
    for (let i = 1; i < games.length; i++) {
      GameTree._mergeNodes(tree, games[i]!.moves, []);
    }
    return tree;
  }

  /** Detect the repertoire color from PGN headers (ChessTempo: ChesstempoRepertoireColour). */
  static detectColorFromPgn(pgn: string): "white" | "black" | null {
    const game = parsePgn(pgn)[0];
    if (!game) return null;
    const ct = game.headers.get("ChesstempoRepertoireColour");
    if (ct?.toLowerCase() === "white") return "white";
    if (ct?.toLowerCase() === "black") return "black";
    return null;
  }

  private static _mergeNodes(tree: GameTree, node: Node<PgnNodeData>, path: Path): void {
    for (const child of node.children as ChildNode<PgnNodeData>[]) {
      const result = tree.appendSan(path, child.data.san);
      GameTree._mergeNodes(tree, child, result.path);
    }
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

  /** Known continuations with origin/destination squares, for drawing repertoire arrows. */
  childMovesAt(path: Path): { san: string; orig: string; dest: string }[] {
    const pos = this.positionAt(path);
    return this.nodeAt(path).children.flatMap((c) => {
      const move = parseSan(pos, c.data.san);
      if (!move || !("from" in move)) return [];
      return [{ san: c.data.san, orig: makeSquare(move.from), dest: makeSquare(move.to) }];
    });
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

  /**
   * Position-keyed map of the moves the repertoire prescribes (port of player_move_map). For
   * every position with ≥1 continuation: the child SANs + side to move. Transposition-aware (one
   * entry per position). Used to walk a played game against the prep (repertoire_vs_history).
   */
  moveMap(): Map<string, { sans: string[]; turn: Color }> {
    const map = new Map<string, { sans: string[]; turn: Color }>();
    const dfs = (node: Node<PgnNodeData>, pos: Chess) => {
      if (node.children.length) {
        const key = positionKey(makeFen(pos.toSetup()));
        if (!map.has(key)) map.set(key, { sans: node.children.map((c) => c.data.san), turn: pos.turn });
      }
      for (const child of node.children) {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) continue;
        next.play(move);
        dfs(child, next);
      }
    };
    dfs(this.game.moves, Chess.default());
    return map;
  }

  /** Chess position at a SAN variation path, or null if the path doesn't match the tree. */
  positionAtSanPath(sans: readonly string[]): Chess | null {
    if (!this.resolveSan(sans)) return null;
    return this.positionAtSan(sans);
  }

  /** Every leaf with its SAN path + position (for per-leaf congruence analysis). */
  leaves(): { path: string[]; pos: Chess }[] {
    const out: { path: string[]; pos: Chess }[] = [];
    const dfs = (node: Node<PgnNodeData>, pos: Chess, sanPath: string[]) => {
      for (const child of node.children) {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) continue;
        next.play(move);
        const sp = [...sanPath, child.data.san];
        if (child.children.length === 0) out.push({ path: sp, pos: next });
        else dfs(child, next, sp);
      }
    };
    dfs(this.game.moves, Chess.default(), []);
    return out;
  }

  /** Chess position at every leaf (for aggregate structural analysis). */
  leafPositions(): Chess[] {
    const out: Chess[] = [];
    const dfs = (node: Node<PgnNodeData>, pos: Chess) => {
      for (const child of node.children) {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) continue;
        next.play(move);
        if (child.children.length === 0) out.push(next);
        else dfs(child, next);
      }
    };
    dfs(this.game.moves, Chess.default());
    return out;
  }

  /** Resolve a SAN variation path to its node + parent (null parent at the root). */
  private resolveSan(sans: readonly string[]): { node: Node<PgnNodeData>; parent: Node<PgnNodeData> | null } | null {
    let node: Node<PgnNodeData> = this.game.moves;
    let parent: Node<PgnNodeData> | null = null;
    for (const san of sans) {
      const child = node.children.find((c) => c.data.san === san);
      if (!child) return null;
      parent = node;
      node = child;
    }
    return { node, parent };
  }

  /** Position reached by replaying a (already-validated) SAN path. */
  private positionAtSan(sans: readonly string[]): Chess {
    const pos = Chess.default();
    for (const san of sans) {
      const move = parseSan(pos, san);
      if (!move) throw new Error(`illegal SAN in path: ${san}`);
      pos.play(move);
    }
    return pos;
  }

  /**
   * Clone-on-write edit (port of apply_repertoire_edit). Returns a NEW GameTree with the edit
   * applied; `this` is untouched. error ∈ variation_not_found / invalid_line / invalid_edit.
   *   - prune: remove the node at `sanPath` and its subtree (path must be non-empty).
   *   - add: graft `addMoves` (SAN) under the node, merging into existing children.
   *   - reorder: make `promoteMove` the first child (mainline) at the node.
   */
  edit(
    action: "prune" | "add" | "reorder",
    sanPath: readonly string[],
    opts: { addMoves?: string[]; promoteMove?: string } = {},
  ): { tree: GameTree | null; error: string | null } {
    const clone = GameTree.fromPgn(this.toPgn()); // deep copy via round-trip
    let effectiveSanPath = [...sanPath];
    let effectiveAddMoves = opts.addMoves ?? [];
    let res = clone.resolveSan(effectiveSanPath);

    if (!res && action === "add") {
      for (let split = sanPath.length - 1; split >= 0; split--) {
        const prefix = sanPath.slice(0, split);
        const prefixRes = clone.resolveSan(prefix);
        if (prefixRes) {
          effectiveSanPath = [...prefix];
          effectiveAddMoves = [...sanPath.slice(split), ...effectiveAddMoves];
          res = prefixRes;
          break;
        }
      }
    }

    if (!res) return { tree: null, error: "variation_not_found" };
    const { node, parent } = res;

    if (action === "prune") {
      if (sanPath.length === 0 || !parent) return { tree: null, error: "invalid_edit" };
      parent.children.splice(parent.children.indexOf(node as ChildNode<PgnNodeData>), 1);
      return { tree: clone, error: null };
    }

    if (action === "add") {
      const moves = effectiveAddMoves;
      if (!moves.length) return { tree: null, error: "invalid_edit" };
      const pos = clone.positionAtSan(effectiveSanPath);
      let cursor = node;
      for (const san of moves) {
        const move = parseSan(pos, san);
        if (!move) return { tree: null, error: "invalid_line" };
        const canon = makeSan(pos, move);
        pos.play(move);
        const existing = cursor.children.find((c) => c.data.san === canon);
        if (existing) cursor = existing;
        else {
          const child = new ChildNode<PgnNodeData>({ san: canon });
          cursor.children.push(child);
          cursor = child;
        }
      }
      return { tree: clone, error: null };
    }

    // reorder
    if (!opts.promoteMove) return { tree: null, error: "invalid_edit" };
    const idx = node.children.findIndex((c) => c.data.san === opts.promoteMove);
    if (idx < 0) return { tree: null, error: "variation_not_found" };
    const [child] = node.children.splice(idx, 1);
    node.children.unshift(child!);
    return { tree: clone, error: null };
  }

  /**
   * NAG-tier illustrative lines (the authoritative engine-free signal from
   * classify_illustrative_lines): nodes carrying a mistake/dubious/blunder NAG ($2/$4/$6) mark
   * a side line shown because it is BAD. Returns each flagged node's SAN path + leaves beneath it.
   */
  illustrativeLines(): { lines: { path: string[]; reason: "nag" }[]; illustrativeLeaves: number } {
    const NAG_BAD = new Set([2, 4, 6]);
    const lines: { path: string[]; reason: "nag" }[] = [];
    let illustrativeLeaves = 0;
    const countLeaves = (node: Node<PgnNodeData>): number =>
      node.children.length === 0 ? 1 : node.children.reduce((a, c) => a + countLeaves(c), 0);
    const dfs = (node: Node<PgnNodeData>, sanPath: string[]) => {
      for (const child of node.children) {
        const sp = [...sanPath, child.data.san];
        if ((child.data.nags ?? []).some((n) => NAG_BAD.has(n))) {
          lines.push({ path: sp, reason: "nag" });
          illustrativeLeaves += countLeaves(child);
        }
        dfs(child, sp);
      }
    };
    dfs(this.game.moves, []);
    return { lines, illustrativeLeaves };
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
