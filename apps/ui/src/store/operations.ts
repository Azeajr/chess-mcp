/**
 * WP-010 — the operation registry. One authoritative answer to "what is running right now?",
 * from any source. Stores register on start, patch on progress, and settle on completion;
 * recently-settled operations linger 8 s (LINGER_MS) so an activity strip can show completion,
 * then are evicted. The registry owns announcements per the WP-009 policy: exactly one message
 * per operation start and one per settle, never per progress tick.
 *
 * It does not own the work itself or the abort controllers — owners keep those and hand a
 * `cancel` callback.
 */
import { createSignal } from "solid-js";
import { announce } from "./announce";

export type OperationStatus = "running" | "completed" | "cancelled" | "failed";

/** Which panel owns the operation's result. */
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

/** Test seam: reset the registry and timers between tests. */
export function resetOperationsForTesting() {
  for (const timer of evictionTimers.values()) clearTimeout(timer);
  evictionTimers.clear();
  setOperations([]);
}

let nextId = 0;
const evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Register a running operation and announce its start. Returns the id used to patch or settle
 * it. `cancel` is the owner's existing abort path — the registry only surfaces it.
 */
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

/** Patch a running operation's progress. Never announces — progress ticks say nothing. */
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

/**
 * Settle an operation with a terminal status. It lingers LINGER_MS for the activity strip, then
 * is evicted. Announces exactly once per settle.
 */
export function settleOperation(
  id: string,
  status: Exclude<OperationStatus, "running">,
  result?: { detail?: string },
) {
  // Guard against double settlement before touching state: a lingering completed operation must
  // not re-announce or flip status.
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

/** Operations currently in the running state, oldest first. */
export function runningOperations(): readonly Operation[] {
  return operations().filter((operation) => operation.status === "running");
}

/**
 * Silent settle: flips status and schedules eviction WITHOUT announcing. Two callers:
 * - a superseded run replaced by a new run of the same command (bookkeeping, not feedback);
 * - an aborted run observed after the fact, where the abort was already announced.
 */
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

/**
 * Silent settle for high-frequency operations (live analysis): flips status and schedules
 * eviction without announcing. The WP-009 policy announces per user-visible operation, never
 * per engine pass.
 */
export function updateOperationStatus(id: string, status: Exclude<OperationStatus, "running">) {
  const current = operations().find((entry) => entry.id === id);
  if (current?.status !== "running") return;
  setOperations((all) =>
    all.map((entry) => (entry.id === id ? { ...entry, status, cancel: undefined } : entry)),
  );
  scheduleEviction(id);
}
