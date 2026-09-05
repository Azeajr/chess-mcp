import { strategicFitFindingQueue } from "../../store/strategic-fit-finding-queue";
import { setStrategicFitWorkspaceStage } from "../../store/ui";

export function selectStrategicFitFinding(findingId: string, focusEvidence: boolean): void {
  strategicFitFindingQueue.selectFinding(findingId);
  if (!focusEvidence) return;
  setStrategicFitWorkspaceStage("evidence");
  queueMicrotask(() =>
    document.querySelector<HTMLElement>("#strategic-fit-pane-evidence")?.focus(),
  );
}
