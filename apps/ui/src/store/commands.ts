/** Shared direct-analysis client. Buttons and chat both execute `runTool`; this store owns only
 * direct-UI lifecycle (progress, cancellation, and the last typed result). */
import { createSignal } from "solid-js";
import { runTool } from "../llm/tools";

export type DirectCommand =
  | "audit_repertoire_moves"
  | "find_only_moves"
  | "find_structures"
  | "export_annotated_repertoire"
  | "prep_vs_opponent";

export interface CommandState {
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  result?: Record<string, unknown>;
  error?: string;
  progress?: { done: number; total?: number; detail?: string };
}

const initial = (): CommandState => ({ status: "idle" });
const [commandStates, setCommandStates] = createSignal<Record<DirectCommand, CommandState>>({
  audit_repertoire_moves: initial(),
  find_only_moves: initial(),
  find_structures: initial(),
  export_annotated_repertoire: initial(),
  prep_vs_opponent: initial(),
});
export { commandStates };

const controllers = new Map<DirectCommand, AbortController>();

export function cancelCommand(command: DirectCommand) {
  controllers.get(command)?.abort();
  controllers.delete(command);
  setCommandStates((all) => ({ ...all, [command]: { ...all[command], status: "cancelled", progress: undefined } }));
}

export async function executeCommand(command: DirectCommand, args: Record<string, unknown> = {}) {
  cancelCommand(command);
  const controller = new AbortController();
  controllers.set(command, controller);
  setCommandStates((all) => ({ ...all, [command]: { status: "running" } }));
  try {
    const value = await runTool(command, args, {
      signal: controller.signal,
      onProgress: (done, total, detail) => setCommandStates((all) => ({
        ...all,
        [command]: all[command].status === "running" ? { ...all[command], progress: { done, total, detail } } : all[command],
      })),
    });
    if (controller.signal.aborted) return;
    const result = value as Record<string, unknown>;
    const error = typeof result?.error === "string" ? result.error : undefined;
    setCommandStates((all) => ({ ...all, [command]: error ? { status: "failed", result, error } : { status: "completed", result } }));
  } catch (error) {
    if (controller.signal.aborted) return;
    setCommandStates((all) => ({ ...all, [command]: { status: "failed", error: error instanceof Error ? error.message : String(error) } }));
  } finally {
    if (controllers.get(command) === controller) controllers.delete(command);
  }
}
