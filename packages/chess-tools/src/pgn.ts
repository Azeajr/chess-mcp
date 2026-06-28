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
import { makeSquare, parseSquare, makeUci, parseUci } from "chessops/util";
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

/**
 * An engine-guided stub→prep connection (extendedBridges) — the surviving stub-resolution half of
 * the old bridges tool. A stopped line (frontier leaf, `color` to move) continued by `moves` lands
 * back in prep at `joinsPath`. The color's moves in `moves` are the engine's picks (good by
 * construction); opponent replies are enumerated.
 */
export interface ExtendedBridge {
  /** SAN path to the frontier leaf the extension departs from. */
  fromPath: string[];
  /** SAN sequence (length ≥ 1) that bridges the leaf into existing prep. */
  moves: string[];
  /** The repertoire color (to move at fromPath). */
  sideToMove: Color;
  /** Shallowest SAN path that already reaches the position the extension lands on. */
  joinsPath: string[];
  /** Ply depth of joinsPath. */
  joinsPly: number;
}

/** One engine line for the prune scan (white-POV cp/mate). Matches the Node/browser MultiLine. */
export interface PruneEngineLine {
  uci: string;
  cp: number | null;
  mate: number | null;
}

/**
 * A way to SHORTEN a line: at an early node where it is your turn, an engine-best move re-routes
 * the line into a position already prepared on a DIFFERENT line, making the original tail
 * redundant (find_pruning_transpositions).
 */
export interface PruneSuggestion {
  /** SAN path to the leaf line that can be shortened. */
  linePath: string[];
  /** SAN path to the re-route node (a prefix of linePath). */
  atPath: string[];
  /** Ply index of atPath (== atPath.length). */
  atPly: number;
  /** Engine SAN that transposes (≠ the line's own next move, within the near-best window). */
  rerouteMove: string;
  /** Shallowest SAN path on a DIFFERENT line the re-route reaches. */
  joinsPath: string[];
  /** linePath.length − atPly: the redundant tail removed by re-routing here. */
  savedPlies: number;
  /** cp (mover POV) of the engine's #1 move at the node. */
  evalBest: number;
  /** cp (mover POV) of the line's own next move (null if it was outside the top-k). */
  evalStay: number | null;
  /** cp (mover POV) of the re-route move (passed the near-best gate). */
  evalTranspose: number;
  /** evalStay − evalTranspose: cp given up by transposing vs staying (null if evalStay unknown). */
  evalDelta: number | null;
  /** C1: this is the biggest-tail-cut re-route for its line (earliest node; ties → better eval). */
  bestSavings: boolean;
  /** C1: this is the best-eval re-route for its line (highest evalTranspose; ties → more saved). */
  bestEval: boolean;
  /** E1: evalTranspose was deep-confirmed (re-searched at confirmDepth). Only the bestEval pick is. */
  evalConfirmed: boolean;
}

/**
 * Result of one `pruneTranspositions` call. The scan walks leaves in tree order; a call may cover the
 * whole tree or a cursor-bounded slice (leafStart/leafCount) so a long scan can be driven in chunks
 * with visible progress between calls. `nextLeaf` is the cursor for the following chunk (null = done).
 */
export interface PruneScanResult {
  /** Shortening suggestions found in the leaves scanned by THIS call (sorted, longest tail first). */
  suggestions: PruneSuggestion[];
  /** Total leaves in the tree (the cursor's upper bound). */
  totalLeaves: number;
  /** First leaf index this call scanned. */
  leafStart: number;
  /** How many leaves this call fully scanned (≤ leafCount). */
  leavesScanned: number;
  /** Cursor for the next chunk (leafStart + leavesScanned), or null when the tree is exhausted. */
  nextLeaf: number | null;
  /** Engine analyses actually spent in this call. */
  positionsAnalysed: number;
  /** Engine analyses to scan the WHOLE tree: your-turn nodes that have a cross-branch transposer (the
   *  pre-filtered work), summed over all leaves. A tight upper bound (a leaf stops early once it emits). */
  totalPositionsEstimate: number;
  /** Self-correcting ETA: positions left to scan, from THIS call's actual cost-per-leaf (null if none scanned). */
  estimatedPositionsRemaining: number | null;
}

// --- shared transposition primitives (gap resolution · stub resolution · shorten) ---

/**
 * Apply a shorten suggestion (W1): the SAN path to prune is the original line's OWN node at the
 * re-route ply — `linePath` truncated to `atPly + 1`. Pruning this drops the now-redundant tail and
 * leaves the `joinsPath` branch as the surviving prep. Do NOT prune at `atPath` (one ply shallower):
 * that also deletes the transposition target the re-route depends on.
 */
export function pruneTailPath(s: Pick<PruneSuggestion, "linePath" | "atPly">): string[] {
  return s.linePath.slice(0, s.atPly + 1);
}

/** Path `a` is an ancestor-or-equal of `b` (same line). */
export function isPrefix(a: Path, b: Path): boolean {
  return a.length <= b.length && a.every((v, i) => b[i] === v);
}

export interface KeyIndex {
  /** positionKey → shallowest occurrence among all child nodes. */
  keyMap: Map<string, { path: Path; sanPath: string[]; ply: number }>;
  /** positionKey → number of nodes carrying it (≥2 ⇒ an existing transposition). */
  keyCount: Map<string, number>;
}

/** Index every child node by positionKey: shallowest path per key + occurrence counts. */
export function buildKeyIndex(root: Node<PgnNodeData>): KeyIndex {
  const keyMap: KeyIndex["keyMap"] = new Map();
  const keyCount: KeyIndex["keyCount"] = new Map();
  const walk = (node: Node<PgnNodeData>, pos: Chess, path: Path, sanPath: string[]) => {
    node.children.forEach((child, i) => {
      const next = pos.clone();
      const move = parseSan(next, child.data.san);
      if (!move) return;
      next.play(move);
      const p = [...path, i];
      const sp = [...sanPath, child.data.san];
      const key = positionKey(makeFen(next.toSetup()));
      keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
      const prev = keyMap.get(key);
      if (!prev || sp.length < prev.ply) keyMap.set(key, { path: p, sanPath: sp, ply: sp.length });
      walk(child, next, p, sp);
    });
  };
  walk(root, Chess.default(), [], []);
  return { keyMap, keyCount };
}

/**
 * Does playing into `afterPos` land in a DIFFERENT prepared line? Returns the shallowest target
 * (sanPath + ply) when yes, else null. `ownPath` is the source node's index path; an
 * ancestor/descendant target is the line's own continuation, not a cross-branch transposition.
 */
export function landsInCrossBranchPrep(
  keyMap: KeyIndex["keyMap"],
  afterPos: Chess,
  ownPath: Path,
): { sanPath: string[]; ply: number } | null {
  const tgt = keyMap.get(positionKey(makeFen(afterPos.toSetup())));
  if (!tgt) return null;
  if (isPrefix(ownPath, tgt.path) || isPrefix(tgt.path, ownPath)) return null;
  return { sanPath: tgt.sanPath, ply: tgt.ply };
}

/** Legal moves at `pos` as { move, after } — pawns to the last rank as queen promotions only. */
export function enumerateLegal(pos: Chess): { move: NormalMove; after: Chess }[] {
  const out: { move: NormalMove; after: Chess }[] = [];
  for (const [orig, dests] of chessgroundDests(pos)) {
    const from = parseSquare(orig)!;
    for (const dest of dests) {
      const to = parseSquare(dest)!;
      const piece = pos.board.get(from);
      const toRank = to >> 3;
      const move: NormalMove =
        piece?.role === "pawn" && (toRank === 0 || toRank === 7) ? { from, to, promotion: "queen" } : { from, to };
      const after = pos.clone();
      after.play(move);
      out.push({ move, after });
    }
  }
  return out;
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
   * Engine-guided multi-ply extension of frontier_link bridges (retro 2a/2b). For each frontier
   * leaf where `color` is to move, search forward up to `maxDepth` plies — the color's moves are
   * chosen by the injected engine (`pickMoves` returns the best UCIs ± a cp threshold, so they are
   * good by construction); opponent replies are enumerated — until the position transposes into
   * prep already in the tree. `pickMoves` runs only at color-to-move nodes; the search is bounded
   * by `nodeBudget` total expansions to cap the combinatorial fan-out. Returns the bridging
   * sequences, shallowest leaf first.
   */
  async extendedBridges(
    color: Color,
    opts: { maxDepth?: number; nodeBudget?: number },
    pickMoves: (fen: string) => Promise<string[]>,
  ): Promise<ExtendedBridge[]> {
    const maxDepth = opts.maxDepth ?? 4;
    let budget = opts.nodeBudget ?? 40;

    const { keyMap, keyCount } = buildKeyIndex(this.game.moves);

    // Legal moves at pos as { san, after, uci } (queen-promo only), via the shared enumerator.
    const legalMoves = (pos: Chess) =>
      enumerateLegal(pos).map(({ move, after }) => ({ san: makeSan(pos, move), after, uci: makeUci(move) }));

    // Frontier leaves (no children) where `color` is to move; shallowest first (highest impact).
    const frontiers: { path: Path; pos: Chess; sanPath: string[] }[] = [];
    const findFrontiers = (node: Node<PgnNodeData>, pos: Chess, path: Path, sanPath: string[]) => {
      if (node.children.length === 0) {
        // Skip a leaf whose position already transposes elsewhere (keyCount > 1): it already
        // rejoins prep, so it is not a real dangling stub (transpositions() already reports it).
        if (pos.turn === color && (keyCount.get(positionKey(makeFen(pos.toSetup()))) ?? 0) <= 1) {
          frontiers.push({ path, pos, sanPath });
        }
        return;
      }
      node.children.forEach((child, i) => {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) return;
        next.play(move);
        findFrontiers(child, next, [...path, i], [...sanPath, child.data.san]);
      });
    };
    findFrontiers(this.game.moves, Chess.default(), [], []);
    frontiers.sort((a, b) => a.sanPath.length - b.sanPath.length);

    const out: ExtendedBridge[] = [];
    const seen = new Set<string>();

    for (const f of frontiers) {
      const dfs = async (pos: Chess, acc: string[], ply: number): Promise<void> => {
        if (ply > maxDepth || budget <= 0) return;
        budget--;
        let candidates = legalMoves(pos);
        if (pos.turn === color) {
          const ucis = new Set(await pickMoves(makeFen(pos.toSetup())));
          candidates = candidates.filter((c) => ucis.has(c.uci));
        }
        for (const c of candidates) {
          const accNext = [...acc, c.san];
          const tgt = landsInCrossBranchPrep(keyMap, c.after, f.path);
          if (tgt) {
            const dedup = `${f.sanPath.join(",")}|${accNext.join(",")}`;
            if (!seen.has(dedup)) {
              seen.add(dedup);
              out.push({ fromPath: [...f.sanPath], moves: accNext, sideToMove: color, joinsPath: tgt.sanPath, joinsPly: tgt.ply });
            }
            continue; // reached prep — stop deepening this branch
          }
          await dfs(c.after, accNext, ply + 1);
        }
      };
      await dfs(f.pos, [], 1);
    }

    return out.sort(
      (a, b) => a.fromPath.length - b.fromPath.length || b.joinsPly - a.joinsPly || a.moves.length - b.moves.length,
    );
  }

  /**
   * Line shortening via engine-vetted transposition (find_pruning_transpositions). For each leaf
   * line, walk your-turn nodes EARLIEST first; run multipv; among the candidate moves WITHIN
   * `cpThreshold` of the engine's #1 (the near-best gate — multipv can return blunders, so "top-k"
   * is not "good enough to play"), find one that transposes into a DIFFERENT line. The earliest such
   * node per line is reported (most tail pruned). Reports evalStay vs evalTranspose so the caller can
   * weigh the trade. Engine injected via `analyse`; `chess-tools` stays engine-free.
   */
  async pruneTranspositions(
    color: Color,
    opts: {
      multipv?: number;
      cpThreshold?: number;
      maxLossCp?: number;
      budget?: number;
      /** Cursor: first leaf index to scan (default 0). Pair with leafCount to drive a long scan in chunks. */
      leafStart?: number;
      /** Cursor: how many leaves to scan from leafStart (default: to the end). */
      leafCount?: number;
      /** E1: deep-confirm depth. When set, each line's best-eval re-route is re-searched at this depth
       *  (vs the cheaper scan effort) so the eval you act on is trustworthy. Unset = no deep confirm. */
      confirmDepth?: number;
    },
    analyse: (fen: string, multipv: number, depth?: number) => Promise<PruneEngineLine[] | null>,
    /** Fires after each engine analysis with (analysesDone, sliceEstimate) — for a determinate progress bar. */
    onProgress?: (done: number, total: number) => void,
  ): Promise<PruneScanResult> {
    const multipv = opts.multipv ?? 4;
    const cpThreshold = opts.cpThreshold ?? 50;
    const maxLossCp = opts.maxLossCp;
    const budget = opts.budget; // max engine analyses over the whole walk (undefined = unlimited)
    const confirmDepth = opts.confirmDepth; // E1: deep-confirm depth for each line's best-eval pick
    const MATE = 100000;

    const { keyMap } = buildKeyIndex(this.game.moves);

    const moverCp = (fen: string, l: PruneEngineLine) => {
      const white = l.mate !== null ? (l.mate > 0 ? MATE : -MATE) : (l.cp ?? 0);
      return fen.split(" ")[1] === "w" ? white : -white;
    };

    // Every leaf's index path.
    const leaves: Path[] = [];
    const collect = (node: Node<PgnNodeData>, path: Path) => {
      if (node.children.length === 0) {
        if (path.length) leaves.push(path);
        return;
      }
      node.children.forEach((c, i) => collect(c, [...path, i]));
    };
    collect(this.game.moves, []);

    // Cursor slice: scan leaves [leafStart, leafStart+leafCount). Default = the whole tree.
    const totalLeaves = leaves.length;
    const leafStart = Math.min(Math.max(opts.leafStart ?? 0, 0), totalLeaves);
    const leafCount = opts.leafCount ?? totalLeaves - leafStart;
    const slice = leaves.slice(leafStart, leafStart + leafCount);

    // Pre-pass (engine-free, P1): replay each leaf and find the your-turn nodes that actually have a
    // legal move transposing into a DIFFERENT prepared line — the ONLY nodes worth an engine call.
    // Skipping the rest is the main speed-up, and the candidate count is a TIGHT progress denominator
    // (real engine work, not a loose parity bound).
    interface LeafWork {
      leaf: Path;
      leafSan: string[];
      steps: { pos: Chess; ply: number }[];
      candidates: number[]; // indices into steps: your-turn nodes with a cross-branch transposer
    }
    const replayLeaf = (leaf: Path): LeafWork => {
      const leafSan: string[] = [];
      const steps: { pos: Chess; ply: number }[] = [];
      const pos = Chess.default();
      let node: Node<PgnNodeData> = this.game.moves;
      for (let depth = 0; depth < leaf.length; depth++) {
        steps.push({ pos: pos.clone(), ply: depth }); // pos is the node before playing leafSan[depth]
        const child = node.children[leaf[depth]!] as ChildNode<PgnNodeData>;
        const move = parseSan(pos, child.data.san);
        if (!move) break;
        pos.play(move);
        leafSan.push(child.data.san);
        node = child;
      }
      const candidates: number[] = [];
      steps.forEach((s, idx) => {
        if (s.pos.turn !== color) return;
        if (enumerateLegal(s.pos).some((m) => landsInCrossBranchPrep(keyMap, m.after, leaf) != null)) {
          candidates.push(idx);
        }
      });
      return { leaf, leafSan, steps, candidates };
    };

    const allWork = leaves.map(replayLeaf);
    const sliceWork = allWork.slice(leafStart, leafStart + leafCount);
    const totalPositionsEstimate = allWork.reduce((a, w) => a + w.candidates.length, 0);
    const sliceEstimate = sliceWork.reduce((a, w) => a + w.candidates.length, 0);

    const out: PruneSuggestion[] = [];
    let analyses = 0;
    let leavesScanned = 0;
    let budgetSpent = false;

    // P2: memoise engine results within the scan, keyed by transposition-stable positionKey (4-field
    // FEN, clock dropped) + multipv. A position reached by several leaves or move-orders is analysed
    // once. Only a real engine call (cache miss) counts toward analyses / onProgress.
    const evalMemo = new Map<string, PruneEngineLine[] | null>();
    const analyseCached = async (fen: string, mpv: number, depth?: number): Promise<PruneEngineLine[] | null> => {
      const k = `${positionKey(fen)}|${mpv}|${depth ?? 0}`;
      if (evalMemo.has(k)) return evalMemo.get(k) ?? null;
      const r = await analyse(fen, mpv, depth);
      evalMemo.set(k, r);
      analyses++;
      onProgress?.(analyses, sliceEstimate);
      return r;
    };

    // mover-POV cp of the position AFTER the move (single-PV, negated to the mover). Used to fill an
    // out-of-top-k stay move (C2) and to deep-confirm a re-route's eval (E1, via the depth override).
    const evalAfterMove = async (pos: Chess, san: string, depth?: number): Promise<number | null> => {
      const after = pos.clone();
      const mv = parseSan(after, san);
      if (!mv) return null;
      after.play(mv);
      const fen = makeFen(after.toSetup());
      const sl = await analyseCached(fen, 1, depth);
      return sl && sl.length ? -moverCp(fen, sl[0]!) : null; // sl is opponent-POV; negate for the mover
    };

    // A re-route collected for the current line (pos kept for E1's deep re-eval; not emitted).
    interface Reroute {
      pos: Chess;
      atPly: number;
      rerouteMove: string;
      joinsPath: string[];
      savedPlies: number;
      evalBest: number;
      evalStay: number | null;
      evalTranspose: number;
    }

    for (const work of sliceWork) {
      if (budgetSpent) break;
      const { leaf, leafSan, steps, candidates } = work;
      // C1: collect EVERY viable re-route for this line (not just the earliest) — a shallow one saves
      // more plies, a deeper one may keep a better eval; the caller chooses the trade.
      const reroutes: Reroute[] = [];
      for (const idx of candidates) {
        if (budget != null && analyses >= budget) { budgetSpent = true; break; }
        const s = steps[idx]!;
        const fen = makeFen(s.pos.toSetup());
        const lines = await analyseCached(fen, multipv);
        if (!lines || !lines.length) continue;
        const stayMove = leafSan[s.ply]!; // the line's own next move at this node
        const enriched = lines
          .map((l) => {
            const mv = parseUci(l.uci);
            return mv ? { mv, san: makeSan(s.pos, mv), cp: moverCp(fen, l) } : null;
          })
          .filter((e): e is { mv: Move; san: string; cp: number } => e !== null);
        if (!enriched.length) continue;

        const evalBest = Math.max(...enriched.map((e) => e.cp));
        const stayInList = enriched.find((e) => e.san === stayMove);
        let evalStay = stayInList ? stayInList.cp : null;
        let evalStayResolved = stayInList != null; // don't re-eval the stay move per candidate

        for (const e of enriched) {
          if (e.san === stayMove) continue; // staying, not a re-route
          if (evalBest - e.cp > cpThreshold) continue; // near-best gate (drops blunders in top-k)
          const after = s.pos.clone();
          after.play(e.mv);
          // Re-route must land in a DIFFERENT prepared line. Compare against the FULL leaf — a
          // shared early ancestor must NOT count as same-line.
          const tgt = landsInCrossBranchPrep(keyMap, after, leaf);
          if (!tgt) continue;
          if (!evalStayResolved) {
            evalStay = await evalAfterMove(s.pos, stayMove); // C2: fill the trade for an out-of-top-k stay
            evalStayResolved = true;
          }
          if (maxLossCp != null && evalStay != null && evalStay - e.cp > maxLossCp) continue;
          reroutes.push({
            pos: s.pos, atPly: s.ply, rerouteMove: e.san, joinsPath: tgt.sanPath,
            savedPlies: leaf.length - s.ply, evalBest, evalStay, evalTranspose: e.cp,
          });
        }
      }
      if (!budgetSpent) leavesScanned++; // a leaf cut short by budget is left for the next cursor chunk
      if (!reroutes.length) continue;

      // Tag the per-line winners on each axis: max-savings (earliest; tie → better eval) and
      // best-eval (highest evalTranspose; tie → more saved).
      let savIdx = 0;
      let evIdx = 0;
      reroutes.forEach((r, i) => {
        const sav = reroutes[savIdx]!;
        if (r.savedPlies > sav.savedPlies || (r.savedPlies === sav.savedPlies && r.evalTranspose > sav.evalTranspose)) savIdx = i;
        const ev = reroutes[evIdx]!;
        if (r.evalTranspose > ev.evalTranspose || (r.evalTranspose === ev.evalTranspose && r.savedPlies > ev.savedPlies)) evIdx = i;
      });

      // E1: deep-confirm the best-eval pick so the number the user acts on is trustworthy (selection
      // itself stays on the cheaper scan eval; only the reported eval is upgraded).
      let confirmedIdx = -1;
      if (confirmDepth != null) {
        const best = reroutes[evIdx]!;
        const deep = await evalAfterMove(best.pos, best.rerouteMove, confirmDepth);
        if (deep != null) {
          best.evalTranspose = deep;
          confirmedIdx = evIdx;
        }
      }

      reroutes.forEach((r, i) => {
        out.push({
          linePath: leafSan.slice(),
          atPath: leafSan.slice(0, r.atPly),
          atPly: r.atPly,
          rerouteMove: r.rerouteMove,
          joinsPath: r.joinsPath,
          savedPlies: r.savedPlies,
          evalBest: r.evalBest,
          evalStay: r.evalStay,
          evalTranspose: r.evalTranspose,
          evalDelta: r.evalStay == null ? null : r.evalStay - r.evalTranspose,
          bestSavings: i === savIdx,
          bestEval: i === evIdx,
          evalConfirmed: i === confirmedIdx,
        });
      });
    }

    out.sort((a, b) => b.savedPlies - a.savedPlies || (a.evalDelta ?? 0) - (b.evalDelta ?? 0) || a.atPly - b.atPly);
    const scannedEnd = leafStart + leavesScanned;
    // U1: a self-correcting remaining estimate from THIS call's actual cost-per-leaf (the agent's ETA
    // tightens after the first chunk instead of trusting the loose upper bound).
    const remainingLeaves = totalLeaves - scannedEnd;
    const estimatedPositionsRemaining =
      leavesScanned > 0 ? Math.round((analyses / leavesScanned) * remainingLeaves) : null;
    return {
      suggestions: out,
      totalLeaves,
      leafStart,
      leavesScanned,
      nextLeaf: scannedEnd < totalLeaves ? scannedEnd : null,
      positionsAnalysed: analyses,
      totalPositionsEstimate,
      estimatedPositionsRemaining,
    };
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
  ): { tree: GameTree | null; error: string | null; added?: { from: string[]; moves: string[] } } {
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
      // Report what actually anchored the graft — when the caller's path ran past the tree,
      // the fallback above re-split it, so `effectiveSanPath`/`moves` differ from the input.
      return { tree: clone, error: null, added: { from: effectiveSanPath, moves } };
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

  /** SAN list along an index path (root→node) — the inverse of `resolveSan`. `[]` → `[]`. */
  sanPathAt(path: Path): string[] {
    const out: string[] = [];
    let node: Node<PgnNodeData> = this.game.moves;
    for (const idx of path) {
      const child = node.children[idx];
      if (!child) throw new Error(`invalid path at index ${idx}`);
      out.push(child.data.san);
      node = child;
    }
    return out;
  }

  /** Index path for a SAN variation path, or null if it doesn't match a line (inverse of sanPathAt). */
  indexPathOfSan(sans: readonly string[]): Path | null {
    const out: Path = [];
    let node: Node<PgnNodeData> = this.game.moves;
    for (const san of sans) {
      const ci = node.children.findIndex((c) => c.data.san === san);
      if (ci < 0) return null;
      out.push(ci);
      node = node.children[ci]!;
    }
    return out;
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
