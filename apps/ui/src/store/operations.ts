import { createSignal } from "solid-js";
import { announce } from "./announce";
import { assertTestOnly } from "./test-seam";

export type OperationStatus = "running" | "completed" | "cancelled" | "failed";

export type OperationSurface = "analysis" | "repertoire" | "chat" | "strategic-fit";

export interface Operation {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly surface: OperationSurface;
  readonly status: OperationStatus;
  readonly done?: number;
  readonly total?: number;
  readonly detail?: string;
  readonly startedAt: number;
  readonly cancel?: () => void;
}

const LINGER_MS = 8_000;

const [operations, setOperations] = createSignal<Operation[]>([]);
export { operations };

export function resetOperationsForTesting() {
  assertTestOnly();
  for (const timer of evictionTimers.values()) clearTimeout(timer);
  evictionTimers.clear();
  setOperations([]);
}

let nextId = 0;
const evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function registerOperation(input: {
  kind: string;
  label: string;
  surface: OperationSurface;
  cancel?: () => void;
}): string {
  const id = `op-${(nextId += 1)}`;
  setOperations((all) => [
    ...all,
    {
      id,
      kind: input.kind,
      label: input.label,
      surface: input.surface,
      status: "running",
      startedAt: Date.now(),
      cancel: input.cancel,
    },
  ]);
  announce(`${input.label} started.`);
  return id;
}

export function updateOperation(
  id: string,
  progress: { done?: number; total?: number; detail?: string },
) {
  setOperations((all) =>
    all.map((operation) =>
      operation.id === id && operation.status === "running"
        ? { ...operation, ...progress }
        : operation,
    ),
  );
}

export function settleOperation(
  id: string,
  status: Exclude<OperationStatus, "running">,
  result?: { detail?: string },
) {
  const current = operations().find((entry) => entry.id === id);
  if (current?.status !== "running") return;
  setOperations((all) =>
    all.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status,
            detail: result?.detail ?? entry.detail,
            cancel: undefined,
          }
        : entry,
    ),
  );
  const message =
    status === "completed"
      ? `${current.label} completed${result?.detail ? `: ${result.detail}` : "."}`
      : status === "cancelled"
        ? `${current.label} cancelled.`
        : `${current.label} failed${result?.detail ? `: ${result.detail}` : "."}`;
  announce(message, { assertive: status === "failed" });
  scheduleEviction(id);
}

export function runningOperations(): readonly Operation[] {
  return operations().filter((operation) => operation.status === "running");
}

export function settleOperationQuietly(id: string, status: Exclude<OperationStatus, "running">) {
  const current = operations().find((entry) => entry.id === id);
  if (current?.status !== "running") return;
  setOperations((all) =>
    all.map((entry) =>
      entry.id === id ? { ...entry, status, detail: undefined, cancel: undefined } : entry,
    ),
  );
  scheduleEviction(id);
}

function scheduleEviction(id: string) {
  const existing = evictionTimers.get(id);
  if (existing) clearTimeout(existing);
  evictionTimers.set(
    id,
    setTimeout(() => {
      evictionTimers.delete(id);
      setOperations((all) => all.filter((entry) => entry.id !== id));
    }, LINGER_MS),
  );
}

export function updateOperationStatus(id: string, status: Exclude<OperationStatus, "running">) {
  const current = operations().find((entry) => entry.id === id);
  if (current?.status !== "running") return;
  setOperations((all) =>
    all.map((entry) => (entry.id === id ? { ...entry, status, cancel: undefined } : entry)),
  );
  scheduleEviction(id);
}
