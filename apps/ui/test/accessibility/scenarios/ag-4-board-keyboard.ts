import type { BoardScenarioDefinition } from "./board-scenario";

/**
 * AG-4's concrete scenario: WP-014's board keyboard layer at the start position (White to move,
 * so the grid's accessible name — the position summary — is a fixed, known string). e2 holds a
 * pawn with two legal destinations (e3, e4); e5 is deliberately not one of them.
 */
export const BOARD_KEYBOARD_SCENARIO: BoardScenarioDefinition = {
  id: "ag-4-board-keyboard",
  gridName: "Chessboard. White to move.",
  entrySquare: "e2",
  entrySquareDescription: "e2, white pawn",
  selectionSquare: "e2",
  expectedDestinationCount: 2,
  illegalTargetSquare: "e5",
  traversalStartSquare: "e2",
  traversalKey: "ArrowUp",
  traversalTargetSquare: "e3",
  otherSquareTokens: ["e4", "e5", "d3", "f3"],
  floodThreshold: 4,
};
