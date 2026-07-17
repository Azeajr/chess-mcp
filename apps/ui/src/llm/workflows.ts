import { renderWorkflowGuidance, renderWorkflowOverview, WORKFLOW_INVARIANTS, type WorkflowFamily } from "@chess-mcp/chess-tools";

export type ChatMode = "" | "general" | "repertoire" | "review" | "position" | "annotate";

export const CHAT_MODES: { id: ChatMode; label: string }[] = [
  { id: "", label: "Auto" },
  { id: "general", label: "General" },
  { id: "repertoire", label: "Repertoire" },
  { id: "review", label: "Game review" },
  { id: "position", label: "Position" },
  { id: "annotate", label: "Annotate PGN" },
];

const BROWSER_ADAPTATION = `Browser adaptation:
- The loaded GameTree, current FEN/PGN, color, revision, selected SAN path, and file name are injected by the application; there are no repertoire handles or host filesystem paths.
- Validate only user-pasted FEN/PGN. Trust the already parsed current document and omit optional pgn/fen arguments when operating on it.
- Mutations are revision-bound staged actions. Never claim an add/prune/reorder occurred until the user accepts its action card.
- Exports and decks are artifact references with explicit Save actions. Never repeat PGN/CSV content to make it saveable.
- For Strategic Fit, preserve report_id and finding_id exactly in follow-up discussion. A blocked, degraded, uncertain, or insufficient-evidence result is not evidence of consistency; report its actual preflight and confidence state.
- All browser commands remain available on every tool-capable round. Presets change guidance only.`;

const GENERAL = `Choose the method that matches the request and document: position for one FEN/current node, review for one game mainline, annotation for a requested artifact, and repertoire for a branching tree. Operation boundaries matter: audit=user move quality; gaps=opponent coverage; only moves=training criticality; structure profile=aggregate identity; structure search=matching lines; history=user departures; opponent prep=opponent targets; game annotation and repertoire annotation are different artifacts. For a current-document game summary or review, call the game command directly; its PGN is injected. For a move what-if, validate the line once and evaluate its returned final FEN—do not repeat legal-move lookup after legality is known.`;

const GROUNDING = `Shared grounding contract:\n${WORKFLOW_INVARIANTS.map((rule) => `- ${rule}`).join("\n")}`;

const familyForMode = (mode: Exclude<ChatMode, "" | "general">): WorkflowFamily =>
  mode === "annotate" ? "annotation" : mode;

export function workflowPrompt(mode: ChatMode): string {
  if (!mode || mode === "general") return `${GROUNDING}\n\n${renderWorkflowOverview("browser")}\n\n${GENERAL}\n\n${BROWSER_ADAPTATION}`;
  return `${renderWorkflowGuidance(familyForMode(mode), "browser")}\n\n${BROWSER_ADAPTATION}`;
}
