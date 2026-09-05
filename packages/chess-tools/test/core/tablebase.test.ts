import assert from "node:assert/strict";
import test from "node:test";

import { tablebaseLookup } from "../../src/index.ts";
import { withFakeClock, stubFetch, jsonResponse, oneRequest } from "./net-helpers.ts";
import { PROMOTION_FEN } from "./fixtures.ts";

const win = (over: Record<string, unknown> = {}) => ({
  category: "win",
  dtz: 1,
  dtm: 11,
  checkmate: false,
  stalemate: false,
  moves: [{ uci: "a7a8q", san: "a8=Q", category: "win", dtz: -1 }],
  ...over,
});

test("tablebaseLookup queries the standard endpoint with an encoded FEN", async () => {
  const clock = withFakeClock();
  try {
    const stub = stubFetch(() => jsonResponse(win()));
    await oneRequest(clock, () => tablebaseLookup(PROMOTION_FEN));

    const url = stub.calls[0]?.url ?? "";
    assert.match(url, /^https:\/\/tablebase\.lichess\.ovh\/standard\?fen=/u);
    assert.equal(url.includes(" "), false, "the FEN's spaces must not split the query");
  } finally {
    clock.restore();
  }
});

test("tablebaseLookup maps the result and its move list", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse(win()));
    assert.deepEqual(await oneRequest(clock, () => tablebaseLookup(PROMOTION_FEN)), {
      category: "win",
      dtz: 1,
      dtm: 11,
      checkmate: false,
      stalemate: false,
      moves: [{ uci: "a7a8q", san: "a8=Q", category: "win", dtz: -1 }],
    });
  } finally {
    clock.restore();
  }
});

test("tablebaseLookup accepts every category the endpoint can return", async () => {
  const clock = withFakeClock();
  try {
    for (const category of ["win", "loss", "draw", "cursed-win", "blessed-loss", "unknown"]) {
      stubFetch(() => jsonResponse(win({ category })));
      const result = await oneRequest(clock, () => tablebaseLookup(PROMOTION_FEN));
      assert.equal(result?.category, category);
    }
  } finally {
    clock.restore();
  }
});

test("tablebaseLookup coerces an unrecognised category to unknown", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse(win({ category: "something-new" })));
    const result = await oneRequest(clock, () => tablebaseLookup(PROMOTION_FEN));
    assert.equal(result?.category, "unknown");
  } finally {
    clock.restore();
  }
});

test("tablebaseLookup normalises missing depth fields and a missing move list to empty", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() =>
      jsonResponse({ category: "draw", checkmate: false, stalemate: true, dtz: null, dtm: null }),
    );
    const result = await oneRequest(clock, () => tablebaseLookup(PROMOTION_FEN));
    assert.equal(result?.dtz, null);
    assert.equal(result?.dtm, null);
    assert.deepEqual(result?.moves, [], "an absent move list is empty, not undefined");
    assert.equal(result?.stalemate, true);
  } finally {
    clock.restore();
  }
});

test("tablebaseLookup returns null for a position the tablebase does not cover", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => jsonResponse({ error: "too many pieces" }, 404));
    assert.equal(await oneRequest(clock, () => tablebaseLookup(PROMOTION_FEN)), null);
  } finally {
    clock.restore();
  }
});

test("tablebaseLookup returns null when the network is down rather than throwing", async () => {
  const clock = withFakeClock();
  try {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    assert.equal(await oneRequest(clock, () => tablebaseLookup(PROMOTION_FEN)), null);
  } finally {
    clock.restore();
  }
});
