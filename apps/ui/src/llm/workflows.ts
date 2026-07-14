/**
 * Chat workflow prompts — the PWA equivalent of the Claude Code skills (.claude/skills/*). They
 * encode the METHOD: which tools to call, in what order, to reach an outcome, plus the grounding
 * rules that keep every claim engine-backed. Adapted to the browser tools (llm/tools.ts): there is
 * no repertoire_id handle (the loaded board tree IS the repertoire), no host-filesystem tools, and
 * modify_repertoire_line stages an explicit user action. Optional presets append the selected
 * workflow to the automatically routed system prompt.
 */
export type ChatMode = "" | "general" | "repertoire" | "review" | "position" | "annotate";

export const CHAT_MODES: { id: ChatMode; label: string }[] = [
  { id: "", label: "Auto" },
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
5. classify_illustrative_lines FIRST, then pass its paths as exclude_paths to find_repertoire_gaps so "wrong-answer" side lines don't seed false gaps.
6. find_repertoire_gaps → strong uncovered opponent replies, ranked by severity. Transposition-first: a reply that walks back into prep on a DIFFERENT line is returned under covered_by_transposition (a false gap, not counted) — trust the gap list directly, no separate get_transpositions pass needed. popularity=true adds how often each gap move is actually played and re-ranks by frequency within severity — prefer it when the Lichess token is set (explorer_auth_required → ask the user to add the token in Settings).
7. Extend/diversify from a position: suggest_complementary_lines(mode "low_memorization" = least new theory / "sharp" = imbalance); fix an incongruent line with suggest_replacement_line(outlier_variation_path=[…]).
8. Connect dangling stubs: get_repertoire_coverage lists your-turn leaves owed a continuation; a stub whose position already appears in get_transpositions is covered by transposition (wire it, no new theory). For one that doesn't, suggest_complementary_lines continues it in-theme.
9. Shorten lines to cut memorization: find_pruning_transpositions → for each line, the earliest of YOUR moves where an engine-best (near-#1) move re-routes into a DIFFERENT prepared line, making the tail redundant (savedPlies). It reports the eval trade (evalStay vs evalTranspose) so you weigh transposing vs staying; apply by pruning the tail (modify_repertoire_line prune) and keeping the re-route move.
10. Practical-play checks (opening explorer; needs the Lichess token in Settings — on explorer_auth_required ask the user to add it): position_popularity(fen) → what opponents actually play at a position (frequency + score); find_theory_depth → per line, the ply where explorer game counts collapse (theory_exit_ply) — past it memorization stops paying, so deep tails beyond the exit are prune candidates and lines that exit early deserve the prep budget.
To ADD a line, prefer propose_line (SAN moves from the current position). Reserve modify_repertoire_line for prune/reorder, or an add whose anchor isn't the current position. Both create revision-checked action cards; neither changes the tree until the user presses Accept. Do not repeat preview PGN or claim an edit was applied.
Report: structural identity / incongruencies with the offending line / weak user moves + the engine fix / uncovered opponent tries = gaps / suggested extensions.`,

  review: `Game review (the current line on the board, or a PGN the user pastes — pass it as pgn).
1. get_game_summary → opening, per-side blunder/mistake/inaccuracy counts, accuracy %, the 3 worst moves. Lead your reply with this verdict.
2. analyze_game → the per-move list (cp_loss, classification, best_move). Default skips good moves; that's what you discuss.
3. For a move you'll explain: navigate the board to it (or read get_position for the current FEN), then evaluate_position(fen) for what-ifs, and validate_line before stating any "better was…".
Present: verdict up top (accuracy per side, the 1–3 turning points), then per key mistake: move played → eval swing (white-POV, e.g. +0.3 → −2.1) → best_move + the validated line → one human sentence on why.`,

  position: `Single position — the current board, or a FEN the user gives (pass it as fen).
1. validate_fen on a pasted FEN; use the normalized fen from here on.
2. evaluate_position(lines=3) → the verdict plus the ranked top moves with evals. Compare them directly.
3. Go deeper: validate_line(fen,[…]) → take its final_fen → evaluate_position(final_fen). Use get_legal_moves for the full legal set, or compare_moves to rank specific candidate moves you name.
4. What humans play: position_popularity(fen) → per-move frequency + win rates from the Lichess opening explorer (db "masters" for OTB theory). Needs the Lichess token in Settings — on explorer_auth_required, ask the user to add it.`,

  annotate: `Produce an annotated PGN artifact.
1. validate_pgn (omit pgn to annotate the current board's line).
2. export_annotated_pgn(pgn) → an annotated PGN string: glyphs ($2/$4/$6) + best-move/eval comments on flagged moves. Do NOT hand-assemble a PGN yourself.
3. The result is a saveable artifact card. Mention its name and summary only; never repeat the PGN content.`,
};

export function workflowPrompt(mode: ChatMode): string {
  if (!mode) return `${GROUNDING}\n\nInfer the user's outcome from the request and available document context. Start with the smallest relevant tool bundle. If the request changes direction and a needed tool is unavailable, call expand_capabilities for position, game, repertoire, or annotate.`;
  return `${GROUNDING}\n\n${MODE_BODY[mode]}`;
}
