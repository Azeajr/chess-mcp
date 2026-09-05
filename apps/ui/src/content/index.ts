import { createMemo } from "solid-js";

export const shortcutLabels = [
  { id: "document.save", label: "Save", key: "s", scope: "global" },
  { id: "document.undo", label: "Undo", key: "z", scope: "global" },
  { id: "position.back", label: "Previous move", key: "ArrowLeft", scope: "global" },
  { id: "position.forward", label: "Next move", key: "ArrowRight", scope: "global" },
  { id: "app.help", label: "Help", key: "?", scope: "global" },
] as const;

function formatKey(key: string): string {
  const ua = (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData;
  const platform = ua?.platform ?? "";
  const isMac = /Mac|iPod|iPhone|iPad/.test(platform) || navigator.userAgent.includes("Mac");
  const modifier = isMac ? "⌘" : "Ctrl";
  if (key.length === 1 && /[a-z]/i.test(key)) {
    return `${modifier}+${key.toUpperCase()}`;
  }
  return key;
}

export const shortcutDisplayLabels = createMemo(() =>
  shortcutLabels.map((label) => ({
    ...label,
    formattedKey: formatKey(label.key),
  })),
);
