/** Shared direct-analysis client. Buttons and chat both execute the application command; this store owns only
 * direct-UI lifecycle (progress, cancellation, and the last typed result). */
import { createSignal } from "solid-js";
import {
  executeBrowserCommand,
  type BrowserCommandDependencies,
  type BrowserCommandExecutionOptions,
} from "../application/browser-commands/client";
import type { BrowserCommandName } from "../application/browser-commands/types";
import { executionOutcome, type ExecutionStatus } from "../application/execution-status";
import {
  registerOperation,
  settleOperation,
  settleOperationQuietly,
  updateOperation,
} from "./operations";
import { assertTestOnly } from "./test-seam";

/** Direct-control adapter; dependency injection keeps equivalence tests deterministic. */
export function executeDirectBrowserCommand(
  command: BrowserCommandName,
  args: Record<string, unknown> = {},
  options: BrowserCommandExecutionOptions = {},
  dependencies?: BrowserCommandDependencies,
) {
  return executeBrowserCommand(command, args, options, dependencies);
}

export type DirectCommand =
  | "audit_repertoire_moves"
  | "find_only_moves"
  | "find_structures"
  | "export_annotated_repertoire"
  | "export_strategic_fit_metadata"
  | "export_strategic_fit_intent_pgn"
  | "prep_vs_opponent";

export interface CommandState {
  status: Exclude<ExecutionStatus, "queued">;
  result?: Record<string, unknown>;
  error?: string;
  progress?: { done: number; total?: number; detail?: string };
  /** Epoch millis of the last transition to a settled status — drives WP-022 AC-4 summaries. */
  completedAt?: number;
}

const initial = (): CommandState => ({ status: "idle" });
const [commandStates, setCommandStates] = createSignal<Record<DirectCommand, CommandState>>({
  audit_repertoire_moves: initial(),
  find_only_moves: initial(),
  find_structures: initial(),
  export_annotated_repertoire: initial(),
  export_strategic_fit_metadata: initial(),
  export_strategic_fit_intent_pgn: initial(),
  prep_vs_opponent: initial(),
});
export { commandStates };

const controllers = new Map<DirectCommand, AbortController>();

/** Development harness seam for deterministic direct-panel result fixtures. */
export function setCommandStateForTesting(command: DirectCommand, state: CommandState) {
  assertTestOnly();
  controllers.get(command)?.abort();
  controllers.delete(command);
  setCommandStates((all) => ({ ...all, [command]: { ...state } }));
}

export function cancelCommand(command: DirectCommand) {
  controllers.get(command)?.abort();
  controllers.delete(command);
  setCommandStates((all) => ({
    ...all,
    [command]: {
      ...all[command],
      status: "cancelled",
      progress: undefined,
      completedAt: Date.now(),
    },
  }));
  // WP-010: the registry settles the operation and owns the announcement.
  const operationId = commandOperationIds.get(command);
  if (operationId !== undefined) {
    settleOperation(operationId, "cancelled");
    commandOperationIds.delete(command);
  }
}

/** Human-readable label per direct command — the announcement policy speaks in operations, not IDs. */
const COMMAND_LABELS: Record<DirectCommand, string> = {
  audit_repertoire_moves: "Prescribed-move audit",
  find_only_moves: "Only-moves scan",
  find_structures: "Structure search",
  export_annotated_repertoire: "Annotated repertoire export",
  export_strategic_fit_metadata: "Strategic Fit settings export",
  export_strategic_fit_intent_pgn: "Strategic Fit intent PGN export",
  prep_vs_opponent: "Opponent preparation comparison",
};

const commandOperationIds = new Map<DirectCommand, string>();

/**
 * WP-026 AC-4: the most recent direct-panel command request, so an error card's Retry re-issues
 * exactly what failed. Tracked here — at the single dispatch point — so every caller (panel
 * buttons, deck/export follow-ups) is covered, not just one component.
 */
let lastCommandRequest: {
  command: DirectCommand;
  args: Record<string, unknown>;
} | null = null;

/** The last command this session dispatched, for ErrorResult's Retry action. */
export function lastDirectCommandRequest(): {
  command: DirectCommand;
  args: Record<string, unknown>;
} | null {
  return lastCommandRequest;
}

/** DEV/e2e seam: seed the last-command record without dispatching. */
export function recordDirectCommandForTesting(
  command: DirectCommand,
  args: Record<string, unknown>,
) {
  assertTestOnly();
  lastCommandRequest = { command, args: { ...args } };
}

export async function executeCommand(command: DirectCommand, args: Record<string, unknown> = {}) {
  cancelCommandSilently(command);
  const controller = new AbortController();
  controllers.set(command, controller);
  lastCommandRequest = { command, args: { ...args } };
  setCommandStates((all) => ({ ...all, [command]: { status: "running" } }));
  // WP-010: registration announces the start; settle announces the outcome. No double speech.
  const operationId = registerOperation({
    kind: `direct-command:${command}`,
    label: COMMAND_LABELS[command],
    surface: "repertoire",
    cancel: () => {
      cancelCommand(command);
    },
  });
  commandOperationIds.set(command, operationId);
  try {
    const value = await executeDirectBrowserCommand(command, args, {
      signal: controller.signal,
      onProgress: (done, total, detail) => {
        updateOperation(operationId, { done, total, detail });
        setCommandStates((all) => ({
          ...all,
          [command]:
            all[command].status === "running"
              ? { ...all[command], progress: { done, total, detail } }
              : all[command],
        }));
      },
    });
    if (controller.signal.aborted) {
      // The superseding run (or cancelCommand) already settled this operation; settle quietly so
      // the entry cannot linger as running forever when no supersede happened to register.
      settleOperationQuietly(operationId, "cancelled");
      commandOperationIds.delete(command);
      return;
    }
    const result = value as Record<string, unknown>;
    const error = typeof result.error === "string" ? result.error : undefined;
    if (error) {
      settleOperation(operationId, "failed", { detail: error });
    } else {
      settleOperation(operationId, "completed", {
        detail: `${resultCount(result)} result(s)`,
      });
    }
    commandOperationIds.delete(command);
    setCommandStates((all) => ({
      ...all,
      [command]: error
        ? {
            status: executionOutcome(false, true),
            result,
            error,
            completedAt: Date.now(),
          }
        : { status: executionOutcome(false), result, completedAt: Date.now() },
    }));
  } catch (error) {
    if (controller.signal.aborted) {
      settleOperationQuietly(operationId, "cancelled");
      commandOperationIds.delete(command);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    settleOperation(operationId, "failed", { detail: message });
    setCommandStates((all) => ({
      ...all,
      [command]: {
        status: "failed",
        error: message,
        completedAt: Date.now(),
      },
    }));
  } finally {
    if (controllers.get(command) === controller) controllers.delete(command);
  }
}

/** First plausible count in a command result, for the completion announcement. */
function resultCount(result: Record<string, unknown>): number {
  for (const key of ["count", "total", "moves_audited", "positions_scanned"]) {
    const value = result[key];
    if (typeof value === "number") return value;
  }
  return 0;
}

/**
 * Cancel without the cancelled-settle announcement — used when a new run supersedes the old one.
 * Only an explicit user-visible cancellation announces; a supersede is bookkeeping, not feedback.
 */
function cancelCommandSilently(command: DirectCommand) {
  controllers.get(command)?.abort();
  controllers.delete(command);
  setCommandStates((all) => ({
    ...all,
    [command]: { ...all[command], status: "cancelled", progress: undefined },
  }));
  // Supersede: settle the superseded operation QUIETLY — a new run of the same command replacing
  // the old one is bookkeeping, not user feedback. Only cancelCommand announces "cancelled."
  const operationId = commandOperationIds.get(command);
  if (operationId !== undefined) {
    settleOperationQuietly(operationId, "cancelled");
    commandOperationIds.delete(command);
  }
}
