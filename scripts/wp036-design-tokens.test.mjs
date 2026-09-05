import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../apps/ui/src/styles.css", import.meta.url), "utf8");
const strategicFitMarker = "WP-036_STRATEGIC_FIT_START";
const [coreSource, strategicFitSource] = source.split(strategicFitMarker);
const tokenStart = coreSource.indexOf("WP-036 design tokens");
const tokenRoot = coreSource.indexOf(":root {", tokenStart);
const tokenEnd = coreSource.indexOf("\n}", tokenRoot) + 2;
const tokenSection = coreSource.slice(tokenStart, tokenEnd);
const tokenBlock = tokenSection.slice(tokenSection.indexOf("{") + 1, -1);

const withoutComments = (css) => css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

test("WP-036 AC-1 documents tokens for all nine design categories", () => {
  assert.ok(tokenStart >= 0 && tokenRoot >= 0 && tokenEnd > tokenRoot, "token block is missing");
  for (const category of [
    "Type",
    "Spacing",
    "Surfaces",
    "Borders",
    "Status",
    "Motion",
    "Focus",
    "Targets",
    "Layering",
  ]) {
    assert.match(
      tokenSection,
      new RegExp(`\\/\\* ${category}\\b`, "u"),
      `${category} is undocumented`,
    );
  }
  for (const prefix of [
    "--type-",
    "--space-",
    "--surface-",
    "--border-",
    "--status-",
    "--motion-",
    "--focus-",
    "--target-",
    "--z-",
  ]) {
    assert.match(tokenBlock, new RegExp(prefix, "u"), `${prefix} tokens are missing`);
    assert.match(
      source.replace(tokenSection, ""),
      new RegExp(`var\\(${prefix}`, "u"),
      `${prefix} tokens are not consumed outside the token block`,
    );
  }
});

test("WP-036 AC-2 keeps body declarations at twelve pixels and explicitly allowlists micro-labels", () => {
  assert.match(tokenBlock, /--type-micro:\s*0\.7rem;/u);
  assert.match(tokenBlock, /--type-xs:\s*0\.75rem;/u);
  assert.match(source, /Uppercase micro-label allowlist/u);

  const subFloorRems = [...source.matchAll(/font-size:\s*(0?(?:\.\d+))rem;/gu)].filter(
    ([, value]) => Number(value) < 0.7,
  );
  assert.deepEqual(
    subFloorRems.map((match) => match[0]),
    [],
    "rem-based text below the documented 11.2px micro-label floor remains",
  );

  const allowedSvgSelectors = new Set([
    ".replacement-pareto-plot > text",
    ".replacement-pareto-point > text",
    ".replacement-pareto-point > .replacement-pareto-point-label",
    ".decision-flow-node-text",
    ".strategic-map-cluster-text",
  ]);
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*font-size:\s*([\d.]+)px;[^{}]*)\}/gu)) {
    if (Number(match[3]) >= 12) continue;
    const selectors = match[1]
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
    assert.ok(
      selectors.every((selector) => allowedSvgSelectors.has(selector)),
      `non-SVG pixel font below 12px remains: ${selectors.join(", ")}`,
    );
  }
});

test("WP-036 AC-3 confines raw core-app colors to the token block", () => {
  assert.ok(strategicFitSource, "Strategic Fit retained-color boundary is missing");
  const coreWithoutTokens = withoutComments(coreSource.replace(tokenSection, ""));
  assert.deepEqual(
    [...coreWithoutTokens.matchAll(/#[\da-f]{3,8}\b/giu)].map((match) => match[0]),
    [],
  );
  assert.ok(
    [...strategicFitSource.matchAll(/#[\da-f]{3,8}\b/giu)].length > 0,
    "retained Strategic Fit colors should remain explicitly bounded until their migration is safe",
  );
});

test("WP-036 AC-4 confines z-index literals to the layering token scale", () => {
  const sourceWithoutTokens = withoutComments(source.replace(tokenSection, ""));
  assert.deepEqual(
    [...sourceWithoutTokens.matchAll(/z-index:\s*-?\d+/gu)].map((match) => match[0]),
    [],
  );
  assert.match(tokenBlock, /--z-content:\s*1;/u);
  assert.match(tokenBlock, /--z-workspace:\s*200;/u);
});
