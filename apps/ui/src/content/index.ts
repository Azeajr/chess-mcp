/**
 * WP-008 content-label-foundation — human labels and platform-key formatting for shortcuts.
 *
 * This is a bounded prerequisite for WP-008 only. It provides exactly the six shortcut
 * labels and platform-key formatting needed by the shortcut help dialog. WP-024 later
 * absorbs this module as part of its full mechanical migration.
 */
import { createMemo } from "solid-js";

/** Shortcut label records. */
export const shortcutLabels = [
  { id: "document.save", label: "Save", key: "s", scope: "global" },
  { id: "document.undo", label: "Undo", key: "z", scope: "global" },
  { id: "position.back", label: "Previous move", key: "ArrowLeft", scope: "global" },
  { id: "position.forward", label: "Next move", key: "ArrowRight", scope: "global" },
  { id: "app.help", label: "Help", key: "?", scope: "global" },
] as const;

/**
 * Format a key for the current platform: "?" is literal, single chars become
 * "⌘+K" on Mac and "Ctrl+K" elsewhere. Non-letter keys (arrows, etc.) are
 * rendered as-is. userAgentData is the modern API; navigator.platform is the fallback
 * both for engines that have not shipped userAgentData yet and for test environments.
 */
export function formatKey(key: string): string {
  const ua = (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData;
  const platform = ua?.platform ?? "";
  const isMac = /Mac|iPod|iPhone|iPad/.test(platform) || navigator.userAgent.includes("Mac");
  const modifier = isMac ? "⌘" : "Ctrl";
  if (key.length === 1 && /[a-z]/i.test(key)) {
    return `${modifier}+${key.toUpperCase()}`;
  }
  return key;
}

/** Platform-aware formatted labels for UI display. */
export const shortcutDisplayLabels = createMemo(() =>
  shortcutLabels.map((label) => ({
    ...label,
    formattedKey: formatKey(label.key),
  })),
);
