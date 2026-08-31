/**
 * F21: every `*ForTesting` seam must refuse to run in a production build.
 *
 * The guard cannot be a plain `import.meta.env.DEV` check. `import.meta.env` is injected by Vite
 * and is `undefined` under `tsx --test`, so the naive form throws a TypeError in this very suite —
 * which is why ten seams were left unguarded rather than guarded incorrectly. `assertTestOnly`
 * reads `env` defensively and throws only when it exists and reports a non-DEV build.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assertTestOnly, isProductionEnvironment } from "../src/store/test-seam.ts";

test("F21 the test-seam guard blocks production and allows dev and node:test", () => {
  // Vite production: the case the guard exists for.
  assert.equal(isProductionEnvironment({ DEV: false }), true);
  // Vite dev.
  assert.equal(isProductionEnvironment({ DEV: true }), false);
  // node:test / tsx — no injected env at all. Treating this as production would break every
  // unit test that legitimately drives a seam, which is why the naive check was unusable.
  assert.equal(isProductionEnvironment(undefined), false);

  // And under this runner the guard itself is a no-op rather than a TypeError.
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
      /*
       * A seam is guarded iff `assertTestOnly()` appears between its declaration and the next
       * top-level declaration. Slicing between consecutive `export`s is deliberately simple and
       * shape-independent: three earlier attempts to locate the function body by regex or by
       * brace heuristics each produced false positives on some real signature in this tree
       * (multi-line return types, typed parameter lists).
       */
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
