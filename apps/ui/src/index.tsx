/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import {
  actions,
  changesSinceExport,
  color,
  currentPath,
  dirty,
  documentId,
  fileName,
  version,
} from "./store/game";
import { setReopenHandleForTesting } from "./store/files";
import {
  addSuggestion,
  acceptSuggestion,
  suggestions,
  preview,
  stagePreview,
  stagePreviewLine,
  acceptPreview,
  clearPreview,
  stageEdit,
  stagedEdit,
  acceptStagedEdit,
  rejectStagedEdit,
} from "./store/suggestions";
import { setStagedEditsForTesting, stagedEdits } from "./store/suggestions";
import { runTool } from "./llm/tools";
import { artifactById, createArtifact, saveArtifact } from "./store/artifacts";
import { appendToolResultForTesting, appendUserMessageForTesting } from "./store/chat";
import { setInspectResultForTesting, setPruneSuggestionsForTesting } from "./store/repertoire";
import { setScanErrorForTesting } from "./store/gaps";
import {
  pwaUpdateSnapshotForTesting,
  resetPwaUpdateForTesting,
  settlePwaBlockingOperationForTesting,
  simulatePwaUpdate,
  startPwaBlockingOperationForTesting,
} from "./pwa/updates";
import {
  deleteStrategicFitMetadata,
  flushStrategicFitMetadata,
  replaceStrategicFitMetadata,
  strategicFitMetadata,
  strategicFitMetadataIssues,
  strategicFitMetadataStatus,
  strategicFitMetadataWarning,
} from "./store/strategic-fit-metadata";
import {
  applyInferredStrategicFitProfile,
  confirmInferredStrategicFitProfile,
  selectStrategicFitProfile,
  strategicFitProfile,
  updateCustomStrategicFitProfile,
} from "./store/strategic-fit-profile";
import {
  completeStrategicFitProfileSetup,
  skipStrategicFitProfileSetup,
  strategicFitProfileSetupRequired,
} from "./store/strategic-fit-profile-setup";
import {
  strategicFitDataSourceCommandArguments,
  strategicFitDataSourceIdentity,
  strategicFitDataSourceSettings,
  updateStrategicFitDataSourceSettings,
} from "./store/strategic-fit-data-sources";
import {
  analyzeStrategicFit,
  cancelStrategicFitAnalysis,
  retryStrategicFitAnalysis,
  strategicFitLifecycle,
} from "./store/strategic-fit";
import {
  reconcileStrategicFitSettings,
  removeStrategicFitCohortOverride,
  removeStrategicFitDecisionWeight,
  removeStrategicFitResolution,
  removeStrategicFitRouteWeight,
  reopenStrategicFitResolution,
  strategicFitAnalysisSettings,
  upsertStrategicFitCohortOverride,
  upsertStrategicFitDecisionWeight,
  upsertStrategicFitResolution,
  upsertStrategicFitRouteWeight,
} from "./store/strategic-fit-resolutions";
import {
  cancelStrategicFitSidecarImport,
  confirmStrategicFitSidecarImport,
  prepareStrategicFitSidecarImport,
  strategicFitSidecarImportError,
  strategicFitSidecarImportPreview,
} from "./store/strategic-fit-sidecar";
import {
  commandStates,
  lastDirectCommandRequest,
  recordDirectCommandForTesting,
  setCommandStateForTesting,
} from "./store/commands";
import {
  setStrategicFitWorkspaceRegionState,
  strategicFitWorkspaceOpen,
  strategicFitWorkspaceRegions,
  strategicFitWorkspaceStage,
  settingsOpen,
  setSettingsOpen,
} from "./store/ui";
import { settingsFocusTarget, setSettingsFocusTarget, apiKey, setApiKey } from "./store/settings";
import { replacementLab } from "./store/strategic-fit-replacement";
import {
  strategicFitResolutionProof,
  strategicFitResolutionProofSnapshot,
} from "./store/strategic-fit-resolution-proof";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
render(() => <App />, root);

// DEV-only handle for headless verification (loading a PGN / driving the suggestion pipeline
// without a native file picker or a live LLM key). Not bundled in production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __chess?: unknown }).__chess = {
    ...actions,
    documentId,
    version,
    color,
    currentPath,
    dirty,
    changesSinceExport,
    fileName,
    setReopenHandleForTesting,
    commandStates,
    lastDirectCommandRequest,
    setCommandStateForTesting,
    // WP-026 AC-4 e2e seam: seed the "last direct command" so the Retry button's guard
    // (a prior dispatch must exist) is satisfiable deterministically in specs.
    recordDirectCommandForTesting: (command: string, args: Record<string, unknown>) => {
      recordDirectCommandForTesting(
        command as Parameters<typeof recordDirectCommandForTesting>[0],
        args,
      );
    },
    addSuggestion,
    acceptSuggestion,
    suggestions,
    preview,
    stagePreview,
    stagePreviewLine,
    acceptPreview,
    clearPreview,
    stageEdit,
    stagedEdit,
    acceptStagedEdit,
    rejectStagedEdit,
    createArtifact,
    artifactById,
    saveArtifact,
    appendToolResultForTesting,
    appendUserMessageForTesting,
    setInspectResultForTesting,
    setPruneSuggestionsForTesting,
    setScanErrorForTesting,
    simulatePwaUpdate,
    pwaUpdateSnapshotForTesting,
    resetPwaUpdateForTesting,
    startPwaBlockingOperationForTesting,
    settlePwaBlockingOperationForTesting,
    setStagedEditsForTesting,
    stagedEdits,
    runTool,
    settingsOpen,
    setSettingsOpen,
    settingsFocusTarget,
    setSettingsFocusTarget,
    apiKey,
    setApiKey,
    strategicFitMetadata,
    strategicFitMetadataStatus,
    strategicFitMetadataIssues,
    strategicFitMetadataWarning,
    replaceStrategicFitMetadata,
    deleteStrategicFitMetadata,
    flushStrategicFitMetadata,
    strategicFitProfile,
    selectStrategicFitProfile,
    updateCustomStrategicFitProfile,
    applyInferredStrategicFitProfile,
    confirmInferredStrategicFitProfile,
    strategicFitProfileSetupRequired,
    skipStrategicFitProfileSetup,
    completeStrategicFitProfileSetup,
    strategicFitDataSourceSettings,
    strategicFitDataSourceIdentity,
    strategicFitDataSourceCommandArguments,
    updateStrategicFitDataSourceSettings,
    strategicFitLifecycle,
    analyzeStrategicFit,
    cancelStrategicFitAnalysis,
    retryStrategicFitAnalysis,
    upsertStrategicFitResolution,
    removeStrategicFitResolution,
    reopenStrategicFitResolution,
    upsertStrategicFitCohortOverride,
    removeStrategicFitCohortOverride,
    upsertStrategicFitRouteWeight,
    removeStrategicFitRouteWeight,
    upsertStrategicFitDecisionWeight,
    removeStrategicFitDecisionWeight,
    reconcileStrategicFitSettings,
    strategicFitAnalysisSettings,
    strategicFitSidecarImportPreview,
    strategicFitSidecarImportError,
    prepareStrategicFitSidecarImport,
    confirmStrategicFitSidecarImport,
    cancelStrategicFitSidecarImport,
    strategicFitWorkspaceOpen,
    strategicFitWorkspaceStage,
    strategicFitWorkspaceRegions,
    setStrategicFitWorkspaceRegionState,
    setReplacementLabResultForTesting: replacementLab.setResultForTesting,
    setReplacementLabReviewForTesting: replacementLab.setReviewForTesting,
    setResolutionProofForTesting: strategicFitResolutionProof.setForTesting,
    strategicFitResolutionProofSnapshot,
    // Clears the live regions between UX-012 scenarios so consecutive identical messages
    // (e.g. started → completed of two separate runs) remain observable as changes.
    resetAnnouncementsForTesting: () => {
      void import("./store/announce").then((m) => {
        m.resetAnnouncementsForTesting();
      });
    },
    announcementLogForTesting: async () => {
      const m = await import("./store/announce");
      return m.announcementLogForTesting().map((entry) => entry.message);
    },
    // WP-009: deterministic driver for the live-region announcement scenarios (UX-012 baseline).
    // Each scenario triggers the real store path so the assertion covers the actual wiring.
    exerciseAnnouncementScenario: async (scenario: string) => {
      switch (scenario) {
        case "file-saved": {
          // Headless browsers reject showSaveFilePicker with an AbortError, which saveFile
          // correctly treats as a user cancel. Stub the picker with a minimal handle so the
          // success path — and its "Saved <name>." announcement — is what gets exercised.
          const files = await import("./store/files");
          const pickerWindow = window as unknown as {
            showSaveFilePicker?: (opts?: unknown) => Promise<{
              name: string;
              createWritable(): Promise<{
                write(d: string): Promise<void>;
                close(): Promise<void>;
              }>;
            }>;
          };
          pickerWindow.showSaveFilePicker = () => {
            const writable = {
              write: (data: string) => Promise.resolve(void data),
              close: () => Promise.resolve(),
            };
            return Promise.resolve({
              name: "announcement-probe.pgn",
              createWritable: () => Promise.resolve(writable),
            });
          };
          await files.saveFile().then(() => undefined);
          return;
        }
        case "document-restored": {
          // A fresh dev session has no autosave, so restoreWorking would legitimately restore
          // nothing. Seed one first through the same store path the app writes, then restore.
          const persist = await import("./store/persist");
          const idb = await import("./store/idb");
          const game = await import("./store/game");
          await idb.idbSet(persist.WORKING_REPERTOIRE_STORAGE_KEY, {
            pgn: game.actions.toPgn(),
            color: game.color(),
            path: game.currentPath(),
            fileName: "announcement-probe.pgn",
            dirty: false,
            documentId: game.documentId(),
            revision: game.version(),
          });
          await persist.restoreWorking();
          return;
        }
        case "operation-started":
        case "operation-completed":
        case "operation-cancelled":
        case "operation-failed": {
          const commands = await import("./store/commands");
          const command = "audit_repertoire_moves" as const;
          if (scenario === "operation-cancelled") {
            const pending = commands.executeCommand(command, {
              depth: 1,
              min_severity: 40,
            });
            commands.cancelCommand(command);
            await pending.catch(() => undefined);
            return;
          }
          if (scenario === "operation-failed") {
            // An unknown argument fails canonical validation, which surfaces as a per-item error
            // result announced as failed without throwing.
            await commands.executeCommand(command, { surprise: true }).catch(() => undefined);
            return;
          }
          await commands
            .executeCommand(command, {
              depth: 1,
              min_cp_loss: 50,
              max_positions: 2,
              limit: 1,
            })
            .catch(() => undefined);
          return;
        }
        case "mutation-applied":
        case "mutation-undone": {
          // A real staged edit applied through the suggestion writer, then undone. Announce the
          // mutation outcome here because WP-009 owns the policy and no store currently announces
          // mutations; WP-005's undo flow will consume Toast for the same event.
          const game = await import("./store/game");
          const suggestionsStore = await import("./store/suggestions");
          const { announce } = await import("./store/announce");
          // A real staged edit through the suggestion writer: add d5 as a new reply at move
          // one (RICH_PGN's first game opens 1.d4, so "d4" always resolves), then optionally undo.
          const staged = suggestionsStore.stageEdit("add", ["d4"], {
            addMoves: ["d5"],
          });
          if (staged.ok) {
            const applied = suggestionsStore.acceptStagedEdit(staged.action_id);
            if (scenario === "mutation-undone") {
              game.actions.undo();
              announce("Mutation undone.");
            } else if (applied.ok) {
              announce("Mutation applied.");
            }
          }
          return;
        }
        case "engine-offline": {
          const analysis = await import("./store/analysis");
          analysis.announceEngineOfflineForTesting();
          return;
        }
        default:
          throw new Error(`Unknown announcement scenario: ${scenario}`);
      }
    },
  };
}
