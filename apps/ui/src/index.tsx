/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { actions, color, currentPath, dirty, documentId, fileName, version } from "./store/game";
import { addSuggestion, acceptSuggestion, suggestions, preview, stagePreview, stagePreviewLine, acceptPreview, clearPreview, stageEdit, stagedEdit, acceptStagedEdit, rejectStagedEdit } from "./store/suggestions";
import { runTool } from "./llm/tools";
import { artifactById, createArtifact, saveArtifact } from "./store/artifacts";
import { appendToolResultForTesting } from "./store/chat";
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
import { commandStates } from "./store/commands";
import {
  setStrategicFitWorkspaceRegionState,
  strategicFitWorkspaceOpen,
  strategicFitWorkspaceRegions,
  strategicFitWorkspaceStage,
} from "./store/ui";
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
    fileName,
    commandStates,
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
    runTool,
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
  };
}
