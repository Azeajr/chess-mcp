/** Dependency-free application contract consumed by the MCP and browser hosts. */
import { EXPLORER_RATING_BUCKETS, EXPLORER_SPEEDS } from "./explorer.js";
import { STRATEGIC_FIT_PLAN_SECTION_KINDS } from "./strategic-fit/plan-synthesis.js";
import { STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS } from "./strategic-fit/portfolio.js";

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
      } : {}),
      ...(name === "suggest_replacement_line" ? {
        semantics: "A complete revision-bound Strategic Fit V2 candidate/change-set preview envelope. No host silently applies a preview.",
        compatibility: "Requires the complete canonical retained safety envelope.",
      } : {}),
      ...(name === "get_strategic_fit_report" ? {
        semantics: "Bounded conversation projection of an existing immutable report: identity, overview state, one compact finding page, or one finding with evidence and navigable paths. Never the full report, provenance, or any document artifact.",
      } : {}),
      ...(name === "propose_strategic_fit_profile" ? {
        semantics: "Staged, revision-bound profile proposal with the exact field-level diff against the current effective profile. Proposing changes nothing: the profile, the repertoire tree, and cached reports are untouched until the user accepts in the application.",
      } : {}),
      ...(name === "propose_strategic_fit_plan" ? {
        semantics: "Either the bounded deterministic evidence basis for one finding, or a staged plan card validated against it. Proposing changes nothing: training metadata, the resolution, and the repertoire tree are untouched until the user accepts in the application.",
      } : {}),
      ...(name === "propose_strategic_fit_portfolio" ? {
        semantics: "Constraints staged for confirmation with any contradictions named, a bounded Pareto portfolio whose options are existing candidates with their retained measurements and change sets, or one option staged through the existing change-review path. Nothing is selected automatically, nothing is applied, and no preference is persisted.",
      } : {}),
    },
    hostAdaptation: {
      browserInjects: name === "export_strategic_fit_metadata"
        ? ["stable document ID", "normalized Strategic Fit metadata"]
        : name === "export_strategic_fit_intent_pgn"
        ? ["current PGN", "current GameTree", "stable document ID", "document revision", "normalized Strategic Fit metadata", "current Strategic Fit report"]
        : name === "analyze_repertoire_congruence"
        ? ["current PGN", "current GameTree", "repertoire color", "document revision", "opening taxonomy", "optional explorer credentials", "optional fetched personal-game PGNs", "Strategic Fit Web Worker"]
        : name === "suggest_replacement_line"
        ? ["current GameTree", "repertoire color", "stable document ID", "document revision", "browser engine/Worker and explorer boundaries", "revision-bound staged change-set storage"]
        : name === "get_strategic_fit_report"
        ? ["document revision", "bounded cached Strategic Fit report lookup by report identity"]
        : name === "propose_strategic_fit_profile"
        ? ["stable document ID", "document revision", "current effective Strategic Fit profile", "Strategic Fit analysis-settings identity", "session-only staged proposal storage"]
        : name === "propose_strategic_fit_plan"
        ? ["stable document ID", "document revision", "current Strategic Fit report and finding", "deterministic training record for that finding", "session-only staged plan storage", "the existing training writer used on acceptance"]
        : name === "propose_strategic_fit_portfolio"
        ? ["stable document ID", "document revision", "current effective Strategic Fit profile", "the open Replacement Lab's retained Task 8.6 scoring, Task 8.7 safety, and Task 8.8 change-set previews", "session-only staged constraint and portfolio storage", "the existing revision-bound change-review staging path used on selection"]
        : input?.properties.repertoire_id ? ["current GameTree", "repertoire color"] : [
        ...(input?.properties.fen && !(input.required ?? []).includes("fen") ? ["current FEN"] : []),
        ...(input?.properties.pgn && !(input.required ?? []).includes("pgn") ? ["current PGN"] : []),
      ],
      mcpInjects: name === "analyze_repertoire_congruence"
        ? ["repertoire handle lookup", "handle revision", "bounded opening taxonomy", "optional explorer credentials", "optional fetched personal-game PGNs"]
        : name === "suggest_replacement_line"
        ? ["immutable repertoire handle lookup", "handle revision", "Node engine pool and optional explorer credentials", "explicit no-archive/no-undo limitation"]
        : name === "get_strategic_fit_report"
        ? ["repertoire handle lookup", "handle revision", "bounded per-handle Strategic Fit report lookup by report identity"]
        : input?.properties.repertoire_id ? ["repertoire handle lookup"] : [],
      ...(name === "get_position" ? { resultDifference: "browser adds current repertoire color" }
        : name === "modify_repertoire_line" ? { resultDifference: "MCP returns a clone-on-write handle; browser returns a non-mutating preview" }
        : name === "analyze_game" ? { resultDifference: "MCP supports the host-only verbose result projection" }
        : name === "analyze_repertoire_congruence" ? { resultDifference: "Browser execution uses the dedicated Worker; MCP runs the deterministic analyzer in-process. Each host optionally collects bounded explorer evidence and fetched personal-game PGNs before that shared analyzer boundary." }
        : name === "propose_strategic_fit_profile" ? { resultDifference: "Browser only. MCP keeps no document profile: an MCP session passes the confirmed profile explicitly with each analysis, so there is nothing there to stage, diff, or persist." }
        : name === "propose_strategic_fit_plan" ? { resultDifference: "Browser only. Training records, resolutions, and drill artifacts are browser document state; an MCP session keeps none of them, so it has nothing to ground a plan card in and nothing to save it to." }
        : name === "propose_strategic_fit_portfolio" ? { resultDifference: "Browser only. A portfolio option is one of the open Replacement Lab's retained candidates, and selecting it stages a change for revision-bound confirmation; an MCP session holds no lab result and no staging, archive, or undo, so it has nothing to build a portfolio from and nowhere to stage one. On MCP, `suggest_replacement_line` already returns the same previews as immutable results." }
        : name === "get_strategic_fit_report" ? { resultDifference: "Each host resolves the report identity in its own bounded cache — per handle on MCP, per document settings in the browser — and both project the same shared bounded views. A report that is not cached, or that belongs to another revision, fails closed rather than returning older evidence." }
        : name === "suggest_replacement_line" ? { resultDifference: "Browser V2 results are staged against the exact current document revision and require explicit acceptance. MCP V2 results are immutable previews only: no archive persistence or undo is available, and a new clone-on-write handle is returned only by an explicit repertoire edit call." }
        : {}),
    },
    ...(input ? { input } : {}),
  });
const string = (description?: string, maxLength?: number, pattern?: string): InputField => ({ type: "string", ...(description ? { description } : {}), ...(maxLength == null ? {} : { maxLength }), ...(pattern == null ? {} : { pattern }) });
const integer = (minimum?: number, maximum?: number): InputField => ({ type: "integer", ...(minimum == null ? {} : { minimum }), ...(maximum == null ? {} : { maximum }) });
const number = (minimum?: number, maximum?: number): InputField => ({ type: "number", ...(minimum == null ? {} : { minimum }), ...(maximum == null ? {} : { maximum }) });
const array = (items: InputField = string(), minItems?: number, maxItems?: number): InputField => ({ type: "array", items, ...(minItems == null ? {} : { minItems }), ...(maxItems == null ? {} : { maxItems }) });
const object = (properties: Readonly<Record<string, InputField>>, required: readonly string[] = []): InputField => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });
const openObject = (
  description: string,
  properties: Readonly<Record<string, InputField>>,
  required: readonly string[],
): InputField => ({ type: "object", description, properties, required, additionalProperties: true });

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
    feature_family_weights: object({
      "pawn-topology": number(0, 3),
      "center-dynamics": number(0, 3),
      "king-and-piece-setup": number(0, 3),
      "space-and-files": number(0, 3),
      "dynamic-character": number(0, 3),
      "learning-concepts": number(0, 3),
    }),
  }),
}, ["mode"]);
/**
 * Interview-scoped preferences. Every field matches the canonical profile, but the bounds are
 * tighter than the analysis argument because a model authors these values without the user
 * watching a control move. Clearing an optional constraint back to "no limit" stays a Settings
 * action: this schema can propose a bound, not remove one.
 */
const strategicFitIntentConceptId = () => string(
  "Concept identity reported by the analysis, such as setup-family.castling.repertoire.kingside.",
  128,
  "^[a-z][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)+$",
);
const strategicFitIntentPreferences = object({
  maximum_engine_loss_cp: integer(0, 1000),
  opponent_popularity_importance: number(0, 1),
  personal_game_frequency_importance: number(0, 1),
  manual_weight_importance: number(0, 1),
  additional_memorization_tolerance: number(0, 1),
  preferred_concept_ids: array(strategicFitIntentConceptId(), undefined, 32),
  avoided_concept_ids: array(strategicFitIntentConceptId(), undefined, 32),
  preferred_tactical_character: array(string("Lowercase term such as forcing, sharp, or quiet.", 32, "^[a-z][a-z0-9-]*$"), undefined, 12),
  minimum_opponent_coverage: number(0, 1),
  feature_family_weights: object({
    "pawn-topology": number(0, 3),
    "center-dynamics": number(0, 3),
    "king-and-piece-setup": number(0, 3),
    "space-and-files": number(0, 3),
    "dynamic-character": number(0, 3),
    "learning-concepts": number(0, 3),
  }),
});
/**
 * One section of a plan card for a retained exception. Free text is bounded, and every anchor list
 * addresses evidence the finding's own basis returned; the host refuses any identity or move that
 * basis does not contain, so this schema deliberately cannot express a position, line, or game of
 * the model's own.
 */
const strategicFitPlanSection = object({
  kind: { type: "string", enum: STRATEGIC_FIT_PLAN_SECTION_KINDS },
  text: string("What to do, in plain language, resting only on the cited evidence.", 600),
  concept_ids: array(strategicFitId(), undefined, 8),
  checkpoint_ids: array(strategicFitId(), undefined, 8),
  drill_ids: array(strategicFitId(), undefined, 8),
}, ["kind", "text"]);
/**
 * The bounds a redesign request may state. Every one names a metric the deterministic replacement
 * chain already measures, and there is deliberately nowhere in this schema to supply an evaluation,
 * a coverage figure, a legality claim, or a candidate line: the host reads all of those out of
 * retained evidence rather than accepting them as arguments.
 */
const strategicFitPortfolioConstraints = object({
  maximum_engine_loss_cp: integer(0, 1000),
  minimum_expected_opponent_coverage: number(0, 1),
  maximum_added_theory_nodes: integer(0, 10_000),
  maximum_new_concept_count: integer(0, 128),
  maximum_homogenization_cost: number(0, 1),
  maximum_memorization_burden: number(0, 10_000),
  minimum_strategic_fit_delta: number(-1, 1),
});
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
const strategicFitPersonalHistory = object({
  username: string("Username on the selected game platform.", 128),
  platform: { type: "string", enum: ["lichess", "chesscom"] },
  max_games: integer(1, 100),
  year: integer(1900, 9999),
  month: integer(1, 12),
}, ["username"]);
const strategicFitPage = object({
  offset: integer(0, 1_000_000),
  limit: integer(1, 50),
  cursor: string("Opaque cursor from a previous page; mutually exclusive with offset.", 512),
});
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
    "Analyze Strategic Fit across transposition-aware repertoire routes with bounded custom feature-family weights, profile-composed manual/population/personal-history frequency, source filters, and browser-local training mastery; returns the native V2 report.",
    ["repertoire", "game", "network"],
    BOTH,
    { profile_mode: "balanced", weighting_mode: "equal", popularity_db: "lichess", popularity_max_positions: 60, personal_history_platform: "lichess", personal_history_max_games: 30, page_limit: 50 },
    {
      properties: {
        repertoire_id: string("MCP handle; browser injects the current document"),
        profile: strategicFitProfile,
        weighting: strategicFitWeighting,
        popularity: strategicFitPopularity,
        personal_history: strategicFitPersonalHistory,
        page: strategicFitPage,
        sort: { type: "string", enum: ["replacement-priority", "training-priority", "expected-frequency", "opening-scope", "finding-id"] },
        cohort_overrides: array(strategicFitCohortOverride, undefined, 100),
        explicit_targets: array(strategicFitExplicitTarget, undefined, 100),
        route_assessments: array(strategicFitRouteAssessment, undefined, 500),
      },
      mcpRequired: ["repertoire_id"],
    },
  ),
  define(
    "get_strategic_fit_report",
    "Retrieve one bounded view of an existing Strategic Fit report by its exact identity: the overview summary, one page of compact findings, or one finding with its evidence and navigable SAN paths. Stale report or finding identities fail with a structured error.",
    ["repertoire"],
    BOTH,
    { view: "summary", page_limit: 10, sort: "replacement-priority" },
    {
      properties: {
        repertoire_id: string("MCP handle; browser injects the current document"),
        report_id: strategicFitId(),
        view: { type: "string", enum: ["summary", "findings", "finding"] },
        finding_id: strategicFitId(),
        page: object({ offset: integer(0, 1_000_000), limit: integer(1, 25), cursor: string(undefined, 512) }),
        sort: { type: "string", enum: ["replacement-priority", "training-priority", "expected-frequency", "opening-scope", "finding-id"] },
      },
      required: ["report_id"],
      mcpRequired: ["repertoire_id", "report_id"],
    },
  ),
  define("classify_illustrative_lines","Find NAG-marked side lines that can inflate repertoire analysis counts.", ["repertoire"], BOTH, { limit: 20 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100) }, mcpRequired: ["repertoire_id"] }),
  define("modify_repertoire_line", "Apply or preview a prune, add, or reorder edit by SAN path.", ["repertoire", "action"], BOTH, {}, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), action: { type: "string", enum: ["prune", "add", "reorder"] }, path: array(), add_moves: array(), promote_move: string() }, required: ["action", "path"], mcpRequired: ["repertoire_id", "action", "path"] }),
  define("suggest_complementary_lines", "Suggest engine-sound moves ranked for structural fit or imbalance.", ["repertoire", "engine"], BOTH, { depth: 20, limit: 5 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), fen: string("FEN; browser defaults to the current position"), mode: { type: "string", enum: ["low_memorization", "sharp"] }, depth: integer(1, 30), limit: integer(1, 10) }, mcpRequired: ["repertoire_id", "fen"] }),
  define("suggest_replacement_line", "Validate retained Task 8.7 evidence into complete Strategic Fit V2 atomic change sets without silently applying them.", ["repertoire", "engine", "action"], BOTH, {}, {
    properties: {
      repertoire_id: string("MCP handle; browser injects the current document"),
      contract: { type: "string", enum: ["strategic-fit-replacement-v2"] },
      replacement_request: openObject("Complete canonical ReplacementRequest with finding, profile, source, budget, identity, version, and provenance inputs.", { request_id: strategicFitId() }, ["request_id"]),
      finding: openObject("Revision-bound report/finding/semantic-finding/cohort identity.", { finding_id: strategicFitId() }, ["finding_id"]),
      pivot: openObject("Automatic or explicit semantic pivot selection.", { kind: { type: "string", enum: ["automatic", "user-selected"] } }, ["kind"]),
      profile: openObject("Exact Strategic Fit profile snapshot used by the request.", { mode: { type: "string", enum: ["familiar-plans", "balanced", "versatile", "custom"] } }, ["mode"]),
      sources: array({ type: "string", enum: ["existing-repertoire-transposition", "opening-database", "engine-multipv", "user-line", "structurally-similar", "move-order-shortcut"] }, 1, 6),
      budget: openObject("Exact bounded candidate, engine, explorer, subtree, and strategic-horizon budget.", {
        engine_depth: integer(1, 30), engine_multipv: integer(1, 10),
      }, ["engine_depth", "engine_multipv"]),
      engine: openObject("Exact engine depth/multipv request and unavailable-evidence policy.", {
        depth: integer(1, 30), multipv: integer(1, 10), allow_unavailable_evidence: { type: "boolean" },
      }, ["depth", "multipv", "allow_unavailable_evidence"]),
      coverage: openObject("Exact minimum coverage and forcing-reply policy.", {
        minimum_expected_opponent_coverage: { type: "number", minimum: 0, maximum: 1 },
        require_all_forcing_replies: { type: "boolean" },
      }, ["minimum_expected_opponent_coverage", "require_all_forcing_replies"]),
      retention: array(openObject("Per-candidate add-alternative or explicitly confirmed archive-before-prune replacement choice.", {
        candidate_id: strategicFitId(),
        action: { type: "string", enum: ["add-alternative", "replace"] },
        prune_explicitly_confirmed: { type: "boolean" },
        promote_candidate_to_mainline: { type: "boolean" },
      }, ["candidate_id", "action"]), undefined, 100),
      candidate_ids: array(string(undefined, 256), 1, 100),
      safety: openObject("Complete immutable Task 8.3-8.7 evidence envelope, including structured per-item errors and provenance.", { request_id: strategicFitId() }, ["request_id"]),
    },
    mcpRequired: ["repertoire_id"],
  }),
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
    "propose_strategic_fit_profile",
    "Propose Strategic Fit profile preferences inferred from what the user said, staged for confirmation. The application shows the exact field-level difference against the current effective profile; nothing is saved, no report is invalidated, and the repertoire is never touched until the user explicitly accepts. Invalid concept identities and out-of-range values are rejected rather than adjusted, and a proposal is void once the document revision, profile, or analysis settings change.",
    ["repertoire", "action"],
    BROWSER,
    {},
    {
      properties: {
        mode: { type: "string", enum: ["familiar-plans", "balanced", "versatile", "custom"], description: "Named preset. Selecting a preset alone restores that preset's preference defaults; combining it with preferences produces a custom profile." },
        preferences: strategicFitIntentPreferences,
        rationale: string("One or two sentences grounded in what the user actually said, shown next to the diff.", 400),
      },
    },
  ),
  define(
    "propose_strategic_fit_plan",
    "Write a plan card for an exception the user keeps and trains. Call it without `plan` first to receive the finding's deterministic evidence basis — the concepts the analysis reported, its legal checkpoints and drill positions, and the validated moves — then call it again with a plan whose every section cites that evidence. Sections that name no evidence, identities the basis did not return, a move outside the validated paths, and any outside game are rejected rather than trimmed. Nothing is saved: the card is staged until the user accepts it, and acceptance writes through the existing training path without editing repertoire lines.",
    ["repertoire", "action"],
    BROWSER,
    {},
    {
      properties: {
        report_id: strategicFitId(),
        finding_id: strategicFitId(),
        semantic_finding_id: strategicFitId(),
        plan: object({
          title: string("Short name for the plan, in the user's own terms.", 120),
          sections: array(strategicFitPlanSection, 1, 8),
        }, ["title", "sections"]),
      },
      required: ["report_id", "finding_id", "semantic_finding_id"],
    },
  ),
  define(
    "propose_strategic_fit_portfolio",
    "Turn a stated redesign goal into bounded alternatives for the Replacement Lab finding that is open. Call it with `constraints` first: the bounds are validated, checked for contradictions with the confirmed profile, and shown to the user for confirmation without binding anything. Call it again with the confirmed `constraint_set_id` to receive a bounded portfolio in which every option is one already-generated candidate with its own validated change set, its Task 8.6 Pareto status, and the measured values behind each bound; when nothing satisfies the request, the result names the bound that alone excluded candidates instead of relaxing it. Add `option_id` to stage that option's existing change set for the user's explicit confirmation. No option is preselected, nothing is applied, and no preference is persisted.",
    ["repertoire", "action"],
    BROWSER,
    {},
    {
      properties: {
        constraints: strategicFitPortfolioConstraints,
        rationale: string("One or two sentences grounded in what the user actually said, shown next to the bounds.", 400),
        constraint_set_id: strategicFitId(),
        option_id: strategicFitId(),
      },
    },
  ),
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
  const popularityReason = explorerPopulationArgumentsError(
    value.popularity as Record<string, unknown> | undefined,
    "popularity",
  );
  if (popularityReason) return popularityReason;

  const personalHistory = value.personal_history as Record<string, unknown> | undefined;
  if (personalHistory !== undefined) {
    const username = personalHistory.username as string;
    if (username.trim().length === 0) return "personal_history.username must not be blank";
    const platform = personalHistory.platform ?? "lichess";
    if (platform === "chesscom") {
      if (personalHistory.year === undefined || personalHistory.month === undefined) {
        return "personal_history for chesscom requires year and month";
      }
      if (personalHistory.max_games !== undefined) {
        return "personal_history.max_games is only supported for lichess";
      }
    } else if (personalHistory.year !== undefined || personalHistory.month !== undefined) {
      return "personal_history year and month are only supported for chesscom";
    }
  }

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

  const page = value.page as Record<string, unknown> | undefined;
  if (page?.cursor !== undefined && page.offset !== undefined) {
    return "page.cursor and page.offset are mutually exclusive";
  }
  return null;
}

function strategicFitRetrievalArgumentsError(value: Record<string, unknown>): string | null {
  const reportId = value.report_id;
  if (typeof reportId !== "string" || reportId.trim().length === 0) return "report_id must not be blank";
  const view = value.view ?? "summary";
  if (view === "finding") {
    const findingId = value.finding_id;
    if (typeof findingId !== "string" || findingId.trim().length === 0) {
      return "view finding requires a non-blank finding_id";
    }
  } else if (value.finding_id !== undefined) {
    return "finding_id is only valid with view finding";
  }
  if (view !== "findings") {
    for (const key of ["page", "sort"]) {
      if (value[key] !== undefined) return `${key} is only valid with view findings`;
    }
  }
  const page = value.page as Record<string, unknown> | undefined;
  if (page?.cursor !== undefined && page.offset !== undefined) {
    return "page.cursor and page.offset are mutually exclusive";
  }
  return null;
}

function strategicFitIntentArgumentsError(value: Record<string, unknown>): string | null {
  if (value.mode === undefined && value.preferences === undefined) {
    return "a profile proposal requires mode, preferences, or both";
  }
  const preferences = value.preferences as Record<string, unknown> | undefined;
  if (preferences !== undefined && Object.keys(preferences).length === 0) {
    return "preferences must contain at least one preference";
  }
  const weights = preferences?.feature_family_weights as Record<string, unknown> | undefined;
  if (weights !== undefined && Object.keys(weights).length === 0) {
    return "preferences.feature_family_weights must contain at least one signal family";
  }
  const preferred = preferences?.preferred_concept_ids as readonly string[] | undefined;
  const avoided = preferences?.avoided_concept_ids as readonly string[] | undefined;
  const conflict = preferred?.find((concept) => avoided?.includes(concept));
  if (conflict) return `${conflict} cannot be both preferred and avoided`;
  return null;
}

function strategicFitPlanArgumentsError(value: Record<string, unknown>): string | null {
  for (const key of ["report_id", "finding_id", "semantic_finding_id"]) {
    const identity = value[key];
    if (typeof identity !== "string" || identity.trim().length === 0) return `${key} must not be blank`;
  }
  const plan = value.plan as Record<string, unknown> | undefined;
  if (plan === undefined) return null;
  const sections = plan.sections as readonly Record<string, unknown>[] | undefined;
  if (!Array.isArray(sections) || sections.length === 0) {
    return "plan.sections must contain at least one section";
  }
  for (const [index, section] of sections.entries()) {
    const anchors = ["concept_ids", "checkpoint_ids", "drill_ids"]
      .flatMap((key) => (Array.isArray(section[key]) ? (section[key] as readonly unknown[]) : []));
    if (anchors.length === 0) {
      return `plan.sections[${index}] must cite at least one concept, checkpoint, or drill from the finding's evidence`;
    }
    if (section.kind === "model-position" && !(section.drill_ids as readonly unknown[] | undefined)?.length) {
      return `plan.sections[${index}] is a model position and must cite a drill from the finding's evidence`;
    }
  }
  return null;
}

/**
 * One call is exactly one of three steps: state the bounds, read the portfolio for confirmed
 * bounds, or select one of its options. Mixing them would let a single call both propose a
 * constraint and act on it, which is the confirmation this operation exists to require.
 */
function strategicFitPortfolioArgumentsError(value: Record<string, unknown>): string | null {
  const constraints = value.constraints as Record<string, unknown> | undefined;
  const setId = value.constraint_set_id;
  const optionId = value.option_id;
  if (constraints !== undefined) {
    if (setId !== undefined || optionId !== undefined) {
      return "constraints cannot be combined with constraint_set_id or option_id; state the bounds first and let the user confirm them";
    }
    if (Object.keys(constraints).length === 0) {
      return "constraints must state at least one bound";
    }
    if (Object.keys(constraints).length > STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS.length) {
      return `constraints must contain at most ${STRATEGIC_FIT_PORTFOLIO_CONSTRAINT_KINDS.length} bounds`;
    }
    return null;
  }
  if (value.rationale !== undefined) {
    return "rationale belongs with the constraints it explains";
  }
  if (typeof setId !== "string" || setId.trim().length === 0) {
    return "constraint_set_id must name the confirmed constraint set to build the portfolio from";
  }
  if (optionId !== undefined && (typeof optionId !== "string" || optionId.trim().length === 0)) {
    return "option_id must not be blank";
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

function replacementArgumentsError(value: Record<string, unknown>): string | null {
  const id = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && candidate.length >= 1 && candidate.length <= 256;
  if (value.contract !== "strategic-fit-replacement-v2") return "contract must be strategic-fit-replacement-v2";
  for (const key of [
    "replacement_request", "finding", "pivot", "profile", "sources", "budget", "engine", "coverage",
    "retention", "candidate_ids", "safety",
  ]) if (!(key in value)) return `missing required V2 argument: ${key}`;
  const record = (key: string) => value[key] as Record<string, unknown>;
  const object = (candidate: unknown): candidate is Record<string, unknown> =>
    candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  for (const key of ["replacement_request", "finding", "pivot", "profile", "budget", "engine", "coverage", "safety"]) {
    if (!object(value[key])) return `${key} must be an object`;
  }
  if (!Array.isArray(value.sources) || !Array.isArray(value.retention) || !Array.isArray(value.candidate_ids)) {
    return "sources, retention, and candidate_ids must be arrays";
  }
  if (!id(record("replacement_request").request_id)) return "replacement_request.request_id is required";
  const request = record("replacement_request");
  for (const key of ["report_id", "finding_id", "semantic_finding_id", "cohort_id", "repertoire_revision",
    "schema_version", "analysis_version", "replacement_schema_version"]) {
    if (!id(request[key])) return `replacement_request.${key} is required`;
  }
  if (!["white", "black"].includes(String(request.repertoire_color)) ||
    !object(request.pivot_selection) || !object(request.profile) || !object(request.budget) ||
    !Array.isArray(request.candidate_sources) || !Array.isArray(request.user_candidate_san_lines) ||
    !Array.isArray(request.provenance)) return "replacement_request is incomplete";
  if (!id(record("finding").finding_id)) return "finding.finding_id is required";
  if (!["automatic", "user-selected"].includes(String(record("pivot").kind))) return "pivot.kind is invalid";
  if (!["familiar-plans", "balanced", "versatile", "custom"].includes(String(record("profile").mode))) return "profile.mode is invalid";
  const budget = record("budget");
  if (!Number.isInteger(budget.engine_depth) || (budget.engine_depth as number) < 1 || (budget.engine_depth as number) > 30 ||
    !Number.isInteger(budget.engine_multipv) || (budget.engine_multipv as number) < 1 || (budget.engine_multipv as number) > 10) {
    return "budget engine_depth or engine_multipv is invalid";
  }
  const engine = record("engine");
  if (!Number.isInteger(engine.depth) || (engine.depth as number) < 1 || (engine.depth as number) > 30 ||
    !Number.isInteger(engine.multipv) || (engine.multipv as number) < 1 || (engine.multipv as number) > 10 ||
    typeof engine.allow_unavailable_evidence !== "boolean") {
    return "engine depth, multipv, and allow_unavailable_evidence are required";
  }
  if (typeof record("coverage").require_all_forcing_replies !== "boolean") return "coverage.require_all_forcing_replies is required";
  const minimumCoverage = record("coverage").minimum_expected_opponent_coverage;
  if (typeof minimumCoverage !== "number" || !Number.isFinite(minimumCoverage) || minimumCoverage < 0 || minimumCoverage > 1) {
    return "coverage.minimum_expected_opponent_coverage must be a number from 0 to 1";
  }
  for (const [index, entry] of (value.retention as readonly Record<string, unknown>[]).entries()) {
    if (!object(entry) || !id(entry.candidate_id) || !["add-alternative", "replace"].includes(String(entry.action)) ||
      (entry.action === "replace" && entry.prune_explicitly_confirmed !== true) ||
      (entry.promote_candidate_to_mainline !== undefined && typeof entry.promote_candidate_to_mainline !== "boolean")) {
      return `retention[${index}] is invalid`;
    }
  }
  if ((value.candidate_ids as readonly unknown[]).some((candidate) => !id(candidate))) return "candidate_ids contains an invalid identity";
  if (!id(record("safety").request_id)) return "safety.request_id is required";
  const safety = record("safety");
  if (!object(safety.request) || !Array.isArray(safety.candidates) || !Array.isArray(safety.provenance) ||
    !id(safety.repertoire_revision) || !["white", "black"].includes(String(safety.repertoire_color))) {
    return "safety must contain the complete retained request, candidates, provenance, revision, and ownership";
  }
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
  if (name === "get_strategic_fit_report") {
    const reason = strategicFitRetrievalArgumentsError(value);
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  if (name === "propose_strategic_fit_profile") {
    const reason = strategicFitIntentArgumentsError(value);
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  if (name === "propose_strategic_fit_plan") {
    const reason = strategicFitPlanArgumentsError(value);
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  if (name === "propose_strategic_fit_portfolio") {
    const reason = strategicFitPortfolioArgumentsError(value);
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  if (name === "position_popularity") {
    const reason = explorerPopulationArgumentsError(value, "position_popularity");
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  if (name === "suggest_replacement_line") {
    const reason = replacementArgumentsError(value);
    if (reason) return { ok: false, error: "invalid_arguments", reason };
  }
  return { ok: true, value };
}
