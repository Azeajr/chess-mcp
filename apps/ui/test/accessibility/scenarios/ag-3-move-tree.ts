import type { TreeScenarioDefinition } from "./tree-scenario";

export const BRANCHING_PGN = "1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) (2... Nf6 3. Nxe5) 3. Bb5 *";

export const MOVE_TREE_SCENARIO: TreeScenarioDefinition = {
  id: "ag-3-move-tree",
  treeName: "Repertoire moves",
  entryPath: [0, 0, 0],
  entryMoveSan: "Nf3",
  branchItemPath: [0, 0, 0, 0],
  branchMoveSan: "Nc6",
  expectedLevel: "1",
  traversalKey: "ArrowLeft",
  traversalTargetPath: [0, 0, 0],
  traversalTargetSan: "Nf3",
  otherMoveSans: ["e4", "e5", "Nc6", "d6", "d4", "Nf6", "Nxe5", "Bb5"],
  floodThreshold: 4,
};
