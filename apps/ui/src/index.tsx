import { render } from "solid-js/web";
import App from "./App";
import { executeBrowserCommand } from "./application/browser-commands/client";
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
  strategicFitTrainingPerformance,
  strategicFitTrainingMastery,
} from "./store/strategic-fit-training";
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

if (import.meta.env.VITE_PWA_LIFECYCLE_TEST === "1") {
  const bridge = (window as unknown as { __pwaLifecycleTest: object }).__pwaLifecycleTest;
  Object.assign(bridge, {
    identifyOpening: (pgn: string) => executeBrowserCommand("identify_opening", { pgn }),
    cloudEvaluation: () => executeBrowserCommand("cloud_eval", {}),
  });
}

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
    strategicFitTrainingPerformance,
    strategicFitTrainingMastery,
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
    resetAnnouncementsForTesting: async () => {
      const m = await import("./store/announce");
      m.resetAnnouncementsForTesting();
    },
    announcementLogForTesting: async () => {
      const m = await import("./store/announce");
      return m.announcementLogForTesting().map((entry) => entry.message);
    },
    exerciseAnnouncementScenario: async (scenario: string) => {
      switch (scenario) {
        case "file-saved": {
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
          const game = await import("./store/game");
          const suggestionsStore = await import("./store/suggestions");
          const { announce } = await import("./store/announce");
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
