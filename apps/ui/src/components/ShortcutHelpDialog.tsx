/**
 * WP-008 ShortcutHelpDialog — the `?` help dialog listing all registered shortcuts
 * grouped by scope, with platform-correct key formatting.
 */
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import Dialog from "./primitives/Dialog";
import { shortcutDisplayLabels, shortcutLabels } from "../content/index";
import { registerShortcut } from "../store/shortcuts";

export default function ShortcutHelpDialog() {
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    const dispose = registerShortcut({
      id: "app.help",
      key: "?",
      allowInTextFields: false,
      handler: () => {
        setOpen(true);
      },
    });
    onCleanup(dispose);
  });

  const grouped = () =>
    shortcutLabels.reduce<Record<string, { label: string; key: string }[]>>((acc, label) => {
      const bucket = (acc[label.scope] ??= []);
      bucket.push({
        label: label.label,
        key: shortcutDisplayLabels().find((d) => d.id === label.id)?.formattedKey ?? label.key,
      });
      return acc;
    }, {});

  return (
    <Show when={open()} fallback={null}>
      <Dialog
        title="Keyboard Shortcuts"
        size="compact"
        onClose={() => setOpen(false)}
        initialFocus=".shortcut-help-close"
      >
        <div class="shortcut-help">
          <For each={Object.entries(grouped())}>
            {([scope, items]) => (
              <section>
                <h3 class="shortcut-help-scope">{scope}</h3>
                <dl class="shortcut-help-list">
                  <For each={items}>
                    {(item) => (
                      <div class="shortcut-help-item">
                        <dt>{item.label}</dt>
                        <dd>
                          <kbd class="shortcut-key">{item.key}</kbd>
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>
              </section>
            )}
          </For>
        </div>
        <div class="shortcut-help-footer">
          <button onClick={() => setOpen(false)} class="shortcut-help-close">
            Close
          </button>
        </div>
      </Dialog>
    </Show>
  );
}
