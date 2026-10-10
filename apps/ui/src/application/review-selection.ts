import { actions, currentTree } from "../store/game";
import { commandStates, commandIsStale } from "../store/commands";
import { setSelectedReview } from "../store/guided-ui";

export function selectReviewedMove(resultId: string, ply: number): boolean {
  const state = commandStates().analyze_game;
  if (
    state.resultId !== resultId ||
    commandIsStale("analyze_game") ||
    state.status !== "completed" ||
    !Array.isArray(state.result?.moves) ||
    !state.result.moves.some((move: Record<string, unknown>) => move.ply === ply)
  )
    return false;
  const path = Array.from({ length: ply - 1 }, () => 0);
  try {
    currentTree().nodeAt(path);
  } catch {
    return false;
  }
  actions.goto(path);
  setSelectedReview({ resultId, ply });
  return true;
}
