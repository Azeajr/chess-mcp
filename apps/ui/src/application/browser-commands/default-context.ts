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
import {
  actions,
  color,
  currentPath,
  currentTree,
  documentId,
  fen,
  fileName,
  version,
} from "../../store/game";
import { createArtifact } from "../../store/artifacts";
import { addSuggestion, stageEdit } from "../../store/suggestions";
import {
  rejectStrategicFitChangeSet,
  stageStrategicFitChangeSet,
} from "../../store/strategic-fit-changes";
import { analysisDepth } from "../../store/engine-settings";
import { strategicFitProfile } from "../../store/strategic-fit-profile";
import { proposeStrategicFitProfile } from "../../store/strategic-fit-intent-interview";
import { proposeStrategicFitPlan } from "../../store/strategic-fit-plan-synthesis";
import { proposeStrategicFitPortfolio } from "../../store/strategic-fit-portfolio";
import { strategicFitAnalysisSettings } from "../../store/strategic-fit-resolutions";
import { strategicFitMetadata } from "../../store/strategic-fit-metadata";
import {
  getCachedStrategicFitReport,
  getCachedStrategicFitReportById,
} from "../strategic-fit-report-cache";
import { currentStrategicFitTrainingEvidence } from "../strategic-fit-training-evidence";
import type { BrowserCommandDependencies } from "./types";

let openingsPromise: Promise<OpeningTable> | null = null;
const openings = () => {
  openingsPromise ??= fetch("/openings.tsv")
    .then((response) => (response.ok ? response.text() : ""))
    .catch(() => "")
    .then((text) => parseOpeningsTsv(text));
  return openingsPromise;
};

export const defaultBrowserCommandDependencies: BrowserCommandDependencies = {
  currentTree,
  currentFen: fen,
  currentPgn: () => actions.toPgn(),
  currentColor: color,
  currentPath,
  currentFileName: fileName,
  currentRevision: version,
  currentDocumentId: documentId,
  currentStrategicFitMetadata: strategicFitMetadata,
  currentStrategicFitProfile: strategicFitProfile,
  currentStrategicFitAnalysisSettings: strategicFitAnalysisSettings,
  currentStrategicFitTrainingEvidence,
  analysisDepth,
  analyse: (atFen, multipv, depth, movetime, signal) =>
    analyseMulti(atFen, multipv, depth, movetime, signal),
  cloudEval,
  tablebaseLookup,
  explorerPosition,
  hasExplorerToken,
  lichessGames,
  chesscomGames,
  openings,
  strategicFitReport: getCachedStrategicFitReport,
  strategicFitReportById: getCachedStrategicFitReportById,
  createArtifact,
  stageEdit,
  stageReplacementChangeSet: stageStrategicFitChangeSet,
  discardReplacementChangeSet: rejectStrategicFitChangeSet,
  proposeLine: addSuggestion,
  proposeStrategicFitProfile,
  proposeStrategicFitPlan,
  proposeStrategicFitPortfolio,
};
