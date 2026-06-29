/**
 * Phone-only (≤720px) panel switcher. Sits between the pinned board and the panels; CSS hides it
 * above 720px. Selecting a tab sets mobileTab, which App mirrors onto `.workspace[data-mtab]` so
 * the stylesheet shows exactly one panel — the panels stay mounted, only their `display` toggles.
 */
import { For } from "solid-js";
import { mobileTab, setMobileTab, type MobileTab } from "../store/ui";

const TABS: { id: MobileTab; label: string }[] = [
  { id: "analysis", label: "Analysis" },
  { id: "moves", label: "Moves" },
  { id: "chat", label: "Chat" },
];

export default function MobileTabs() {
  return (
    <div class="mobile-tabs" role="tablist">
      <For each={TABS}>
        {(t) => (
          <button
            role="tab"
            aria-selected={mobileTab() === t.id}
            class={mobileTab() === t.id ? "active" : ""}
            onClick={() => setMobileTab(t.id)}
          >
            {t.label}
          </button>
        )}
      </For>
    </div>
  );
}
