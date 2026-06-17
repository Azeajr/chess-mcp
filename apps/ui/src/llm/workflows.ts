/**
 * Chat workflow prompts — the PWA equivalent of the Claude Code skills (.claude/skills/*). They
 * encode the METHOD: which tools to call, in what order, to reach an outcome, plus the grounding
 * rules that keep every claim engine-backed. Adapted to the browser tools (llm/tools.ts): there is
 * no repertoire_id handle (the loaded board tree IS the repertoire), no host-filesystem tools, and
 * modify_repertoire_line only previews. The user picks a mode in the chat panel; the selected
 * workflow is appended to the system prompt for that turn.
 */
export type ChatMode = "" | "general" | "repertoire" | "review" | "position" | "annotate";

export const CHAT_MODES: { id: ChatMode; label: string }[] = [
  { id: "", label: "Select mode..." },
  { id: "general", label: "General" },
  { id: "repertoire", label: "Repertoire" },
  { id: "review", label: "Game review" },
  { id: "position", label: "Position" },
  { id: "annotate", label: "Annotate PGN" },
];

// Applies to every mode. The non-negotiable grounding contract from the skills.
const GROUNDING = `Grounding (always): ground every claim in a tool result — never state a move, line, eval, or FEN from memory. Validate pasted input first (validate_fen for a FEN, validate_pgn for a PGN); on valid:false, stop and report, never "fix" it. FENs come from tool results — get_position returns the current board FEN; the only FEN you may type is the start position. Before you state any line or "they should have played X", pass it through validate_line. Evals are white-POV centipawns (±10000 = mate): positive favors White, negative favors Black. Translate to words (±50 ≈ equal, ±200 clearly better, ±500+ winning) and always say which side the eval favors; for a Black repertoire, a negative eval is good for Black/the user and a positive eval is good for White/the opponent. If the engine is offline, say so and stop. Don't dump raw JSON; summarise. To suggest a concrete continuation, call propose_line so it shows as a board arrow the user can accept (it does not add the line until they do).`;

const MODE_BODY: Record<Exclude<ChatMode, "">, string> = {
  general: `Pick the approach that fits the request: a branching repertoire tree → the repertoire tools; a whole game → get_game_summary then analyze_game; a single position → evaluate_position. Call get_position first to ground yourself on the current board.`,

  repertoire: `Repertoire work. The variation tree the user opened on the board IS the repertoire — the repertoire tools act on it directly (no load step, no id). Method:
1. get_structural_profile (no variation_path) → the repertoire's aggregate structural identity (which pawn structures it commits to, center tendencies, files). State it plainly; relay structure_class:"unknown" rather than guessing a name.
2. analyze_repertoire_congruence → thematic inconsistencies, clustered by opening system; each flag carries paths + its cluster label.
3. Drill a flagged line: get_structural_profile(variation_path=[…SAN…]) for that node's structure/center/primitives.
4. get_repertoire_coverage → dangling lines (your-turn leaves owed a reply) vs natural frontiers.
5. classify_illustrative_lines FIRST, then pass its paths as exclude_paths to find_repertoire_gaps so "wrong-answer" side lines don't seed false gaps. Run get_transpositions before trusting gaps — a "gap" that transposes back into prep isn't one.
6. find_repertoire_gaps → strong uncovered opponent replies, ranked by severity.
7. Extend/diversify from a position: suggest_complementary_lines(mode "low_memorization" = least new theory / "sharp" = imbalance); fix an incongruent line with suggest_replacement_line(outlier_variation_path=[…]).
modify_repertoire_line only PREVIEWS the edit (returns the resulting PGN + stats) — it does NOT change the board; tell the user to apply it via the board to keep it.
Report: structural identity / incongruencies with the offending line / weak user moves + the engine fix / uncovered opponent tries = gaps / suggested extensions.`,

  review: `Game review (the current line on the board, or a PGN the user pastes — pass it as pgn).
1. get_game_summary → opening, per-side blunder/mistake/inaccuracy counts, accuracy %, the 3 worst moves. Lead your reply with this verdict.
2. analyze_game → the per-move list (cp_loss, classification, best_move). Default skips good moves; that's what you discuss.
3. For a move you'll explain: navigate the board to it (or read get_position for the current FEN), then evaluate_position(fen) for what-ifs, and validate_line before stating any "better was…".
Present: verdict up top (accuracy per side, the 1–3 turning points), then per key mistake: move played → eval swing (white-POV, e.g. +0.3 → −2.1) → best_move + the validated line → one human sentence on why.`,

  position: `Single position — the current board, or a FEN the user gives (pass it as fen).
1. validate_fen on a pasted FEN; use the normalized fen from here on.
2. evaluate_position(lines=3) → the verdict plus the ranked top moves with evals. Compare them directly.
3. Go deeper: validate_line(fen,[…]) → take its final_fen → evaluate_position(final_fen). Use get_legal_moves for the full legal set, or compare_moves to rank specific candidate moves you name.`,

  annotate: `Produce an annotated PGN artifact.
1. validate_pgn (omit pgn to annotate the current board's line).
2. export_annotated_pgn(pgn) → an annotated PGN string: glyphs ($2/$4/$6) + best-move/eval comments on flagged moves. Do NOT hand-assemble a PGN yourself.
3. Emit the returned PGN in a fenced \`\`\`pgn block and offer to save it as <name>-annotated.pgn.`,
};

export function workflowPrompt(mode: ChatMode): string {
  if (!mode) return GROUNDING;
  return `${GROUNDING}\n\n${MODE_BODY[mode]}`;
}
