/**
 * Opening a finding for review is one navigation — select it, move to Evidence, put focus in the
 * pane — and more than one surface performs it. It lived inside FindingQueue as a local helper,
 * which is why the review loop had no way out of Resolution: the stage that finishes a decision
 * could not start the next one without duplicating the focus timing below and drifting from it.
 *
 * It sits here rather than in a store because it ends in a DOM focus call: this is view
 * navigation, not queue state. The queue store owns which finding is selected; this owns what the
 * workspace does about it.
 */
import { strategicFitFindingQueue } from "../../store/strategic-fit-finding-queue";
import { setStrategicFitWorkspaceStage } from "../../store/ui";

/**
 * `focusEvidence` is false for the queue's roving arrow keys, which move the selection through the
 * list without leaving it — the reader is still choosing, and yanking them to another stage
 * mid-traversal would make the arrow keys unusable.
 */
export function selectStrategicFitFinding(findingId: string, focusEvidence: boolean): void {
  strategicFitFindingQueue.selectFinding(findingId);
  if (!focusEvidence) return;
  setStrategicFitWorkspaceStage("evidence");
  queueMicrotask(() =>
    document.querySelector<HTMLElement>("#strategic-fit-pane-evidence")?.focus(),
  );
}
