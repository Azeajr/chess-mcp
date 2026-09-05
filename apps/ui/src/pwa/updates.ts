/// <reference types="vite-plugin-pwa/client" />

import { createMemo, createSignal } from "solid-js";
import { registerSW } from "virtual:pwa-register";
import { registerOperation, runningOperations, settleOperationQuietly } from "../store/operations";
import { assertTestOnly } from "../store/test-seam";

export const PWA_UPDATE_MESSAGE = "A new version is ready.";

const SIMULATED_PENDING_KEY = "chess-mcp:pwa-update-simulated-pending";
const SIMULATED_RELOAD_KEY = "chess-mcp:pwa-update-reload-requested";

const simulatedPendingOnLoad =
  import.meta.env.DEV && sessionStorage.getItem(SIMULATED_PENDING_KEY) === "true";

const [updatePending, setUpdatePending] = createSignal(simulatedPendingOnLoad);
const [dismissedForPage, setDismissedForPage] = createSignal(false);

export const pwaUpdateVisible = createMemo(
  () => updatePending() && !dismissedForPage() && runningOperations().length === 0,
);

export { updatePending as pwaUpdatePending };

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    setUpdatePending(true);
    setDismissedForPage(false);
  },
});

export function deferPwaUpdate() {
  setDismissedForPage(true);
}

export function reloadPwaUpdate() {
  if (import.meta.env.DEV) {
    sessionStorage.removeItem(SIMULATED_PENDING_KEY);
    sessionStorage.setItem(SIMULATED_RELOAD_KEY, "true");
    window.location.reload();
    return;
  }
  void updateSW(true);
}

export function simulatePwaUpdate() {
  assertTestOnly();
  sessionStorage.setItem(SIMULATED_PENDING_KEY, "true");
  sessionStorage.removeItem(SIMULATED_RELOAD_KEY);
  setUpdatePending(true);
  setDismissedForPage(false);
}

let blockingOperationId: string | null = null;

export function startPwaBlockingOperationForTesting() {
  assertTestOnly();
  blockingOperationId = registerOperation({
    kind: "pwa-update-probe",
    label: "Update deferral probe",
    surface: "analysis",
  });
}

export function settlePwaBlockingOperationForTesting() {
  assertTestOnly();
  if (blockingOperationId) settleOperationQuietly(blockingOperationId, "completed");
  blockingOperationId = null;
}

export function pwaUpdateSnapshotForTesting() {
  assertTestOnly();
  return {
    pending: updatePending(),
    visible: pwaUpdateVisible(),
    runningOperations: runningOperations().length,
    reloadRequested: sessionStorage.getItem(SIMULATED_RELOAD_KEY) === "true",
  };
}

export function resetPwaUpdateForTesting() {
  assertTestOnly();
  sessionStorage.removeItem(SIMULATED_PENDING_KEY);
  sessionStorage.removeItem(SIMULATED_RELOAD_KEY);
  setUpdatePending(false);
  setDismissedForPage(false);
  settlePwaBlockingOperationForTesting();
}

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
