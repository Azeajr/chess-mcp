export const CHAT_CONTROLS = {
  stopRequest: "Stop this request",
  stopRequestDescription: "Stops the assistant's current turn, including any tool still running.",
  sendAgain: "Send again",
  sendAgainDescription: "Sends your last message again.",
  cancelRun: "Cancel",
  cancelRunDescription: (tool: string) => `Cancels ${tool} and lets the turn continue.`,
} as const;

/** Goal starters for an empty app, each with the route to the same task without the assistant. */
export const GOAL_STARTERS = [
  {
    label: "Review a game",
    manual:
      "open the game with Open PGN in the File menu, then press Review game in the Analysis tab",
  },
  {
    label: "Improve a repertoire",
    manual:
      "open the repertoire with Open PGN in the File menu, then press Open Strategic Fit in the Analysis tab",
  },
  {
    label: "Understand a position",
    manual:
      "play or open the position, then use Compare moves and position tools in the Analysis tab",
  },
] as const;

export const MISSING_KEY = {
  message: "Set your OpenRouter API key in Settings.",
  withManualRoute: (route: string) =>
    `Set your OpenRouter API key in Settings, then send again. Without the assistant: ${route}.`,
  setup: "Set up the assistant",
} as const;

/** Replaces a credential typed into chat; Settings opens at the field it belongs in. */
export const CREDENTIAL_REMOVED = {
  "lichess-token":
    "[Lichess token removed from this message. Settings is open at the Lichess API token field for you to enter it.]",
  "api-key":
    "[OpenRouter key removed from this message. Settings is open at the OpenRouter API key field for you to enter it.]",
} as const;

/**
 * One starter per step of the Strategic Fit journey (docs/CHAT_DRIVEN_UI_SPEC.md J3), in order: set
 * up and analyse, read the assessment, take the top finding, ask for a replacement, then train.
 * Each names the step instead of a tool, so the assistant picks the command and stops where the
 * journey needs the user: setup preferences, accepting a preview, playing recall moves.
 */
export const STRATEGIC_FIT_STARTERS = [
  "Run Strategic Fit on this repertoire and tell me what it found.",
  "Which finding matters most, and is it a real inconsistency or a forced choice?",
  "Show me the evidence for the top finding on the board.",
  "Propose a replacement for the top finding and show me the preview.",
  "Make a training plan for the line I just changed.",
] as const;

export const CHAT_STARTERS = [
  "What is the plan for White in this position?",
  "Which of my replies here is weakest, and why?",
  "Suggest a line that fits the rest of my repertoire.",
] as const;

export const CHAT_CONTEXT = {
  label: "What the assistant can see",
  expandLabel: "Show the exact text sent with your message",
  collapseLabel: "Hide the exact text sent with your message",
  summary: (input: {
    readonly sanPath: readonly string[];
    readonly color: string;
    readonly fileName: string;
    readonly leaves: number;
  }) =>
    `${input.sanPath.length ? input.sanPath.join(" ") : "Starting position"} · ${input.color} · ${input.fileName} · ${input.leaves} ${input.leaves === 1 ? "line" : "lines"}`,
} as const;
