/**
 * Deterministic, engine-free preflight validation for Strategic Fit.
 *
 * The preflight deliberately describes input quality only. It never makes a
 * strategic-fit verdict, and it walks the raw tree defensively so malformed
 * host data becomes a structured blocking issue instead of an exception.
 */
import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";

import { positionKey, type Color } from "../congruence.js";
import type { OpeningTable } from "../openings.js";
import type { GameTree } from "../pgn.js";
import type {
  JsonValue,
  PreflightIssue,
  PreflightIssueCode,
  PreflightIssueKind,
  PreflightIssueSeverity,
  StrategicFitPreflight,
  StrategicFitSourceProvenance,
} from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION } from "./version.js";

/** The first frozen configured checkpoint in the Strategic Fit design. */
export const STRATEGIC_FIT_MIN_COMPARABLE_PLY = 12;
/** Comparing fewer than two routes cannot establish a cohort baseline. */
export const STRATEGIC_FIT_MIN_COMPARABLE_ROUTES = 2;

export interface StrategicFitPreflightOptions {
  readonly repertoireColor: Color | null;
  readonly openingTable?: OpeningTable | null;
}

interface RouteObservation {
  readonly path: readonly string[];
  readonly position: Chess;
  readonly positionKeys: readonly string[];
}

interface ReplayProblem {
  readonly path: readonly string[];
  readonly reason: string;
}

interface ReplayResult {
  readonly routes: readonly RouteObservation[];
  readonly malformed: readonly ReplayProblem[];
  readonly illegal: readonly ReplayProblem[];
  readonly duplicatePaths: readonly (readonly string[])[];
  readonly transpositionPaths: readonly (readonly (readonly string[])[])[];
}

const REPERTOIRE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "repertoire",
  kind: "repertoire",
  state: "available",
  version: null,
  snapshot: null,
  reason: null,
});

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit-preflight",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: null,
  reason: null,
});

function taxonomyProvenance(available: boolean): StrategicFitSourceProvenance {
  return {
    source_id: "opening-taxonomy",
    kind: "opening-taxonomy",
    state: available ? "available" : "unavailable",
    version: null,
    snapshot: null,
    reason: available ? null : "No opening-classification table was supplied.",
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function issueId(code: PreflightIssueCode, paths: readonly (readonly string[])[]): string {
  if (paths.length === 0) return `preflight:${code}`;
  const canonicalPaths = paths.map((path) => path.join("\u001f")).sort().join("\u001e");
  return `preflight:${code}:${stableHash(canonicalPaths)}`;
}

function makeIssue(
  code: PreflightIssueCode,
  kind: PreflightIssueKind,
  severity: PreflightIssueSeverity,
  message: string,
  paths: readonly (readonly string[])[] = [],
  details: Readonly<Record<string, JsonValue>> = {},
  provenance: readonly StrategicFitSourceProvenance[] = [CORE_PROVENANCE, REPERTOIRE_PROVENANCE],
): PreflightIssue {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    issue_id: issueId(code, paths),
    code,
    kind,
    severity,
    message,
    // Semantic route IDs are assigned by the repertoire graph in Task 1.2. Preflight retains
    // exact source paths so the graph/analyzer can attach those IDs without inventing path IDs.
    affected_route_ids: [],
    affected_source_paths: paths.map((path) => [...path]),
    details,
    provenance,
  };
}

function customStartProblem(tree: GameTree): { unsupported: boolean; reason: string } | null {
  const headers = tree.game?.headers;
  if (!(headers instanceof Map)) return { unsupported: false, reason: "Repertoire headers are malformed." };

  const fen = headers.get("FEN");
  const setup = headers.get("SetUp");
  if (fen === undefined) {
    return setup === "1" ? { unsupported: false, reason: "SetUp is 1 but the FEN header is missing." } : null;
  }

  try {
    if (makeFen(parseFen(fen).unwrap()) === INITIAL_FEN) return null;
    return { unsupported: true, reason: "The repertoire starts from a non-standard FEN." };
  } catch {
    return { unsupported: true, reason: "The repertoire FEN header is malformed or unsupported." };
  }
}

function replayTree(tree: GameTree): ReplayResult {
  const routes: RouteObservation[] = [];
  const malformed: ReplayProblem[] = [];
  const illegal: ReplayProblem[] = [];
  const duplicatePaths: string[][] = [];
  const positions = new Map<string, string[][]>();

  const root = tree.game?.moves as unknown;
  if (!root || typeof root !== "object" || !Array.isArray((root as { children?: unknown }).children)) {
    return {
      routes,
      malformed: [{ path: [], reason: "The repertoire move tree is missing or malformed." }],
      illegal,
      duplicatePaths,
      transpositionPaths: [],
    };
  }

  const ancestors = new Set<object>();
  const visit = (
    node: object,
    position: Chess,
    path: readonly string[],
    routePositionKeys: readonly string[],
  ): void => {
    if (ancestors.has(node)) {
      malformed.push({ path, reason: "The repertoire move tree contains a cycle." });
      return;
    }

    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children)) {
      malformed.push({ path, reason: "A repertoire node has malformed children." });
      return;
    }

    ancestors.add(node);
    const siblingSans = new Set<string>();
    for (const child of children) {
      if (!child || typeof child !== "object") {
        malformed.push({ path, reason: "A repertoire child node is malformed." });
        continue;
      }
      const data = (child as { data?: unknown }).data;
      const san = data && typeof data === "object" ? (data as { san?: unknown }).san : undefined;
      if (typeof san !== "string" || san.length === 0) {
        malformed.push({ path, reason: "A repertoire node has no SAN move." });
        continue;
      }

      const nextPath = [...path, san];
      if (siblingSans.has(san)) duplicatePaths.push(nextPath);
      siblingSans.add(san);

      let move;
      try {
        move = parseSan(position, san);
      } catch {
        move = undefined;
      }
      if (!move) {
        illegal.push({ path: nextPath, reason: `Illegal SAN move: ${san}` });
        continue;
      }

      const next = position.clone();
      next.play(move);
      const key = positionKey(makeFen(next.toSetup()));
      const occurrences = positions.get(key) ?? [];
      occurrences.push(nextPath);
      positions.set(key, occurrences);

      const nextKeys = [...routePositionKeys, key];
      const grandchildren = (child as { children?: unknown }).children;
      if (!Array.isArray(grandchildren)) {
        malformed.push({ path: nextPath, reason: "A repertoire node has malformed children." });
      } else if (grandchildren.length === 0) {
        routes.push({ path: nextPath, position: next, positionKeys: nextKeys });
      } else {
        visit(child, next, nextPath, nextKeys);
      }
    }
    ancestors.delete(node);
  };

  visit(root, Chess.default(), [], []);
  const transpositionPaths = [...positions.values()]
    .filter((paths) => paths.length > 1)
    .map((paths) => paths.map((path) => [...path]));
  return { routes, malformed, illegal, duplicatePaths, transpositionPaths };
}

function pathsFor(problems: readonly ReplayProblem[]): readonly (readonly string[])[] {
  return problems.map((problem) => problem.path);
}

/**
 * Inspect a parsed repertoire before Strategic Fit analysis.
 *
 * `ready` means only that the input can proceed to evidence extraction. It is never a claim that
 * the repertoire is strategically consistent. Degraded inputs remain analyzable with explicit
 * evidence limitations; blocking inputs must not proceed to position analysis.
 */
export function preflightStrategicFit(
  tree: GameTree,
  options: StrategicFitPreflightOptions,
): StrategicFitPreflight {
  const issues: PreflightIssue[] = [];
  const customStart = customStartProblem(tree);
  if (customStart?.unsupported) {
    issues.push(
      makeIssue(
        "unsupported-custom-start",
        "error",
        "blocking",
        "Strategic Fit cannot analyze a repertoire from a custom starting FEN.",
        [],
        { reason: customStart.reason, supported_start: "standard-initial-position" },
      ),
    );
  } else if (customStart) {
    issues.push(
      makeIssue("malformed-data", "error", "blocking", "The repertoire setup headers are malformed.", [], {
        reason: customStart.reason,
      }),
    );
  }

  if (options.repertoireColor === null) {
    issues.push(
      makeIssue(
        "missing-repertoire-color",
        "error",
        "blocking",
        "Strategic Fit requires the repertoire color to select player-turn checkpoints.",
      ),
    );
  }

  // A custom FEN must never be replayed from the standard position. The raw tree shape is enough
  // to report whether it is empty, but route evidence is intentionally withheld.
  const replay = customStart?.unsupported
    ? { routes: [], malformed: [], illegal: [], duplicatePaths: [], transpositionPaths: [] }
    : replayTree(tree);

  if (replay.malformed.length > 0) {
    issues.push(
      makeIssue(
        "malformed-data",
        "error",
        "blocking",
        "The repertoire contains malformed tree data.",
        pathsFor(replay.malformed),
        { reasons: replay.malformed.map((problem) => problem.reason) },
      ),
    );
  }
  if (replay.illegal.length > 0) {
    issues.push(
      makeIssue(
        "illegal-line",
        "error",
        "blocking",
        "The repertoire contains one or more illegal lines.",
        pathsFor(replay.illegal),
        { reasons: replay.illegal.map((problem) => problem.reason) },
      ),
    );
  }

  const rawRootChildren = (tree.game?.moves as unknown as { children?: unknown })?.children;
  const structurallyEmpty = Array.isArray(rawRootChildren) && rawRootChildren.length === 0;
  if (structurallyEmpty) {
    issues.push(
      makeIssue(
        "empty-repertoire",
        "error",
        "blocking",
        "Strategic Fit requires at least one legal repertoire route.",
      ),
    );
  }

  if (replay.duplicatePaths.length > 0) {
    issues.push(
      makeIssue(
        "duplicate-branch",
        "warning",
        "informational",
        "Duplicate editorial branches were found and should be normalized before cohort analysis.",
        replay.duplicatePaths,
        { duplicate_branch_count: replay.duplicatePaths.length },
      ),
    );
  }
  if (replay.transpositionPaths.length > 0) {
    const transpositionSourcePaths = replay.transpositionPaths.flat();
    issues.push(
      makeIssue(
        "transposition-detected",
        "warning",
        "informational",
        "Multiple move orders reach the same position; the Strategic Fit graph will normalize them.",
        transpositionSourcePaths,
        { transposition_group_count: replay.transpositionPaths.length },
      ),
    );
  }

  const routeCount = replay.routes.length;
  if (routeCount === 1) {
    issues.push(
      makeIssue(
        "single-route",
        "evidence-limitation",
        "degraded",
        "One route cannot establish a comparable strategic baseline.",
        [replay.routes[0]!.path],
        { route_count: routeCount },
      ),
    );
  }

  const shallowRoutes = replay.routes.filter((route) => route.path.length < STRATEGIC_FIT_MIN_COMPARABLE_PLY);
  if (shallowRoutes.length > 0) {
    issues.push(
      makeIssue(
        "shallow-route",
        "evidence-limitation",
        "degraded",
        `Routes ending before ply ${STRATEGIC_FIT_MIN_COMPARABLE_PLY} have incomplete strategic evidence.`,
        shallowRoutes.map((route) => route.path),
        {
          first_comparable_ply: STRATEGIC_FIT_MIN_COMPARABLE_PLY,
          shallow_route_count: shallowRoutes.length,
        },
      ),
    );
  }

  const incompleteRoutes =
    options.repertoireColor === null
      ? []
      : replay.routes.filter(
          (route) => !route.position.isEnd() && route.position.turn === options.repertoireColor,
        );
  if (incompleteRoutes.length > 0) {
    issues.push(
      makeIssue(
        "incomplete-route",
        "warning",
        "degraded",
        "Some routes stop when the repertoire side still needs a prepared move.",
        incompleteRoutes.map((route) => route.path),
        { incomplete_route_count: incompleteRoutes.length },
      ),
    );
  }

  const openingTableAvailable =
    options.openingTable !== null && options.openingTable !== undefined && options.openingTable.size > 0;
  const routesMissingOpening = openingTableAvailable
    ? replay.routes.filter((route) => !route.positionKeys.some((key) => options.openingTable!.has(key)))
    : replay.routes;
  if (!openingTableAvailable || routesMissingOpening.length > 0) {
    const paths = routesMissingOpening.map((route) => route.path);
    issues.push(
      makeIssue(
        "missing-opening-classification",
        "evidence-limitation",
        "degraded",
        openingTableAvailable
          ? "Some routes have no opening-classification evidence."
          : "Opening-classification data is unavailable for this analysis.",
        paths,
        {
          opening_table_available: openingTableAvailable,
          unclassified_route_count: routesMissingOpening.length,
        },
        [CORE_PROVENANCE, REPERTOIRE_PROVENANCE, taxonomyProvenance(openingTableAvailable)],
      ),
    );
  }

  const tacticalTerminalRoutes = replay.routes.filter((route) => route.position.isCheckmate());
  if (tacticalTerminalRoutes.length > 0) {
    issues.push(
      makeIssue(
        "terminal-tactical-route",
        "evidence-limitation",
        "degraded",
        "Checkmate ends some routes before a comparable strategic trajectory can be measured.",
        tacticalTerminalRoutes.map((route) => route.path),
        { terminal_tactical_route_count: tacticalTerminalRoutes.length },
      ),
    );
  }

  const terminalEndgameRoutes = replay.routes.filter(
    (route) => !route.position.isCheckmate() && route.position.board.occupied.size() <= 7,
  );
  if (terminalEndgameRoutes.length > 0) {
    issues.push(
      makeIssue(
        "terminal-endgame-route",
        "evidence-limitation",
        "degraded",
        "Some routes end in a seven-piece-or-fewer endgame and are not comparable to opening trajectories.",
        terminalEndgameRoutes.map((route) => route.path),
        { terminal_endgame_route_count: terminalEndgameRoutes.length, maximum_piece_count: 7 },
      ),
    );
  }

  const excludedPaths = new Set(
    [...incompleteRoutes, ...tacticalTerminalRoutes, ...terminalEndgameRoutes].map((route) => route.path.join("\u001f")),
  );
  const comparableRouteCount = replay.routes.filter(
    (route) => route.path.length >= STRATEGIC_FIT_MIN_COMPARABLE_PLY && !excludedPaths.has(route.path.join("\u001f")),
  ).length;
  const incompleteRouteCount = routeCount - comparableRouteCount;

  if (routeCount > 0 && comparableRouteCount < STRATEGIC_FIT_MIN_COMPARABLE_ROUTES) {
    issues.push(
      makeIssue(
        "insufficient-comparable-positions",
        "evidence-limitation",
        "degraded",
        "There are not enough comparable routes to establish a strategic baseline.",
        replay.routes.map((route) => route.path),
        {
          comparable_route_count: comparableRouteCount,
          minimum_comparable_routes: STRATEGIC_FIT_MIN_COMPARABLE_ROUTES,
        },
      ),
    );
  }

  const state = issues.some((issue) => issue.severity === "blocking")
    ? "blocked"
    : issues.some((issue) => issue.severity === "degraded")
      ? "degraded"
      : "ready";

  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    state,
    issues,
    route_count: routeCount,
    comparable_route_count: comparableRouteCount,
    incomplete_route_count: incompleteRouteCount,
  };
}
