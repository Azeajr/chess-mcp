/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { actions, documentId, version } from "./store/game";
import { addSuggestion, acceptSuggestion, suggestions, preview, stagePreview, stagePreviewLine, acceptPreview, clearPreview, stageEdit, stagedEdit, acceptStagedEdit, rejectStagedEdit } from "./store/suggestions";
import { runTool } from "./llm/tools";
import { createArtifact, saveArtifact } from "./store/artifacts";
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
  };
}
