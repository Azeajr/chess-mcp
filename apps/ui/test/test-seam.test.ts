import assert from "node:assert/strict";
import test from "node:test";
import { assertTestOnly, isProductionEnvironment } from "../src/store/test-seam.ts";

test("F21 the test-seam guard blocks production and allows dev and node:test", () => {
  assert.equal(isProductionEnvironment({ DEV: false }), true);
  assert.equal(isProductionEnvironment({ DEV: true }), false);
  assert.equal(isProductionEnvironment(undefined), false);

  assert.doesNotThrow(() => assertTestOnly());
});

test("F21 every ForTesting seam is guarded", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const roots = ["src/store", "src/pwa"];
  const unguarded: string[] = [];
  for (const root of roots) {
    for (const entry of await readdir(new URL(`../${root}`, import.meta.url))) {
      if (!entry.endsWith(".ts") || entry === "test-seam.ts") continue;
      const source = await readFile(
        join(new URL("../", import.meta.url).pathname, root, entry),
        "utf8",
      );
      const seams = [...source.matchAll(/export function (\w*ForTesting)\b/gu)];
      for (const match of seams) {
        const name = match[1] as string;
        const start = match.index ?? 0;
        const nextExport = source.indexOf("\nexport ", start + 1);
        const end = nextExport === -1 ? source.length : nextExport;
        if (!source.slice(start, end).includes("assertTestOnly()")) {
          unguarded.push(`${root}/${entry}::${name}`);
        }
      }
    }
  }

  assert.deepEqual(unguarded, [], "these test seams are callable from a production build");
});
