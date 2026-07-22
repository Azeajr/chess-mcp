/** Dependency-free application contract consumed by the MCP and browser hosts. */
import { EXPLORER_RATING_BUCKETS, EXPLORER_SPEEDS } from "./explorer.js";

export type ToolHost = "mcp" | "browser";
export type ToolCapability = "position" | "game" | "repertoire" | "engine" | "network" | "artifact" | "action";
export type InputField = {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: readonly (string | number)[];
  items?: InputField;
  properties?: Readonly<Record<string, InputField>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  pattern?: string;
};
export type ToolInput = { properties: Readonly<Record<string, InputField>>; browserProperties?: Readonly<Record<string, InputField>>; mcpProperties?: Readonly<Record<string, InputField>>; required?: readonly string[]; mcpRequired?: readonly string[] };
export interface ToolContract {
  name: string;
  description: string;
  hosts: readonly ToolHost[];
  capabilities: readonly ToolCapability[];
  defaults: Readonly<Record<string, unknown>>;
  result: Readonly<{
    kind: "data" | "artifact" | "action";
    semantics?: string;
    compatibility?: string;
  }>;
  hostAdaptation: Readonly<{
    browserInjects: readonly string[];
    mcpInjects: readonly string[];
    resultDifference?: string;
  }>;
  /** Canonical shared arguments. Host context fields may be optional in one adapter. */
  input?: ToolInput;
}

const BOTH = ["mcp", "browser"] as const;
const MCP = ["mcp"] as const;
const BROWSER = ["browser"] as const;
const define = (name: string, description: string, capabilities: ToolCapability[], hosts: readonly ToolHost[] = BOTH, defaults: Record<string, unknown> = {}, input?: ToolInput): ToolContract =>
  ({
    name, description, capabilities, hosts, defaults,
    result: {
      kind: capabilities.includes("action") ? "action" : capabilities.includes("artifact") ? "artifact" : "data",
      ...(name === "analyze_repertoire_congruence" ? {
        semantics: "Versioned Strategic Fit V2 report with immutable summary, findings, preflight, paging, and provenance.",
        compatibility: "Includes a bounded deprecated V1 incongruencies projection until Task 12.5.",
      } : {}),
    },
    hostAdaptation: {
      browserInjects: name === "export_strategic_fit_metadata"
        ? ["stable document ID", "normalized Strategic Fit metadata"]
        : name === "export_strategic_fit_intent_pgn"
        ? ["current PGN", "current GameTree", "stable document ID", "document revision", "normalized Strategic Fit metadata", "current Strategic Fit report"]
        : name === "analyze_repertoire_congruence"
        ? ["current PGN", "current GameTree", "repertoire color", "document revision", "opening taxonomy", "optional explorer credentials", "Strategic Fit Web Worker"]
        : input?.properties.repertoire_id ? ["current GameTree", "repertoire color"] : [
        ...(input?.properties.fen && !(input.required ?? []).includes("fen") ? ["current FEN"] : []),
        ...(input?.properties.pgn && !(input.required ?? []).includes("pgn") ? ["current PGN"] : []),
      ],
      mcpInjects: name === "analyze_repertoire_congruence"
        ? ["repertoire handle lookup", "handle revision", "bounded opening taxonomy", "optional explorer credentials"]
        : input?.properties.repertoire_id ? ["repertoire handle lookup"] : [],
      ...(name === "get_position" ? { resultDifference: "browser adds current repertoire color" }
        : name === "modify_repertoire_line" ? { resultDifference: "MCP returns a clone-on-write handle; browser returns a non-mutating preview" }
        : name === "analyze_game" ? { resultDifference: "MCP supports the host-only verbose result projection" }
        : name === "analyze_repertoire_congruence" ? { resultDifference: "Browser execution uses the dedicated Worker; MCP runs the deterministic analyzer in-process. Each host optionally collects bounded explorer evidence before that shared analyzer boundary." }
        : {}),
    },
    ...(input ? { input } : {}),
  });
const string = (description?: string, maxLength?: number, pattern?: string): InputField => ({ type: "string", ...(description ? { description } : {}), ...(maxLength == null ? {} : { maxLength }), ...(pattern == null ? {} : { pattern }) });
const integer = (minimum?: number, maximum?: number): InputField => ({ type: "integer", ...(minimum == null ? {} : { minimum }), ...(maximum == null ? {} : { maximum }) });
const number = (minimum?: number, maximum?: number): InputField => ({ type: "number", ...(minimum == null ? {} : { minimum }), ...(maximum == null ? {} : { maximum }) });
const array = (items: InputField = string(), minItems?: number, maxItems?: number): InputField => ({ type: "array", items, ...(minItems == null ? {} : { minItems }), ...(maxItems == null ? {} : { maxItems }) });
const object = (properties: Readonly<Record<string, InputField>>, required: readonly string[] = []): InputField => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });

const strategicFitId = () => string(undefined, 256);
const strategicFitIdList = (minimum: number | undefined = undefined, maximum = 500) => array(strategicFitId(), minimum, maximum);
const strategicFitProfile = object({
  mode: { type: "string", enum: ["familiar-plans", "balanced", "versatile", "custom"] },
  preferences: object({
    maximum_engine_loss_cp: integer(0, 1000),
    opponent_popularity_importance: number(0, 1),
    personal_game_frequency_importance: number(0, 1),
    manual_weight_importance: number(0, 1),
    additional_memorization_tolerance: number(0, 1),
    preferred_concept_ids: strategicFitIdList(undefined, 128),
    avoided_concept_ids: strategicFitIdList(undefined, 128),
    preferred_tactical_character: array(string(undefined, 128), undefined, 32),
    minimum_opponent_coverage: number(0, 1),
  }),
}, ["mode"]);
const strategicFitWeighting = object({
  mode: { type: "string", enum: ["equal", "manual", "external"] },
  route_weights: array(object({ route_id: strategicFitId(), weight: number(0, 1_000_000) }, ["route_id", "weight"]), undefined, 500),
  decision_weights: array(object({ decision_id: strategicFitId(), weight: number(0, 1_000_000) }, ["decision_id", "weight"]), undefined, 500),
});
const explorerRecency = string("Lichess: YYYY-MM; masters: YYYY", 7, "^(?:\\d{4}|\\d{4}-(?:0[1-9]|1[0-2]))$");
const explorerPopulationFilters = {
  db: { type: "string", enum: ["lichess", "masters"] },
  speeds: array({ type: "string", enum: EXPLORER_SPEEDS }, 1, EXPLORER_SPEEDS.length),
  ratings: array(integer(0, 2500), 1, EXPLORER_RATING_BUCKETS.length),
  since: explorerRecency,
  until: explorerRecency,
} as const satisfies Readonly<Record<string, InputField>>;
const strategicFitPopularity = object({
  ...explorerPopulationFilters,
  max_positions: integer(1, 120),
});
const strategicFitPage = object({ offset: integer(0, 1_000_000), limit: integer(1, 50) });
const strategicFitCohortOverride = object({
  override_id: strategicFitId(),
  kind: { type: "string", enum: ["merge", "split", "exclude"] },
  route_ids: strategicFitIdList(1, 500),
  decision_ids: strategicFitIdList(1, 500),
}, ["override_id", "kind"]);
const strategicFitExplicitTarget = object({
  target_id: strategicFitId(),
  cohort_id: strategicFitId(),
  representative_route_id: strategicFitId(),
  supporting_route_ids: strategicFitIdList(1, 500),
  concept_ids: strategicFitIdList(undefined, 128),
}, ["target_id", "cohort_id", "representative_route_id"]);
const strategicFitRouteAssessment = object({
  route_id: strategicFitId(),
  matches_declared_objective: { type: "boolean" },
  resolution_state: {
    type: "string",
    enum: ["unresolved", "change-repertoire", "keep-intentionally", "train-as-exception", "reclassify-cohort", "exclude-from-analysis", "defer", "insufficient-evidence", "automatically-resolved-by-another-edit"],
  },
  alternative_state: { type: "string", enum: ["viable-more-congruent", "no-acceptable-alternative", "not-assessed"] },
}, ["route_id"]);

export const TOOL_CONTRACTS = [
  define("validate_fen", "Validate a FEN; returns the normalised FEN when legal.", ["position"], BOTH, {}, { properties: { fen: string() }, required: ["fen"] }),
  define("validate_pgn", "Validate a PGN; returns the game count.", ["game"], BOTH, {}, { properties: { pgn: string() }, required: ["pgn"] }),
  define("validate_line", "Validate SAN moves from a FEN; returns canonical SANs or the first illegal index.", ["position"], BOTH, {}, { properties: { fen: string("FEN; browser defaults to the current position"), moves: array() }, required: ["moves"], mcpRequired: ["fen", "moves"] }),
  define("get_legal_moves", "Legal moves (SAN) at a FEN.", ["position"], BOTH, {}, { properties: { fen: string("FEN; browser defaults to the current position") }, mcpRequired: ["fen"] }),
  define("get_position", "Ground the current position with its normalised FEN and legal moves; the browser also includes current-document context.", ["position"], BOTH, {}, { properties: { fen: string("FEN; browser uses its current position when omitted") }, mcpRequired: ["fen"] }),
  define("evaluate_position", "Local Stockfish multi-line analysis with white-POV cp/mate scores.", ["position", "engine"], BOTH, { depth: 20, lines: 3 }, { properties: { fen: string("FEN; browser defaults to the current position"), depth: integer(1, 30), lines: integer(1, 5) }, mcpRequired: ["fen"] }),
  define("compare_moves", "Rank candidate SAN moves by local Stockfish (mover POV); illegal moves are returned separately.", ["position", "engine"], BOTH, { depth: 20 }, { properties: { fen: string("FEN; browser defaults to the current position"), moves: array(), depth: integer(1, 30) }, required: ["moves"], mcpRequired: ["fen", "moves"] }),
  define("cloud_eval", "Lichess cloud evaluation (white-POV) for a FEN, or unavailable.", ["position", "network"], BOTH, {}, { properties: { fen: string("FEN; browser defaults to the current position") }, mcpRequired: ["fen"] }),
  define("tablebase_lookup", "Lichess tablebase result for a seven-piece-or-fewer FEN, or unavailable.", ["position", "network"], BOTH, {}, { properties: { fen: string("FEN; browser defaults to the current position") }, mcpRequired: ["fen"] }),
  define("position_popularity", "Lichess opening-explorer statistics for a configured game population, including move frequencies and white-POV results.", ["position", "network"], BOTH, { db: "lichess", top_moves: 12 }, { properties: { fen: string("FEN; browser defaults to the current position"), ...explorerPopulationFilters, top_moves: integer(0, 30) }, mcpRequired: ["fen"] }),
  define("identify_opening", "Name the deepest ECO opening reached by a PGN.", ["position", "game"], BOTH, {}, { properties: { pgn: string("PGN; browser defaults to the current working line") }, mcpRequired: ["pgn"] }),
  define("find_repertoire_gaps", "Scan decision nodes for uncovered strong opponent replies, ranked by severity.", ["repertoire", "engine"], BOTH, { depth: 20, limit: 20, popularity_db: "lichess" }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), depth: integer(1, 30), min_severity: { type: "string", enum: ["low", "medium", "high"] }, max_positions: integer(1, 60), limit: integer(1, 50), popularity: { type: "boolean" }, popularity_db: { type: "string", enum: ["lichess", "masters"] } }, mcpRequired: ["repertoire_id"] }),
  define("suggest_gap_fills", "Build best-evaluation and best-fit repertoire lines for one uncovered opponent move.", ["repertoire", "engine"], BOTH, { depth: 20, limit: 4 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), variation_path: array(), uncovered_move: string(), depth: integer(1, 30), limit: integer(2, 10), target_plies: integer(2, 200) }, required: ["variation_path", "uncovered_move"], mcpRequired: ["repertoire_id", "variation_path", "uncovered_move"] }),
  define("find_theory_depth", "Report where repertoire lines leave known opening theory using explorer game counts.", ["repertoire", "network"], BOTH, { db: "lichess", max_positions: 60 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), db: { type: "string", enum: ["lichess", "masters"] }, min_games: integer(1), max_positions: integer(1, 120) }, mcpRequired: ["repertoire_id"] }),
  define("get_transpositions", "Positions the repertoire reaches by more than one move order, largest groups first.", ["repertoire"], BOTH, { limit: 20 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100) }, mcpRequired: ["repertoire_id"] }),
  define("find_pruning_transpositions", "Find sound moves that transpose into another prepared line and shorten memorisation.", ["repertoire", "engine"], BOTH, { limit: 20, multipv: 4, cp_threshold: 50, depth: 20 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100), multipv: integer(1, 8), cp_threshold: integer(0, 500), max_loss_cp: integer(0, 1000), depth: integer(1, 30), movetime_ms: integer(50, 10000), budget: integer(1, 500), leaf_start: integer(0), leaf_count: integer(1, 200), confirm_depth: integer(1, 30) }, mcpRequired: ["repertoire_id"] }),
  define("get_repertoire_coverage", "Report dangling lines and natural frontiers; optionally engine-check whether stubs reconnect.", ["repertoire", "engine"], BOTH, { limit: 20, connect_stubs: false, depth: 20 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100), connect_stubs: { type: "boolean" }, depth: integer(1, 30) }, mcpRequired: ["repertoire_id"] }),
  define("get_structural_profile", "Return a repertoire-wide pawn-structure profile or one position selected by SAN path.", ["repertoire"], BOTH, {}, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), variation_path: array() }, mcpRequired: ["repertoire_id"] }),
  define(
    "analyze_repertoire_congruence",
    "Analyze Strategic Fit across transposition-aware repertoire routes; returns native V2 evidence plus a temporary legacy projection.",
    ["repertoire", "network"],
    BOTH,
    { profile_mode: "balanced", weighting_mode: "equal", popularity_db: "lichess", popularity_max_positions: 60, page_limit: 50, legacy_projection_limit: 10 },
    {
      properties: {
        repertoire_id: string("MCP handle; browser injects the current document"),
        profile: strategicFitProfile,
        weighting: strategicFitWeighting,
        popularity: strategicFitPopularity,
        page: strategicFitPage,
        sort: { type: "string", enum: ["replacement-priority", "training-priority", "expected-frequency", "opening-scope", "finding-id"] },
        cohort_overrides: array(strategicFitCohortOverride, undefined, 100),
        explicit_targets: array(strategicFitExplicitTarget, undefined, 100),
        route_assessments: array(strategicFitRouteAssessment, undefined, 500),
        min_severity: { type: "string", enum: ["low", "medium", "high"], description: "Deprecated V1 compatibility input." },
        limit: integer(1, 50),
        acknowledged_weaknesses: array(array(string(undefined, 128), undefined, 256), undefined, 500),
        exclude_paths: array(array(string(undefined, 128), undefined, 256), undefined, 500),
      },
      mcpRequired: ["repertoire_id"],
    },
  ),
  define("classify_illustrative_lines", "Find NAG-marked side lines that can inflate repertoire analysis counts.", ["repertoire"], BOTH, { limit: 20 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100) }, mcpRequired: ["repertoire_id"] }),
  define("modify_repertoire_line", "Apply or preview a prune, add, or reorder edit by SAN path.", ["repertoire", "action"], BOTH, {}, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), action: { type: "string", enum: ["prune", "add", "reorder"] }, path: array(), add_moves: array(), promote_move: string() }, required: ["action", "path"], mcpRequired: ["repertoire_id", "action", "path"] }),
  define("suggest_complementary_lines", "Suggest engine-sound moves ranked for structural fit or imbalance.", ["repertoire", "engine"], BOTH, { depth: 20, limit: 5 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), fen: string("FEN; browser defaults to the current position"), mode: { type: "string", enum: ["low_memorization", "sharp"] }, depth: integer(1, 30), limit: integer(1, 10) }, mcpRequired: ["repertoire_id", "fen"] }),
  define("suggest_replacement_line", "Suggest sound replacements for an incongruent repertoire line.", ["repertoire", "engine"], BOTH, { depth: 20 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), outlier_variation_path: array(), mode: { type: "string", enum: ["structural_fit", "low_memorization", "solid"] }, depth: integer(1, 30) }, required: ["outlier_variation_path"], mcpRequired: ["repertoire_id", "outlier_variation_path"] }),
  define("analyze_game", "Per-move engine review of a game's mainline with centipawn loss and classification.", ["game", "engine"], BOTH, { depth: 20 }, { properties: { pgn: string("PGN; browser defaults to the current working line"), depth: integer(1, 30) }, mcpProperties: { verbose: { type: "boolean" } }, mcpRequired: ["pgn"] }),
  define("get_game_summary", "Game-review summary with per-side counts, accuracy, and worst moves.", ["game", "engine"], BOTH, { depth: 20 }, { properties: { pgn: string("PGN; browser defaults to the current working line"), depth: integer(1, 30) }, mcpRequired: ["pgn"] }),
  define("export_annotated_pgn", "Annotate a game's mainline with move glyphs and best-move/evaluation comments.", ["game", "engine", "artifact"], BOTH, { depth: 20 }, { properties: { pgn: string("PGN; browser defaults to the current working line"), depth: integer(1, 30) }, mcpRequired: ["pgn"] }),
  define("batch_review", "Analyze multiple games and aggregate results by opening or player color.", ["game", "engine"], BOTH, { group_by: "eco", max_games: 100, depth: 20 }, { properties: { pgn: string(), group_by: { type: "string", enum: ["eco", "color"] }, username: string(), max_games: integer(1, 100), depth: integer(1, 30) }, required: ["pgn"], mcpRequired: ["pgn"] }),
  define("lichess_games", "Fetch recent games for a Lichess user.", ["game", "network"], BOTH, { max_games: 20, include_pgn: false }, { properties: { username: string(), max_games: integer(1, 100), opening_eco: string(), include_pgn: { type: "boolean" } }, required: ["username"] }),
  define("chesscom_games", "Fetch games for a Chess.com user in a given month.", ["game", "network"], BOTH, { include_pgn: false }, { properties: { username: string(), year: integer(), month: integer(1, 12), opening_eco: string(), include_pgn: { type: "boolean" } }, required: ["username", "year", "month"] }),
  define("repertoire_vs_history", "Compare a repertoire with a user's games and report all departures.", ["repertoire", "game", "network"], BOTH, { platform: "lichess", max_games: 30 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), username: string(), platform: { type: "string", enum: ["lichess", "chesscom"] }, max_games: integer(1, 100), year: integer(), month: integer(1, 12) }, required: ["username"], mcpRequired: ["repertoire_id", "username"] }),
  define("audit_repertoire_moves", "Engine-check prescribed moves tree-wide and rank findings by centipawn loss.", ["repertoire", "engine"], BOTH, { depth: 20, min_cp_loss: 50, max_positions: 20, limit: 10 }, { properties: { repertoire_id: string(), depth: integer(1, 30), min_cp_loss: integer(0), max_positions: integer(1, 60), limit: integer(1, 50) }, mcpRequired: ["repertoire_id"] }),
  define("find_only_moves", "Find positions where the best move clearly exceeds the second choice.", ["repertoire", "engine", "artifact"], BOTH, { depth: 20, min_margin: 100, max_positions: 300, limit: 25, lines_limit: 10 }, { properties: { repertoire_id: string(), depth: integer(1, 30), min_margin: integer(0), max_positions: integer(1, 300), limit: integer(1, 100), lines_limit: integer(1, 50) }, browserProperties: { export_deck: { type: "boolean" } }, mcpProperties: { export_path: string() }, mcpRequired: ["repertoire_id"] }),
  define("find_structures", "Search repertoire leaves by structure, center, themes, or color complex.", ["repertoire"], BOTH, { min_confidence: 0.6, limit: 30 }, { properties: { repertoire_id: string(), structure: string(), min_confidence: { type: "number", minimum: 0, maximum: 1 }, center: { type: "string", enum: ["tense", "locked", "open", "semi-open"] }, themes: array({ type: "string", enum: ["fianchetto_white", "fianchetto_black", "minority_attack_white", "minority_attack_black", "flank_vs_center"] }), color_complex: { type: "string", enum: ["light", "dark"] }, limit: integer(1, 100) }, mcpRequired: ["repertoire_id"] }),
  define("check_shortcut_coverage", "Check whether pruning a shortcut line creates an uncovered gap.", ["repertoire", "engine"], MCP, { depth: 20 }, { properties: { repertoire_id: string(), line_path: array(), at_ply: integer(0), depth: integer(1, 30), min_severity: { type: "string", enum: ["low", "medium", "high"] }, max_positions: integer(1, 60), limit: integer(1, 50) }, mcpRequired: ["repertoire_id", "line_path", "at_ply"] }),
  define("compare_shortcut_lines", "Compare shortcut candidates by engine quality and structural fit.", ["repertoire", "engine"], MCP, { depth: 20, eval_tiebreak_cp: 30 }, { properties: { repertoire_id: string(), line_path: array(), at_ply: integer(0), joins_path: array(), depth: integer(1, 30), eval_tiebreak_cp: integer(0, 500) }, mcpRequired: ["repertoire_id", "line_path", "at_ply", "joins_path"] }),
  define("inspect_shortcut", "Inspect one shortcut candidate for both line quality and coverage safety.", ["repertoire", "engine"], BROWSER, { depth: 20, max_positions: 12, eval_tiebreak_cp: 30 }, { properties: { line_path: array(), at_ply: integer(0), joins_path: array(), depth: integer(1, 30), max_positions: integer(1, 60), min_severity: { type: "string", enum: ["low", "medium", "high"] }, limit: integer(1, 50), eval_tiebreak_cp: integer(0, 500) }, required: ["line_path", "at_ply", "joins_path"] }),
  define("export_annotated_repertoire", "Run analyses and produce a cloned, annotated repertoire PGN.", ["repertoire", "engine", "artifact"], BOTH, { include: ["audit", "only_moves", "gaps", "congruence"], depth: 20 }, { properties: { repertoire_id: string(), include: array({ type: "string", enum: ["audit", "only_moves", "gaps", "congruence"] }), depth: integer(1, 30), max_positions: integer(1, 300), min_cp_loss: integer(0), min_margin: integer(0), min_severity: { type: "string", enum: ["low", "medium", "high"] } }, mcpProperties: { export_path: string() }, mcpRequired: ["repertoire_id"] }),
  define("prep_vs_opponent", "Compare a repertoire with an opponent's games and summarize preparation targets.", ["repertoire", "game", "network"], BOTH, { platform: "lichess", max_games: 30 }, { properties: { repertoire_id: string(), username: string(), platform: { type: "string", enum: ["lichess", "chesscom"] }, max_games: integer(1, 100), year: integer(), month: integer(1, 12) }, required: ["username"], mcpRequired: ["repertoire_id", "username"] }),
  define("load_repertoire", "Parse a repertoire PGN and return a Node-host handle.", ["repertoire"], MCP, {}, { properties: { pgn: string(), color: { type: "string", enum: ["white", "black"] } }, mcpRequired: ["pgn", "color"] }),
  define("load_repertoire_from_file", "Load a repertoire PGN from the confined Node repertoire directory.", ["repertoire"], MCP, {}, { properties: { path: string(), color: { type: "string", enum: ["white", "black"] } }, mcpRequired: ["path", "color"] }),
  define("export_repertoire", "Serialize a Node repertoire handle to PGN.", ["repertoire", "artifact"], MCP, {}, { properties: { repertoire_id: string() }, mcpRequired: ["repertoire_id"] }),
  define("export_repertoire_to_file", "Write repertoire PGN under the confined Node repertoire directory.", ["repertoire", "artifact"], MCP, {}, { properties: { repertoire_id: string(), path: string() }, mcpRequired: ["repertoire_id", "path"] }),
  define("propose_line", "Stage a validated SAN line for explicit user acceptance without mutating the repertoire.", ["repertoire", "action"], BROWSER, {}, { properties: { moves: array(), comment: string() }, required: ["moves"] }),
  define("get_selected_subtree", "Retrieve bounded SAN lines for the currently selected repertoire subtree.", ["repertoire"], BROWSER, { max_plies: 80 }, { properties: { max_plies: integer(1, 200) } }),
  define("get_document_pgn", "Retrieve the full current PGN only when an operation genuinely needs the artifact.", ["game", "repertoire", "artifact"], BROWSER, {}, { properties: {} }),
  define(
    "export_strategic_fit_metadata",
    "Export the current document's normalized Strategic Fit metadata as a versioned, secret-free JSON sidecar.",
    ["repertoire", "artifact"],
    BROWSER,
    {},
    { properties: {} },
  ),
  define(
    "export_strategic_fit_intent_pgn",
    "Export a cloned legal PGN with bounded portable comments for confirmed Strategic Fit intent, resolutions, and findings.",
    ["repertoire", "artifact"],
    BROWSER,
    { max_findings: 25, max_resolutions: 25 },
    { properties: { max_findings: integer(0, 100), max_resolutions: integer(0, 100) } },
  ),
] as const;

export const TOOL_CONTRACT_BY_NAME = new Map(TOOL_CONTRACTS.map((tool) => [tool.name, tool]));
export const contractsForHost = (host: ToolHost) => TOOL_CONTRACTS.filter((tool) => (tool.hosts as readonly ToolHost[]).includes(host));
export function toolContract(name: string): ToolContract {
  const value = TOOL_CONTRACT_BY_NAME.get(name);
  if (!value) throw new Error(`unknown tool contract: ${name}`);
  return value;
}
export function toolDefault<T>(name: string, key: string, fallback: T): T {
  return (toolContract(name).defaults[key] as T | undefined) ?? fallback;
}

export function jsonSchemaForTool(name: string, host: ToolHost): Record<string, unknown> | null {
  const contract = toolContract(name);
  if (!(contract.hosts as readonly ToolHost[]).includes(host)) return null;
  if (!contract.input) return null;
  const omitted = host === "browser" ? new Set(["repertoire_id"]) : new Set<string>();
  const hostProperties = host === "mcp" ? contract.input.mcpProperties : contract.input.browserProperties;
  const properties = Object.fromEntries(Object.entries({ ...contract.input.properties, ...hostProperties }).filter(([key]) => !omitted.has(key)));
  // Browser FEN/PGN/current-tree fields are context-injected; MCP Zod remains stricter where its
  // transport requires them. Required entries absent from this host are removed mechanically.
  const required = ((host === "mcp" ? (contract.input.mcpRequired ?? contract.input.required) : contract.input.required) ?? []).filter((key) => key in properties);
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export type ArgumentsResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: "invalid_arguments"; reason: string };
function fieldError(field: InputField, candidate: unknown, path: string): string | null {
  const valid = field.type === "array"
    ? Array.isArray(candidate)
    : field.type === "object"
      ? typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
      : field.type === "integer"
        ? Number.isInteger(candidate)
        : field.type === "number"
          ? typeof candidate === "number" && Number.isFinite(candidate)
          : typeof candidate === field.type;
  if (!valid) return `${path} must be ${field.type}`;
  if (typeof candidate === "number" && (candidate < (field.minimum ?? -Infinity) || candidate > (field.maximum ?? Infinity))) return `${path} is outside the allowed range`;
  if (typeof candidate === "string" && candidate.length > (field.maxLength ?? Infinity)) return `${path} is outside the allowed length`;
  if (typeof candidate === "string" && field.pattern && !new RegExp(field.pattern).test(candidate)) return `${path} has an invalid format`;
  if (field.enum && !field.enum.includes(candidate as never)) return `${path} must be one of: ${field.enum.join(", ")}`;
  if (field.type === "array" && field.items) {
    if ((candidate as unknown[]).length < (field.minItems ?? 0) || (candidate as unknown[]).length > (field.maxItems ?? Infinity)) {
      return `${path} is outside the allowed item count`;
    }
    for (let i = 0; i < (candidate as unknown[]).length; i++) {
      const nested = fieldError(field.items, (candidate as unknown[])[i], `${path}[${i}]`);
      if (nested) return nested;
    }
  }
  if (field.type === "object") {
    const value = candidate as Record<string, unknown>;
    for (const key of field.required ?? []) {
      if (!(key in value)) return `missing required argument: ${path}.${key}`;
    }
    const properties = field.properties ?? {};
    for (const [key, nestedCandidate] of Object.entries(value)) {
      const nestedField = properties[key];
      if (!nestedField && field.additionalProperties === false) return `unknown argument: ${path}.${key}`;
      if (!nestedField) continue;
      const nested = fieldError(nestedField, nestedCandidate, `${path}.${key}`);
      if (nested) return nested;
    }
  }
  return null;
}

function duplicateIdentity(values: readonly unknown[], key: string): string | null {
  const seen = new Set<unknown>();
  for (const value of values) {
    const identity = (value as Record<string, unknown>)[key];
    if (seen.has(identity)) return String(identity);
    seen.add(identity);
  }
  return null;
}

function strategicFitArgumentsError(value: Record<string, unknown>): string | null {
  if (value.popularity !== undefined && value.weighting !== undefined) {
    return "popularity and weighting are alternative route-weight sources and cannot be combined";
  }
  const popularityReason = explorerPopulationArgumentsError(
    value.popularity as Record<string, unknown> | undefined,
    "popularity",
  );
  if (popularityReason) return popularityReason;

  const weighting = value.weighting as Record<string, unknown> | undefined;
  for (const [list, identity] of [["route_weights", "route_id"], ["decision_weights", "decision_id"]] as const) {
    const items = weighting?.[list] as readonly unknown[] | undefined;
    const duplicate = items && duplicateIdentity(items, identity);
    if (duplicate) return `weighting.${list} contains duplicate ${identity}: ${duplicate}`;
  }

  const overrides = value.cohort_overrides as readonly Record<string, unknown>[] | undefined;
  const duplicateOverride = overrides && duplicateIdentity(overrides, "override_id");
  if (duplicateOverride) return `cohort_overrides contains duplicate override_id: ${duplicateOverride}`;
  for (const [index, override] of (overrides ?? []).entries()) {
    const kind = override.kind;
    const routeIds = override.route_ids as readonly string[] | undefined;
    const decisionIds = override.decision_ids as readonly string[] | undefined;
    if ((kind === "merge" || kind === "split") && !routeIds?.length) {
      return `cohort_overrides[${index}].route_ids is required for ${kind}`;
    }
    if ((kind === "merge" || kind === "split") && decisionIds) {
      return `cohort_overrides[${index}].decision_ids is only valid for exclude`;
    }
    if (kind === "exclude" && !routeIds?.length && !decisionIds?.length) {
      return `cohort_overrides[${index}] must select route_ids or decision_ids`;
    }
  }

  const targets = value.explicit_targets as readonly Record<string, unknown>[] | undefined;
  const duplicateTarget = targets && duplicateIdentity(targets, "target_id");
  if (duplicateTarget) return `explicit_targets contains duplicate target_id: ${duplicateTarget}`;

  const assessments = value.route_assessments as readonly Record<string, unknown>[] | undefined;
  const duplicateAssessment = assessments && duplicateIdentity(assessments, "route_id");
  if (duplicateAssessment) return `route_assessments contains duplicate route_id: ${duplicateAssessment}`;
  for (const [index, assessment] of (assessments ?? []).entries()) {
    if (Object.keys(assessment).every((key) => key === "route_id")) {
      return `route_assessments[${index}] must contain an assessment`;
    }
  }
  return null;
}

function explorerPopulationArgumentsError(
  filters: Record<string, unknown> | undefined,
  path: string,
): string | null {
  if (!filters) return null;
  const db = filters.db ?? "lichess";
  const ratings = filters.ratings as readonly unknown[] | undefined;
  if (ratings?.some((rating) =>
    typeof rating !== "number" || !(EXPLORER_RATING_BUCKETS as readonly number[]).includes(rating)
  )) return `${path}.ratings contains an unsupported explorer rating bucket`;
  if (db === "masters" && (filters.speeds !== undefined || filters.ratings !== undefined)) {
    return `${path}.speeds and ${path}.ratings apply only to the lichess database`;
  }
  const pattern = db === "masters" ? /^\d{4}$/ : /^\d{4}-(0[1-9]|1[0-2])$/;
  for (const key of ["since", "until"] as const) {
    const candidate = filters[key];
    if (typeof candidate === "string" && !pattern.test(candidate)) {
      return `${path}.${key} has an invalid format for ${String(db)}`;
    }
  }
  if (
    typeof filters.since === "string" &&
    typeof filters.until === "string" &&
    filters.since > filters.until
  ) return `${path}.since must not be after ${path}.until`;
  return null;
}

export function validateToolArguments(name: string, raw: unknown, host: ToolHost): ArgumentsResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_arguments", reason: "arguments must be an object" };
  const contract = TOOL_CONTRACT_BY_NAME.get(name);
  if (!contract) return { ok: false, error: "invalid_arguments", reason: `unknown tool: ${name}` };
  if (!(contract.hosts as readonly ToolHost[]).includes(host)) return { ok: false, error: "invalid_arguments", reason: `${name} is not available on the ${host} host` };
  if (!contract.input) return { ok: true, value: raw as Record<string, unknown> };
  const value = raw as Record<string, unknown>;
  const schema = jsonSchemaForTool(name, host)!;
  const properties = schema.properties as Record<string, InputField>;
  for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in value)) return { ok: false, error: "invalid_arguments", reason: `missing required argument: ${key}` };
  for (const [key, candidate] of Object.entries(value)) {
    const field = properties[key];
    if (!field) return { ok: false, error: "invalid_arguments", reason: `unknown argument: ${key}` };
    const reason = fieldError(field, candidate, key);
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  if (name === "analyze_repertoire_congruence") {
    const reason = strategicFitArgumentsError(value);
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  if (name === "position_popularity") {
    const reason = explorerPopulationArgumentsError(value, "position_popularity");
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  return { ok: true, value };
}
