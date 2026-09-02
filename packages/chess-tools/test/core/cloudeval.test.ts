import assert from "node:assert/strict";
import test from "node:test";

import { cloudEval } from "../../src/index.ts";
import { withFakeClock, stubFetch, jsonResponse, oneRequest } from "./net-helpers.ts";
import { START_FEN } from "./fixtures.ts";

test("cloudEval asks lichess for a single principal variation at the given position", async () => {
  const clock = withFakeClock();
  try {
    const stub = stubFetch(() =>
      jsonResponse({ depth: 40, knodes: 1234, pvs: [{ moves: "e2e4 e7e5", cp: 24 }] }),
    );
    await oneRequest(clock, () => cloudEval(START_FEN));

    const url = stub.calls[0]?.url ?? "";
    assert.match(url, /^https:\/\/lichess\.org\/api\/cloud-eval\?/u);
    assert.match(url, /multiPv=1/u);
    assert.match(url, /fen=rnbqkbnr%2Fpppppppp/u, "the FEN is percent-encoded");
    assert.equal(url.includes(" "), false);
  } finally {
    clock.restore();
  }
});

test("cloudEval maps a centipawn evaluation onto the public shape", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() =>
      jsonResponse({ depth: 40, knodes: 1234, pvs: [{ moves: "e2e4 e7e5", cp: 24 }] }),
    );
    assert.deepEqual(await oneRequest(clock, () => cloudEval(START_FEN)), {
      cp: 24,
      mate: null,
      depth: 40,
      knodes: 1234,
      pv: "e2e4 e7e5",
    });
  } finally {
    clock.restore();
  }
});

/** cp and mate are mutually exclusive in the response; the absent one must be null, not undefined. */
test("cloudEval maps a mate evaluation with a null centipawn score", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse({ depth: 20, knodes: 5, pvs: [{ moves: "d8h4", mate: -1 }] }));
    const result = await oneRequest(clock, () => cloudEval(START_FEN));
    assert.equal(result?.cp, null);
    assert.equal(result?.mate, -1);
    assert.equal(result?.pv, "d8h4");
  } finally {
    clock.restore();
  }
});

test("cloudEval returns null when the position is not in the cloud", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse({ error: "Not found" }, 404));
    assert.equal(await oneRequest(clock, () => cloudEval(START_FEN)), null);
  } finally {
    clock.restore();
  }
});

/** A 200 whose `pvs` array is empty carries no evaluation, so it is a miss rather than a zero. */
test("cloudEval returns null for a response with no principal variations", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse({ depth: 10, knodes: 1, pvs: [] }));
    assert.equal(await oneRequest(clock, () => cloudEval(START_FEN)), null);
  } finally {
    clock.restore();
  }
});

test("cloudEval returns null when the network is down rather than throwing", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    assert.equal(await oneRequest(clock, () => cloudEval(START_FEN)), null);
  } finally {
    clock.restore();
  }
});
