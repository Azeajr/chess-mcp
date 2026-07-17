/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { actions, documentId } from "./store/game";
import { addSuggestion, acceptSuggestion, suggestions, preview, stagePreview, stagePreviewLine, acceptPreview, clearPreview, stageEdit, stagedEdit, acceptStagedEdit, rejectStagedEdit } from "./store/suggestions";
import { runTool } from "./llm/tools";
import { createArtifact, saveArtifact } from "./store/artifacts";
import { appendToolResultForTesting } from "./store/chat";
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
  };
}
