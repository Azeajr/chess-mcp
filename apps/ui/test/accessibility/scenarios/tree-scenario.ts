import type { Page } from "playwright/test";
import type { EvidenceBundle } from "../evidence-schema";
import { captureAriaSnapshot, captureCdpAxTree, supportsCdpAxTree } from "../collectors/browser-ax";
import { captureAxe } from "../collectors/axe";
import { collectAtTier } from "../collectors/at-tier";

export interface TreeScenarioDefinition {
  readonly id: string;
  readonly treeName: string;
  readonly entryPath: readonly number[];
  readonly entryMoveSan: string;
  readonly branchItemPath: readonly number[];
  readonly branchMoveSan: string;
  readonly expectedLevel: string;
  readonly traversalKey: string;
  readonly traversalTargetPath: readonly number[];
  readonly traversalTargetSan: string;
  readonly otherMoveSans: readonly string[];
  readonly floodThreshold: number;
}

export interface TreeScenarioOptions {
  readonly runId: string;
  readonly attemptAtCapture: boolean;
}

const moveItem = (page: Page, path: readonly number[]) =>
  page.locator(`[role="treeitem"][data-move-path="${path.join(",")}"]`);

export async function runTreeScenario(
  page: Page,
  browser: "chromium" | "firefox" | "webkit",
  definition: TreeScenarioDefinition,
  options: TreeScenarioOptions,
): Promise<EvidenceBundle> {
  const tree = page.getByRole("tree", { name: definition.treeName });
  await tree.waitFor({ state: "visible" });
  const branchItem = moveItem(page, definition.branchItemPath);
  await branchItem.waitFor({ state: "visible" });

  const ariaSnapshots = [
    await captureAriaSnapshot(tree, browser, `${definition.treeName} tree root`),
  ];
  const cdpAxTrees = supportsCdpAxTree(browser) ? [await captureCdpAxTree(page)] : [];
  const axe = [await captureAxe(page, browser)];

  const focus = async (path: readonly number[]) => {
    await moveItem(page, path).evaluate((element: HTMLElement) => element.focus());
  };
  const { atObservations, infrastructureLimitations } = await collectAtTier({
    attemptAtCapture: options.attemptAtCapture,
    label: definition.treeName,
    capture: async (runner) => {
      const { captureTreeObservations } = await import("../collectors/at-runner");
      return captureTreeObservations(runner, page, {
        focusEntryItem: () => focus(definition.entryPath),
        focusBranchItem: () => focus(definition.branchItemPath),
        focusTraversalTarget: () => focus(definition.traversalTargetPath),
        traversalReachedTarget: () =>
          moveItem(page, definition.traversalTargetPath).evaluate(
            (element) => document.activeElement === element,
          ),
        awaitExpanded: async (expanded) => {
          await branchItem.waitFor({ state: "visible" });
          await page.waitForFunction(
            ({ selector, value }) =>
              document.querySelector(selector)?.getAttribute("aria-expanded") === value,
            {
              selector: `[role="treeitem"][data-move-path="${definition.branchItemPath.join(",")}"]`,
              value: String(expanded),
            },
          );
        },
        traversalKey: definition.traversalKey,
      });
    },
  });

  return {
    scenarioId: definition.id,
    runId: options.runId,
    stateFingerprint: `${browser}:tree:${definition.treeName}:${definition.entryPath.join(",")}`,
    ariaSnapshots,
    cdpAxTrees,
    axe,
    keyboardTraces: [],
    atObservations,
    infrastructureLimitations,
  };
}
