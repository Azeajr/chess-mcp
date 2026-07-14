/** Dependency-free application contract consumed by the MCP and browser hosts. */
export type ToolHost = "mcp" | "browser";
export type ToolCapability = "position" | "game" | "repertoire" | "engine" | "network" | "artifact" | "action";
export type InputField = {
  type: "string" | "integer" | "number" | "boolean" | "array";
  description?: string;
  enum?: readonly string[];
  items?: InputField;
  minimum?: number;
  maximum?: number;
};
export type ToolInput = { properties: Readonly<Record<string, InputField>>; browserProperties?: Readonly<Record<string, InputField>>; mcpProperties?: Readonly<Record<string, InputField>>; required?: readonly string[]; mcpRequired?: readonly string[] };
export interface ToolContract {
  name: string;
  description: string;
  hosts: readonly ToolHost[];
  capabilities: readonly ToolCapability[];
  defaults: Readonly<Record<string, unknown>>;
  result: Readonly<{ kind: "data" | "artifact" | "action" }>;
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
    result: { kind: capabilities.includes("action") ? "action" : capabilities.includes("artifact") ? "artifact" : "data" },
    hostAdaptation: {
      browserInjects: input?.properties.repertoire_id ? ["current GameTree", "repertoire color"] : [
        ...(input?.properties.fen && !(input.required ?? []).includes("fen") ? ["current FEN"] : []),
        ...(input?.properties.pgn && !(input.required ?? []).includes("pgn") ? ["current PGN"] : []),
      ],
      mcpInjects: input?.properties.repertoire_id ? ["repertoire handle lookup"] : [],
      ...(name === "get_position" ? { resultDifference: "browser adds current repertoire color" }
        : name === "modify_repertoire_line" ? { resultDifference: "MCP returns a clone-on-write handle; browser returns a non-mutating preview" }
        : name === "analyze_game" ? { resultDifference: "MCP supports the host-only verbose result projection" }
        : {}),
    },
    ...(input ? { input } : {}),
  });
const string = (description?: string): InputField => ({ type: "string", ...(description ? { description } : {}) });
const integer = (minimum?: number, maximum?: number): InputField => ({ type: "integer", ...(minimum == null ? {} : { minimum }), ...(maximum == null ? {} : { maximum }) });
const array = (items: InputField = string()): InputField => ({ type: "array", items });

export const TOOL_CONTRACTS = [
  define("validate_fen", "Validate a FEN; returns the normalised FEN when legal.", ["position"], BOTH, {}, { properties: { fen: string() }, required: ["fen"] }),
  define("validate_pgn", "Validate a PGN; returns the game count.", ["game"], BOTH, {}, { properties: { pgn: string() }, required: ["pgn"] }),
  define("validate_line", "Validate SAN moves from a FEN; returns canonical SANs or the first illegal index.", ["position"], BOTH, {}, { properties: { fen: string("FEN; browser defaults to the current position"), moves: array() }, required: ["moves"], mcpRequired: ["fen", "moves"] }),
  define("get_legal_moves", "Legal moves (SAN) at a FEN.", ["position"], BOTH, {}, { properties: { fen: string("FEN; browser defaults to the current position") }, mcpRequired: ["fen"] }),
  define("get_position", "Ground the current position with its normalised FEN and legal moves; the browser also includes current-document context.", ["position"], BOTH, {}, { properties: { fen: string("FEN; browser uses its current position when omitted") }, mcpRequired: ["fen"] }),
  define("evaluate_position", "Local Stockfish multi-line analysis with white-POV cp/mate scores.", ["position", "engine"], BOTH, { depth: 16, lines: 3 }, { properties: { fen: string("FEN; browser defaults to the current position"), depth: integer(1, 30), lines: integer(1, 5) }, mcpRequired: ["fen"] }),
  define("compare_moves", "Rank candidate SAN moves by local Stockfish (mover POV); illegal moves are returned separately.", ["position", "engine"], BOTH, { depth: 14 }, { properties: { fen: string("FEN; browser defaults to the current position"), moves: array(), depth: integer(1, 30) }, required: ["moves"], mcpRequired: ["fen", "moves"] }),
  define("cloud_eval", "Lichess cloud evaluation (white-POV) for a FEN, or unavailable.", ["position", "network"], BOTH, {}, { properties: { fen: string("FEN; browser defaults to the current position") }, mcpRequired: ["fen"] }),
  define("tablebase_lookup", "Lichess tablebase result for a seven-piece-or-fewer FEN, or unavailable.", ["position", "network"], BOTH, {}, { properties: { fen: string("FEN; browser defaults to the current position") }, mcpRequired: ["fen"] }),
  define("position_popularity", "Lichess opening-explorer statistics at a FEN, including move frequencies and white-POV results.", ["position", "network"], BOTH, { db: "lichess", top_moves: 12 }, { properties: { fen: string("FEN; browser defaults to the current position"), db: { type: "string", enum: ["lichess", "masters"] }, top_moves: integer(0, 30) }, mcpRequired: ["fen"] }),
  define("identify_opening", "Name the deepest ECO opening reached by a PGN.", ["position", "game"], BOTH, {}, { properties: { pgn: string("PGN; browser defaults to the current working line") }, mcpRequired: ["pgn"] }),
  define("find_repertoire_gaps", "Scan decision nodes for uncovered strong opponent replies, ranked by severity.", ["repertoire", "engine"], BOTH, { depth: 14, limit: 20, popularity_db: "lichess" }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), depth: integer(1, 30), min_severity: { type: "string", enum: ["low", "medium", "high"] }, max_positions: integer(1, 60), limit: integer(1, 50), popularity: { type: "boolean" }, popularity_db: { type: "string", enum: ["lichess", "masters"] } }, mcpRequired: ["repertoire_id"] }),
  define("find_theory_depth", "Report where repertoire lines leave known opening theory using explorer game counts.", ["repertoire", "network"], BOTH, { db: "lichess", max_positions: 60 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), db: { type: "string", enum: ["lichess", "masters"] }, min_games: integer(1), max_positions: integer(1, 120) }, mcpRequired: ["repertoire_id"] }),
  define("get_transpositions", "Positions the repertoire reaches by more than one move order, largest groups first.", ["repertoire"], BOTH, { limit: 20 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100) }, mcpRequired: ["repertoire_id"] }),
  define("find_pruning_transpositions", "Find sound moves that transpose into another prepared line and shorten memorisation.", ["repertoire", "engine"], BOTH, { limit: 20, multipv: 4, cp_threshold: 50, depth: 14 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100), multipv: integer(1, 8), cp_threshold: integer(0, 500), max_loss_cp: integer(0, 1000), depth: integer(1, 30), movetime_ms: integer(50, 10000), budget: integer(1, 500), leaf_start: integer(0), leaf_count: integer(1, 200), confirm_depth: integer(1, 30) }, mcpRequired: ["repertoire_id"] }),
  define("get_repertoire_coverage", "Report dangling lines and natural frontiers; optionally engine-check whether stubs reconnect.", ["repertoire"], BOTH, { limit: 20, connect_stubs: false }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100), connect_stubs: { type: "boolean" } }, mcpRequired: ["repertoire_id"] }),
  define("get_structural_profile", "Return a repertoire-wide pawn-structure profile or one position selected by SAN path.", ["repertoire"], BOTH, {}, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), variation_path: array() }, mcpRequired: ["repertoire_id"] }),
  define("analyze_repertoire_congruence", "Flag thematic inconsistencies across repertoire lines, clustered by opening system.", ["repertoire"], BOTH, {}, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), min_severity: { type: "string", enum: ["low", "medium", "high"] }, limit: integer(1, 50), acknowledged_weaknesses: array(array()), exclude_paths: array(array()) }, mcpRequired: ["repertoire_id"] }),
  define("classify_illustrative_lines", "Find NAG-marked side lines that can inflate repertoire analysis counts.", ["repertoire"], BOTH, { limit: 20 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), limit: integer(1, 100) }, mcpRequired: ["repertoire_id"] }),
  define("modify_repertoire_line", "Apply or preview a prune, add, or reorder edit by SAN path.", ["repertoire", "action"], BOTH, {}, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), action: { type: "string", enum: ["prune", "add", "reorder"] }, path: array(), add_moves: array(), promote_move: string() }, required: ["action", "path"], mcpRequired: ["repertoire_id", "action", "path"] }),
  define("suggest_complementary_lines", "Suggest engine-sound moves ranked for structural fit or imbalance.", ["repertoire", "engine"], BOTH, { depth: 14, limit: 5 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), fen: string("FEN; browser defaults to the current position"), mode: { type: "string", enum: ["low_memorization", "sharp"] }, depth: integer(1, 30), limit: integer(1, 10) }, mcpRequired: ["repertoire_id", "fen"] }),
  define("suggest_replacement_line", "Suggest sound replacements for an incongruent repertoire line.", ["repertoire", "engine"], BOTH, { depth: 14 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), outlier_variation_path: array(), mode: { type: "string", enum: ["structural_fit", "low_memorization", "solid"] }, depth: integer(1, 30) }, required: ["outlier_variation_path"], mcpRequired: ["repertoire_id", "outlier_variation_path"] }),
  define("analyze_game", "Per-move engine review of a game's mainline with centipawn loss and classification.", ["game", "engine"], BOTH, { depth: 14 }, { properties: { pgn: string("PGN; browser defaults to the current working line"), depth: integer(1, 30) }, mcpProperties: { verbose: { type: "boolean" } }, mcpRequired: ["pgn"] }),
  define("get_game_summary", "Game-review summary with per-side counts, accuracy, and worst moves.", ["game", "engine"], BOTH, { depth: 14 }, { properties: { pgn: string("PGN; browser defaults to the current working line"), depth: integer(1, 30) }, mcpRequired: ["pgn"] }),
  define("export_annotated_pgn", "Annotate a game's mainline with move glyphs and best-move/evaluation comments.", ["game", "engine", "artifact"], BOTH, { depth: 14 }, { properties: { pgn: string("PGN; browser defaults to the current working line"), depth: integer(1, 30) }, mcpRequired: ["pgn"] }),
  define("batch_review", "Analyze multiple games and aggregate results by opening or player color.", ["game", "engine"], BOTH, { group_by: "eco", max_games: 100, depth: 12 }, { properties: { pgn: string(), group_by: { type: "string", enum: ["eco", "color"] }, username: string(), max_games: integer(1, 100), depth: integer(1, 30) }, required: ["pgn"], mcpRequired: ["pgn"] }),
  define("lichess_games", "Fetch recent games for a Lichess user.", ["game", "network"], BOTH, { max_games: 20, include_pgn: false }, { properties: { username: string(), max_games: integer(1, 100), opening_eco: string(), include_pgn: { type: "boolean" } }, required: ["username"] }),
  define("chesscom_games", "Fetch games for a Chess.com user in a given month.", ["game", "network"], BOTH, { include_pgn: false }, { properties: { username: string(), year: integer(), month: integer(1, 12), opening_eco: string(), include_pgn: { type: "boolean" } }, required: ["username", "year", "month"] }),
  define("repertoire_vs_history", "Compare a repertoire with a user's games and report all departures.", ["repertoire", "game", "network"], BOTH, { platform: "lichess", max_games: 30 }, { properties: { repertoire_id: string("MCP handle; browser injects the current document"), username: string(), platform: { type: "string", enum: ["lichess", "chesscom"] }, max_games: integer(1, 100), year: integer(), month: integer(1, 12) }, required: ["username"], mcpRequired: ["repertoire_id", "username"] }),
  define("audit_repertoire_moves", "Engine-check prescribed moves tree-wide and rank findings by centipawn loss.", ["repertoire", "engine"], BOTH, { depth: 14, min_cp_loss: 50, max_positions: 20, limit: 10 }, { properties: { repertoire_id: string(), depth: integer(1, 30), min_cp_loss: integer(0), max_positions: integer(1, 60), limit: integer(1, 50) }, mcpRequired: ["repertoire_id"] }),
  define("find_only_moves", "Find positions where the best move clearly exceeds the second choice.", ["repertoire", "engine", "artifact"], BOTH, { depth: 14, min_margin: 100, max_positions: 300, limit: 25, lines_limit: 10 }, { properties: { repertoire_id: string(), depth: integer(1, 30), min_margin: integer(0), max_positions: integer(1, 300), limit: integer(1, 100), lines_limit: integer(1, 50) }, browserProperties: { export_deck: { type: "boolean" } }, mcpProperties: { export_path: string() }, mcpRequired: ["repertoire_id"] }),
  define("find_structures", "Search repertoire leaves by structure, center, themes, or color complex.", ["repertoire"], BOTH, { min_confidence: 0.6, limit: 30 }, { properties: { repertoire_id: string(), structure: string(), min_confidence: { type: "number", minimum: 0, maximum: 1 }, center: { type: "string", enum: ["tense", "locked", "open", "semi-open"] }, themes: array({ type: "string", enum: ["fianchetto_white", "fianchetto_black", "minority_attack_white", "minority_attack_black", "flank_vs_center"] }), color_complex: { type: "string", enum: ["light", "dark"] }, limit: integer(1, 100) }, mcpRequired: ["repertoire_id"] }),
  define("check_shortcut_coverage", "Check whether pruning a shortcut line creates an uncovered gap.", ["repertoire", "engine"], MCP, {}, { properties: { repertoire_id: string(), line_path: array(), at_ply: integer(0), depth: integer(1, 30), min_severity: { type: "string", enum: ["low", "medium", "high"] }, max_positions: integer(1, 60), limit: integer(1, 50) }, mcpRequired: ["repertoire_id", "line_path", "at_ply"] }),
  define("compare_shortcut_lines", "Compare shortcut candidates by engine quality and structural fit.", ["repertoire", "engine"], MCP, { eval_tiebreak_cp: 30 }, { properties: { repertoire_id: string(), line_path: array(), at_ply: integer(0), joins_path: array(), depth: integer(1, 30), eval_tiebreak_cp: integer(0, 500) }, mcpRequired: ["repertoire_id", "line_path", "at_ply", "joins_path"] }),
  define("inspect_shortcut", "Inspect one shortcut candidate for both line quality and coverage safety.", ["repertoire", "engine"], BROWSER, { depth: 12, max_positions: 12, eval_tiebreak_cp: 30 }, { properties: { line_path: array(), at_ply: integer(0), joins_path: array(), depth: integer(1, 30), max_positions: integer(1, 60), min_severity: { type: "string", enum: ["low", "medium", "high"] }, limit: integer(1, 50), eval_tiebreak_cp: integer(0, 500) }, required: ["line_path", "at_ply", "joins_path"] }),
  define("export_annotated_repertoire", "Run analyses and produce a cloned, annotated repertoire PGN.", ["repertoire", "engine", "artifact"], BOTH, { include: ["audit", "only_moves", "gaps", "congruence"], depth: 14 }, { properties: { repertoire_id: string(), include: array({ type: "string", enum: ["audit", "only_moves", "gaps", "congruence"] }), depth: integer(1, 30), max_positions: integer(1, 300), min_cp_loss: integer(0), min_margin: integer(0), min_severity: { type: "string", enum: ["low", "medium", "high"] } }, mcpProperties: { export_path: string() }, mcpRequired: ["repertoire_id"] }),
  define("prep_vs_opponent", "Compare a repertoire with an opponent's games and summarize preparation targets.", ["repertoire", "game", "network"], BOTH, { platform: "lichess", max_games: 30 }, { properties: { repertoire_id: string(), username: string(), platform: { type: "string", enum: ["lichess", "chesscom"] }, max_games: integer(1, 100), year: integer(), month: integer(1, 12) }, required: ["username"], mcpRequired: ["repertoire_id", "username"] }),
  define("load_repertoire", "Parse a repertoire PGN and return a Node-host handle.", ["repertoire"], MCP, {}, { properties: { pgn: string(), color: { type: "string", enum: ["white", "black"] } }, mcpRequired: ["pgn", "color"] }),
  define("load_repertoire_from_file", "Load a repertoire PGN from the confined Node repertoire directory.", ["repertoire"], MCP, {}, { properties: { path: string(), color: { type: "string", enum: ["white", "black"] } }, mcpRequired: ["path", "color"] }),
  define("export_repertoire", "Serialize a Node repertoire handle to PGN.", ["repertoire", "artifact"], MCP, {}, { properties: { repertoire_id: string() }, mcpRequired: ["repertoire_id"] }),
  define("export_repertoire_to_file", "Write repertoire PGN under the confined Node repertoire directory.", ["repertoire", "artifact"], MCP, {}, { properties: { repertoire_id: string(), path: string() }, mcpRequired: ["repertoire_id", "path"] }),
  define("propose_line", "Stage a validated SAN line for explicit user acceptance without mutating the repertoire.", ["repertoire", "action"], BROWSER, {}, { properties: { moves: array(), comment: string() }, required: ["moves"] }),
  define("get_current_line", "Retrieve the selected SAN line and its position references from the current browser document.", ["position", "game"], BROWSER, {}, { properties: {} }),
  define("get_selected_subtree", "Retrieve bounded SAN lines for the currently selected repertoire subtree.", ["repertoire"], BROWSER, { max_plies: 80 }, { properties: { max_plies: integer(1, 200) } }),
  define("get_document_summary", "Retrieve compact current-document metadata and tree statistics.", ["game", "repertoire"], BROWSER, {}, { properties: {} }),
  define("get_document_pgn", "Retrieve the full current PGN only when an operation genuinely needs the artifact.", ["game", "repertoire", "artifact"], BROWSER, {}, { properties: {} }),
  define("expand_capabilities", "Request an additional tool bundle when the conversation changes outcome.", ["action"], BROWSER, {}, { properties: { outcome: { type: "string", enum: ["position", "game", "repertoire", "annotate"] } }, required: ["outcome"] }),
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
  const valid = field.type === "array" ? Array.isArray(candidate) : field.type === "integer" ? Number.isInteger(candidate) : typeof candidate === field.type;
  if (!valid) return `${path} must be ${field.type}`;
  if (typeof candidate === "number" && (candidate < (field.minimum ?? -Infinity) || candidate > (field.maximum ?? Infinity))) return `${path} is outside the allowed range`;
  if (field.enum && !field.enum.includes(candidate as string)) return `${path} must be one of: ${field.enum.join(", ")}`;
  if (field.type === "array" && field.items) {
    for (let i = 0; i < (candidate as unknown[]).length; i++) {
      const nested = fieldError(field.items, (candidate as unknown[])[i], `${path}[${i}]`);
      if (nested) return nested;
    }
  }
  return null;
}
export function validateToolArguments(name: string, raw: unknown, host: ToolHost): ArgumentsResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_arguments", reason: "arguments must be an object" };
  const contract = toolContract(name);
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
  return { ok: true, value };
}
