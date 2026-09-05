import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const fails of [false, true]) {
  test(`network fixtures restore globals after a ${fails ? "failing" : "passing"} test`, () => {
    // A deliberately failing test must run in a child so its teardown can be observed without
    // failing this suite. Replace fetch twice to cover suites that vary responses in one test.
    const script = `
      import assert from "node:assert/strict";
      import test from "node:test";
      import { withFakeClock, stubFetch, jsonResponse } from ${JSON.stringify(new URL("./net-helpers.ts", import.meta.url).href)};
      const original = { fetch: globalThis.fetch, Date: globalThis.Date, setTimeout: globalThis.setTimeout };
      test("uses network fixtures", async () => {
        withFakeClock();
        stubFetch(() => jsonResponse({ first: true }));
        stubFetch(() => jsonResponse({ second: true }));
        assert.deepEqual(await (await fetch("https://example.invalid")).json(), { second: true });
        if (${fails}) throw new Error("intentional fixture failure");
      });
      test("globals restored", () => {
        assert.equal(globalThis.fetch, original.fetch);
        assert.equal(globalThis.Date, original.Date);
        assert.equal(globalThis.setTimeout, original.setTimeout);
        withFakeClock(); // teardown must also allow the next test to enable fake timers
      });
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      },
    );
    assert.ifError(result.error);
    assert.match(result.stdout, /ok 2 - globals restored/, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /not ok 2 - globals restored/, result.stdout);
    assert.equal(result.status, fails ? 1 : 0, result.stdout + result.stderr);
  });
}
