import { For, Show } from "solid-js";
import { mobileTab, setMobileTab, type MobileTab } from "../store/ui";
import { operations, type OperationSurface } from "../store/operations";

const TABS: readonly [{ id: MobileTab; label: string }, ...{ id: MobileTab; label: string }[]] = [
  { id: "analysis", label: "Analysis" },
  { id: "moves", label: "Moves" },
  { id: "chat", label: "Chat" },
];

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
