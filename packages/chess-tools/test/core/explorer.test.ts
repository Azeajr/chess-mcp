import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeExplorerFilters,
  explorerFilterKey,
  explorerRequest,
  setExplorerToken,
  hasExplorerToken,
  DEFAULT_EXPLORER_SPEEDS,
  DEFAULT_EXPLORER_RATINGS,
} from "../../src/index.ts";
import { START_FEN } from "./fixtures.ts";

test("normalizeExplorerFilters fills in the lichess defaults when given nothing", () => {
  const normalized = normalizeExplorerFilters();
  assert.equal(normalized.db, "lichess");
  assert.equal(normalized.movesLimit, 12);
  assert.deepEqual(normalized.speeds, [...DEFAULT_EXPLORER_SPEEDS]);
  assert.deepEqual(normalized.ratings, [...DEFAULT_EXPLORER_RATINGS]);
  assert.equal(normalized.since, null);
  assert.equal(normalized.until, null);
});

/** Canonicalisation is what makes the cache key stable, so order and duplicates must not survive. */
test("normalizeExplorerFilters sorts and de-duplicates speeds and ratings", () => {
  const normalized = normalizeExplorerFilters({
    speeds: ["classical", "blitz", "blitz"],
    ratings: [2200, 1800, 2200],
  });
  assert.deepEqual(normalized.speeds, ["blitz", "classical"]);
  assert.deepEqual(normalized.ratings, [1800, 2200]);
});

test("normalizeExplorerFilters clears speeds and ratings for the masters database", () => {
  const normalized = normalizeExplorerFilters({ db: "masters" });
  assert.deepEqual(normalized.speeds, [], "masters has no speed population");
  assert.deepEqual(normalized.ratings, []);
});

test("normalizeExplorerFilters refuses population filters that masters cannot honour", () => {
  assert.throws(
    () => normalizeExplorerFilters({ db: "masters", speeds: ["blitz"] }),
    /explorer_unsupported_masters_population_filter/u,
  );
  assert.throws(
    () => normalizeExplorerFilters({ db: "masters", ratings: [2200] }),
    /explorer_unsupported_masters_population_filter/u,
  );
});

test("normalizeExplorerFilters bounds movesLimit to a whole number in 0..30", () => {
  assert.equal(normalizeExplorerFilters({ movesLimit: 0 }).movesLimit, 0);
  assert.equal(normalizeExplorerFilters({ movesLimit: 30 }).movesLimit, 30);
  assert.throws(() => normalizeExplorerFilters({ movesLimit: 31 }), /invalid_moves_limit/u);
  assert.throws(() => normalizeExplorerFilters({ movesLimit: -1 }), /invalid_moves_limit/u);
  assert.throws(() => normalizeExplorerFilters({ movesLimit: 1.5 }), /invalid_moves_limit/u);
});

/**
 * Regression guard. Validation lived inside the sort comparator, and `Array.prototype.sort` does
 * not invoke a comparator for a list of fewer than two elements — so exactly one bad value was
 * accepted while two were caught, and the bad value reached the request URL as `speeds=hyperbullet`.
 * Each case below is asserted at length one specifically.
 */
test("normalizeExplorerFilters rejects an unknown speed or rating bucket, even on its own", () => {
  assert.throws(
    () => normalizeExplorerFilters({ speeds: ["hyperbullet" as "blitz"] }),
    /explorer_invalid_speed/u,
    "a single invalid speed must not slip past the sort",
  );
  assert.throws(
    () => normalizeExplorerFilters({ ratings: [1500 as 1600] }),
    /invalid_rating_bucket/u,
    "a single invalid rating must not slip past the sort",
  );
  assert.throws(
    () => normalizeExplorerFilters({ speeds: ["hyperbullet" as "blitz", "teleport" as "blitz"] }),
    /explorer_invalid_speed/u,
  );
  assert.throws(
    () => normalizeExplorerFilters({ speeds: ["hyperbullet" as "blitz", "blitz"] }),
    /explorer_invalid_speed/u,
  );
});

test("an unknown speed never reaches the request URL", () => {
  assert.throws(
    () => explorerRequest(START_FEN, { speeds: ["hyperbullet" as "blitz"] }),
    /explorer_invalid_speed/u,
  );
});

test("normalizeExplorerFilters rejects an empty lichess population", () => {
  assert.throws(() => normalizeExplorerFilters({ speeds: [] }), /explorer_empty_speeds/u);
  assert.throws(() => normalizeExplorerFilters({ ratings: [] }), /explorer_empty_ratings/u);
});

/** lichess buckets by month, masters by year, so the same string is valid for only one of them. */
test("normalizeExplorerFilters applies the recency format each database actually uses", () => {
  assert.equal(normalizeExplorerFilters({ since: "2024-01" }).since, "2024-01");
  assert.equal(normalizeExplorerFilters({ db: "masters", since: "2024" }).since, "2024");

  assert.throws(() => normalizeExplorerFilters({ since: "2024" }), /explorer_invalid_since/u);
  assert.throws(
    () => normalizeExplorerFilters({ db: "masters", since: "2024-01" }),
    /explorer_invalid_since/u,
  );
  assert.throws(() => normalizeExplorerFilters({ until: "2024-13" }), /explorer_invalid_until/u);
  assert.throws(() => normalizeExplorerFilters({ since: "not-a-date" }), /explorer_invalid_since/u);
});

test("normalizeExplorerFilters rejects a recency range that runs backwards", () => {
  assert.throws(
    () => normalizeExplorerFilters({ since: "2024-06", until: "2024-01" }),
    /explorer_invalid_recency_range/u,
  );
  assert.doesNotThrow(() => normalizeExplorerFilters({ since: "2024-01", until: "2024-06" }));
  assert.doesNotThrow(
    () => normalizeExplorerFilters({ since: "2024-01", until: "2024-01" }),
    "the same month at both ends is a valid single-month window",
  );
});

/** The key is population identity only — two orderings of the same population are one population. */
test("explorerFilterKey is stable across equivalent filter spellings", () => {
  assert.equal(
    explorerFilterKey({ speeds: ["classical", "blitz"], ratings: [2200, 1800] }),
    explorerFilterKey({ speeds: ["blitz", "classical"], ratings: [1800, 2200] }),
  );
});

test("explorerFilterKey separates populations that really differ", () => {
  const base = explorerFilterKey();
  assert.notEqual(base, explorerFilterKey({ db: "masters" }));
  assert.notEqual(base, explorerFilterKey({ speeds: ["bullet"] }));
  assert.notEqual(base, explorerFilterKey({ movesLimit: 5 }));
  assert.notEqual(base, explorerFilterKey({ since: "2024-01" }));
});

test("explorerRequest builds the lichess URL with the normalised population", () => {
  const request = explorerRequest(START_FEN, { speeds: ["blitz"], ratings: [2000] });
  assert.match(request.url, /^https:\/\/explorer\.lichess\.org\/lichess\?/u);
  assert.match(request.url, /variant=standard/u);
  assert.match(request.url, /speeds=blitz/u);
  assert.match(request.url, /ratings=2000/u);
  assert.match(request.url, /moves=12/u);
  assert.equal(request.filters.db, "lichess");
});

test("explorerRequest builds the masters URL without a speed or rating population", () => {
  const request = explorerRequest(START_FEN, { db: "masters" });
  assert.match(request.url, /^https:\/\/explorer\.lichess\.org\/masters\?/u);
  assert.equal(/speeds=/u.test(request.url), false);
  assert.equal(/ratings=/u.test(request.url), false);
});

test("explorerRequest percent-encodes the FEN so its spaces cannot split the query", () => {
  const request = explorerRequest(START_FEN);
  assert.match(request.url, /fen=rnbqkbnr%2Fpppppppp/u);
  assert.equal(request.url.includes(" "), false);
});

test("explorerRequest appends recency bounds only when they were given", () => {
  assert.equal(/since=/u.test(explorerRequest(START_FEN).url), false);
  const bounded = explorerRequest(START_FEN, { since: "2024-01", until: "2024-06" });
  assert.match(bounded.url, /&since=2024-01/u);
  assert.match(bounded.url, /&until=2024-06/u);
});

/**
 * The cache key carries the position as a transposition key, so two FENs that differ only in their
 * clocks share a cache entry — the explorer's answer does not depend on the move number.
 */
test("explorerRequest keys the cache by transposition, ignoring the clocks", () => {
  const early = explorerRequest("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const later = explorerRequest("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 9 30");
  assert.equal(early.cache_key, later.cache_key);
  assert.notEqual(early.url, later.url, "the URL still asks for the exact FEN it was given");
});

test("explorerRequest separates the population key from the full cache key", () => {
  const request = explorerRequest(START_FEN);
  assert.equal(request.cache_key.startsWith(request.filter_key), true);
  assert.equal(
    request.filter_key,
    explorerFilterKey(),
    "the population half must match the standalone key",
  );
});

test("setExplorerToken treats blank input as no token at all", () => {
  const restore = hasExplorerToken();
  try {
    setExplorerToken("abc123");
    assert.equal(hasExplorerToken(), true);

    setExplorerToken("   ");
    assert.equal(hasExplorerToken(), false, "whitespace is not a token");

    setExplorerToken("abc123");
    setExplorerToken(null);
    assert.equal(hasExplorerToken(), false);
  } finally {
    if (!restore) setExplorerToken(null);
  }
});
