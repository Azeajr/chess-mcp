/**
 * WP-027: chat control labels and context-chip copy.
 *
 * The labels say what the control does to what: "Stop" and "Retry" left the user guessing whether
 * they act on the whole conversation, the current turn, or one tool.
 */
export const CHAT_CONTROLS = {
  stopRequest: "Stop this request",
  stopRequestDescription: "Stops the assistant's current turn, including any tool still running.",
  sendAgain: "Send again",
  sendAgainDescription: "Sends your last message again.",
  cancelRun: "Cancel",
  cancelRunDescription: (tool: string) => `Cancels ${tool} and lets the turn continue.`,
} as const;

export const CHAT_CONTEXT = {
  label: "What the assistant can see",
  expandLabel: "Show the exact text sent with your message",
  collapseLabel: "Hide the exact text sent with your message",
  /** The short human summary; the disclosure shows the verbatim injected block. */
  summary: (input: {
    readonly sanPath: readonly string[];
    readonly color: string;
    readonly fileName: string;
    readonly leaves: number;
  }) =>
    `${input.sanPath.length ? input.sanPath.join(" ") : "Starting position"} · ${input.color} · ${input.fileName} · ${input.leaves} ${input.leaves === 1 ? "line" : "lines"}`,
} as const;
