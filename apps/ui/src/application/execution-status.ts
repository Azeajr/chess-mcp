export const EXECUTION_STATUSES = ["idle", "queued", "running", "completed", "cancelled", "failed"] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type TerminalExecutionStatus = Extract<ExecutionStatus, "completed" | "cancelled" | "failed">;

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function executionOutcome(aborted: boolean, failed = false): TerminalExecutionStatus {
  return aborted ? "cancelled" : failed ? "failed" : "completed";
}
