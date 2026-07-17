import {
  chesscomGames,
  cloudEval,
  explorerPosition,
  hasExplorerToken,
  lichessGames,
  parseOpeningsTsv,
  tablebaseLookup,
  type OpeningTable,
} from "@chess-mcp/chess-tools";
import { analyseMulti } from "../../engine/stockfish";
import { actions, color, currentPath, currentTree, documentId, fen, fileName, version } from "../../store/game";
import { createArtifact } from "../../store/artifacts";
import { addSuggestion, stageEdit } from "../../store/suggestions";
import { analysisDepth } from "../../store/engine-settings";
import { strategicFitProfile } from "../../store/strategic-fit-profile";
import { strategicFitAnalysisSettings } from "../../store/strategic-fit-resolutions";
import { strategicFitMetadata } from "../../store/strategic-fit-metadata";
import { getCachedStrategicFitReport } from "../strategic-fit-report-cache";
import type { BrowserCommandDependencies } from "./types";

let openingsPromise: Promise<OpeningTable> | null = null;
const openings = () => {
  if (!openingsPromise) {
    openingsPromise = fetch("/openings.tsv")
      .then((response) => (response.ok ? response.text() : ""))
      .catch(() => "")
      .then((text) => parseOpeningsTsv(text));
  }
  return openingsPromise;
};

export const defaultBrowserCommandDependencies: BrowserCommandDependencies = {
  currentTree,
  currentFen: fen,
  currentPgn: actions.toPgn,
  currentColor: color,
  currentPath,
  currentFileName: fileName,
  currentRevision: version,
  currentDocumentId: documentId,
  currentStrategicFitMetadata: strategicFitMetadata,
  currentStrategicFitProfile: strategicFitProfile,
  currentStrategicFitAnalysisSettings: strategicFitAnalysisSettings,
  analysisDepth,
  analyse: (atFen, multipv, depth, movetime, signal) => analyseMulti(atFen, multipv, depth, movetime, signal),
  cloudEval,
  tablebaseLookup,
  explorerPosition,
  hasExplorerToken,
  lichessGames,
  chesscomGames,
  openings,
  strategicFitReport: getCachedStrategicFitReport,
  createArtifact,
  stageEdit,
  proposeLine: addSuggestion,
};
