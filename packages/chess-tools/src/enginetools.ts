import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { makeSan, parseSan } from "chessops/san";
import type { ChildNode, PgnNodeData } from "chessops/pgn";
import type { GameTree } from "./pgn.js";
import { type Path, buildKeyIndex, landsInCrossBranchPrep } from "./pgn.js";
import { positionKey, type Color } from "./congruence.js";
import { mainline, classifyCpLoss, type MoveClass } from "./game.js";
import {
  decisionNodes,
  turnNodes,
  gapSeverity,
  medianLineLength,
  SEVERITY_RANK,
  moveSan,
  type Severity,
} from "./gaps.js";
import { validateLine } from "./validate.js";
import type { ExplorerLookup } from "./explorer.js";
import type { OpeningTable } from "./openings.js";
import { strategicFitPortableAnnotations } from "./strategic-fit/annotation.js";
import type { StrategicFitReport } from "./strategic-fit/types.js";
import {
  profileStructureShares,
  buildFitProfile,
  fitScore,
  classifyStructure,
  isolatedPawns,
  doubledPawns,
  passedPawns,
} from "./structure.js";
import { assertDefined } from "./assert.js";

const MATE_CP = 100000;

export interface EngineLine {
  uci: string;
  cp: number | null;
  mate: number | null;
  depth: number;
  pv: string[];
}

export type Analyse = (fen: string, multipv: number, depth: number) => Promise<EngineLine[] | null>;

export interface OperationControl {
  shouldCancel?: () => boolean;
  onProgress?: (done: number, total: number) => void;
  concurrency?: number;
}

async function mapBounded<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  control: OperationControl = {},
): Promise<{ cancelled: boolean; results: R[] }> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  let cancelled = false;
  control.onProgress?.(0, items.length);
  const run = async () => {
    for (;;) {
      if (control.shouldCancel?.()) {
        cancelled = true;
        return;
      }
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(assertDefined(items[index]), index);
      done++;
      control.onProgress?.(done, items.length);
      if (control.shouldCancel?.()) {
        cancelled = true;
        return;
      }
    }
  };
  const concurrency = Math.max(1, Math.min(items.length || 1, control.concurrency ?? 4));
  await Promise.all(Array.from({ length: concurrency }, run));
  return { cancelled, results: results.slice(0, next) };
}

const chessFromFen = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

interface ScoreLine {
  cp: number | null;
  mate: number | null;
}
const whitePov = (l: ScoreLine, mateCp: number): number =>
  l.mate !== null ? (l.mate > 0 ? mateCp : -mateCp) : (l.cp ?? 0);
const moverPov = (l: ScoreLine, moverIsWhite: boolean, mateCp: number): number =>
  (moverIsWhite ? 1 : -1) * whitePov(l, mateCp);
const evalWhite = (l: ScoreLine) => whitePov(l, 10000);
const pvSan = (fen: string, pv: string[]): string => {
  const pos = chessFromFen(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, 5)) {
    const mv = parseUci(uci);
    if (!mv) break;
    out.push(makeSan(pos, mv));
    pos.play(mv);
  }
  return out.join(" ");
};

export interface MoveRecord {
  ply: number;
  color: Color;
  san: string;
  cp_loss: number;
  classification: MoveClass;
  eval_cp: number;
  best_move: string;
  best_eval: number;
}

export async function analyzeMainline(
  pgn: string,
  depth: number,
  analyse: Analyse,
  control: OperationControl = {},
): Promise<MoveRecord[] | null> {
  const moves = mainline(pgn);
  if (!moves.length) return [];
  const fens = moves.map((m) => m.fenBefore);
  fens.push(assertDefined(moves[moves.length - 1]).fenAfter);

  const scheduled = await mapBounded(fens, (fen) => analyse(fen, 1, depth), control);
  if (scheduled.cancelled) return null;
  const results = scheduled.results;
  if (results.some((r) => r === null)) return null;
  const evals = results.map((res, i) => {
    const l = assertDefined(res)[0];
    if (!l) {
      const pos = chessFromFen(assertDefined(fens[i]));
      return {
        whiteCp: pos.isCheckmate() ? (pos.turn === "white" ? -MATE_CP : MATE_CP) : 0,
        bestUci: "",
      };
    }
    return { whiteCp: whitePov(l, MATE_CP), bestUci: l.uci };
  });

  if (moves.some((_, k) => assertDefined(evals[k]).bestUci === "")) return null;

  return moves.map((m, k) => {
    const before = assertDefined(evals[k]);
    const after = assertDefined(evals[k + 1]);
    const loss =
      m.color === "white" ? before.whiteCp - after.whiteCp : after.whiteCp - before.whiteCp;
    const cp_loss = Math.max(0, loss);
    return {
      ply: m.ply,
      color: m.color,
      san: m.san,
      cp_loss,
      classification: classifyCpLoss(cp_loss),
      eval_cp: after.whiteCp,
      best_move: moveSan(m.fenBefore, before.bestUci),
      best_eval: before.whiteCp,
    };
  });
}

export interface GapsOptions {
  depth?: number;
  minSeverity?: Severity;
  maxPositions?: number;
  limit?: number;
  popularity?: ExplorerLookup;
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
  concurrency?: number;
}
export interface Gap {
  path: Path;
  san_path: string[];
  fen: string;
  uncovered_move: string;
  eval: number | null;
  mate: number | null;
  severity: Severity;
  played_pct?: number | null;
  played_games?: number | null;
}
export interface CoveredGap {
  path: Path;
  san_path: string[];
  fen: string;
  uncovered_move: string;
  joins_path: string[];
}
export type GapsResult =
  | { error: "engine_unavailable" }
  | { cancelled: true }
  | {
      color: Color;
      positions_scanned: number;
      total_gaps: number;
      gaps: Gap[];
      covered_by_transposition: CoveredGap[];
    };

export async function findRepertoireGaps(
  tree: GameTree,
  color: Color,
  opts: GapsOptions,
  analyse: Analyse,
): Promise<GapsResult> {
  const minSev: Severity = opts.minSeverity ?? "medium";
  const nodes = decisionNodes(tree, color).slice(0, opts.maxPositions ?? 20);
  const { keyMap } = buildKeyIndex(tree.game.moves);
  const scheduled = await mapBounded(
    nodes,
    async (node) => {
      const res = await analyse(node.fen, 4, opts.depth ?? 20);
      if (!res) return null;
      const gaps: Gap[] = [];
      const covered: CoveredGap[] = [];
      const moverIsWhite = node.fen.split(" ")[1] === "w";
      const moverCp = (l: EngineLine) => moverPov(l, moverIsWhite, MATE_CP);
      const best = res.length ? moverCp(assertDefined(res[0])) : 0;
      for (const l of res) {
        const san = moveSan(node.fen, l.uci);
        if (node.covered.includes(san)) continue;
        const after = Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
        after.play(assertDefined(parseUci(l.uci)));
        const tgt = landsInCrossBranchPrep(keyMap, after, node.path);
        if (tgt) {
          covered.push({
            path: node.path,
            san_path: node.sanPath,
            fen: node.fen,
            uncovered_move: san,
            joins_path: tgt.sanPath,
          });
          continue;
        }
        gaps.push({
          path: node.path,
          san_path: node.sanPath,
          fen: node.fen,
          uncovered_move: san,
          eval: l.cp,
          mate: l.mate,
          severity: gapSeverity(best, moverCp(l)),
        });
      }
      return { gaps, covered };
    },
    { shouldCancel: opts.shouldCancel, onProgress: opts.onProgress, concurrency: opts.concurrency },
  );
  if (scheduled.cancelled) return { cancelled: true };
  const perNode = scheduled.results;
  if (perNode.some((r) => r === null)) return { error: "engine_unavailable" };
  const results = perNode as { gaps: Gap[]; covered: CoveredGap[] }[];
  const found = results.flatMap((r) => r.gaps);
  const covered = results.flatMap((r) => r.covered);
  const gaps = found
    .filter((g) => SEVERITY_RANK[g.severity] >= SEVERITY_RANK[minSev])
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, opts.limit ?? 10);
  if (opts.popularity && gaps.length) {
    const popularityLookup = opts.popularity;
    const fens = [...new Set(gaps.map((g) => g.fen))];
    const popularity = await mapBounded(
      fens,
      async (fen) => [fen, await popularityLookup(fen)] as const,
      {
        shouldCancel: opts.shouldCancel,
        concurrency: opts.concurrency,
      },
    );
    if (popularity.cancelled) return { cancelled: true };
    const byFen = new Map(popularity.results);
    for (const g of gaps) {
      const pos = byFen.get(g.fen);
      const m = pos?.moves.find((x) => x.san === g.uncovered_move);
      g.played_pct = pos ? (m?.played_pct ?? 0) : null;
      g.played_games = pos ? (m?.games ?? 0) : null;
    }
    gaps.sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (b.played_pct ?? -1) - (a.played_pct ?? -1),
    );
  }
  return {
    color,
    positions_scanned: nodes.length,
    total_gaps: gaps.length,
    gaps,
    covered_by_transposition: covered,
  };
}

export interface AuditOptions extends OperationControl {
  depth?: number;
  minCpLoss?: number;
  maxPositions?: number;
  limit?: number;
}
export interface AuditFinding {
  path: string[];
  fen: string;
  prescribed: string;
  prescribed_eval: number;
  best_move: string;
  best_eval: number;
  cp_loss: number;
  classification: MoveClass;
  best_margin: number | null;
}
export type AuditResult =
  | { error: "engine_unavailable" }
  | { cancelled: true }
  | { color: Color; positions_scanned: number; moves_audited: number; findings: AuditFinding[] };

export async function auditRepertoireMoves(
  tree: GameTree,
  color: Color,
  opts: AuditOptions,
  analyse: Analyse,
): Promise<AuditResult> {
  const depth = opts.depth ?? 20;
  const minCpLoss = opts.minCpLoss ?? 50;
  const nodes = turnNodes(tree, color).slice(0, opts.maxPositions ?? 20);
  const scheduled = await mapBounded(
    nodes,
    async (node) => {
      const res = await analyse(node.fen, 2, depth);
      if (res === null) return null;
      const findings: AuditFinding[] = [];
      let audited = 0;
      if (!res.length) return { findings, audited };
      const moverIsWhite = node.fen.split(" ")[1] === "w";
      const mcp = (l: EngineLine) => moverPov(l, moverIsWhite, MATE_CP);
      const first = assertDefined(res[0]);
      const best = mcp(first);
      const best_move = moveSan(node.fen, first.uci);
      const best_margin = res.length > 1 ? best - mcp(assertDefined(res[1])) : null;
      const bySan = new Map(res.map((l) => [moveSan(node.fen, l.uci), l]));
      for (const raw of node.covered) {
        const pos = chessFromFen(node.fen);
        const mv = parseSan(pos, raw);
        if (!mv) continue;
        const prescribed = makeSan(pos, mv);
        audited++;
        const hit = bySan.get(prescribed);
        let prescribedCp: number;
        if (hit) {
          prescribedCp = mcp(hit);
        } else {
          pos.play(mv);
          const r = await analyse(makeFen(pos.toSetup()), 1, depth);
          if (r === null) return null;
          const l = r[0];
          prescribedCp = l
            ? -moverPov(l, pos.turn === "white", MATE_CP)
            : pos.isCheckmate()
              ? MATE_CP
              : 0;
        }
        const cp_loss = Math.max(0, best - prescribedCp);
        if (cp_loss < minCpLoss) continue;
        findings.push({
          path: node.sanPath,
          fen: node.fen,
          prescribed,
          prescribed_eval: prescribedCp,
          best_move,
          best_eval: best,
          cp_loss,
          classification: classifyCpLoss(cp_loss),
          best_margin,
        });
      }
      return { findings, audited };
    },
    opts,
  );
  if (scheduled.cancelled) return { cancelled: true };
  const perNode = scheduled.results;
  if (perNode.some((r) => r === null)) return { error: "engine_unavailable" };
  const results = perNode as { findings: AuditFinding[]; audited: number }[];
  const findings = results.flatMap((r) => r.findings);
  findings.sort((a, b) => b.cp_loss - a.cp_loss);
  return {
    color,
    positions_scanned: nodes.length,
    moves_audited: results.reduce((a, r) => a + r.audited, 0),
    findings: findings.slice(0, opts.limit ?? 10),
  };
}

export interface OnlyMoveOptions extends OperationControl {
  depth?: number;
  minMargin?: number;
  maxPositions?: number;
  linesLimit?: number;
}
export interface OnlyMoveFinding {
  path: string[];
  fen: string;
  prescribed: string[];
  best_move: string;
  prescribed_is_best: boolean;
  margin: number;
  best_eval: number;
}
export interface OnlyMoveLine {
  line: string[];
  critical: number;
  your_moves: number;
  density: number;
}
export type OnlyMoveResult =
  | { error: "engine_unavailable" }
  | { cancelled: true }
  | {
      color: Color;
      positions_scanned: number;
      only_moves_found: number;
      findings: OnlyMoveFinding[];
      lines: OnlyMoveLine[];
    };

export async function findOnlyMoves(
  tree: GameTree,
  color: Color,
  opts: OnlyMoveOptions,
  analyse: Analyse,
): Promise<OnlyMoveResult> {
  const depth = opts.depth ?? 20;
  const minMargin = opts.minMargin ?? 100;
  const nodes = turnNodes(tree, color).slice(0, opts.maxPositions ?? 300);
  const scheduled = await mapBounded(
    nodes,
    async (node) => {
      const res = await analyse(node.fen, 2, depth);
      if (res === null) return null;
      const key = positionKey(node.fen);
      if (res.length < 2) return { key, finding: null };
      const moverIsWhite = node.fen.split(" ")[1] === "w";
      const mcp = (l: EngineLine) => moverPov(l, moverIsWhite, MATE_CP);
      const first = assertDefined(res[0]);
      const second = assertDefined(res[1]);
      const margin = mcp(first) - mcp(second);
      if (margin < minMargin) return { key, finding: null };
      const pos = chessFromFen(node.fen);
      const prescribed = node.covered.map((raw) => {
        const mv = parseSan(pos, raw);
        return mv ? makeSan(pos, mv) : raw;
      });
      const best_move = moveSan(node.fen, first.uci);
      const finding: OnlyMoveFinding = {
        path: node.sanPath,
        fen: node.fen,
        prescribed,
        best_move,
        prescribed_is_best: prescribed.includes(best_move),
        margin,
        best_eval: mcp(first),
      };
      return { key, finding };
    },
    opts,
  );
  if (scheduled.cancelled) return { cancelled: true };
  const perNode = scheduled.results;
  if (perNode.some((r) => r === null)) return { error: "engine_unavailable" };
  const results = perNode as { key: string; finding: OnlyMoveFinding | null }[];
  const scanned = new Set(results.map((r) => r.key));
  const tagged = new Set(results.filter((r) => r.finding).map((r) => r.key));
  const findings = results
    .map((r) => r.finding)
    .filter((f): f is OnlyMoveFinding => f !== null)
    .sort((a, b) => b.margin - a.margin);

  const lines: OnlyMoveLine[] = [];
  for (const leaf of tree.leaves()) {
    const pos = Chess.default();
    let your_moves = 0;
    let critical = 0;
    for (const san of leaf.path) {
      if (pos.turn === color) {
        const key = positionKey(makeFen(pos.toSetup()));
        if (scanned.has(key)) {
          your_moves++;
          if (tagged.has(key)) critical++;
        }
      }
      const mv = parseSan(pos, san);
      if (!mv) break;
      pos.play(mv);
    }
    if (critical)
      lines.push({
        line: leaf.path,
        critical,
        your_moves,
        density: Math.round((critical / your_moves) * 100) / 100,
      });
  }
  lines.sort((a, b) => b.density - a.density || b.critical - a.critical);

  return {
    color,
    positions_scanned: nodes.length,
    only_moves_found: findings.length,
    findings,
    lines: lines.slice(0, opts.linesLimit ?? 10),
  };
}

const csvField = (s: string): string => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
const numberedSan = (path: string[]): string =>
  path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(" ");

export function onlyMoveDeckCsv(color: Color, findings: OnlyMoveFinding[]): string {
  const side = color === "white" ? "White" : "Black";
  const rows = findings.map((f) => {
    const front = `${f.path.length ? numberedSan(f.path) : "(start position)"} (${side} to move)`;
    const note =
      f.margin >= MATE_CP / 2
        ? "only move: alternatives are decisively worse"
        : `only move: next best -${f.margin}cp`;
    const back = `${f.prescribed.join(" / ")} (${note})`;
    return [front, back, f.fen, String(f.margin)].map(csvField).join(",");
  });
  return ["front,back,fen,margin", ...rows].join("\n") + "\n";
}

export type AnnotateSource = "audit" | "only_moves" | "gaps" | "congruence";
export interface AnnotateOptions extends OperationControl {
  include?: AnnotateSource[];
  repertoireRevision: string;
  depth?: number;
  maxPositions?: number;
  minCpLoss?: number;
  minMargin?: number;
  minSeverity?: Severity;
}
export type AnnotateResult =
  | { error: "engine_unavailable" }
  | { error: "strategic_fit_stale_report"; reason: string }
  | { cancelled: true }
  | { color: Color; pgn: string; annotated: Record<AnnotateSource, number> };

export type StrategicFitAnnotationReport = (
  control: OperationControl,
) => StrategicFitReport | Promise<StrategicFitReport>;

const ANNOTATE_NAG: Record<string, number> = { blunder: 4, mistake: 2, inaccuracy: 6 };

export async function annotateRepertoire(
  tree: GameTree,
  color: Color,
  opts: AnnotateOptions,
  analyse: Analyse,
  _openings?: OpeningTable,
  strategicFitReport?: StrategicFitAnnotationReport,
): Promise<AnnotateResult> {
  const include = opts.include ?? ["audit", "only_moves", "gaps", "congruence"];
  let phase = 0;
  const phaseControl = (): OperationControl => ({
    shouldCancel: opts.shouldCancel,
    concurrency: opts.concurrency,
    onProgress: (done, total) =>
      opts.onProgress?.(
        phase * 100 + (total ? Math.round((done / total) * 100) : 0),
        include.length * 100,
      ),
  });
  const nextPhase = () => {
    phase++;
  };
  const clone = tree.clone();
  const NO_LIMIT = 10000;

  const evalStr = (cp: number) =>
    cp >= MATE_CP / 2
      ? "winning"
      : cp <= -MATE_CP / 2
        ? "losing"
        : `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
  const childData = (sanPath: string[]): PgnNodeData | null => {
    const idx = clone.indexPathOfSan(sanPath);
    if (!idx?.length) return null;
    return (clone.nodeAt(idx) as ChildNode<PgnNodeData>).data;
  };
  const comment = (data: PgnNodeData, text: string) => {
    (data.comments ??= []).push(text);
  };
  const addNag = (data: PgnNodeData, n: number) => {
    if (!(data.nags ??= []).includes(n)) data.nags.push(n);
  };

  const annotated: Record<AnnotateSource, number> = {
    audit: 0,
    only_moves: 0,
    gaps: 0,
    congruence: 0,
  };

  if (include.includes("audit")) {
    if (opts.shouldCancel?.()) return { cancelled: true };
    const control = phaseControl();
    const res = await auditRepertoireMoves(
      tree,
      color,
      {
        depth: opts.depth,
        minCpLoss: opts.minCpLoss,
        maxPositions: opts.maxPositions,
        limit: NO_LIMIT,
        ...control,
      },
      analyse,
    );
    if ("error" in res) return res;
    if ("cancelled" in res) return res;
    for (const f of res.findings) {
      const d = childData([...f.path, f.prescribed]);
      if (!d) continue;
      addNag(d, ANNOTATE_NAG[f.classification] ?? 6);
      const loss = f.cp_loss >= MATE_CP / 2 ? "decisively" : `${f.cp_loss}cp`;
      comment(
        d,
        `audit: ${f.classification} — loses ${loss} vs ${f.best_move} (${evalStr(f.best_eval)})`,
      );
      annotated.audit++;
    }
    nextPhase();
  }

  if (include.includes("only_moves")) {
    if (opts.shouldCancel?.()) return { cancelled: true };
    const control = phaseControl();
    const res = await findOnlyMoves(
      tree,
      color,
      {
        depth: opts.depth,
        minMargin: opts.minMargin,
        maxPositions: opts.maxPositions,
        linesLimit: 1,
        ...control,
      },
      analyse,
    );
    if ("error" in res) return res;
    if ("cancelled" in res) return res;
    for (const f of res.findings) {
      const note =
        f.margin >= MATE_CP / 2
          ? "only move: alternatives are decisively worse"
          : `only move: next best -${f.margin}cp`;
      const tail = f.prescribed_is_best ? "" : `; engine best is ${f.best_move}`;
      for (const san of f.prescribed) {
        const d = childData([...f.path, san]);
        if (d) comment(d, `${note}${tail}`);
      }
      annotated.only_moves++;
    }
    nextPhase();
  }

  if (include.includes("gaps")) {
    if (opts.shouldCancel?.()) return { cancelled: true };
    const control = phaseControl();
    const res = await findRepertoireGaps(
      tree,
      color,
      {
        depth: opts.depth,
        minSeverity: opts.minSeverity,
        maxPositions: opts.maxPositions,
        limit: NO_LIMIT,
        ...control,
      },
      analyse,
    );
    if ("error" in res) return res;
    if ("cancelled" in res) return res;
    for (const g of res.gaps) {
      const text = `gap: ${g.uncovered_move} not covered (severity ${g.severity})`;
      if (g.path.length === 0) (clone.game.comments ??= []).push(text);
      else comment((clone.nodeAt(g.path) as ChildNode<PgnNodeData>).data, text);
      annotated.gaps++;
    }
    nextPhase();
  }

  if (include.includes("congruence")) {
    if (opts.shouldCancel?.()) return { cancelled: true };
    if (strategicFitReport) {
      const control = phaseControl();
      let report: StrategicFitReport;
      try {
        report = await strategicFitReport(control);
      } catch (error) {
        if (opts.shouldCancel?.()) return { cancelled: true };
        throw error;
      }
      if (opts.shouldCancel?.()) return { cancelled: true };
      if (report.repertoire_revision !== opts.repertoireRevision) {
        return {
          error: "strategic_fit_stale_report",
          reason: `Strategic Fit report belongs to ${report.repertoire_revision}, not ${opts.repertoireRevision}.`,
        };
      }
      for (const annotation of strategicFitPortableAnnotations(report)) {
        for (const p of annotation.source_san_paths) {
          if (p.length === 0) {
            (clone.game.comments ??= []).push(annotation.text);
            annotated.congruence++;
            continue;
          }
          const d = childData([...p]);
          if (!d) continue;
          comment(d, annotation.text);
          annotated.congruence++;
        }
      }
    }
    nextPhase();
    opts.onProgress?.(phase * 100, include.length * 100);
  }

  return { color, pgn: clone.toPgn(), annotated };
}

export interface ShortcutComparison {
  recommend: "stay" | "transpose";
  basis: "eval" | "fit" | "fit_eval_unavailable";
  eval_disagrees_with_fit: boolean;
  evalStay: number | null;
  evalTranspose: number | null;
  evalDelta: number | null;
  fitStay: number;
  fitTranspose: number;
  structureStay: string;
  structureTranspose: string;
  unknownShareStay: number;
  unknownShareTranspose: number;
}

export async function compareShortcutLines(
  tree: GameTree,
  color: Color,
  opts: {
    linePath: string[];
    atPly: number;
    joinsPath: string[];
    depth?: number;
    evalTiebreakCp?: number;
  },
  analyse: Analyse,
): Promise<ShortcutComparison | { error: string }> {
  const stayPath = opts.linePath.slice(0, opts.atPly + 1);
  const stayFen = tree.fenAtSanPath(stayPath);
  const joinFen = tree.fenAtSanPath(opts.joinsPath);
  const subA = tree.subtreeLeafBoards(stayPath);
  const subB = tree.subtreeLeafBoards(opts.joinsPath);
  if (!stayFen || !joinFen || !subA || !subB) return { error: "path_not_found" };

  const yourEval = async (fen: string): Promise<number | null> => {
    const r = await analyse(fen, 1, opts.depth ?? 20);
    if (!r?.length) return null;
    return -moverPov(assertDefined(r[0]), fen.split(" ")[1] === "w", MATE_CP);
  };
  const evalStay = await yourEval(stayFen);
  const evalTranspose = await yourEval(joinFen);
  const evalDelta = evalStay != null && evalTranspose != null ? evalStay - evalTranspose : null;

  const r2 = (x: number) => Math.round(x * 100) / 100;
  const profile = buildFitProfile(
    tree.leafPositions().map((p) => p.board),
    color,
  );
  const fitOf = (boards: Parameters<typeof buildFitProfile>[0]) => {
    const fit = boards.length
      ? boards.reduce((s, b) => s + fitScore(profile, b, color), 0) / boards.length
      : 0;
    return { fit: r2(fit), unknown: r2(profileStructureShares(boards).unknown ?? 0) };
  };
  const fa = fitOf(subA);
  const fb = fitOf(subB);
  const labelOf = (sans: string[]) => {
    const b = tree.mainlineLeafBoard(sans);
    return b ? classifyStructure(b).structure_class : "unknown";
  };

  const tb = opts.evalTiebreakCp ?? 30;
  const fitPref = fb.fit >= fa.fit ? "transpose" : "stay";
  let recommend: "stay" | "transpose";
  let basis: "eval" | "fit" | "fit_eval_unavailable";
  if (evalDelta != null && Math.abs(evalDelta) > tb) {
    recommend = evalDelta < 0 ? "transpose" : "stay";
    basis = "eval";
  } else {
    recommend = fitPref;
    basis = evalDelta == null ? "fit_eval_unavailable" : "fit";
  }
  const evalPref = evalDelta == null ? null : evalDelta < 0 ? "transpose" : "stay";
  return {
    recommend,
    basis,
    eval_disagrees_with_fit: evalPref != null && evalPref !== fitPref,
    evalStay,
    evalTranspose,
    evalDelta,
    fitStay: fa.fit,
    fitTranspose: fb.fit,
    structureStay: labelOf(stayPath),
    structureTranspose: labelOf(opts.joinsPath),
    unknownShareStay: fa.unknown,
    unknownShareTranspose: fb.unknown,
  };
}

export interface ShortcutCoverage {
  prunes: string[];
  introduces_gap: boolean;
  new_gaps: Gap[];
  before_total: number;
  after_total: number;
}

export async function checkShortcutCoverage(
  tree: GameTree,
  color: Color,
  opts: {
    linePath: string[];
    atPly: number;
    depth?: number;
    minSeverity?: Severity;
    maxPositions?: number;
    limit?: number;
  } & OperationControl,
  analyse: Analyse,
): Promise<ShortcutCoverage | { error: string }> {
  const prunes = opts.linePath.slice(0, opts.atPly + 1);
  if (!prunes.length) return { error: "invalid_prune" };
  const edited = tree.edit("prune", prunes);
  if (!edited.tree) return { error: edited.error ?? "invalid_edit" };
  const gapsOpts = {
    depth: opts.depth,
    minSeverity: opts.minSeverity,
    maxPositions: opts.maxPositions,
    limit: opts.limit,
    shouldCancel: opts.shouldCancel,
    concurrency: opts.concurrency,
  };
  const [before, after] = await Promise.all([
    findRepertoireGaps(tree, color, gapsOpts, analyse),
    findRepertoireGaps(edited.tree, color, gapsOpts, analyse),
  ]);
  if ("error" in before) return { error: before.error };
  if ("error" in after) return { error: after.error };
  if ("cancelled" in before || "cancelled" in after) return { error: "cancelled" };
  const key = (g: Gap) => `${g.fen}|${g.uncovered_move}`;
  const beforeSet = new Set(before.gaps.map(key));
  const new_gaps = after.gaps.filter((g) => !beforeSet.has(key(g)));
  return {
    prunes,
    introduces_gap: new_gaps.length > 0,
    new_gaps,
    before_total: before.total_gaps,
    after_total: after.total_gaps,
  };
}

export interface StubResolution {
  path: string[];
  ply: number;
  connects_via?: string[];
  joins_path?: string[];
  joins_ply?: number;
}
export type CoverageResolution =
  | { error: "engine_unavailable" }
  | { resolved: number; dangling: StubResolution[] };

const STUB_MAX_DEPTH = 4;
const STUB_NODE_BUDGET = 40;
const STUB_CP_THRESHOLD = 50;

export async function resolveDanglingStubs(
  tree: GameTree,
  color: Color,
  opts: {
    maxDepth?: number;
    nodeBudget?: number;
    cpThreshold?: number;
    limit?: number;
    depth?: number;
  } & OperationControl,
  analyse: Analyse,
): Promise<CoverageResolution> {
  const dangling = tree.coverage(color).danglingLines.slice(0, opts.limit ?? 20);
  if (!dangling.length) return { resolved: 0, dangling: [] };

  const cpThreshold = opts.cpThreshold ?? STUB_CP_THRESHOLD;
  let engineOk = true;
  const pickMoves = async (fen: string): Promise<string[]> => {
    const res = await analyse(fen, 3, opts.depth ?? 20);
    if (!res) {
      engineOk = false;
      return [];
    }
    if (!res.length) return [];
    const moverIsWhite = fen.split(" ")[1] === "w";
    const moverCp = (l: EngineLine) => moverPov(l, moverIsWhite, MATE_CP);
    const best = moverCp(assertDefined(res[0]));
    return res.filter((l) => best - moverCp(l) <= cpThreshold).map((l) => l.uci);
  };

  const ext = await tree.extendedBridges(
    color,
    {
      maxDepth: opts.maxDepth ?? STUB_MAX_DEPTH,
      nodeBudget: opts.nodeBudget ?? STUB_NODE_BUDGET,
      shouldCancel: opts.shouldCancel,
      onProgress: opts.onProgress,
    },
    pickMoves,
  );
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!engineOk) return { error: "engine_unavailable" };

  const byPath = new Map<string, (typeof ext)[number]>();
  for (const e of ext) {
    const k = e.fromPath.join(" ");
    if (!byPath.has(k)) byPath.set(k, e);
  }

  let resolved = 0;
  const out: StubResolution[] = dangling.map((d) => {
    const e = byPath.get(d.path.join(" "));
    if (!e) return { path: d.path, ply: d.ply };
    resolved++;
    return {
      path: d.path,
      ply: d.ply,
      connects_via: e.moves,
      joins_path: e.joinsPath,
      joins_ply: e.joinsPly,
    };
  });
  return { resolved, dangling: out };
}

export async function compareMoves(
  fen: string,
  moves: string[],
  depth: number,
  analyse: Analyse,
  control: OperationControl = {},
): Promise<{ fen: string; candidates: Record<string, unknown>[]; cancelled?: true }> {
  const moverIsWhite = fen.split(" ")[1] === "w";
  const scheduled = await mapBounded(
    moves,
    async (san) => {
      const chk = validateLine(fen, [san]);
      if (!chk.ok || !chk.finalFen) return { san, error: "illegal_move" };
      const res = await analyse(chk.finalFen, 1, depth);
      if (res === null) return { san: chk.canonical[0], error: "engine_unavailable" };
      const line = res[0];
      if (!line) {
        const moverWins = chessFromFen(chk.finalFen).isCheckmate();
        return {
          san: chk.canonical[0],
          uci: chk.firstUci,
          eval_cp: null,
          mate: null,
          mover_cp: moverWins ? MATE_CP : 0,
        };
      }
      return {
        san: chk.canonical[0],
        uci: chk.firstUci,
        eval_cp: line.cp,
        mate: line.mate,
        mover_cp: moverPov(line, moverIsWhite, MATE_CP),
      };
    },
    control,
  );
  const out: Record<string, unknown>[] = scheduled.results;
  out.sort(
    (a, b) =>
      ((b.mover_cp as number | undefined) ?? -Infinity) -
      ((a.mover_cp as number | undefined) ?? -Infinity),
  );
  let rank = 0;
  for (const o of out) if (o.mover_cp !== undefined) o.rank = ++rank;
  return { fen, candidates: out, ...(scheduled.cancelled ? { cancelled: true as const } : {}) };
}

export interface SuggestComplementaryOptions {
  mode?: "low_memorization" | "sharp";
  depth?: number;
  limit?: number;
}

export async function suggestComplementaryLines(
  tree: GameTree,
  color: Color,
  fen: string,
  opts: SuggestComplementaryOptions,
  analyse: Analyse,
): Promise<Record<string, unknown>> {
  const m = opts.mode ?? "low_memorization";
  const setup = parseFen(fen);
  if (setup.isErr) return { error: "invalid_fen", reason: String(setup.error) };
  const posCheck = Chess.fromSetup(setup.value);
  if (posCheck.isErr) return { error: "invalid_fen", reason: String(posCheck.error) };
  const pos = posCheck.value;
  const lim = Math.max(1, Math.min(10, opts.limit ?? 5));
  const pool = Math.min(10, lim + 2);

  let opponentMoveSan: string | null = null;
  if (pos.turn !== color) {
    const oppRes = await analyse(makeFen(pos.toSetup()), 1, opts.depth ?? 20);
    if (!oppRes) return { error: "engine_unavailable" };
    const oppUci = oppRes[0]?.uci;
    if (!oppUci) return { mode: m, anchor_fen: makeFen(pos.toSetup()), suggestions: [] };
    opponentMoveSan = moveSan(makeFen(pos.toSetup()), oppUci);
    pos.play(assertDefined(parseUci(oppUci)));
  }
  const anchorFen = makeFen(pos.toSetup());
  const moverIsWhite = pos.turn === "white";
  const moverCp = (l: EngineLine) => moverPov(l, moverIsWhite, 10000);

  const res = await analyse(anchorFen, pool, opts.depth ?? 20);
  if (!res) return { error: "engine_unavailable" };
  const best = res.length ? moverCp(assertDefined(res[0])) : 0;
  const leafBoards = tree.leafPositions().map((p) => p.board);
  const profile = buildFitProfile(leafBoards, color);
  const shares = profileStructureShares(leafBoards);

  const ranked: { entry: Record<string, unknown>; mcp: number }[] = [];
  for (const l of res) {
    const mcp = moverCp(l);
    if (best - mcp > 100) continue;
    const after = chessFromFen(anchorFen);
    after.play(assertDefined(parseUci(l.uci)));
    const resultStruct = classifyStructure(after.board).structure_class;
    const entry: Record<string, unknown> = {
      move: moveSan(anchorFen, l.uci),
      resulting_structure: resultStruct,
      eval: evalWhite(l),
      pv: pvSan(anchorFen, l.pv),
    };
    if (m === "low_memorization") {
      entry.profile_match = fitScore(profile, after.board, color);
    } else {
      const imbalance = (["white", "black"] as const).reduce(
        (a, c) =>
          a +
          isolatedPawns(after.board, c).length +
          doubledPawns(after.board, c).length +
          passedPawns(after.board, c).length,
        0,
      );
      const novelty = resultStruct in shares ? 0 : 1;
      entry.sharpness = Math.round((Math.abs(mcp) / 100 + 0.5 * imbalance + novelty) * 100) / 100;
    }
    ranked.push({ entry, mcp });
  }

  if (m === "low_memorization")
    ranked.sort(
      (a, b) =>
        (b.entry.profile_match as number) - (a.entry.profile_match as number) || b.mcp - a.mcp,
    );
  else ranked.sort((a, b) => (b.entry.sharpness as number) - (a.entry.sharpness as number));

  const result: Record<string, unknown> = {
    mode: m,
    anchor_fen: anchorFen,
    suggestions: ranked.slice(0, lim).map((r) => r.entry),
  };
  if (opponentMoveSan) result.opponent_move = opponentMoveSan;
  return result;
}

export interface GapFillOption {
  kind: "best_eval" | "best_fit";
  reply: string;
  line: string[];
  eval_cp: number;
  fit: number;
}

export interface SuggestGapFillsOptions {
  depth?: number;
  limit?: number;
  target_plies?: number;
}

interface RawComplementarySuggestion {
  move: string;
  eval: number;
  profile_match?: number;
  pv: string;
}

async function gapFillTail(
  fen: string,
  maxPlies: number,
  depth: number,
  analyse: Analyse,
): Promise<string[]> {
  const out: string[] = [];
  if (maxPlies <= 0) return out;
  const pos = chessFromFen(fen);
  let currentFen = fen;
  for (let guard = 0; out.length < maxPlies && guard < 6; guard++) {
    const need = maxPlies - out.length;
    const searchDepth = Math.min(30, Math.max(depth, need + 2));
    const result = await analyse(currentFen, 1, searchDepth);
    if (!result?.length) break;
    let advanced = 0;
    for (const uci of assertDefined(result[0]).pv) {
      if (out.length >= maxPlies) break;
      const move = parseUci(uci);
      if (!move) break;
      out.push(makeSan(pos, move));
      pos.play(move);
      advanced++;
    }
    if (!advanced) break;
    currentFen = makeFen(pos.toSetup());
  }
  return out;
}

async function buildGapFillLine(
  anchorFen: string,
  uncoveredMove: string,
  reply: string,
  pliesToAdd: number,
  depth: number,
  analyse: Analyse,
): Promise<string[]> {
  const pos = chessFromFen(anchorFen);
  const move = parseSan(pos, reply);
  if (!move) return [uncoveredMove, reply];
  pos.play(move);
  const tail = await gapFillTail(makeFen(pos.toSetup()), pliesToAdd - 2, depth, analyse);
  const line = [uncoveredMove, reply, ...tail].slice(0, Math.max(2, pliesToAdd));
  if (line.length % 2 === 1) line.pop();
  return line;
}

function gapFillFit(
  startFen: string,
  sans: string[],
  profile: ReturnType<typeof buildFitProfile>,
  color: Color,
): number {
  const pos = chessFromFen(startFen);
  let sum = 0;
  let count = 0;
  for (const san of sans) {
    const move = parseSan(pos, san);
    if (!move) break;
    pos.play(move);
    sum += fitScore(profile, pos.board, color);
    count++;
  }
  return count ? Math.round((sum / count) * 100) / 100 : 0;
}

export async function suggestGapFills(
  tree: GameTree,
  color: Color,
  path: Path,
  uncoveredMove: string,
  opts: SuggestGapFillsOptions,
  analyse: Analyse,
): Promise<
  | { path: string[]; uncovered_move: string; target_plies: number; options: GapFillOption[] }
  | { error: string; reason?: string }
> {
  let startFen: string;
  let sanPath: string[];
  try {
    startFen = tree.fenAt(path);
    sanPath = tree.sanPathAt(path);
  } catch {
    return { error: "path_not_found" };
  }
  const afterGap = chessFromFen(startFen);
  const gapMove = parseSan(afterGap, uncoveredMove);
  if (!gapMove)
    return {
      error: "illegal_uncovered_move",
      reason: `cannot play '${uncoveredMove}' at the gap path`,
    };
  afterGap.play(gapMove);
  const anchorFen = makeFen(afterGap.toSetup());
  const depth = Math.max(1, Math.min(30, opts.depth ?? 20));
  const limit = Math.max(2, Math.min(10, opts.limit ?? 4));
  const raw = (await suggestComplementaryLines(
    tree,
    color,
    anchorFen,
    { mode: "low_memorization", limit, depth },
    analyse,
  )) as {
    suggestions?: RawComplementarySuggestion[];
    error?: string;
    reason?: string;
  };
  if (raw.error) return { error: raw.error, ...(raw.reason ? { reason: raw.reason } : {}) };
  if (!raw.suggestions?.length) return { error: "no_fill_found" };

  const target = Math.max(2, opts.target_plies ?? (medianLineLength(tree) || 10));
  const pliesToAdd = Math.max(2, target - path.length);
  const profile = buildFitProfile(
    tree.leafPositions().map((position) => position.board),
    color,
  );
  const moverEval = (suggestion: RawComplementarySuggestion) =>
    (color === "white" ? 1 : -1) * suggestion.eval;
  const probed: { suggestion: RawComplementarySuggestion; fit: number }[] = [];
  for (const suggestion of raw.suggestions) {
    const line = await buildGapFillLine(
      anchorFen,
      uncoveredMove,
      suggestion.move,
      Math.min(pliesToAdd, 10),
      14,
      analyse,
    );
    probed.push({ suggestion, fit: gapFillFit(startFen, line, profile, color) });
  }
  const byEval = [...probed].sort(
    (a, b) => moverEval(b.suggestion) - moverEval(a.suggestion) || b.fit - a.fit,
  );
  const evalPick = assertDefined(byEval[0]);
  const fitPick = [...probed]
    .filter((candidate) => candidate.suggestion.move !== evalPick.suggestion.move)
    .sort((a, b) => b.fit - a.fit || moverEval(b.suggestion) - moverEval(a.suggestion))[0];

  const build = async (
    kind: GapFillOption["kind"],
    pick: typeof evalPick,
  ): Promise<GapFillOption> => {
    const line = await buildGapFillLine(
      anchorFen,
      uncoveredMove,
      pick.suggestion.move,
      pliesToAdd,
      14,
      analyse,
    );
    return {
      kind,
      reply: pick.suggestion.move,
      line,
      eval_cp: moverEval(pick.suggestion),
      fit: gapFillFit(startFen, line, profile, color),
    };
  };
  const options = [await build("best_eval", evalPick)];
  if (fitPick) options.push(await build("best_fit", fitPick));
  return { path: sanPath, uncovered_move: uncoveredMove, target_plies: target, options };
}
