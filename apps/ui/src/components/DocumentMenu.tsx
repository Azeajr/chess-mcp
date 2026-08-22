/**
 * WP-017 DocumentMenu — the Repertoire menu (DV-3).
 *
 * `Save to file` stays visible in the top bar; Open, Re-link, New, and Recover move in here.
 * Menu-button pattern: Enter/Space/ArrowDown opens, arrows and Home/End traverse, Escape closes
 * and restores focus to the trigger, `aria-expanded` reflects state. Each group carries its own
 * accessible label so the three action families are distinguishable.
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  clearHandle,
  openFile,
  reopenLast,
  requestDocumentClose,
  storedFileName,
} from "../store/files";
import { setRecoverDialogOpen } from "../store/persist";
import { actions } from "../store/game";

interface MenuEntry {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  run(): void;
}

export default function DocumentMenu() {
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  let trigger!: HTMLButtonElement;
  let listEl: HTMLDivElement | undefined;

  const entries = (): MenuEntry[] => {
    const list: MenuEntry[] = [
      {
        id: "menu-open",
        group: "Open a repertoire",
        label: "Open PGN",
        run: () => {
          openFile();
        },
      },
    ];
    const stored = storedFileName();
    if (stored) {
      list.push({
        id: "menu-reopen",
        group: "Open a repertoire",
        label: `Reopen ${stored}`,
        run: () => void reopenLast(),
      });
    }
    list.push(
      {
        id: "menu-new",
        group: "Start over",
        label: "New repertoire",
        run: () => {
          requestDocumentClose("new", () => {
            clearHandle();
            actions.newGame();
          });
        },
      },
      {
        id: "menu-recover",
        group: "Recover",
        label: "Recover an earlier repertoire",
        run: () => setRecoverDialogOpen(true),
      },
    );
    return list;
  };

  /** Entries grouped in declaration order, so each group renders once with its own label. */
  const groups = () => {
    const order: string[] = [];
    const byGroup = new Map<string, MenuEntry[]>();
    for (const entry of entries()) {
      const bucket = byGroup.get(entry.group);
      if (bucket) {
        bucket.push(entry);
        continue;
      }
      byGroup.set(entry.group, [entry]);
      order.push(entry.group);
    }
    return order.map((name) => ({ name, items: byGroup.get(name) ?? [] }));
  };

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.focus();
  };

  const choose = (index: number) => {
    const entry = entries()[index];
    if (!entry) return;
    close(false);
    trigger.focus();
    entry.run();
  };

  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(0);
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const count = entries().length;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + count) % count);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(count - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex());
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!open()) return;
    const target = event.target;
    if (target instanceof HTMLElement && !target.closest(".document-menu")) close(false);
  };

  onMount(() => {
    document.addEventListener("pointerdown", onPointerDown, true);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", onPointerDown, true);
  });

  // Roving focus: the active item owns DOM focus while the menu is open.
  createEffect(() => {
    if (!open() || !listEl) return;
    const index = activeIndex();
    const items = [...listEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    items[index]?.focus();
  });

  return (
    <div class="document-menu">
      <button
        ref={trigger}
        class="document-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => {
          if (open()) close();
          else {
            setActiveIndex(0);
            setOpen(true);
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        Repertoire
      </button>
      <Show when={open()}>
        <div
          ref={listEl}
          class="document-menu-list"
          role="menu"
          aria-label="Repertoire actions"
          onKeyDown={onMenuKeyDown}
        >
          <For each={groups()}>
            {(group) => (
              <div role="group" aria-label={group.name} class="document-menu-group">
                <span class="document-menu-group-label" aria-hidden="true">
                  {group.name}
                </span>
                <For each={group.items}>
                  {(entry) => {
                    const index = () =>
                      entries().findIndex((candidate) => candidate.id === entry.id);
                    return (
                      <button
                        type="button"
                        role="menuitem"
                        tabindex={-1}
                        class={
                          index() === activeIndex()
                            ? "document-menu-item active"
                            : "document-menu-item"
                        }
                        onClick={() => {
                          choose(index());
                        }}
                      >
                        {entry.label}
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
