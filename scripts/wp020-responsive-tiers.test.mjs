import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../apps/ui/src/styles.css", import.meta.url), "utf8");
const startMarker = "/* WP-020_RESPONSIVE_TIERS_START";
const endMarker = "/* WP-020_RESPONSIVE_TIERS_END */";

test("WP-020 AC-3 documents the three responsive tiers and their content contracts", () => {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const tierBlock = css.slice(start, end);
  for (const contract of [
    "Compact",
    "Grid",
    "Flex",
    "--tier-panel-min-width: 240px",
    "--tier-panel-min-height: 12rem",
    "scroll",
    "hidden",
  ]) {
    assert.match(tierBlock, new RegExp(contract));
  }
});

test("WP-020 AC-3 keeps raw global breakpoint literals inside the tier block", () => {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker) + endMarker.length;
  const outsideTierBlock = css.slice(0, start) + css.slice(end);
  assert.doesNotMatch(outsideTierBlock, /(?:720px|1100px)/);
});

test("WP-020 AC-3 labels every 820px query as Strategic Fit workspace-local", () => {
  const queries = [...css.matchAll(/@media \(max-width: 820px\)/g)];
  assert.ok(queries.length > 0);
  for (const query of queries) {
    const prelude = css.slice(Math.max(0, query.index - 120), query.index);
    assert.match(prelude, /Strategic Fit workspace-local/);
  }
});
