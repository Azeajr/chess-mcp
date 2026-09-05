import { Chess } from "chessops/chess";
import type { Board } from "chessops/board";
import { makeFen, parseFen, INITIAL_FEN } from "chessops/fen";
import { parseSan, makeSan, makeSanAndPlay } from "chessops/san";
import { makeSquare, parseSquare, makeUci, parseUci } from "chessops/util";
import {
  defaultGame,
  parsePgn,
  makePgn,
  Node,
  ChildNode,
  type Game,
  type PgnNodeData,
} from "chessops/pgn";
import { chessgroundDests } from "chessops/compat";
import type { Move, NormalMove } from "chessops/types";
import { positionKey, type Color } from "./congruence.js";
import { assertDefined } from "./assert.js";

export type Path = number[];

export function rejectFenSetup(game: Game<PgnNodeData>): void {
  const setupFen = game.headers.get("FEN");
  if (setupFen === undefined) return;
  let isStandard = false;
  try {
    isStandard = makeFen(parseFen(setupFen).unwrap()) === INITIAL_FEN;
  } catch {
    /* unparseable header FEN — treat as non-standard */
  }
  if (!isStandard) {
    throw new Error(
      "fen_setup_unsupported: this PGN starts from a FEN setup position; only PGNs from the standard start position are supported",
    );
  }
}

export interface PlayResult {
  path: Path;
  appended: boolean;
}

export interface ExtendedBridge {
  fromPath: string[];
  moves: string[];
  sideToMove: Color;
  joinsPath: string[];
  joinsPly: number;
}

export interface PruneEngineLine {
  uci: string;
  cp: number | null;
  mate: number | null;
}

export interface PruneSuggestion {
  linePath: string[];
  atPath: string[];
  atPly: number;
  rerouteMove: string;
  joinsPath: string[];
  savedPlies: number;
  evalBest: number;
  evalStay: number | null;
  evalTranspose: number;
  evalDelta: number | null;
  bestSavings: boolean;
  bestEval: boolean;
  evalConfirmed: boolean;
}

export interface PruneScanResult {
  suggestions: PruneSuggestion[];
  totalLeaves: number;
  leafStart: number;
  leavesScanned: number;
  nextLeaf: number | null;
  positionsAnalysed: number;
  totalPositionsEstimate: number;
  estimatedPositionsRemaining: number | null;
  partial: boolean;
}

export function pruneTailPath(s: Pick<PruneSuggestion, "linePath" | "atPly">): string[] {
  return s.linePath.slice(0, s.atPly + 1);
}

export function isPrefix(a: Path, b: Path): boolean {
  return a.length <= b.length && a.every((v, i) => b[i] === v);
}

export interface KeyIndex {
  keyMap: Map<string, { path: Path; sanPath: string[]; ply: number }>;
  keyCount: Map<string, number>;
}

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

export function* iterateLegal(pos: Chess): Generator<{ move: NormalMove; after: Chess }> {
  for (const [orig, dests] of chessgroundDests(pos)) {
    const from = parseSquare(orig);
    for (const dest of dests) {
      const to = parseSquare(dest);
      const piece = pos.board.get(from);
      const toRank = to >> 3;
      const move: NormalMove =
        piece?.role === "pawn" && (toRank === 0 || toRank === 7)
          ? { from, to, promotion: "queen" }
          : { from, to };
      const after = pos.clone();
      after.play(move);
      yield { move, after };
    }
  }
}

export function enumerateLegal(pos: Chess): { move: NormalMove; after: Chess }[] {
  return [...iterateLegal(pos)];
}

export function someLegal(
  pos: Chess,
  pred: (m: { move: NormalMove; after: Chess }) => boolean,
): boolean {
  for (const m of iterateLegal(pos)) if (pred(m)) return true;
  return false;
}

interface PruneLeafWork {
  leaf: Path;
  leafSan: string[];
  steps: { pos: Chess; ply: number }[];
  candidates: number[];
}

export class GameTree {
  game: Game<PgnNodeData>;

  private _pruneWork: { color: Color; keyMap: KeyIndex["keyMap"]; work: PruneLeafWork[] } | null =
    null;

  constructor(game?: Game<PgnNodeData>) {
    this.game = game ?? defaultGame();
  }

  static fromPgn(pgn: string): GameTree {
    const games = parsePgn(pgn);
    const first = games[0];
    if (!first) throw new Error("no game found in PGN");
    for (const g of games) rejectFenSetup(g);
    const tree = new GameTree(first);
    for (let i = 1; i < games.length; i++) {
      GameTree._mergeNodes(tree, assertDefined(games[i]).moves, []);
    }
    tree.assertLegal();
    return tree;
  }

  private assertLegal(): void {
    const fen = this.game.headers.get("FEN");
    const start = fen ? Chess.fromSetup(parseFen(fen).unwrap()).unwrap() : Chess.default();
    const dfs = (node: Node<PgnNodeData>, pos: Chess) => {
      for (const child of node.children) {
        const move = parseSan(pos, child.data.san);
        if (!move) throw new Error(`illegal move in PGN: ${child.data.san}`);
        const next = pos.clone();
        next.play(move);
        dfs(child, next);
      }
    };
    dfs(this.game.moves, start);
  }

  static detectColorFromPgn(pgn: string): "white" | "black" | null {
    const game = parsePgn(pgn)[0];
    if (!game) return null;
    const ct = game.headers.get("ChesstempoRepertoireColour");
    if (ct?.toLowerCase() === "white") return "white";
    if (ct?.toLowerCase() === "black") return "black";
    return null;
  }

  private static _mergeNodes(tree: GameTree, node: Node<PgnNodeData>, path: Path): void {
    for (const child of node.children) {
      const result = tree.appendSan(path, child.data.san);
      GameTree._mergeNodes(tree, child, result.path);
    }
  }

  toPgn(): string {
    return makePgn(this.game);
  }

  nodeAt(path: Path): Node<PgnNodeData> {
    let node: Node<PgnNodeData> = this.game.moves;
    for (const idx of path) {
      const child = node.children[idx];
      if (!child) throw new Error(`invalid path at index ${idx}`);
      node = child;
    }
    return node;
  }

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

  destsAt(path: Path): Map<string, string[]> {
    return chessgroundDests(this.positionAt(path));
  }

  playMove(path: Path, orig: string, dest: string, promotion?: string): PlayResult {
    const pos = this.positionAt(path);
    const from = parseSquare(orig);
    const to = parseSquare(dest);
    if (from === undefined || to === undefined) throw new Error("bad square");
    const move: NormalMove = { from, to };
    const piece = pos.board.get(from);
    const toRank = to >> 3;
    if (promotion) move.promotion = promotion as NormalMove["promotion"];
    else if (piece?.role === "pawn" && (toRank === 0 || toRank === 7)) move.promotion = "queen";
    if (!pos.isLegal(move)) throw new Error(`illegal move ${orig}${dest}`);
    const san = makeSanAndPlay(pos, move);
    return this.appendSan(path, san);
  }

  appendSan(path: Path, san: string): PlayResult {
    const parent = this.nodeAt(path);
    const existing = parent.children.findIndex((c) => c.data.san === san);
    if (existing >= 0) return { path: [...path, existing], appended: false };
    const child = new ChildNode<PgnNodeData>({ san });
    parent.children.push(child);
    this._pruneWork = null;
    return { path: [...path, parent.children.length - 1], appended: true };
  }

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

  childSansAt(path: Path): string[] {
    return this.nodeAt(path).children.map((c) => c.data.san);
  }

  childMovesAt(path: Path): { san: string; orig: string; dest: string }[] {
    const pos = this.positionAt(path);
    return this.nodeAt(path).children.flatMap((c) => {
      const move = parseSan(pos, c.data.san);
      if (!move || !("from" in move)) return [];
      return [{ san: c.data.san, orig: makeSquare(move.from), dest: makeSquare(move.to) }];
    });
  }

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
    return [...groups.values()]
      .filter((g) => g.paths.length > 1)
      .sort((a, b) => b.paths.length - a.paths.length);
  }

  async extendedBridges(
    color: Color,
    opts: {
      maxDepth?: number;
      nodeBudget?: number;
      shouldCancel?: () => boolean;
      onProgress?: (done: number, total: number) => void;
    },
    pickMoves: (fen: string) => Promise<string[]>,
  ): Promise<ExtendedBridge[]> {
    const maxDepth = opts.maxDepth ?? 4;
    let budget = opts.nodeBudget ?? 40;

    const { keyMap, keyCount } = buildKeyIndex(this.game.moves);

    const legalMoves = (pos: Chess) =>
      enumerateLegal(pos).map(({ move, after }) => ({
        san: makeSan(pos, move),
        after,
        uci: makeUci(move),
      }));

    const frontiers: { path: Path; pos: Chess; sanPath: string[] }[] = [];
    const findFrontiers = (node: Node<PgnNodeData>, pos: Chess, path: Path, sanPath: string[]) => {
      if (node.children.length === 0) {
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

    let completed = 0;
    opts.onProgress?.(0, frontiers.length);
    for (const f of frontiers) {
      if (opts.shouldCancel?.()) break;
      const dfs = async (pos: Chess, acc: string[], ply: number): Promise<void> => {
        if (opts.shouldCancel?.() || ply > maxDepth || budget <= 0) return;
        budget--;
        let candidates = legalMoves(pos);
        if (pos.turn === color) {
          const ucis = new Set(await pickMoves(makeFen(pos.toSetup())));
          if (opts.shouldCancel?.()) return;
          candidates = candidates.filter((c) => ucis.has(c.uci));
        }
        for (const c of candidates) {
          if (opts.shouldCancel?.()) return;
          const accNext = [...acc, c.san];
          const tgt = landsInCrossBranchPrep(keyMap, c.after, f.path);
          if (tgt) {
            const dedup = `${f.sanPath.join(",")}|${accNext.join(",")}`;
            if (!seen.has(dedup)) {
              seen.add(dedup);
              out.push({
                fromPath: [...f.sanPath],
                moves: accNext,
                sideToMove: color,
                joinsPath: tgt.sanPath,
                joinsPly: tgt.ply,
              });
            }
            continue;
          }
          await dfs(c.after, accNext, ply + 1);
        }
      };
      await dfs(f.pos, [], 1);
      opts.onProgress?.(++completed, frontiers.length);
    }

    return out.sort(
      (a, b) =>
        a.fromPath.length - b.fromPath.length ||
        b.joinsPly - a.joinsPly ||
        a.moves.length - b.moves.length,
    );
  }

  async pruneTranspositions(
    color: Color,
    opts: {
      multipv?: number;
      cpThreshold?: number;
      maxLossCp?: number;
      budget?: number;
      leafStart?: number;
      leafCount?: number;
      confirmDepth?: number;
      shouldCancel?: () => boolean;
    },
    analyse: (fen: string, multipv: number, depth?: number) => Promise<PruneEngineLine[] | null>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<PruneScanResult> {
    const multipv = opts.multipv ?? 4;
    const cpThreshold = opts.cpThreshold ?? 50;
    const maxLossCp = opts.maxLossCp;
    const budget = opts.budget;
    const confirmDepth = opts.confirmDepth;
    const MATE = 100000;

    const moverCp = (fen: string, l: PruneEngineLine) => {
      const white = l.mate !== null ? (l.mate > 0 ? MATE : -MATE) : (l.cp ?? 0);
      return fen.split(" ")[1] === "w" ? white : -white;
    };

    if (this._pruneWork?.color !== color) {
      const keyIndex = buildKeyIndex(this.game.moves).keyMap;

      const leaves: Path[] = [];
      const collect = (node: Node<PgnNodeData>, path: Path) => {
        if (node.children.length === 0) {
          if (path.length) leaves.push(path);
          return;
        }
        node.children.forEach((c, i) => {
          collect(c, [...path, i]);
        });
      };
      collect(this.game.moves, []);

      const replayLeaf = (leaf: Path): PruneLeafWork => {
        const leafSan: string[] = [];
        const steps: { pos: Chess; ply: number }[] = [];
        const pos = Chess.default();
        let node: Node<PgnNodeData> = this.game.moves;
        for (let depth = 0; depth < leaf.length; depth++) {
          steps.push({ pos: pos.clone(), ply: depth });
          const child = assertDefined(node.children[assertDefined(leaf[depth])]);
          const move = parseSan(pos, child.data.san);
          if (!move) break;
          pos.play(move);
          leafSan.push(child.data.san);
          node = child;
        }
        const candidates: number[] = [];
        steps.forEach((s, idx) => {
          if (s.pos.turn !== color) return;
          if (someLegal(s.pos, (m) => landsInCrossBranchPrep(keyIndex, m.after, leaf) != null)) {
            candidates.push(idx);
          }
        });
        return { leaf, leafSan, steps, candidates };
      };

      this._pruneWork = { color, keyMap: keyIndex, work: leaves.map(replayLeaf) };
    }
    const { keyMap, work: allWork } = this._pruneWork;

    const totalLeaves = allWork.length;
    const leafStart = Math.min(Math.max(opts.leafStart ?? 0, 0), totalLeaves);
    const leafCount = opts.leafCount ?? totalLeaves - leafStart;
    const sliceWork = allWork.slice(leafStart, leafStart + leafCount);
    const totalPositionsEstimate = allWork.reduce((a, w) => a + w.candidates.length, 0);
    const sliceEstimate = sliceWork.reduce((a, w) => a + w.candidates.length, 0);

    const out: PruneSuggestion[] = [];
    let analyses = 0;
    let leavesScanned = 0;
    let budgetSpent = false;

    const evalMemo = new Map<string, PruneEngineLine[] | null>();
    const analyseCached = async (
      fen: string,
      mpv: number,
      depth?: number,
    ): Promise<PruneEngineLine[] | null> => {
      if (opts.shouldCancel?.()) return null;
      const k = `${positionKey(fen)}|${mpv}|${depth ?? 0}`;
      if (evalMemo.has(k)) return evalMemo.get(k) ?? null;
      const r = await analyse(fen, mpv, depth);
      evalMemo.set(k, r);
      analyses++;
      onProgress?.(analyses, sliceEstimate);
      return r;
    };

    const evalAfterMove = async (
      pos: Chess,
      san: string,
      depth?: number,
    ): Promise<number | null> => {
      const after = pos.clone();
      const mv = parseSan(after, san);
      if (!mv) return null;
      after.play(mv);
      const fen = makeFen(after.toSetup());
      const sl = await analyseCached(fen, 1, depth);
      return sl?.length ? -moverCp(fen, assertDefined(sl[0])) : null;
    };

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
      if (budgetSpent || opts.shouldCancel?.()) break;
      const { leaf, leafSan, steps, candidates } = work;
      const reroutes: Reroute[] = [];
      for (const idx of candidates) {
        if (opts.shouldCancel?.()) break;
        if (budget != null && analyses >= budget) {
          budgetSpent = true;
          break;
        }
        const s = assertDefined(steps[idx]);
        const fen = makeFen(s.pos.toSetup());
        const lines = await analyseCached(fen, multipv);
        if (!lines?.length) continue;
        const stayMove = assertDefined(leafSan[s.ply]);
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
        let evalStayResolved = stayInList != null;

        for (const e of enriched) {
          if (opts.shouldCancel?.()) break;
          if (e.san === stayMove) continue;
          if (evalBest - e.cp > cpThreshold) continue;
          const after = s.pos.clone();
          after.play(e.mv);
          const tgt = landsInCrossBranchPrep(keyMap, after, leaf);
          if (!tgt) continue;
          if (!evalStayResolved) {
            evalStay = await evalAfterMove(s.pos, stayMove);
            evalStayResolved = true;
          }
          if (maxLossCp != null && evalStay != null && evalStay - e.cp > maxLossCp) continue;
          reroutes.push({
            pos: s.pos,
            atPly: s.ply,
            rerouteMove: e.san,
            joinsPath: tgt.sanPath,
            savedPlies: leaf.length - s.ply,
            evalBest,
            evalStay,
            evalTranspose: e.cp,
          });
        }
      }
      if (!budgetSpent && !opts.shouldCancel?.()) leavesScanned++;
      if (!reroutes.length) continue;

      let savIdx = 0;
      let evIdx = 0;
      reroutes.forEach((r, i) => {
        const sav = assertDefined(reroutes[savIdx]);
        if (
          r.savedPlies > sav.savedPlies ||
          (r.savedPlies === sav.savedPlies && r.evalTranspose > sav.evalTranspose)
        )
          savIdx = i;
        const ev = assertDefined(reroutes[evIdx]);
        if (
          r.evalTranspose > ev.evalTranspose ||
          (r.evalTranspose === ev.evalTranspose && r.savedPlies > ev.savedPlies)
        )
          evIdx = i;
      });

      let confirmedIdx = -1;
      if (confirmDepth != null && !opts.shouldCancel?.()) {
        const best = assertDefined(reroutes[evIdx]);
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

    out.sort(
      (a, b) =>
        b.savedPlies - a.savedPlies || (a.evalDelta ?? 0) - (b.evalDelta ?? 0) || a.atPly - b.atPly,
    );
    const scannedEnd = leafStart + leavesScanned;
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
      partial: leafStart !== 0 || scannedEnd < totalLeaves,
    };
  }

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

  moveMap(): Map<string, { sans: string[]; turn: Color }> {
    const map = new Map<string, { sans: string[]; turn: Color }>();
    const dfs = (node: Node<PgnNodeData>, pos: Chess) => {
      if (node.children.length) {
        const key = positionKey(makeFen(pos.toSetup()));
        if (!map.has(key))
          map.set(key, { sans: node.children.map((c) => c.data.san), turn: pos.turn });
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

  positionAtSanPath(sans: readonly string[]): Chess | null {
    if (!this.resolveSan(sans)) return null;
    return this.positionAtSan(sans);
  }

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

  fenAtSanPath(sans: readonly string[]): string | null {
    const pos = this.positionAtSanPath(sans);
    return pos ? makeFen(pos.toSetup()) : null;
  }

  subtreeLeafBoards(sans: readonly string[]): Board[] | null {
    const res = this.resolveSan(sans);
    if (!res) return null;
    const out: Board[] = [];
    const dfs = (node: Node<PgnNodeData>, pos: Chess) => {
      if (node.children.length === 0) {
        out.push(pos.board);
        return;
      }
      for (const child of node.children) {
        const next = pos.clone();
        const move = parseSan(next, child.data.san);
        if (!move) continue;
        next.play(move);
        dfs(child, next);
      }
    };
    dfs(res.node, this.positionAtSan(sans));
    return out;
  }

  mainlineLeafBoard(sans: readonly string[]): Board | null {
    const res = this.resolveSan(sans);
    if (!res) return null;
    let node: Node<PgnNodeData> = res.node;
    const pos = this.positionAtSan(sans);
    while (node.children.length) {
      const child = assertDefined(node.children[0]);
      const move = parseSan(pos, child.data.san);
      if (!move) break;
      pos.play(move);
      node = child;
    }
    return pos.board;
  }

  private resolveSan(
    sans: readonly string[],
  ): { node: Node<PgnNodeData>; parent: Node<PgnNodeData> | null } | null {
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

  private positionAtSan(sans: readonly string[]): Chess {
    const pos = Chess.default();
    for (const san of sans) {
      const move = parseSan(pos, san);
      if (!move) throw new Error(`illegal SAN in path: ${san}`);
      pos.play(move);
    }
    return pos;
  }

  clone(): GameTree {
    const copyChildren = (src: Node<PgnNodeData>, dst: Node<PgnNodeData>) => {
      for (const c of src.children) {
        const child = new ChildNode<PgnNodeData>({
          ...c.data,
          nags: c.data.nags?.slice(),
          comments: c.data.comments?.slice(),
          startingComments: c.data.startingComments?.slice(),
        });
        dst.children.push(child);
        copyChildren(c, child);
      }
    };
    const root = new Node<PgnNodeData>();
    copyChildren(this.game.moves, root);
    return new GameTree({
      headers: new Map(this.game.headers),
      comments: this.game.comments?.slice(),
      moves: root,
    });
  }

  edit(
    action: "prune" | "add" | "reorder",
    sanPath: readonly string[],
    opts: { addMoves?: string[]; promoteMove?: string } = {},
  ): { tree: GameTree | null; error: string | null; added?: { from: string[]; moves: string[] } } {
    const clone = this.clone();
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
      return { tree: clone, error: null, added: { from: effectiveSanPath, moves } };
    }

    if (!opts.promoteMove) return { tree: null, error: "invalid_edit" };
    const idx = node.children.findIndex((c) => c.data.san === opts.promoteMove);
    if (idx < 0) return { tree: null, error: "variation_not_found" };
    const [child] = node.children.splice(idx, 1);
    node.children.unshift(assertDefined(child));
    return { tree: clone, error: null };
  }

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
          continue;
        }
        dfs(child, sp);
      }
    };
    dfs(this.game.moves, []);
    return { lines, illustrativeLeaves };
  }

  sanAt(path: Path): string | null {
    if (path.length === 0) return null;
    return (this.nodeAt(path) as ChildNode<PgnNodeData>).data.san;
  }

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

  indexPathOfSan(sans: readonly string[]): Path | null {
    const out: Path = [];
    let node: Node<PgnNodeData> = this.game.moves;
    for (const san of sans) {
      const ci = node.children.findIndex((c) => c.data.san === san);
      if (ci < 0) return null;
      out.push(ci);
      node = assertDefined(node.children[ci]);
    }
    return out;
  }

  lastMoveAt(path: Path): [string, string] | null {
    if (path.length === 0) return null;
    const before = this.positionAt(path.slice(0, -1));
    const san = assertDefined(this.sanAt(path));
    const move = parseSan(before, san);
    if (!move || !("from" in move)) return null;
    return [makeSquare(move.from), makeSquare(move.to)];
  }
}
