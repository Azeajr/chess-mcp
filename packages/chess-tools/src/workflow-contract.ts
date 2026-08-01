/** Dependency-free semantic workflow guidance shared by browser prompts and MCP skills. */
import type { StrategicFitFindingSort } from "./strategic-fit/analyze.js";
import type {
  StrategicFitConversationFinding,
  StrategicFitConversationFindings,
  StrategicFitConversationSummary,
  StrategicFitConversationView,
} from "./strategic-fit/conversation-projection.js";

export type WorkflowFamily = "position" | "review" | "annotation" | "repertoire";
export type WorkflowHost = "browser" | "mcp";

export interface WorkflowStep {
  title: string;
  instruction: string;
  browserTools: readonly string[];
  mcpTools: readonly string[];
}

/**
 * Dotted field paths of one bounded conversation projection. Guidance may only tell the model to
 * cite a field the Task 11.1 retrieval actually returns, so renaming a projection field breaks the
 * guidance at compile time instead of leaving the model citing something that no longer exists.
 * Array-valued fields terminate the path: their elements are described in prose, not addressed.
 */
type ProjectionPath<T> = T extends readonly unknown[]
  ? never
  : T extends object
    ? { [K in keyof T & string]-?: K | `${K}.${ProjectionPath<NonNullable<T[K]>>}` }[keyof T & string]
    : never;

export type StrategicFitSummaryCitation = ProjectionPath<StrategicFitConversationSummary>;
export type StrategicFitFindingsCitation =
  | ProjectionPath<StrategicFitConversationFindings>
  | ProjectionPath<StrategicFitConversationFindings["findings"][number]>;
export type StrategicFitFindingCitation =
  ProjectionPath<StrategicFitConversationFinding["finding"]>;
export type StrategicFitCitation =
  | StrategicFitSummaryCitation
  | StrategicFitFindingsCitation
  | StrategicFitFindingCitation;

/** One requested depth of explanation for a finding the conversation already retrieved. */
export interface WorkflowExplanationLevel {
  readonly id: "intermediate" | "expert" | "concise" | "training";
  readonly title: string;
  readonly instruction: string;
  readonly cite: readonly StrategicFitFindingCitation[];
}

/**
 * One natural-language question mapped to the retrieval that answers it. `view` is `null` when the
 * report does not own the question and another canonical operation does; the model still selects
 * that operation from its own contract rather than from words in the question.
 */
export interface WorkflowGroundedQuery {
  readonly id: string;
  readonly question: string;
  readonly view: StrategicFitConversationView | null;
  readonly sort?: StrategicFitFindingSort;
  readonly tools: readonly string[];
  readonly answer: string;
  readonly cite: readonly StrategicFitCitation[];
  readonly missing: string;
}

export interface WorkflowExplanationContract {
  readonly goal: string;
  readonly rules: readonly string[];
  readonly levels: readonly WorkflowExplanationLevel[];
  readonly queries: readonly WorkflowGroundedQuery[];
}

export interface WorkflowContract {
  goal: string;
  steps: readonly WorkflowStep[];
  report: readonly string[];
  /** Present only where a family owns explanation and exploration guidance of its own. */
  explanations?: WorkflowExplanationContract;
}

export const WORKFLOW_INVARIANTS = [
  "Validate user-pasted FEN or PGN before analysis. Stop on invalid input; never repair it silently. An already parsed host document needs no redundant validation call.",
  "Ground every move, line, evaluation, FEN, structure label, popularity claim, and best-move claim in a tool result. Never substitute chess knowledge from memory.",
  "Validate any concrete continuation before stating it. Reuse normalized FENs and SAN paths returned by tools; never hand-build a FEN.",
  "Treat engine scores as White-POV centipawns: positive favors White, negative favors Black; about 50 is near equal, 200 clearly better, 500 winning, and the mate sentinel is decisive. Label the favored side.",
  "Engine-backed tools default to depth 20. Use depth 30 only when the user explicitly requests deep analysis; warn that multi-position work may take minutes.",
  "If an engine or required network source is unavailable, say which source is unavailable and stop that dependent method. Do not turn missing evidence into a chess claim.",
  "Summarize semantic results instead of dumping JSON. Preserve structured errors, navigation references, action identifiers, and artifact identifiers for follow-up work.",
  "Treat Strategic Fit replacement results as revision-bound atomic previews. Compare full candidate subtrees and retained unavailable/partial evidence; never infer pruning, auto-accept a staged browser change, or imply MCP archive/undo support.",
] as const;

/**
 * Explanation and exploration guidance for a Strategic Fit report the conversation already holds.
 * Every level and question names the retrieval view that answers it and the exact projection fields
 * it may cite, so an explanation is assembled from returned evidence instead of narrated around it.
 */
export const STRATEGIC_FIT_EXPLANATIONS: WorkflowExplanationContract = {
  goal:
    "Explain a Strategic Fit report the conversation already produced, at the depth the user asked for, using only what the bounded retrieval views returned.",
  rules: [
    "Explain a report through `get_strategic_fit_report`, never by re-running the analysis and never from memory of an earlier answer. Name the exact `report_id`, and the `finding_id` when the subject is one finding.",
    "Quote the projection's own values. Never recompute a score, average contributions, restate one label as another, or turn a strategic distance into an engine evaluation.",
    "These views are bounded on purpose. A positive `omitted_dimension_count` or `omitted_issue_count`, a `total_san_path_count` larger than the returned paths, and any `truncated: true` mean evidence was withheld from you: say it was not shown, never that it does not exist.",
    "A `null` value, an `unavailable` or `partial` metric `state`, an `unknown` label, and an absent optional field all stay missing. Never present one as zero and never fill it in from chess knowledge.",
    "The retrieval views carry no legality, engine evaluation, coverage, or popularity evidence. Such a claim needs its own result from the operation that owns it; without one, say that evidence is unavailable.",
    "A classification is not a verdict. `forced-diversity`, `intentional-diversity`, `productive-diversity`, and `transpositional-equivalence` are not defects, and `uncertain` and `data-quality-issue` describe the evidence rather than the repertoire.",
    "Cite branches only by the SAN paths the projection returned. Never hand-build a line, continue a truncated path, or describe a move those paths do not contain.",
    "Select every operation from its own contract, not from words in the question. The complete schema is offered on each round, so a phrase in the user's message never selects a command by itself.",
  ],
  levels: [
    {
      id: "intermediate",
      title: "Intermediate player",
      instruction:
        "Say in plain language what this branch asks the player to handle differently and what to do about it. Name the opening scope, one concrete measured difference, and the branch it happens on. Keep engine and statistical vocabulary out unless the projection supplied that number.",
      cite: [
        "plain_language_category",
        "opening_scope",
        "affected_line_summary",
        "explanation",
        "difference.magnitude",
        "source_san_paths",
      ],
    },
    {
      id: "expert",
      title: "Expert strategic breakdown",
      instruction:
        "Give the measured breakdown: which comparison dimensions moved, what each contributed, the typical cohort value against the affected value, and what the comparison was made against. State confidence with the caps that limited it and what the causality evidence attributes the difference to.",
      cite: [
        "difference.distance",
        "evidence.dimensions",
        "evidence.omitted_dimension_count",
        "evidence.comparison_basis",
        "evidence.causality.controllability",
        "evidence.causality.explanation",
        "confidence.score",
        "confidence_explanation",
        "applied_caps",
      ],
    },
    {
      id: "concise",
      title: "Concise summary",
      instruction:
        "One or two sentences: the category, how large the difference is, how confident the report is, and how often it is expected to occur. No dimension-by-dimension detail and no new evidence.",
      cite: [
        "plain_language_category",
        "difference.magnitude",
        "confidence.label",
        "expected_frequency",
        "replacement_priority.label",
        "training_priority.label",
      ],
    },
    {
      id: "training",
      title: "Training focus",
      instruction:
        "Explain it as something to learn rather than something to fix: the memorization it adds, how often it comes up, which decision causes it, and which branch to drill. Drill content itself comes from a training or only-move result; never invent a model game, a plan, or a drill line. To write the plan the user keeps with the exception, ask `propose_strategic_fit_plan` for that finding's evidence basis first and build every section from it.",
      cite: [
        "training_priority.label",
        "learning_burden",
        "expected_frequency",
        "evidence.causality.label",
        "evidence.causality.likely_causal_decision_ids",
        "source_san_paths",
        "resolution_state",
      ],
    },
  ],
  queries: [
    {
      id: "frequent-avoidable-exceptions",
      question: "Show only frequent avoidable exceptions.",
      view: "findings",
      sort: "expected-frequency",
      tools: ["get_strategic_fit_report"],
      answer:
        "Page the findings sorted by expected frequency and keep only rows classified `genuine-inconsistency`. Forced, intentional, productive, and transpositional rows are not avoidable, and `uncertain` or `data-quality-issue` rows are unproven rather than avoidable. Report the page you actually read and whether more remain.",
      cite: ["findings", "classification", "expected_frequency", "page.has_more", "next_cursor"],
      missing:
        "A `null` `expected_frequency` was not measured: keep that row out of a frequency ranking and say so, rather than treating it as zero or as rare.",
    },
    {
      id: "castling-patterns",
      question: "Which branches force me into opposite-side castling?",
      view: "finding",
      tools: ["get_strategic_fit_report"],
      answer:
        "Castling is a measured setup-family signal, so read it from a finding's evidence dimensions and the concept identities the analysis reported, not from the moves. Open the findings for the branches in question and quote the dimension that names castling with its typical and affected values.",
      cite: [
        "evidence.dimensions",
        "evidence.omitted_dimension_count",
        "affected_line_summary",
        "source_san_paths",
      ],
      missing:
        "If no returned dimension names castling, say the report did not surface it for that finding, and say dimensions were withheld when `omitted_dimension_count` is above zero. Never read a castling pattern off a move list yourself.",
    },
    {
      id: "known-structure-transpositions",
      question: "Where could I transpose into structures I already know?",
      view: null,
      tools: ["get_transpositions", "find_pruning_transpositions", "find_structures"],
      answer:
        "The report does not own this question. Use the transposition operations for move orders the repertoire already joins and for sound shortcuts that shorten memorization, and structure search for lines matching an explicit structure. A `transpositional-equivalence` finding only says the report already attributed that difference to move order.",
      cite: ["classification"],
      missing:
        "Two similar SAN paths are not a transposition. Without a transposition or shortcut result, say the move order was not verified.",
    },
    {
      id: "train-versus-replace",
      question: "What should I train instead of replace?",
      view: "findings",
      sort: "training-priority",
      tools: ["get_strategic_fit_report"],
      answer:
        "Both priorities sit on every finding row. Read one page sorted by training priority and compare each row's own `training_priority` against its `replacement_priority`; a page sorted by replacement priority shows the other end. Both are report scores, not an instruction to edit: an edit still goes through the replacement or gap path and needs explicit acceptance.",
      cite: ["training_priority.label", "replacement_priority.label", "resolution_state", "sort"],
      missing:
        "A finding already resolved as a kept exception, deferred, or excluded is not a training candidate by default. Read `resolution_state` instead of assuming it is open.",
    },
    {
      id: "intentional-diversity-reason",
      question: "Why is this classified as intentional diversity?",
      view: "finding",
      tools: ["get_strategic_fit_report"],
      answer:
        "Open that finding and quote the report's own explanation, what the causality evidence attributes the difference to, and the confidence with any cap that limited it. When the status came from a decision the user recorded rather than from the analysis, say so: `resolution_state` carries that.",
      cite: [
        "classification",
        "explanation",
        "evidence.causality.label",
        "evidence.causality.explanation",
        "confidence_explanation",
        "applied_caps",
        "resolution_state",
      ],
      missing:
        "Intentional diversity is not proof the branch is good. Objective quality is a separate field and stays `unavailable` when it was not measured.",
    },
  ],
};

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
      step("Analyze strategic fit", "Run the versioned Strategic Fit report with an explicit profile or the labeled inferred default. Custom profiles may set bounded feature-family weights and browser source filters; explain their impact and source availability. Manual, population, and personal-history estimates are independently normalized under usable profile coefficients; unavailable sources contribute zero rather than diluting the result. Browser-local training mastery adjusts personalized metrics with explicit coverage. Review expected-weight findings and their evidence; never treat missing data, difference, uncertainty, forced diversity, or intentional diversity as a defect.", ["analyze_repertoire_congruence", "get_structural_profile"]),
      step("Confirm profile intent", "When the user describes goals such as low theory, a preferred structure, or an acceptable evaluation loss, translate that into an explicit profile proposal instead of quietly assuming it during analysis. In the browser, propose the exact preferences and let the user compare them against the current effective profile: nothing is saved until they accept, a rejected or superseded proposal never becomes intent, and accepting changes profile preferences only and never the repertoire tree. Propose concept identities the analysis actually reported and values inside their documented ranges; an invalid proposal is rejected, not adjusted. On MCP nothing is remembered between calls, so pass the confirmed profile explicitly with each analysis and never claim it was stored.", ["propose_strategic_fit_profile", "analyze_repertoire_congruence"], ["analyze_repertoire_congruence"]),
      step("Discuss a report", "Do not re-run the analysis to talk about a report already produced in this conversation. Retrieve the bounded summary, one page of findings, or one finding with its evidence and navigable paths using the exact report and finding identities. These views are deliberately partial: never present omitted issues, dimensions, references, or truncated text as absent evidence, and treat an unavailable or stale identity as a stale report rather than re-deriving an older answer.", ["get_strategic_fit_report"]),
      step("Plan a retained exception", "When the user keeps a branch and trains it instead of replacing it, write the plan card that goes with it: the plan, the pawn break, the favorable exchange, the danger signs, the familiar structure, and the position to drill. In the browser, ask for that finding's deterministic evidence basis first and build every section from the concepts, checkpoints, drill positions, and validated moves it returned; a section that names no evidence, an identity the basis did not return, a move off those paths, and any outside master game are rejected rather than trimmed, and evidence the basis says it withheld is withheld, not absent. Nothing is saved until the user accepts, acceptance records the plan with the existing training item rather than editing repertoire lines, and a rejected or superseded plan never becomes training metadata. On MCP there is no document training state to ground or save a plan card, so explain the branch from the report instead and never imply one was stored.", ["get_strategic_fit_report", "propose_strategic_fit_plan", "find_only_moves"], ["get_strategic_fit_report", "find_only_moves"]),
      step("Audit user moves","Audit prescribed user moves tree-wide and rank centipawn-loss findings. This checks move quality, not missing opponent replies.", ["audit_repertoire_moves"]),
      step("Find gaps", "Scan opponent decision nodes for strong uncovered replies. For a real gap, generate best-evaluation and best-fit fills and let the user choose before staging or applying an edit.", ["find_repertoire_gaps", "suggest_gap_fills", "modify_repertoire_line"]),
      step("Find only moves", "Find sharp user-turn positions where the best move clearly separates from the second. Fix non-best prescriptions through the audit path before producing a drill deck.", ["find_only_moves"]),
      step("Shorten safely", "Find sound transposition shortcuts, compare memorization savings with evaluation, inspect quality and post-prune coverage, then stage/apply only the chosen prune.", ["find_pruning_transpositions", "inspect_shortcut", "modify_repertoire_line"], ["find_pruning_transpositions", "compare_shortcut_lines", "check_shortcut_coverage", "modify_repertoire_line"]),
      step("Extend and connect", "Use coverage for dangling lines and stub reconnection. For a replacement, compare complete Strategic Fit V2 candidate subtrees, coverage, safety, provenance, and atomic change-set previews. Browser previews are staged for explicit acceptance; MCP previews do not provide archive storage or undo and return a new handle only after an explicit edit.", ["get_repertoire_coverage", "suggest_complementary_lines", "suggest_replacement_line"]),
      step("Redesign under constraints", "When the user states a redesign goal in their own terms — at most this much evaluation loss, no more theory, keep this much coverage — turn it into explicit bounds and let them confirm the bounds before anything is built from them. In the browser, propose the bounds, put every contradiction the proposal reports to the user as the question it is, and never drop, relax, or reconcile a bound yourself. Ask for the portfolio only with a confirmed constraint set: every option is one of Replacement Lab's already-generated candidates with its own scoring, safety evidence, and change set, and each measured value, Pareto status, and exclusion comes from that retained evidence. Never state an evaluation, coverage figure, legality claim, or candidate line of your own, and never present an unmeasured metric as a satisfied bound. An empty portfolio names the bound that emptied it: report that bound and ask which one to move rather than proposing a line the evidence does not contain. Selecting an option stages that existing change set for the user's revision-bound confirmation; nothing is applied, no bound is saved as a preference, and a rejected portfolio persists nothing. On MCP there is no lab result, staging, or undo, so compare candidate previews from the replacement operation instead and never claim bounds, a portfolio, or a staged change exist.", ["suggest_replacement_line", "propose_strategic_fit_portfolio"], ["suggest_replacement_line"]),
      step("Use practical evidence", "Use explorer popularity and theory depth only with authentication. Keep engine soundness distinct from human frequency.", ["position_popularity", "find_theory_depth"]),
      step("Prepare an opponent", "Use opponent preparation for an opponent's games and targets; use repertoire-versus-history for the user's own departures. Do not substitute one report for the other.", ["prep_vs_opponent", "repertoire_vs_history"]),
      step("Export the right artifact", "Use annotated repertoire export for the branching tree and only-move deck export for training. In the browser, use the JSON sidecar for canonical Strategic Fit metadata and the intent PGN only for portable comments; never expose tokens or repeat full artifact content.", ["export_annotated_repertoire", "find_only_moves", "export_strategic_fit_metadata", "export_strategic_fit_intent_pgn"], ["export_annotated_repertoire", "find_only_moves"]),
    ],
    report: ["Separate Strategic Fit, structural identity, weak user moves, uncovered opponent replies, only-move drills, and practical frequency.", "Keep confidence, strategic difference, objective quality, replacement priority, and training priority distinct.", "Give navigable SAN paths and preserve report, finding, action, and artifact references.", "Present alternatives and tradeoffs; never choose or apply a mutation silently."],
    explanations: STRATEGIC_FIT_EXPLANATIONS,
  },
};

const citations = (fields: readonly string[]): string =>
  `Cite: ${fields.map((field) => `\`${field}\``).join(", ")}.`;

function renderGroundedQuery(query: WorkflowGroundedQuery): string {
  const operations = query.tools.map((tool) => `\`${tool}\``).join(", ");
  const source = query.view === null
    ? `Not a report question; use ${operations}.`
    : `Use ${operations} with view \`${query.view}\`${query.sort === undefined ? "" : ` sorted \`${query.sort}\``}.`;
  return `- "${query.question}" ${source} ${query.answer} ${citations(query.cite)} Missing evidence: ${query.missing}`;
}

/** Render one family's explanation and exploration guidance for either host. */
export function renderWorkflowExplanations(contract: WorkflowExplanationContract): string {
  return [
    "## Explanation and exploration contract", "", contract.goal, "",
    ...contract.rules.map((rule) => `- ${rule}`), "",
    "Answer at the depth the user asked for; use the intermediate level when they did not say.", "",
    ...contract.levels.map((level) =>
      `- ${level.title} (\`${level.id}\`): ${level.instruction} ${citations(level.cite)}`),
    "",
    "Grounded questions and the retrieval that answers each:", "",
    ...contract.queries.map(renderGroundedQuery),
  ].join("\n");
}

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
    ...(workflow.explanations === undefined
      ? []
      : ["", renderWorkflowExplanations(workflow.explanations)]),
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
    ...Object.values(WORKFLOW_CONTRACTS).flatMap((workflow) =>
      workflow.explanations === undefined ? [] : ["", renderWorkflowExplanations(workflow.explanations)]),
  ].join("\n");
}
