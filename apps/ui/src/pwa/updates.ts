/// <reference types="vite-plugin-pwa/client" />

/**
 * WP-019 — prompt-driven PWA updates.
 *
 * `registerType: "prompt"` keeps a waiting worker waiting. This module turns the plugin's
 * `onNeedRefresh` callback into application state, defers the prompt while any operation is
 * running, and activates the worker only after the user chooses Reload.
 */
import { createMemo, createSignal } from "solid-js";
import { registerSW } from "virtual:pwa-register";
import { registerOperation, runningOperations, settleOperationQuietly } from "../store/operations";

export const PWA_UPDATE_MESSAGE = "A new version is ready.";

const SIMULATED_PENDING_KEY = "chess-mcp:pwa-update-simulated-pending";
const SIMULATED_RELOAD_KEY = "chess-mcp:pwa-update-reload-requested";

/** A dev simulation survives a reload just as a real waiting service worker does. */
const simulatedPendingOnLoad =
  import.meta.env.DEV && sessionStorage.getItem(SIMULATED_PENDING_KEY) === "true";

const [updatePending, setUpdatePending] = createSignal(simulatedPendingOnLoad);
const [dismissedForPage, setDismissedForPage] = createSignal(false);

/**
 * Visibility is derived from the authoritative operation registry. Settled operations linger for
 * the activity strip, but only `runningOperations()` blocks the prompt.
 */
export const pwaUpdateVisible = createMemo(
  () => updatePending() && !dismissedForPage() && runningOperations().length === 0,
);

/** Exposed for the toast and deterministic assertions. */
export { updatePending as pwaUpdatePending };

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    setUpdatePending(true);
    setDismissedForPage(false);
  },
});

/** Leave the waiting worker untouched and hide the decision for this page lifetime. */
export function deferPwaUpdate() {
  setDismissedForPage(true);
}

/**
 * Activate the waiting worker and reload. The production callback performs both once Workbox has
 * accepted the update. Development has no service worker, so its seam performs the reload itself.
 */
export function reloadPwaUpdate() {
  if (import.meta.env.DEV) {
    sessionStorage.removeItem(SIMULATED_PENDING_KEY);
    sessionStorage.setItem(SIMULATED_RELOAD_KEY, "true");
    window.location.reload();
    return;
  }
  void updateSW(true);
}

/** Dev-only: exercise the real prompt state against the Vite dev server. */
export function simulatePwaUpdate() {
  if (!import.meta.env.DEV) throw new Error("Test-only function");
  sessionStorage.setItem(SIMULATED_PENDING_KEY, "true");
  sessionStorage.removeItem(SIMULATED_RELOAD_KEY);
  setUpdatePending(true);
  setDismissedForPage(false);
}

let blockingOperationId: string | null = null;

/** Dev-only: register a real operation so AC-2 covers the same registry production uses. */
export function startPwaBlockingOperationForTesting() {
  if (!import.meta.env.DEV) throw new Error("Test-only function");
  blockingOperationId = registerOperation({
    kind: "pwa-update-probe",
    label: "Update deferral probe",
    surface: "analysis",
  });
}

/** Dev-only: settle the operation silently; its bookkeeping may linger but no longer blocks. */
export function settlePwaBlockingOperationForTesting() {
  if (!import.meta.env.DEV) throw new Error("Test-only function");
  if (blockingOperationId) settleOperationQuietly(blockingOperationId, "completed");
  blockingOperationId = null;
}

/** Dev-only snapshot stored outside module state where needed so it survives a simulated reload. */
export function pwaUpdateSnapshotForTesting() {
  if (!import.meta.env.DEV) throw new Error("Test-only function");
  return {
    pending: updatePending(),
    visible: pwaUpdateVisible(),
    runningOperations: runningOperations().length,
    reloadRequested: sessionStorage.getItem(SIMULATED_RELOAD_KEY) === "true",
  };
}

/** Reset simulation persistence between independent browser scenarios. */
export function resetPwaUpdateForTesting() {
  if (!import.meta.env.DEV) throw new Error("Test-only function");
  sessionStorage.removeItem(SIMULATED_PENDING_KEY);
  sessionStorage.removeItem(SIMULATED_RELOAD_KEY);
  setUpdatePending(false);
  setDismissedForPage(false);
  settlePwaBlockingOperationForTesting();
}

/**
 * Test-only production bridge for the deployed build-A/build-B lifecycle. Unlike `__chess`, this
 * exists in an optimised build only when the dedicated environment flag is set; ordinary
 * production builds do not expose operation controls or snapshots.
 */
if (import.meta.env.VITE_PWA_LIFECYCLE_TEST === "1") {
  (
    window as unknown as {
      __pwaLifecycleTest?: {
        startOperation: typeof startPwaBlockingOperationForTesting;
        settleOperation: typeof settlePwaBlockingOperationForTesting;
        snapshot: typeof pwaUpdateSnapshotForTesting;
      };
    }
  ).__pwaLifecycleTest = {
    startOperation: () => {
      blockingOperationId = registerOperation({
        kind: "pwa-update-probe",
        label: "Update deferral probe",
        surface: "analysis",
      });
    },
    settleOperation: () => {
      if (blockingOperationId) settleOperationQuietly(blockingOperationId, "completed");
      blockingOperationId = null;
    },
    snapshot: () => ({
      pending: updatePending(),
      visible: pwaUpdateVisible(),
      runningOperations: runningOperations().length,
      reloadRequested: false,
    }),
  };
}
