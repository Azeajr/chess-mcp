import type { ChatMode } from "./workflows";
import type { ToolSchema } from "./openrouter";

export type Outcome = "position" | "game" | "repertoire" | "annotate";

const UNIVERSAL = new Set([
  "get_position", "get_legal_moves", "validate_fen", "validate_pgn", "validate_line",
  "get_current_line", "get_document_summary", "expand_capabilities", "propose_line",
]);

const POSITION = new Set([
  "evaluate_position", "compare_moves", "cloud_eval", "tablebase_lookup", "identify_opening",
  "position_popularity",
]);
const GAME = new Set([
  "identify_opening", "analyze_game", "get_game_summary", "batch_review", "lichess_games",
  "chesscom_games", "export_annotated_pgn", "get_document_pgn",
]);
const REPERTOIRE = new Set([
  "identify_opening", "position_popularity", "find_theory_depth", "find_repertoire_gaps",
  "get_transpositions", "find_pruning_transpositions", "get_repertoire_coverage",
  "inspect_shortcut",
  "get_structural_profile", "analyze_repertoire_congruence", "classify_illustrative_lines",
  "modify_repertoire_line", "suggest_complementary_lines", "suggest_replacement_line",
  "repertoire_vs_history", "get_selected_subtree", "get_document_pgn",
]);
const ANNOTATE = new Set(["export_annotated_pgn", "validate_pgn", "get_document_pgn"]);
const SETS: Record<Outcome, Set<string>> = { position: POSITION, game: GAME, repertoire: REPERTOIRE, annotate: ANNOTATE };

const PATTERNS: Record<Outcome, RegExp> = {
  position: /\b(position|fen|evaluate|evaluation|candidate|legal move|tablebase|best move|cloud eval)\b/i,
  game: /\b(game|review|mistake|blunder|accuracy|played|lichess|chess\.com|history)\b/i,
  repertoire: /\b(repertoire|prep|coverage|gap|structure|theory|transposition|prun|shorten|line|variation|opening tree)\b/i,
  annotate: /\b(annotate|annotated|export pgn)\b/i,
};

export function selectOutcomes(
  text: string,
  preset: ChatMode,
  expanded: readonly Outcome[] = [],
  documentOutcome?: "game" | "repertoire",
): Outcome[] {
  const selected = new Set<Outcome>(expanded);
  if (preset && preset !== "general") selected.add(preset === "review" ? "game" : preset);
  for (const outcome of Object.keys(PATTERNS) as Outcome[]) if (PATTERNS[outcome].test(text)) selected.add(outcome);
  // Ambiguous first turns such as "What are the biggest problems here?" should use the open
  // document as their scope. Explicit wording and capability expansion still take precedence.
  if (!selected.size) selected.add(documentOutcome ?? "position");
  return [...selected];
}

export function schemasForConversation(all: ToolSchema[], outcomes: readonly Outcome[]): ToolSchema[] {
  const names = new Set(UNIVERSAL);
  for (const outcome of outcomes) for (const name of SETS[outcome]) names.add(name);
  return all.filter((schema) => names.has(schema.function.name));
}
