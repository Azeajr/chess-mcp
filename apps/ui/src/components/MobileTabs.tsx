/**
 * Phone-only (≤720px) panel switcher. Sits between the pinned board and the panels; CSS hides it
 * above 720px. Selecting a tab sets mobileTab, which App mirrors onto `.workspace[data-mtab]` so
 * the stylesheet shows exactly one panel — the panels stay mounted, only their `display` toggles.
 *
 * WP-013: full ARIA tab semantics plus roving-tabindex keyboard traversal.
 */
import { For, Show } from "solid-js";
import { mobileTab, setMobileTab, type MobileTab } from "../store/ui";
import { operations, type OperationSurface } from "../store/operations";

const TABS: readonly [{ id: MobileTab; label: string }, ...{ id: MobileTab; label: string }[]] = [
  { id: "analysis", label: "Analysis" },
  { id: "moves", label: "Moves" },
  { id: "chat", label: "Chat" },
];

// AnalysisPanel and RepertoirePanel both render inside the "analysis" mobile panel
// (App.tsx#mobile-panel-analysis), so both surfaces indicate on that one tab. "moves" has no
// operation surface of its own and never indicates.
const TAB_SURFACES: Record<MobileTab, readonly OperationSurface[]> = {
  analysis: ["analysis", "repertoire"],
  moves: [],
  chat: ["chat"],
};

function tabHasRunningOperation(tab: MobileTab): boolean {
  const surfaces = TAB_SURFACES[tab];
  return operations().some(
    (operation) => operation.status === "running" && surfaces.includes(operation.surface),
  );
}

/** Wrap-around sibling lookup; the array is a module constant so an index always resolves. */
function tabAt(index: number): MobileTab {
  const wrapped = ((index % TABS.length) + TABS.length) % TABS.length;
  return (TABS[wrapped] ?? TABS[0]).id;
}

export default function MobileTabs() {
  return (
    <div class="mobile-tabs" role="tablist" aria-label="Panel selector">
      <For each={TABS}>
        {(tab, index) => (
          <button
            role="tab"
            id={`mobile-tab-${tab.id}`}
            aria-selected={mobileTab() === tab.id}
            aria-controls={`mobile-panel-${tab.id}`}
            // Roving tabindex: exactly one tab is a Tab stop, the arrows move within the list.
            tabindex={mobileTab() === tab.id ? 0 : -1}
            class={mobileTab() === tab.id ? "active" : ""}
            onClick={() => {
              setMobileTab(tab.id);
            }}
            onKeyDown={(event) => {
              const keys: Record<string, () => MobileTab> = {
                ArrowLeft: () => tabAt(index() - 1),
                ArrowRight: () => tabAt(index() + 1),
                Home: () => tabAt(0),
                End: () => tabAt(TABS.length - 1),
              };
              const resolve = keys[event.key];
              if (!resolve) return;
              event.preventDefault();
              const next = resolve();
              setMobileTab(next);
              document.getElementById(`mobile-tab-${next}`)?.focus();
            }}
          >
            {tab.label}
            <Show when={tabHasRunningOperation(tab.id)}>
              <span class="mobile-tab-indicator" aria-hidden="true" />
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
