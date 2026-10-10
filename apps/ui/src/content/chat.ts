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
