/**
 * AG-2's scenario: the phone panel switcher's tab semantics and state.
 *
 * The gate's required sources are the three engines plus VoiceOver on macOS WebKit — NVDA is not
 * required here, unlike AG-1/AG-3/AG-4. The gate also explicitly forbids any iPhone-specific claim,
 * so this scenario runs at a phone-sized viewport in desktop browsers and claims exactly that: the
 * tab semantics a screen reader is handed at that width. Nothing about iOS, Safari on iPhone, or
 * touch-specific VoiceOver gestures is asserted anywhere in the verdict.
 */
import type { TabScenarioDefinition } from "./tab-scenario";

export const AG2_SCENARIO_ID = "ag-2-mobile-tabs";

/** The phone tier is the only width where `.mobile-tabs` is displayed (the stylesheet hides it above 720px). */
export const AG2_VIEWPORT = { width: 390, height: 844 } as const;

export const MOBILE_TABS_SCENARIO: TabScenarioDefinition = {
  id: AG2_SCENARIO_ID,
  tablistName: "Panel selector",
  tabs: [
    { id: "analysis", label: "Analysis", panelId: "mobile-panel-analysis" },
    { id: "moves", label: "Moves", panelId: "mobile-panel-moves" },
    { id: "chat", label: "Chat", panelId: "mobile-panel-chat" },
  ],
  // The tab the app selects on first load, and therefore the roving-tabindex Tab stop at rest.
  initialTabId: "analysis",
  /**
   * The arrow state machine WP-013 AC-2 specifies, driven from the initial tab: right advances,
   * End jumps to the last tab, right from the last wraps to the first, Home returns, and left from
   * the first wraps to the last. Five presses cover advance, jump, both wrap directions, and Home.
   */
  keyboardWalk: [
    { key: "ArrowRight", expectedTabId: "moves" },
    { key: "End", expectedTabId: "chat" },
    { key: "ArrowRight", expectedTabId: "analysis" },
    { key: "Home", expectedTabId: "analysis" },
    { key: "ArrowLeft", expectedTabId: "chat" },
  ],
  /**
   * The tab VoiceOver is asked to describe. Deliberately not the initial tab: selecting it first
   * proves the spoken selected-state tracks the app's state rather than a static initial render.
   */
  spokenTabId: "chat",
  spokenTabOrdinal: 3,
};
