/** Dependency-free semantic workflow guidance shared by browser prompts and MCP skills. */
export type WorkflowFamily = "position" | "review" | "annotation" | "repertoire";
export type WorkflowHost = "browser" | "mcp";

export interface WorkflowStep {
  title: string;
  instruction: string;
  browserTools: readonly string[];
  mcpTools: readonly string[];
}

export interface WorkflowContract {
  goal: string;
  steps: readonly WorkflowStep[];
  report: readonly string[];
}

export const WORKFLOW_INVARIANTS = [
  "Validate user-pasted FEN or PGN before analysis. Stop on invalid input; never repair it silently. An already parsed host document needs no redundant validation call.",
  "Ground every move, line, evaluation, FEN, structure label, popularity claim, and best-move claim in a tool result. Never substitute chess knowledge from memory.",
  "Validate any concrete continuation before stating it. Reuse normalized FENs and SAN paths returned by tools; never hand-build a FEN.",
  "Treat engine scores as White-POV centipawns: positive favors White, negative favors Black; about 50 is near equal, 200 clearly better, 500 winning, and the mate sentinel is decisive. Label the favored side.",
  "Engine-backed tools default to depth 20. Use depth 30 only when the user explicitly requests deep analysis; warn that multi-position work may take minutes.",
  "If an engine or required network source is unavailable, say which source is unavailable and stop that dependent method. Do not turn missing evidence into a chess claim.",
  "Summarize semantic results instead of dumping JSON. Preserve structured errors, navigation references, action identifiers, and artifact identifiers for follow-up work.",
] as const;

const step = (title: string, instruction: string, browserTools: readonly string[], mcpTools: readonly string[] = browserTools): WorkflowStep =>
  ({ title, instruction, browserTools, mcpTools });

export const WORKFLOW_CONTRACTS: Record<WorkflowFamily, WorkflowContract> = {
  position: {
    goal: "Evaluate one position and compare legal candidate moves without drifting into whole-game review.",
    steps: [
      step("Ground", "Validate a pasted FEN, then ground the normalized or current position and its legal moves.", ["validate_fen", "get_position"]),
      step("Evaluate", "Run one multi-line local evaluation and compare the ranked candidates directly.", ["evaluate_position"]),
      step("Compare", "Use the full legal-move primitive only when needed; use candidate comparison for moves the user names.", ["get_legal_moves", "compare_moves"]),
      step("Drill", "Validate a proposed SAN line, take its returned final FEN, and evaluate that child position for the what-if.", ["validate_line", "evaluate_position"]),
    ],
    report: ["Lead with the position verdict and favored side.", "Compare the top candidates with labeled scores.", "State only validated continuations."],
  },
  review: {
    goal: "Review one game's mainline, identify turning points, and explain only engine-grounded alternatives.",
    steps: [
      step("Validate", "Validate pasted PGN before review; use the already parsed current game directly on the browser host.", ["validate_pgn"]),
      step("Summarize", "Get the compact game verdict first: accuracy, per-side classifications, and worst moves.", ["get_game_summary"]),
      step("Inspect", "Retrieve the mainline move analysis and focus on the few largest losses rather than narrating every good move.", ["analyze_game"]),
      step("Explain", "For each discussed alternative, ground the position, validate the line, and evaluate a child only when the summary is insufficient.", ["get_position", "validate_line", "evaluate_position"]),
    ],
    report: ["Lead with accuracy and one to three turning points.", "For each mistake: played move, labeled swing, grounded best move, validated line, and one plain-language reason."],
  },
  annotation: {
    goal: "Create a saveable annotated game or repertoire artifact without model-authored PGN content.",
    steps: [
      step("Choose artifact", "Use game annotation for one mainline and repertoire annotation for a branching preparation tree; never substitute one for the other.", ["export_annotated_pgn", "export_annotated_repertoire"]),
      step("Validate pasted input", "Validate only PGN pasted by the user. The browser's current parsed document does not need an argument-less validation call.", ["validate_pgn"]),
      step("Export", "Call the chosen export operation and preserve the returned artifact reference. Do not hand-assemble or repeat the PGN payload.", ["export_annotated_pgn", "export_annotated_repertoire"]),
    ],
    report: ["Name the artifact and summarize what was annotated.", "Keep the artifact identifier/path available for saving; do not echo full PGN."],
  },
  repertoire: {
    goal: "Pressure-test a branching repertoire for soundness, coverage, memorization cost, structures, and practical opponent preparation.",
    steps: [
      step("Profile", "Use the aggregate structural profile for identity; use structure search to locate lines matching explicit structure, center, theme, or color-complex criteria.", ["get_structural_profile", "find_structures"]),
      step("Analyze strategic fit", "Run the versioned Strategic Fit report with an explicit profile or the labeled inferred default. Review expected-weight findings and their evidence; never treat difference, uncertainty, forced diversity, or intentional diversity as a defect.", ["analyze_repertoire_congruence", "get_structural_profile"]),
      step("Audit user moves", "Audit prescribed user moves tree-wide and rank centipawn-loss findings. This checks move quality, not missing opponent replies.", ["audit_repertoire_moves"]),
      step("Find gaps", "Scan opponent decision nodes for strong uncovered replies. For a real gap, generate best-evaluation and best-fit fills and let the user choose before staging or applying an edit.", ["find_repertoire_gaps", "suggest_gap_fills", "modify_repertoire_line"]),
      step("Find only moves", "Find sharp user-turn positions where the best move clearly separates from the second. Fix non-best prescriptions through the audit path before producing a drill deck.", ["find_only_moves"]),
      step("Shorten safely", "Find sound transposition shortcuts, compare memorization savings with evaluation, inspect quality and post-prune coverage, then stage/apply only the chosen prune.", ["find_pruning_transpositions", "inspect_shortcut", "modify_repertoire_line"], ["find_pruning_transpositions", "compare_shortcut_lines", "check_shortcut_coverage", "modify_repertoire_line"]),
      step("Extend and connect", "Use coverage for dangling lines and stub reconnection; use complementary or replacement suggestions for intentional additions grounded in engine output.", ["get_repertoire_coverage", "suggest_complementary_lines", "suggest_replacement_line"]),
      step("Use practical evidence", "Use explorer popularity and theory depth only with authentication. Keep engine soundness distinct from human frequency.", ["position_popularity", "find_theory_depth"]),
      step("Prepare an opponent", "Use opponent preparation for an opponent's games and targets; use repertoire-versus-history for the user's own departures. Do not substitute one report for the other.", ["prep_vs_opponent", "repertoire_vs_history"]),
      step("Export the right artifact", "Use annotated repertoire export for the branching tree and only-move deck export for training. Game annotation is not a repertoire artifact.", ["export_annotated_repertoire", "find_only_moves"]),
    ],
    report: ["Separate Strategic Fit, structural identity, weak user moves, uncovered opponent replies, only-move drills, and practical frequency.", "Keep confidence, strategic difference, objective quality, replacement priority, and training priority distinct.", "Give navigable SAN paths and preserve report, finding, action, and artifact references.", "Present alternatives and tradeoffs; never choose or apply a mutation silently."],
  },
};

export function renderWorkflowGuidance(family: WorkflowFamily, host: WorkflowHost): string {
  const workflow = WORKFLOW_CONTRACTS[family];
  const method = workflow.steps.map((item, index) => {
    const tools = host === "browser" ? item.browserTools : item.mcpTools;
    return `${index + 1}. ${item.title}: ${item.instruction} Tools: ${tools.map((tool) => `\`${tool}\``).join(", ")}.`;
  });
  return [
    "## Shared grounding contract", "", ...WORKFLOW_INVARIANTS.map((rule) => `- ${rule}`), "",
    "## Shared method", "", workflow.goal, "", ...method, "",
    "## Shared report contract", "", ...workflow.report.map((item) => `- ${item}`),
  ].join("\n");
}

/** Compact all-family method index for natural/Auto conversation without a preset. */
export function renderWorkflowOverview(host: WorkflowHost): string {
  return [
    "## Shared method index",
    "",
    "When the user explicitly names an analysis or export, call its matching command instead of explaining how to run it.",
    ...Object.entries(WORKFLOW_CONTRACTS).flatMap(([family, workflow]) => [
      "",
      `### ${family}`,
      workflow.goal,
      ...workflow.steps.map((item) => {
        const tools = host === "browser" ? item.browserTools : item.mcpTools;
        return `- ${item.title}: ${item.instruction} Tools: ${tools.map((tool) => `\`${tool}\``).join(", ")}.`;
      }),
    ]),
  ].join("\n");
}
