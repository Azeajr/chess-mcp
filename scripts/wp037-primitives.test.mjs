import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../apps/ui/src/", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
async function componentSources(directory = new URL("components/", root)) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map((entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      return entry.isDirectory() && entry.name === "primitives"
        ? ""
        : entry.isDirectory()
          ? componentSources(url)
          : entry.name.endsWith(".tsx")
            ? readFile(url, "utf8")
            : "";
    }),
  );
  return sources.flat().filter(Boolean);
}

const [
  chat,
  repertoire,
  workspace,
  analysis,
  analysisProgress,
  preflight,
  settings,
  toolResult,
  styles,
  components,
] = await Promise.all([
  read("components/ChatPanel.tsx"),
  read("components/RepertoirePanel.tsx"),
  read("components/StrategicFitWorkspace.tsx"),
  read("components/AnalysisPanel.tsx"),
  read("components/strategic-fit/AnalysisProgress.tsx"),
  read("components/strategic-fit/PreflightResults.tsx"),
  read("components/SettingsDrawer.tsx"),
  read("components/ToolResult.tsx"),
  read("styles.css"),
  componentSources(),
]);
const app = components.join("\n");

test("WP-037 AC-1 uses one progress primitive and removes legacy progress classes", () => {
  assert.doesNotMatch(app, /<progress\b/u);
  assert.doesNotMatch(styles, /\.scan-bar-fill|\.scan-meter/u);
  assert.match(app, /from ["'][^"']*primitives\/Progress["']/u);
});

test("WP-037 progress primitive owns the native progress rendering", async () => {
  const progress = await read("components/primitives/Progress.tsx");
  assert.match(progress, /<progress\b/u);
});

test("WP-037 AC-2 routes the five status families through one primitive", () => {
  for (const source of [analysis, chat, repertoire, workspace, toolResult]) {
    assert.match(source, /primitives\/Status["']/u);
  }
  for (const source of [analysisProgress, preflight]) {
    assert.match(source, /\.\.\/primitives\/Status["']/u);
  }
});

test("WP-037 AC-3 shares panel headers", () => {
  for (const source of [chat, repertoire, workspace, analysis]) {
    assert.match(source, /PanelHeader/u);
    assert.doesNotMatch(source, /class=["'](?:outcome-label|panel-head)["']/u);
  }
  assert.match(workspace, /from ["']\.\/primitives\/RegionState["']/u);
  assert.doesNotMatch(app, /strategic-fit-region-(?:empty|loading|error|spinner)/u);
});

test("WP-037 AC-4 exposes the three button variants and danger modifier", async () => {
  const button = await read("components/primitives/Button.tsx");
  assert.match(button, /"primary" \| "secondary" \| "ghost"/u);
  assert.match(button, /danger\?/u);
});

test("WP-037 target adopts one generalized error and field/select primitive", async () => {
  const [errorState, field, select] = await Promise.all([
    read("components/primitives/ErrorState.tsx"),
    read("components/primitives/Field.tsx"),
    read("components/primitives/Select.tsx"),
  ]);
  assert.match(errorState, /<RegionState\s+status="error"/u);
  assert.match(field, /ui-field/u);
  assert.match(select, /ui-select/u);
  assert.match(repertoire, /\.\/primitives\/ErrorState["']/u);
  assert.match(settings, /\.\/primitives\/Field["']/u);
  assert.match(chat, /\.\/primitives\/Select["']/u);
});
