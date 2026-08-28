/**
 * One AG-2 tablist scenario run: capture the browser tier at a phone-sized viewport, drive the
 * arrow-key state machine while recording what actually moved, and attempt real VoiceOver output.
 *
 * Parameterized in the same shape as `dialog-scenario` and `tree-scenario` so the three share the
 * AT-tier bookkeeping and evidence envelope rather than each re-implementing them.
 */
import type { Page } from "playwright/test";
import type {
  EvidenceBundle,
  KeyboardTraceEvidence,
  TabPanelWiringEvidence,
} from "../evidence-schema";
import { captureAriaSnapshot, captureCdpAxTree, supportsCdpAxTree } from "../collectors/browser-ax";
import { captureAxe } from "../collectors/axe";
import { traceKeyboard } from "../collectors/keyboard-trace";
import { collectAtTier } from "../collectors/at-tier";

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  readonly panelId: string;
}

export interface TabKeyboardStep {
  readonly key: string;
  /** The tab that must be selected *and* focused after this key. */
  readonly expectedTabId: string;
}

export interface TabScenarioDefinition {
  readonly id: string;
  readonly tablistName: string;
  readonly tabs: readonly TabDefinition[];
  readonly initialTabId: string;
  readonly keyboardWalk: readonly TabKeyboardStep[];
  readonly spokenTabId: string;
  readonly spokenTabOrdinal: number;
}

export interface TabScenarioOptions {
  readonly runId: string;
  readonly attemptAtCapture: boolean;
}

/**
 * What the arrow-key state machine actually did, recorded per step. The browser tier decides
 * roving-tabindex correctness from this rather than from a static snapshot: a tablist can expose
 * every correct attribute at rest and still move focus to the wrong tab on ArrowRight.
 */
export interface TabWalkStep {
  readonly key: string;
  readonly expectedTabId: string;
  readonly selectedTabId: string | null;
  readonly focusedTabId: string | null;
  readonly tabStopCount: number;
}

const tabButton = (page: Page, tabId: string) => page.locator(`#mobile-tab-${tabId}`);

/** Reads selection, focus, and the roving-tabindex Tab-stop count in one evaluation. */
async function readTabState(page: Page) {
  return page.evaluate(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    const idOf = (element: Element | null) =>
      element?.id?.startsWith("mobile-tab-") ? element.id.replace("mobile-tab-", "") : null;
    return {
      selectedTabId: idOf(tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? null),
      focusedTabId: idOf(document.activeElement),
      tabStopCount: tabs.filter((tab) => tab.getAttribute("tabindex") === "0").length,
    };
  });
}

export async function runTabScenario(
  page: Page,
  browser: "chromium" | "firefox" | "webkit",
  definition: TabScenarioDefinition,
  options: TabScenarioOptions,
): Promise<EvidenceBundle> {
  const tablist = page.getByRole("tablist", { name: definition.tablistName });
  await tablist.waitFor({ state: "visible" });

  const ariaSnapshots = [
    await captureAriaSnapshot(tablist, browser, `${definition.tablistName} tablist root`),
  ];
  const cdpAxTrees = supportsCdpAxTree(browser) ? [await captureCdpAxTree(page)] : [];
  const axe = [await captureAxe(page, browser)];

  /**
   * Prove each tab's panel association in the browser tier: `aria-controls` resolves to a real
   * element, that element is a tabpanel, and its accessible name is the tab's label (it is
   * `aria-labelledby` the tab). The AT tier then claims only what a screen reader actually says.
   */
  const tabPanelWiring: TabPanelWiringEvidence[] = await page.evaluate(
    ({ tabs, browserName }) =>
      tabs.map((tab) => {
        const tabElement = document.getElementById(`mobile-tab-${tab.id}`);
        const ariaControls = tabElement?.getAttribute("aria-controls") ?? null;
        const panel = ariaControls ? document.getElementById(ariaControls) : null;
        const labelledBy = panel?.getAttribute("aria-labelledby");
        const labelSource = labelledBy ? document.getElementById(labelledBy) : null;
        return {
          browser: browserName,
          tabId: tab.id,
          tabLabel: tab.label,
          ariaControls,
          panelExists: panel !== null,
          panelRole: panel?.getAttribute("role") ?? null,
          panelAccessibleName: labelSource?.textContent?.trim() ?? null,
        };
      }),
    {
      tabs: definition.tabs.map((tab) => ({ id: tab.id, label: tab.label })),
      browserName: browser,
    },
  );

  // Drive the state machine from the initial tab. Focus it explicitly first so the walk starts
  // from a known place on every engine rather than wherever page load happened to leave focus.
  await tabButton(page, definition.initialTabId).focus();
  const tabWalk: TabWalkStep[] = [];
  for (const step of definition.keyboardWalk) {
    await page.keyboard.press(step.key);
    const state = await readTabState(page);
    tabWalk.push({ key: step.key, expectedTabId: step.expectedTabId, ...state });
  }

  // A separate trace over the same keys records the active element around each press, which is what
  // catches focus leaving the tablist entirely — a failure mode the state read above cannot see.
  await tabButton(page, definition.initialTabId).focus();
  const keyboardTraces: KeyboardTraceEvidence[] = [
    await traceKeyboard(
      page,
      browser,
      definition.keyboardWalk.map((step) => step.key),
      ".mobile-tabs",
    ),
  ];

  // Leave the spoken tab selected before the AT session so VoiceOver describes a tab the app has
  // actually selected, not merely the initial render.
  await tabButton(page, definition.spokenTabId).click();

  const { atObservations, infrastructureLimitations } = await collectAtTier({
    attemptAtCapture: options.attemptAtCapture,
    label: definition.tablistName,
    capture: async (runner) => {
      const { captureTabObservations } = await import("../collectors/at-runner");
      return captureTabObservations(runner, page, {
        focusSpokenTab: async () => {
          await tabButton(page, definition.spokenTabId).evaluate((element: HTMLElement) =>
            element.focus(),
          );
        },
        focusOtherTab: async () => {
          await tabButton(page, definition.initialTabId).evaluate((element: HTMLElement) =>
            element.focus(),
          );
        },
      });
    },
  });

  return {
    scenarioId: definition.id,
    runId: options.runId,
    stateFingerprint: `${browser}:tablist:${definition.tablistName}:${definition.spokenTabId}`,
    ariaSnapshots,
    cdpAxTrees,
    axe,
    keyboardTraces,
    atObservations,
    infrastructureLimitations,
    tabWalk,
    tabPanelWiring,
  };
}
