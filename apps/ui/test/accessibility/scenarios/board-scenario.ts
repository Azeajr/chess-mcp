import type { Page } from "playwright/test";
import type { EvidenceBundle } from "../evidence-schema";
import { captureAriaSnapshot, captureCdpAxTree, supportsCdpAxTree } from "../collectors/browser-ax";
import { captureAxe } from "../collectors/axe";
import { collectAtTier } from "../collectors/at-tier";

export interface BoardScenarioDefinition {
  readonly id: string;
  /** The grid's accessible name — WP-014's position summary, fixed by the fixture's position. */
  readonly gridName: string;
  readonly entrySquare: string;
  readonly entrySquareDescription: string;
  readonly selectionSquare: string;
  readonly expectedDestinationCount: number;
  readonly illegalTargetSquare: string;
  readonly traversalStartSquare: string;
  readonly traversalKey: string;
  readonly traversalTargetSquare: string;
  readonly otherSquareTokens: readonly string[];
  readonly floodThreshold: number;
}

export interface BoardScenarioOptions {
  readonly runId: string;
  readonly attemptAtCapture: boolean;
}

const gridCell = (page: Page, square: string) =>
  page.locator(`.board-keyboard-layer [role="gridcell"][data-square="${square}"]`);

export async function runBoardScenario(
  page: Page,
  browser: "chromium" | "firefox" | "webkit",
  definition: BoardScenarioDefinition,
  options: BoardScenarioOptions,
): Promise<EvidenceBundle> {
  const grid = page.getByRole("grid", { name: definition.gridName });
  await grid.waitFor({ state: "visible" });
  const entryCell = gridCell(page, definition.entrySquare);
  await entryCell.waitFor({ state: "visible" });

  const ariaSnapshots = [
    await captureAriaSnapshot(grid, browser, `${definition.gridName} grid root`),
  ];
  const cdpAxTrees = supportsCdpAxTree(browser) ? [await captureCdpAxTree(page)] : [];
  const axe = [await captureAxe(page, browser)];

  const focus = async (square: string) => {
    await gridCell(page, square).evaluate((element: HTMLElement) => element.focus());
  };
  const { atObservations, infrastructureLimitations } = await collectAtTier({
    attemptAtCapture: options.attemptAtCapture,
    label: definition.gridName,
    capture: async (runner) => {
      const { captureBoardObservations } = await import("../collectors/at-runner");
      return captureBoardObservations(runner, page, {
        focusEntryCell: () => focus(definition.entrySquare),
        focusSelectionCell: () => focus(definition.selectionSquare),
        awaitSelected: () =>
          gridCell(page, definition.selectionSquare).evaluate(
            (element) =>
              new Promise<void>((resolve, reject) => {
                if (element.classList.contains("selected")) {
                  resolve();
                  return;
                }
                const observer = new MutationObserver(() => {
                  if (element.classList.contains("selected")) {
                    observer.disconnect();
                    resolve();
                  }
                });
                observer.observe(element, { attributes: true, attributeFilter: ["class"] });
                setTimeout(() => {
                  observer.disconnect();
                  reject(new Error("selection never highlighted"));
                }, 20_000);
              }),
          ),
        focusIllegalTargetCell: () => focus(definition.illegalTargetSquare),
        clearSelection: async () => {
          await page.keyboard.press("Escape");
        },
        focusTraversalStartCell: () => focus(definition.traversalStartSquare),
        traversalReachedTarget: () =>
          gridCell(page, definition.traversalTargetSquare).evaluate(
            (element) => document.activeElement === element,
          ),
        focusTraversalTargetCell: () => focus(definition.traversalTargetSquare),
        traversalKey: definition.traversalKey,
      });
    },
  });

  return {
    scenarioId: definition.id,
    runId: options.runId,
    stateFingerprint: `${browser}:board:${definition.gridName}`,
    ariaSnapshots,
    cdpAxTrees,
    axe,
    keyboardTraces: [],
    atObservations,
    infrastructureLimitations,
  };
}
